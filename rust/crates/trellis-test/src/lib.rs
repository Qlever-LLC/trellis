//! Private Rust integration-test helpers for live Trellis runtime scenarios.
//!
//! This crate is the Rust equivalent foundation for the TypeScript
//! `@qlever-llc/trellis-test` runtime helper. It owns isolated test workdirs,
//! managed NATS lifecycle, repo-local Trellis process lifecycle, readiness
//! probing, and deterministic cleanup. Admin/client/service automation will be
//! layered on this foundation as Rust live integration cases migrate.

use std::collections::{BTreeMap, HashMap};
use std::ffi::OsString;
use std::fmt;
use std::fs::{self, File};
use std::io::{self, Seek, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use sha2::Digest as _;

use async_nats::jetstream::{self, stream};
use async_nats::ConnectOptions;
use futures_util::StreamExt;
use rusqlite::{params_from_iter, types::Value as SqliteValue, Connection, Params};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};
use tempfile::TempDir;
use tokio::task::JoinHandle;
use trellis_local_bootstrap::{
    BootstrapAccounts, BootstrapPaths, BootstrapUsers,
    ContainerRuntime as BootstrapContainerRuntime, LocalBootstrapError, LocalNatsBootstrapManifest,
    LocalTrellisBootstrapManifest, LocalTrellisBootstrapOptions, LocalTrellisBootstrapPaths,
    LocalTrellisBootstrapUrls, PublicAccount, PublicUser,
};
use trellis_local_nats::{LocalNats, NatsBinarySource, NatsOutput};
use trellis_rs::client::{SessionAuth, TrellisClientError, UserConnectOptions};
use trellis_rs::generated::Caller;
use trellis_runtime_apis::auth::{self as auth_sdk, AuthClient as GeneratedAuthClient};

const DEFAULT_STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_RECONCILIATION_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_ADMIN_RPC_TIMEOUT_MS: u64 = 5_000;
const WORKDIR_OWNER_MARKER: &str = ".trellis-test-owner";
const TRELLIS_TEST_METRICS_ENV: &str = "TRELLIS_TEST_METRICS_PATH";

/// Records a process start in the active integration metrics stream.
#[doc(hidden)]
pub fn record_test_process_start(process: &str, detail: impl fmt::Display) -> io::Result<()> {
    let Some(path) = std::env::var_os(TRELLIS_TEST_METRICS_ENV) else {
        return Ok(());
    };
    let mut output = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    let line = format!(
        "{}\n",
        json!({
            "event": "process-start",
            "process": process,
            "detail": detail.to_string(),
            "pid": std::process::id(),
        })
    );
    output.write_all(line.as_bytes())
}
const SHARED_RUNTIME_ENV: &str = "TRELLIS_TEST_SHARED_RUNTIME";
const ADMIN_USERNAME: &str = "admin";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedRuntimeManifest {
    version: u8,
    trellis_url: String,
    nats_url: String,
    websocket_url: String,
    workdir: PathBuf,
    control_plane_sqlite_path: PathBuf,
    admin_password: String,
    admin_rpc_url: String,
    admin_rpc_token: String,
    test_oidc_issuer: String,
    tenants: BTreeMap<String, SharedTenantManifest>,
    assignments: BTreeMap<String, SharedRuntimeAssignment>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedRuntimeAssignment {
    mode: String,
    namespace: String,
    tenant_id: String,
}

#[derive(Clone, Debug, Deserialize)]
struct SharedTenantManifest {
    accounts: SharedAccounts,
    users: SharedUsers,
    paths: SharedPaths,
}

#[derive(Clone, Debug, Deserialize)]
struct SharedAccounts {
    system: SharedIdentity,
    auth: SharedIdentity,
    trellis: SharedIdentity,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedUsers {
    system: SharedIdentity,
    auth_service: SharedIdentity,
    trellis_service: SharedIdentity,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedIdentity {
    name: String,
    public_key: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedPaths {
    nats_config: String,
    jwt_config: String,
    creds: SharedCredentialPaths,
    secrets: SharedSecretPaths,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedCredentialPaths {
    system_service: String,
    auth_service: String,
    trellis_service: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedSecretPaths {
    auth_issuer_signing: String,
    auth_target_signing: String,
    auth_callout_x_key: String,
}

/// Error returned by Rust Trellis integration-test runtime helpers.
#[derive(Debug, thiserror::Error)]
pub enum TrellisTestError {
    /// Filesystem or process I/O failed.
    #[error(transparent)]
    Io(#[from] io::Error),

    /// Local NATS/Trellis bootstrap generation failed.
    #[error(transparent)]
    LocalBootstrap(#[from] LocalBootstrapError),

    /// Managed local NATS acquisition or lifecycle failed.
    #[error(transparent)]
    LocalNats(#[from] trellis_local_nats::LocalNatsError),

    /// Container or process output was not valid UTF-8.
    #[error(transparent)]
    Utf8(#[from] std::string::FromUtf8Error),

    /// HTTP readiness probing failed.
    #[error(transparent)]
    Http(#[from] reqwest::Error),

    /// JSON serialization or response parsing failed.
    #[error(transparent)]
    Json(#[from] serde_json::Error),

    /// Public Trellis client operation failed.
    #[error(transparent)]
    TrellisClient(#[from] TrellisClientError),

    /// Browser/admin authentication failed.
    #[error(transparent)]
    TrellisAuth(#[from] trellis_rs::auth::TrellisAuthError),

    /// A generated SDK call failed.
    #[error("generated SDK call failed: {0}")]
    GeneratedCall(String),

    /// Control-plane SQLite access failed.
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),

    /// An exact integration-test control could not be configured or observed.
    #[error("integration test control failed: {0}")]
    IntegrationControl(String),

    /// Contract manifest parsing or digesting failed.
    #[error(transparent)]
    Contract(#[from] trellis_rs::contracts::ContractsError),

    /// Protocol artifact or proof construction failed.
    #[error(transparent)]
    Protocol(Box<trellis_protocol::ProtocolError>),

    /// An auth or bootstrap URL did not include a flow id.
    #[error("Trellis auth URL is missing flowId: {0}")]
    MissingFlowId(String),

    /// The runtime did not emit a first-admin bootstrap URL before the deadline.
    #[error("timed out after {timeout:?} waiting for Trellis admin bootstrap URL in {log_path}")]
    BootstrapUrlTimeout {
        /// Trellis stdout log path that was inspected.
        log_path: String,
        /// Configured timeout.
        timeout: Duration,
    },

    /// A Trellis HTTP endpoint returned a non-success status.
    #[error("Trellis HTTP request failed ({status}) for {url}: {code}")]
    HttpStatus {
        /// Requested URL.
        url: String,
        /// HTTP status code.
        status: u16,
        /// Exact Trellis machine error code.
        code: String,
    },

    /// A Trellis flow endpoint returned an unexpected status.
    #[error("Trellis flow {flow_id} reached unexpected status '{status}'")]
    UnexpectedFlowStatus {
        /// Browser flow id.
        flow_id: String,
        /// Returned status string.
        status: String,
    },

    /// A Trellis response had an unsupported or malformed shape.
    #[error("unexpected Trellis response: {0}")]
    UnexpectedResponse(String),

    /// Deployment-authority reconciliation failed.
    #[error("Trellis deployment '{deployment}' reconciliation failed: {message}")]
    ReconciliationFailed {
        /// Deployment id.
        deployment: String,
        /// Failure message returned by auth.
        message: String,
    },

    /// Deployment-authority reconciliation did not complete before the deadline.
    #[error("timed out after {timeout:?} waiting for deployment '{deployment}' reconciliation")]
    ReconciliationTimeout {
        /// Deployment id.
        deployment: String,
        /// Configured timeout.
        timeout: Duration,
    },

    /// A deployment authority plan classification was not eligible for auto-acceptance.
    #[error("authority plan classification '{classification}' is not in allowed set: {allowed}")]
    DisallowedAuthorityPlan {
        /// Plan classification returned by auth.
        classification: String,
        /// Displayed allowed classification list.
        allowed: String,
    },

    /// The Trellis control-plane process exited before becoming ready.
    #[error("Trellis process exited before readiness ({status}) while polling {url}")]
    TrellisExitedBeforeReady {
        /// Trellis `/version` URL.
        url: String,
        /// Child process exit status.
        status: String,
    },

    /// Trellis readiness did not complete before the deadline.
    #[error("timed out after {timeout:?} waiting for Trellis readiness at {url}")]
    TrellisReadyTimeout {
        /// Trellis `/version` URL.
        url: String,
        /// Configured timeout.
        timeout: Duration,
    },

    /// Trellis cleanup failed after a previous operation failed.
    #[error("Trellis test runtime cleanup failed after startup error: startup={startup}; cleanup={cleanup}")]
    StartupCleanupFailed {
        /// Original startup error.
        startup: Box<TrellisTestError>,
        /// Cleanup error.
        cleanup: Box<TrellisTestError>,
    },
}

impl From<trellis_protocol::ProtocolError> for TrellisTestError {
    fn from(error: trellis_protocol::ProtocolError) -> Self {
        Self::Protocol(Box::new(error))
    }
}

/// Send deliberately malformed RPC input through an authenticated test caller.
pub async fn call_malformed_rpc(
    caller: &Caller,
    subject: &str,
    input: &Value,
) -> Result<Value, TrellisClientError> {
    caller.test_request_json_value(subject, input).await
}

/// Download transfer bytes through an authenticated test caller.
pub async fn download_transfer(
    caller: &Caller,
    grant: &trellis_rs::generated::DownloadTransferGrant,
) -> Result<Vec<u8>, TrellisClientError> {
    caller.download_transfer(grant).await
}

/// Connect an ad hoc service runtime through the normal authenticated bootstrap flow.
pub async fn connect_service_runtime<C>(
    trellis_url: &str,
    key: &TrellisTestServiceKey,
) -> Result<trellis_rs::service::ConnectedServiceRuntime<C>, trellis_rs::service::ServiceRuntimeError>
{
    let session_seed = random_session_seed();
    let referenced_api_artifacts = key
        .referenced_api_artifacts
        .iter()
        .map(|(json, digest)| (json.as_str(), digest.as_str()))
        .collect::<Vec<_>>();
    trellis_rs::generated::test_connect_service_runtime(
        trellis_rs::client::ServiceConnectWithContractOptions {
            trellis_url,
            participant_id: &key.participant_id,
            participant_digest: &key.participant_digest,
            participant_json: &key.participant_json,
            api_json: &key.api_json,
            api_digest: &key.api_digest,
            referenced_api_artifacts: &referenced_api_artifacts,
            deployment_id: &key.deployment_id,
            instance_id: &key.instance_id,
            provisioned_identity_seed_base64url: &key.identity_seed,
            participant_needs_digest: &key.participant_needs_digest,
            session_key_seed_base64url: &session_seed,
            timeout_ms: 30_000,
            retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
            authority_pending_timeout_ms: trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            authorization_context_store: std::sync::Arc::new(
                trellis_rs::client::MemoryAuthorizationContextStore::default(),
            ),
        },
    )
    .await
}

/// Build device connection and activation options for a runtime-authored test contract.
pub fn device_connect_options<'a>(
    trellis_url: &'a str,
    approval: &'a TrellisTestContractApproval,
    deployment_id: &'a str,
    instance_id: &'a str,
    identity: &'a trellis_rs::auth::DeviceIdentity,
    authorization_context_store: std::sync::Arc<dyn trellis_rs::client::AuthorizationContextStore>,
) -> trellis_rs::client::DeviceConnectOptions<'a, trellis_rs::generated::DynamicDeviceContract> {
    let contract = trellis_rs::client::DeviceContractEvidence::for_test(
        &approval.participant_id,
        &approval.participant_digest,
        &approval.participant_needs_digest,
        &approval.participant_json,
        &approval.api_json,
        &approval.api_digest,
        &approval
            .referenced_api_artifacts
            .iter()
            .map(|(json, digest)| (json.as_str(), digest.as_str()))
            .collect::<Vec<_>>(),
    );
    trellis_rs::generated::test_device_connect_options(
        trellis_url,
        deployment_id,
        instance_id,
        contract,
        &identity.public_identity_key,
        &identity.identity_seed_base64url,
        authorization_context_store,
    )
}

impl<E: std::fmt::Debug> From<trellis_rs::client::CallError<E>> for TrellisTestError {
    fn from(error: trellis_rs::client::CallError<E>) -> Self {
        Self::GeneratedCall(format!("{error:?}"))
    }
}

/// Container runtime used for nsc bootstrap generation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContainerRuntime {
    /// Detect Podman first and then Docker.
    Auto,
    /// Use Podman and add SELinux mount relabeling.
    Podman,
    /// Use Docker without SELinux mount relabeling.
    Docker,
}

impl ContainerRuntime {
    fn to_bootstrap(self) -> BootstrapContainerRuntime {
        match self {
            Self::Auto => BootstrapContainerRuntime::Auto,
            Self::Podman => BootstrapContainerRuntime::Podman,
            Self::Docker => BootstrapContainerRuntime::Docker,
        }
    }
}

/// Command used to spawn the repo-local Trellis control-plane process.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisProcessCommand {
    program: OsString,
    args: Vec<OsString>,
    current_dir: PathBuf,
    envs: Vec<(OsString, OsString)>,
}

impl TrellisProcessCommand {
    /// Build a command descriptor.
    #[must_use]
    pub fn new(
        program: impl Into<OsString>,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        current_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            program: program.into(),
            args: args.into_iter().map(Into::into).collect(),
            current_dir: current_dir.into(),
            envs: Vec::new(),
        }
    }

    /// Add one environment variable to the spawned command.
    #[must_use]
    pub fn env(mut self, key: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.envs.push((key.into(), value.into()));
        self
    }

    /// Return a display-only command string for diagnostics.
    #[must_use]
    pub fn display_command(&self) -> String {
        let mut parts = Vec::with_capacity(self.args.len() + 1);
        parts.push(self.program.to_string_lossy().into_owned());
        parts.extend(
            self.args
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned()),
        );
        parts.join(" ")
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.args).current_dir(&self.current_dir);
        for (key, value) in &self.envs {
            command.env(key, value);
        }
        command
    }
}

/// Options used to start an isolated Trellis test runtime.
#[derive(Clone, Debug)]
pub struct TrellisTestRuntimeOptions {
    /// Preserve the temp workdir after the runtime is dropped or stopped.
    pub keep_workdir: bool,
    /// Container runtime used for NATS credential generation and NATS itself.
    pub container_runtime: ContainerRuntime,
    /// Trellis process startup timeout.
    pub startup_timeout: Duration,
    /// Trellis process shutdown timeout.
    pub shutdown_timeout: Duration,
    /// Command used to spawn Trellis.
    pub trellis_command: TrellisProcessCommand,
    /// Default service deployment id used by admin automation helpers.
    pub default_deployment: String,
    /// Whether deployment creation should request mutable-dev compatibility.
    pub default_mutable_dev: bool,
    /// Timeout for deployment-authority reconciliation polling.
    pub reconciliation_timeout: Duration,
    /// Optional first-admin password. A random test password is generated when absent.
    pub admin_password: Option<String>,
    /// OAuth/OIDC providers injected into the isolated test control-plane config.
    pub oauth_providers: Map<String, Value>,
    /// Optional NATS user-JWT TTL injected into the platform config.
    pub nats_user_jwt_ttl_ms: Option<u64>,
    /// Whether an isolated process should use the shared standards-based test OIDC provider.
    pub use_shared_test_oidc_provider: bool,
    /// Advertise NATS through a rotatable real TCP proxy for reconnect tests.
    pub rotatable_nats_proxy: bool,
}

impl TrellisTestRuntimeOptions {
    /// Build options for the repo-local Trellis service command.
    #[must_use]
    pub fn repo_default() -> Self {
        Self {
            keep_workdir: keep_workdir_from_env(),
            container_runtime: ContainerRuntime::Auto,
            startup_timeout: DEFAULT_STARTUP_TIMEOUT,
            shutdown_timeout: DEFAULT_SHUTDOWN_TIMEOUT,
            trellis_command: repo_trellis_command(),
            default_deployment: "test".to_string(),
            default_mutable_dev: true,
            reconciliation_timeout: DEFAULT_RECONCILIATION_TIMEOUT,
            admin_password: None,
            oauth_providers: Map::new(),
            nats_user_jwt_ttl_ms: None,
            use_shared_test_oidc_provider: false,
            rotatable_nats_proxy: false,
        }
    }

    /// Build options for the repo-local platform-only command.
    #[must_use]
    pub fn repo_platform() -> Self {
        let mut options = Self::repo_default();
        options.trellis_command = repo_trellis_mode_command("platform");
        options
    }
}

impl Default for TrellisTestRuntimeOptions {
    fn default() -> Self {
        Self::repo_default()
    }
}

/// Runs one isolated Trellis control plane and NATS server for Rust integration tests.
#[derive(Debug)]
pub struct TrellisTestRuntime {
    workdir: IntegrationWorkdir,
    _port_reservation: Option<TrellisTestPortReservation>,
    nats: Option<LocalNatsProcess>,
    nats_proxy: Option<NatsTcpProxy>,
    nats_websocket_proxy: Option<NatsTcpProxy>,
    retiring_nats_proxy: Option<NatsTcpProxy>,
    retiring_nats_websocket_proxy: Option<NatsTcpProxy>,
    trellis: Option<TrellisProcess>,
    trellis_url: String,
    nats_url: String,
    nats_upstream_url: String,
    nats_websocket_url: String,
    nats_websocket_upstream_url: String,
    manifest: LocalTrellisBootstrapManifest,
    admin_password: String,
    default_deployment: String,
    default_mutable_dev: bool,
    reconciliation_timeout: Duration,
    startup_timeout: Duration,
    shutdown_timeout: Duration,
    trellis_command: TrellisProcessCommand,
    admin_rpc: Option<AdminRpcProxy>,
    test_control_rpc: Option<AdminRpcProxy>,
    attached: bool,
    control_plane_path: PathBuf,
}

/// Row returned by a control-plane SQLite query.
pub type TrellisControlPlaneSqliteRow = Map<String, Value>;

/// Result returned by a control-plane SQLite write.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisControlPlaneSqliteExecuteResult {
    /// Number of rows affected by the write.
    pub rows_affected: usize,
}

/// Snapshot of a removed control-plane session row.
#[derive(Clone, Debug, PartialEq)]
pub struct TrellisControlPlaneSessionSnapshot {
    sqlite: TrellisControlPlaneSqlite,
    row: TrellisControlPlaneSqliteRow,
}

impl TrellisControlPlaneSessionSnapshot {
    /// Restores the captured session row if it has not already been recreated.
    pub fn restore(&self) -> Result<TrellisControlPlaneSqliteExecuteResult, TrellisTestError> {
        let columns = self.row.keys().cloned().collect::<Vec<_>>();
        let column_sql = columns
            .iter()
            .map(|column| format!("\"{}\"", column.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(", ");
        let placeholders = vec!["?"; columns.len()].join(", ");
        let values = columns
            .iter()
            .map(|column| json_to_sqlite_value(&self.row[column]))
            .collect::<Vec<_>>();

        self.sqlite.execute(
            &format!("INSERT OR IGNORE INTO auth_sessions ({column_sql}) VALUES ({placeholders})"),
            params_from_iter(values),
        )
    }
}

/// Direct SQLite access for the isolated Trellis control plane under test.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisControlPlaneSqlite {
    path: PathBuf,
}

impl TrellisControlPlaneSqlite {
    /// Build a handle for a control-plane SQLite database path.
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Return the backing SQLite database path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Runs a SQL query against the live control-plane database.
    pub fn query<P>(
        &self,
        sql: &str,
        params: P,
    ) -> Result<Vec<TrellisControlPlaneSqliteRow>, TrellisTestError>
    where
        P: Params,
    {
        let connection = self.connection()?;
        let mut statement = connection.prepare(sql)?;
        let column_names = statement
            .column_names()
            .iter()
            .map(|name| (*name).to_string())
            .collect::<Vec<_>>();
        let mut rows = statement.query(params)?;
        let mut result = Vec::new();

        while let Some(row) = rows.next()? {
            let mut object = Map::new();
            for (index, name) in column_names.iter().enumerate() {
                let value = row.get::<_, SqliteValue>(index)?;
                object.insert(name.clone(), sqlite_value_to_json(value));
            }
            result.push(object);
        }

        Ok(result)
    }

    /// Runs a SQL write against the live control-plane database.
    pub fn execute<P>(
        &self,
        sql: &str,
        params: P,
    ) -> Result<TrellisControlPlaneSqliteExecuteResult, TrellisTestError>
    where
        P: Params,
    {
        let connection = self.connection()?;
        let rows_affected = connection.execute(sql, params)?;
        Ok(TrellisControlPlaneSqliteExecuteResult { rows_affected })
    }

    /// Deletes and returns one session row so tests can restore it later.
    pub fn take_session(
        &self,
        session_key: &str,
    ) -> Result<Option<TrellisControlPlaneSessionSnapshot>, TrellisTestError> {
        let rows = self.query(
            "SELECT * FROM auth_sessions WHERE session_public_key = ?",
            [session_key],
        )?;
        let Some(row) = rows.into_iter().next() else {
            return Ok(None);
        };
        if let Some(session_id) = row.get("session_id").and_then(Value::as_str) {
            let context_table = self.query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_authorization_contexts'",
                [],
            )?;
            if !context_table.is_empty() {
                self.execute(
                    "DELETE FROM auth_authorization_contexts WHERE session_id = ?",
                    [session_id],
                )?;
            }
        }
        self.execute(
            "DELETE FROM auth_sessions WHERE session_public_key = ?",
            [session_key],
        )?;
        Ok(Some(TrellisControlPlaneSessionSnapshot {
            sqlite: self.clone(),
            row,
        }))
    }

    fn connection(&self) -> Result<Connection, TrellisTestError> {
        let connection = Connection::open(&self.path)?;
        connection.busy_timeout(Duration::from_millis(5_000))?;
        Ok(connection)
    }
}

/// JetStream consumer metadata exposed by the Rust integration-test harness.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisJetStreamConsumerInfo {
    /// JetStream consumer name.
    pub name: String,
    /// Durable consumer name, when the consumer is durable.
    pub durable_name: Option<String>,
    /// Concrete filter subjects configured on the consumer.
    pub filter_subjects: Vec<String>,
    /// Number of active pull requests waiting on the consumer.
    pub num_waiting: usize,
    /// Number of messages delivered to clients and still awaiting acknowledgement.
    pub num_ack_pending: usize,
    /// Number of messages pending delivery for the consumer.
    pub num_pending: usize,
}

/// One observed JetStream acknowledgement protocol frame.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisJetStreamAckFrame {
    /// ACK protocol subject the frame was published to.
    pub subject: String,
    /// UTF-8 lossy payload text, such as `+ACK` or `-NAK`.
    pub payload: String,
}

/// One observed raw NATS message frame.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisNatsMessageFrame {
    /// NATS subject the frame was published to.
    pub subject: String,
    /// UTF-8 lossy payload text.
    pub payload: String,
}

/// Raw auth connection-presence entry seeded for malformed live-runtime tests.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisRawAuthConnectionPresence {
    /// Raw key in the `trellis_auth_connections` KV bucket.
    pub key: String,
    /// Raw JSON value written to the `trellis_auth_connections` KV bucket.
    pub value: Value,
}

/// Observable configuration and records for the auth connection-presence bucket.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisAuthConnectionPresenceStatus {
    /// Configured retention for presence entries.
    pub max_age: Duration,
    /// Current raw presence records, keyed by physical connection identity.
    pub records: BTreeMap<String, Value>,
}

/// Raw state entry seeded for malformed live-runtime tests.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisRawStateEntry {
    /// Raw key in the `trellis_state` KV bucket.
    pub key: String,
    /// Raw JSON value written to the `trellis_state` KV bucket.
    pub value: Value,
}

/// Live NATS observer for JetStream acknowledgement protocol frames.
pub struct TrellisJetStreamAckObserver {
    _client: async_nats::Client,
    frames: Arc<Mutex<Vec<TrellisJetStreamAckFrame>>>,
    errors: Arc<Mutex<Vec<String>>>,
    task: Option<JoinHandle<()>>,
}

impl TrellisJetStreamAckObserver {
    /// Return a snapshot of observed ACK protocol frames.
    #[must_use]
    pub fn frames(&self) -> Vec<TrellisJetStreamAckFrame> {
        self.frames
            .lock()
            .expect("lock ACK observer frames")
            .clone()
    }

    /// Return a snapshot of observer errors.
    #[must_use]
    pub fn errors(&self) -> Vec<String> {
        self.errors
            .lock()
            .expect("lock ACK observer errors")
            .clone()
    }

    /// Stop the observer task.
    pub async fn stop(mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
            let _ = task.await;
        }
    }
}

impl Drop for TrellisJetStreamAckObserver {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

/// Live NATS observer for raw messages on a selected subject.
pub struct TrellisNatsMessageObserver {
    subject: String,
    _client: async_nats::Client,
    frames: Arc<Mutex<Vec<TrellisNatsMessageFrame>>>,
    task: Option<JoinHandle<()>>,
}

impl fmt::Debug for TrellisNatsMessageObserver {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrellisNatsMessageObserver")
            .field("subject", &self.subject)
            .field("frame_count", &self.frames().len())
            .finish_non_exhaustive()
    }
}

impl TrellisNatsMessageObserver {
    /// Return the subject pattern observed by this observer.
    #[must_use]
    pub fn subject(&self) -> &str {
        &self.subject
    }

    /// Return a snapshot of observed NATS message frames.
    #[must_use]
    pub fn frames(&self) -> Vec<TrellisNatsMessageFrame> {
        self.frames
            .lock()
            .expect("lock NATS message observer frames")
            .clone()
    }

    /// Stop the observer task.
    pub async fn stop(mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
            let _ = task.await;
        }
    }
}

impl Drop for TrellisNatsMessageObserver {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

fn shared_runtime_assignment() -> Result<
    Option<(
        SharedRuntimeManifest,
        SharedTenantManifest,
        SharedRuntimeAssignment,
    )>,
    TrellisTestError,
> {
    let Some(path) = std::env::var_os(SHARED_RUNTIME_ENV) else {
        return Ok(None);
    };
    let tenant_id = std::thread::current()
        .name()
        .map(str::to_string)
        .ok_or_else(|| {
            TrellisTestError::UnexpectedResponse(
                "shared Rust integration runtime requires a named test thread".to_string(),
            )
        })?;
    let manifest: SharedRuntimeManifest = serde_json::from_slice(&fs::read(path)?)?;
    if manifest.version != 5 {
        return Err(TrellisTestError::UnexpectedResponse(format!(
            "unsupported shared Rust integration runtime manifest version {}",
            manifest.version
        )));
    }
    let assignment = manifest
        .assignments
        .get(&tenant_id)
        .cloned()
        .ok_or_else(|| {
            TrellisTestError::UnexpectedResponse(format!(
                "shared Rust integration runtime has no assignment for {tenant_id}"
            ))
        })?;
    let tenant = manifest
        .tenants
        .get(&assignment.tenant_id)
        .cloned()
        .ok_or_else(|| {
            TrellisTestError::UnexpectedResponse(format!(
                "shared Rust integration runtime has no tenant {}",
                assignment.tenant_id
            ))
        })?;
    Ok(Some((manifest, tenant, assignment)))
}

fn materialize_shared_runtime(
    workdir: &Path,
    shared: &SharedRuntimeManifest,
    tenant: &SharedTenantManifest,
    options: &LocalTrellisBootstrapOptions,
) -> Result<LocalTrellisBootstrapManifest, TrellisTestError> {
    let shared_nats = shared.workdir.join("nats");
    let local_nats = workdir.join("nats");
    fs::create_dir_all(local_nats.join("creds"))?;
    fs::create_dir_all(local_nats.join("secrets"))?;
    fs::create_dir_all(workdir.join("trellis/data"))?;
    trellis_local_bootstrap::generate_local_authorization_trust(
        &workdir.join("trellis/auth"),
        "trellis-test",
    )?;

    for (source, target) in [
        (&tenant.paths.nats_config, "nats.conf"),
        (&tenant.paths.jwt_config, "jwt.conf"),
        (&tenant.paths.creds.system_service, "creds/system.creds"),
        (&tenant.paths.creds.auth_service, "creds/auth-auth.creds"),
        (
            &tenant.paths.creds.trellis_service,
            "creds/trellis-auth.creds",
        ),
        (
            &tenant.paths.secrets.auth_issuer_signing,
            "secrets/auth-issuer-signing.seed",
        ),
        (
            &tenant.paths.secrets.auth_target_signing,
            "secrets/auth-target-signing.seed",
        ),
        (
            &tenant.paths.secrets.auth_callout_x_key,
            "secrets/auth-sx.seed",
        ),
    ] {
        fs::copy(shared_nats.join(source), local_nats.join(target))?;
    }
    fs::write(
        workdir.join("trellis/session.seed"),
        format!("{}\n", random_session_seed()),
    )?;

    let manifest = LocalTrellisBootstrapManifest {
        version: 1,
        nats: LocalNatsBootstrapManifest {
            version: 1,
            nats_box_image: String::new(),
            operator_name: "Qlever".to_string(),
            server_name: "trellis-test".to_string(),
            accounts: BootstrapAccounts {
                system: shared_account(&tenant.accounts.system),
                auth: shared_account(&tenant.accounts.auth),
                trellis: shared_account(&tenant.accounts.trellis),
            },
            users: BootstrapUsers {
                system: shared_user(&tenant.users.system),
                auth_service: shared_user(&tenant.users.auth_service),
                trellis_service: shared_user(&tenant.users.trellis_service),
            },
            paths: BootstrapPaths {
                nats_config: "nats.conf".to_string(),
                jwt_config: "jwt.conf".to_string(),
                account_jwts: BTreeMap::new(),
                creds: BTreeMap::from([
                    (
                        "systemService".to_string(),
                        "creds/system.creds".to_string(),
                    ),
                    (
                        "authService".to_string(),
                        "creds/auth-auth.creds".to_string(),
                    ),
                    (
                        "trellisService".to_string(),
                        "creds/trellis-auth.creds".to_string(),
                    ),
                ]),
                secrets: BTreeMap::from([
                    (
                        "authIssuerSigning".to_string(),
                        "secrets/auth-issuer-signing.seed".to_string(),
                    ),
                    (
                        "authTargetSigning".to_string(),
                        "secrets/auth-target-signing.seed".to_string(),
                    ),
                    (
                        "authCalloutXKey".to_string(),
                        "secrets/auth-sx.seed".to_string(),
                    ),
                ]),
                auth_callout_env: "auth-callout.env".to_string(),
            },
        },
        paths: LocalTrellisBootstrapPaths {
            nats_manifest: "nats/manifest.json".to_string(),
            trellis_config: "trellis/config.toml".to_string(),
            session_seed: "trellis/session.seed".to_string(),
            authorization_root_seed: "trust/authorization-root.seed".to_string(),
            trellis_data: "trellis/data".to_string(),
        },
        urls: LocalTrellisBootstrapUrls {
            public_origin: options.public_origin.clone(),
            nats_server: shared.nats_url.clone(),
            nats_websocket: shared.websocket_url.clone(),
            oauth_redirect_base: format!("{}/auth/callback", options.public_origin),
        },
    };
    fs::write(
        workdir.join(&manifest.paths.nats_manifest),
        serde_json::to_string_pretty(&manifest.nats)? + "\n",
    )?;
    Ok(manifest)
}

fn shared_account(identity: &SharedIdentity) -> PublicAccount {
    PublicAccount {
        name: identity.name.clone(),
        public_key: identity.public_key.clone(),
    }
}

fn shared_user(identity: &SharedIdentity) -> PublicUser {
    PublicUser {
        name: identity.name.clone(),
        public_key: identity.public_key.clone(),
    }
}

impl TrellisTestRuntime {
    /// Start an isolated NATS container and repo-local Trellis control plane.
    pub async fn start(mut options: TrellisTestRuntimeOptions) -> Result<Self, TrellisTestError> {
        let workdir = IntegrationWorkdir::create(options.keep_workdir)?;
        let shared_runtime = shared_runtime_assignment()?;
        if options.use_shared_test_oidc_provider {
            let issuer = shared_runtime
                .as_ref()
                .ok_or_else(|| {
                    TrellisTestError::UnexpectedResponse(
                        "shared test OIDC provider requires a shared runtime manifest".to_owned(),
                    )
                })?
                .0
                .test_oidc_issuer
                .clone();
            for provider_id in ["test-oidc", "other-oidc"] {
                options.oauth_providers.insert(
                    provider_id.to_owned(),
                    json!({
                        "type": "oidc",
                        "issuer": issuer,
                        "client_id": "trellis-test-client",
                        "display_name": "Test OIDC",
                        "role_claims": ["/roles"],
                    }),
                );
            }
        }
        let test_control_rpc = shared_runtime.as_ref().map(|(shared, _, _)| AdminRpcProxy {
            url: shared.admin_rpc_url.clone(),
            token: shared.admin_rpc_token.clone(),
        });
        let mut port_reservation = reserve_local_port()?;
        let port = port_reservation.port()?;
        let trellis_url = format!("http://127.0.0.1:{port}");
        let mut bootstrap_options = LocalTrellisBootstrapOptions::new(workdir.path());
        bootstrap_options.force = false;
        bootstrap_options.container_runtime = options.container_runtime.to_bootstrap();
        bootstrap_options.trellis_port = port;
        bootstrap_options.public_origin = trellis_url.clone();
        if let Some((shared, _, _)) = &shared_runtime {
            bootstrap_options
                .nats_server_url
                .clone_from(&shared.nats_url);
            bootstrap_options
                .nats_websocket_url
                .clone_from(&shared.websocket_url);
        }
        let manifest = match &shared_runtime {
            Some((shared, tenant, _)) => {
                materialize_shared_runtime(workdir.path(), shared, tenant, &bootstrap_options)?
            }
            None => trellis_local_bootstrap::generate_local_trellis_bootstrap(&bootstrap_options)?,
        };
        fs::write(
            workdir.path().join(WORKDIR_OWNER_MARKER),
            format!("{}\n", std::process::id()),
        )?;

        if let Some((shared, _, assignment)) = &shared_runtime {
            if assignment.mode == "shared" {
                return Ok(Self {
                    workdir,
                    _port_reservation: None,
                    nats: None,
                    nats_proxy: None,
                    nats_websocket_proxy: None,
                    retiring_nats_proxy: None,
                    retiring_nats_websocket_proxy: None,
                    trellis: None,
                    trellis_url: shared.trellis_url.clone(),
                    nats_url: shared.nats_url.clone(),
                    nats_upstream_url: shared.nats_url.clone(),
                    nats_websocket_url: shared.websocket_url.clone(),
                    nats_websocket_upstream_url: shared.websocket_url.clone(),
                    manifest,
                    admin_password: shared.admin_password.clone(),
                    default_deployment: format!("{}-deployment", assignment.namespace),
                    default_mutable_dev: options.default_mutable_dev,
                    reconciliation_timeout: options.reconciliation_timeout,
                    startup_timeout: options.startup_timeout,
                    shutdown_timeout: options.shutdown_timeout,
                    trellis_command: options.trellis_command,
                    admin_rpc: Some(AdminRpcProxy {
                        url: shared.admin_rpc_url.clone(),
                        token: shared.admin_rpc_token.clone(),
                    }),
                    test_control_rpc,
                    attached: true,
                    control_plane_path: shared.control_plane_sqlite_path.clone(),
                });
            }
        }

        let mut nats = None;
        let mut nats_proxy = None;
        let mut nats_websocket_proxy = None;
        let mut trellis = None;
        let started = async {
            let started_nats = if shared_runtime.is_some() {
                None
            } else {
                Some(LocalNatsProcess::start(&workdir)?)
            };
            if let Some(started_nats) = &started_nats {
                bootstrap_options.nats_server_url = started_nats.nats_url();
                bootstrap_options.nats_websocket_url = started_nats.websocket_url();
            }
            let nats_upstream_url = bootstrap_options.nats_server_url.clone();
            let nats_websocket_upstream_url = bootstrap_options.nats_websocket_url.clone();
            if options.rotatable_nats_proxy {
                let proxy = NatsTcpProxy::start(&nats_upstream_url).await?;
                bootstrap_options.nats_server_url = proxy.url.clone();
                nats_proxy = Some(proxy);
                let websocket_proxy = NatsTcpProxy::start(&nats_websocket_upstream_url).await?;
                bootstrap_options.nats_websocket_url = websocket_proxy.url.clone();
                nats_websocket_proxy = Some(websocket_proxy);
            }
            rewrite_trellis_config(workdir.path(), &manifest, &bootstrap_options, &options)?;
            ensure_shared_streams(
                &bootstrap_options.nats_server_url,
                &trellis_creds_path(workdir.path()),
            )
            .await?;

            let config_path = workdir.path().join(&manifest.paths.trellis_config);
            port_reservation.release_listener();
            let started_trellis = TrellisProcess::start(
                &options.trellis_command,
                &config_path,
                workdir.path(),
                &trellis_url,
                options.startup_timeout,
                options.shutdown_timeout,
            )
            .await?;
            let nats_url = bootstrap_options.nats_server_url.clone();
            let nats_websocket_url = bootstrap_options.nats_websocket_url.clone();
            nats = started_nats;
            trellis = Some(started_trellis);
            Ok::<_, TrellisTestError>((
                nats_url,
                nats_websocket_url,
                nats_upstream_url,
                nats_websocket_upstream_url,
            ))
        }
        .await;

        let (nats_url, nats_websocket_url, nats_upstream_url, nats_websocket_upstream_url) =
            match started {
                Ok(urls) => urls,
                Err(error) => {
                    let cleanup =
                        cleanup_started(&mut trellis, &mut nats, options.shutdown_timeout);
                    if let Err(cleanup_error) = cleanup {
                        return Err(TrellisTestError::StartupCleanupFailed {
                            startup: Box::new(error),
                            cleanup: Box::new(cleanup_error),
                        });
                    }
                    return Err(error);
                }
            };

        let control_plane_path = control_plane_sqlite_path(workdir.path());
        Ok(Self {
            workdir,
            _port_reservation: Some(port_reservation),
            nats,
            nats_proxy,
            nats_websocket_proxy,
            retiring_nats_proxy: None,
            retiring_nats_websocket_proxy: None,
            trellis,
            trellis_url,
            nats_url,
            nats_upstream_url,
            nats_websocket_url,
            nats_websocket_upstream_url,
            manifest,
            admin_password: options
                .admin_password
                .unwrap_or_else(|| format!("trellis-test-{}", random_session_seed())),
            default_deployment: options.default_deployment,
            default_mutable_dev: options.default_mutable_dev,
            reconciliation_timeout: options.reconciliation_timeout,
            startup_timeout: options.startup_timeout,
            shutdown_timeout: options.shutdown_timeout,
            trellis_command: options.trellis_command,
            admin_rpc: None,
            test_control_rpc,
            attached: false,
            control_plane_path,
        })
    }

    /// Build a physical name isolated to this integration runtime.
    #[must_use]
    pub fn integration_name(&self, prefix: &str) -> String {
        format!("{prefix}-{}", self.default_deployment)
    }

    /// Return the Trellis HTTP base URL.
    #[must_use]
    pub fn trellis_url(&self) -> &str {
        &self.trellis_url
    }

    /// Return the native NATS URL.
    #[must_use]
    pub fn nats_url(&self) -> &str {
        &self.nats_url
    }

    /// Return the browser-facing NATS websocket URL.
    #[must_use]
    pub fn nats_websocket_url(&self) -> &str {
        &self.nats_websocket_url
    }

    /// Return the isolated runtime workdir.
    #[must_use]
    pub fn workdir(&self) -> &Path {
        self.workdir.path()
    }

    /// Return direct SQLite access for the runtime-owned Trellis control plane.
    #[must_use]
    pub fn control_plane_sqlite(&self) -> TrellisControlPlaneSqlite {
        TrellisControlPlaneSqlite::new(self.control_plane_path.clone())
    }

    /// List JetStream consumers on the shared Trellis event stream.
    pub async fn list_trellis_jetstream_consumers(
        &self,
    ) -> Result<Vec<TrellisJetStreamConsumerInfo>, TrellisTestError> {
        let client = ConnectOptions::new()
            .credentials_file(trellis_creds_path(self.workdir.path()))
            .await?
            .connect(&self.nats_url)
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
        let js = jetstream::new(client);
        let stream = js.get_stream("trellis").await.map_err(io::Error::other)?;
        let mut consumers = stream.consumers();
        let mut infos = Vec::new();

        while let Some(info) = consumers.next().await {
            let info = info.map_err(io::Error::other)?;
            let mut filter_subjects = Vec::new();
            if !info.config.filter_subject.is_empty() {
                filter_subjects.push(info.config.filter_subject.clone());
            }
            filter_subjects.extend(info.config.filter_subjects.clone());
            infos.push(TrellisJetStreamConsumerInfo {
                name: info.name,
                durable_name: info.config.durable_name,
                filter_subjects,
                num_waiting: info.num_waiting,
                num_ack_pending: info.num_ack_pending,
                num_pending: usize::try_from(info.num_pending).unwrap_or(usize::MAX),
            });
        }

        Ok(infos)
    }

    /// Start a live NATS observer for JetStream consumer ACK frames.
    pub async fn start_jetstream_ack_observer(
        &self,
    ) -> Result<TrellisJetStreamAckObserver, TrellisTestError> {
        self.start_jetstream_ack_observer_on("$JS.ACK.trellis.>")
            .await
    }

    /// Start a live NATS observer for JetStream publisher ACK reply frames.
    pub async fn start_jetstream_publish_ack_observer(
        &self,
    ) -> Result<TrellisJetStreamAckObserver, TrellisTestError> {
        self.start_jetstream_ack_observer_on("_INBOX.>").await
    }

    async fn start_jetstream_ack_observer_on(
        &self,
        subject: &str,
    ) -> Result<TrellisJetStreamAckObserver, TrellisTestError> {
        let client = ConnectOptions::new()
            .credentials_file(trellis_creds_path(self.workdir.path()))
            .await?
            .connect(&self.nats_url)
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
        let mut subscription = client
            .subscribe(subject.to_owned())
            .await
            .map_err(io::Error::other)?;
        client.flush().await.map_err(io::Error::other)?;

        let frames = Arc::new(Mutex::new(Vec::new()));
        let errors = Arc::new(Mutex::new(Vec::new()));
        let task_frames = Arc::clone(&frames);
        let task = tokio::spawn(async move {
            while let Some(message) = subscription.next().await {
                task_frames.lock().expect("lock ACK observer frames").push(
                    TrellisJetStreamAckFrame {
                        subject: message.subject.to_string(),
                        payload: String::from_utf8_lossy(&message.payload).into_owned(),
                    },
                );
            }
        });

        Ok(TrellisJetStreamAckObserver {
            _client: client,
            frames,
            errors,
            task: Some(task),
        })
    }

    /// Start a live NATS observer for raw messages on a selected subject.
    pub async fn start_nats_message_observer(
        &self,
        subject: impl Into<String>,
    ) -> Result<TrellisNatsMessageObserver, TrellisTestError> {
        let subject = subject.into();
        let client = ConnectOptions::new()
            .credentials_file(trellis_creds_path(self.workdir.path()))
            .await?
            .connect(&self.nats_url)
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
        let mut subscription = client
            .subscribe(subject.clone())
            .await
            .map_err(io::Error::other)?;
        client.flush().await.map_err(io::Error::other)?;

        let frames = Arc::new(Mutex::new(Vec::new()));
        let task_frames = Arc::clone(&frames);
        let task = tokio::spawn(async move {
            while let Some(message) = subscription.next().await {
                task_frames
                    .lock()
                    .expect("lock NATS message observer frames")
                    .push(TrellisNatsMessageFrame {
                        subject: message.subject.to_string(),
                        payload: String::from_utf8_lossy(&message.payload).into_owned(),
                    });
            }
        });

        Ok(TrellisNatsMessageObserver {
            subject,
            _client: client,
            frames,
            task: Some(task),
        })
    }

    /// Delete a JetStream consumer from the shared Trellis event stream.
    pub async fn delete_trellis_jetstream_consumer(
        &self,
        durable_name: &str,
    ) -> Result<bool, TrellisTestError> {
        let client = ConnectOptions::new()
            .credentials_file(trellis_creds_path(self.workdir.path()))
            .await?
            .connect(&self.nats_url)
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
        let js = jetstream::new(client);
        let stream = js.get_stream("trellis").await.map_err(io::Error::other)?;

        match stream.delete_consumer(durable_name).await {
            Ok(_) => Ok(true),
            Err(error) if is_jetstream_not_found_error(&error) => Ok(false),
            Err(error) => Err(io::Error::other(error).into()),
        }
    }

    /// Seeds one raw auth connection-presence KV entry for malformed-entry tests.
    pub async fn seed_raw_auth_connection_presence(
        &self,
        entry: TrellisRawAuthConnectionPresence,
    ) -> Result<(), TrellisTestError> {
        let client = ConnectOptions::new()
            .credentials_file(trellis_creds_path(self.workdir.path()))
            .await?
            .connect(&self.nats_url)
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
        let js = jetstream::new(client);
        let kv = js
            .get_key_value("trellis_auth_connections")
            .await
            .map_err(io::Error::other)?;
        kv.put(entry.key, entry.value.to_string().into())
            .await
            .map_err(io::Error::other)?;
        Ok(())
    }

    /// Return the auth connection-presence bucket configuration and current records.
    pub async fn auth_connection_presence_status(
        &self,
    ) -> Result<TrellisAuthConnectionPresenceStatus, TrellisTestError> {
        let client = ConnectOptions::new()
            .credentials_file(trellis_creds_path(self.workdir.path()))
            .await?
            .connect(&self.nats_url)
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
        let js = jetstream::new(client);
        let kv = js
            .get_key_value("trellis_auth_connections")
            .await
            .map_err(io::Error::other)?;
        let max_age = kv.status().await.map_err(io::Error::other)?.max_age();
        let mut keys = kv.keys().await.map_err(io::Error::other)?;
        let mut records = BTreeMap::new();
        while let Some(key) = keys.next().await {
            let key = key.map_err(io::Error::other)?;
            if let Some(value) = kv.get(&key).await.map_err(io::Error::other)? {
                records.insert(key, serde_json::from_slice(&value)?);
            }
        }
        Ok(TrellisAuthConnectionPresenceStatus { max_age, records })
    }

    /// Seeds one raw state KV entry for malformed-entry tests.
    pub async fn seed_raw_state_entry(
        &self,
        entry: TrellisRawStateEntry,
    ) -> Result<(), TrellisTestError> {
        let client = ConnectOptions::new()
            .credentials_file(trellis_creds_path(self.workdir.path()))
            .await?
            .connect(&self.nats_url)
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
        let js = jetstream::new(client);
        let kv = js
            .get_key_value("trellis_state")
            .await
            .map_err(io::Error::other)?;
        kv.put(entry.key, entry.value.to_string().into())
            .await
            .map_err(io::Error::other)?;
        Ok(())
    }

    /// Return the generated local bootstrap manifest.
    #[must_use]
    pub fn manifest(&self) -> &LocalTrellisBootstrapManifest {
        &self.manifest
    }

    /// Return the first admin bootstrap URL observed in Trellis stdout, if present.
    pub fn bootstrap_url(&self) -> Result<Option<String>, TrellisTestError> {
        if self.attached {
            return Ok(Some(self.trellis_url.clone()));
        }
        let Some(trellis) = &self.trellis else {
            return Ok(None);
        };
        let log = fs::read_to_string(trellis.stdout_log())?;
        Ok(parse_trellis_bootstrap_url(&log))
    }

    /// Wait for and return the first admin bootstrap URL emitted by Trellis.
    pub async fn wait_for_bootstrap_url(
        &self,
        timeout: Duration,
    ) -> Result<String, TrellisTestError> {
        if self.attached {
            return Ok(self.trellis_url.clone());
        }
        let Some(trellis) = &self.trellis else {
            return Err(TrellisTestError::UnexpectedResponse(
                "Trellis process is not running".to_string(),
            ));
        };
        wait_for_bootstrap_url(trellis.stdout_log(), timeout).await
    }

    /// Return a public-surface admin automation helper for this runtime.
    #[must_use]
    pub fn admin(&self) -> TrellisTestAdmin {
        TrellisTestAdmin::new(TrellisTestAdminOptions {
            trellis_url: self.trellis_url.clone(),
            admin_password: self.admin_password.clone(),
            default_deployment: self.default_deployment.clone(),
            default_mutable_dev: self.default_mutable_dev,
            reconciliation_timeout: self.reconciliation_timeout,
            integration_namespace: self.attached.then(|| self.default_deployment.clone()),
            admin_rpc: self.admin_rpc.clone(),
            test_control_rpc: self.test_control_rpc.clone(),
        })
    }

    /// Build public Rust service connect options for a provisioned service key.
    #[must_use]
    pub fn service_connect_options<'a>(
        &'a self,
        _name: &'a str,
        service_key: &'a TrellisTestServiceKey,
    ) -> trellis_rs::service::ServiceConnectOptions<'a> {
        trellis_rs::service::ServiceConnectOptions::new(
            &self.trellis_url,
            &service_key.instance_id,
            &service_key.deployment_id,
            &service_key.identity_seed,
            &service_key.seed,
            Arc::new(trellis_rs::client::MemoryAuthorizationContextStore::default()),
        )
        .with_session_key_seed(random_session_seed())
        .with_timeout_ms(30_000)
    }

    /// Complete first-admin bootstrap through the public Trellis HTTP surface.
    pub async fn complete_bootstrap(&self) -> Result<(), TrellisTestError> {
        if self.attached {
            return Ok(());
        }
        let bootstrap_url = self
            .wait_for_bootstrap_url(self.reconciliation_timeout)
            .await?;
        complete_first_admin_bootstrap(&self.trellis_url, &bootstrap_url, &self.admin_password)
            .await
    }

    /// Complete administrator bootstrap or recovery with a new local password.
    pub async fn complete_bootstrap_with_password(
        &mut self,
        password: impl Into<String>,
    ) -> Result<(), TrellisTestError> {
        if self.attached {
            return Ok(());
        }
        let password = password.into();
        let bootstrap_url = self
            .wait_for_bootstrap_url(self.reconciliation_timeout)
            .await?;
        complete_first_admin_bootstrap(&self.trellis_url, &bootstrap_url, &password).await?;
        self.admin_password = password;
        Ok(())
    }

    /// Restart only the Trellis control-plane process, preserving workdir state and NATS.
    pub async fn restart_control_plane(&mut self) -> Result<(), TrellisTestError> {
        self.restart_control_plane_with_command(self.trellis_command.clone())
            .await
    }

    /// Restart the control plane in explicit administrator-recovery mode.
    pub async fn restart_control_plane_with_admin_reset(&mut self) -> Result<(), TrellisTestError> {
        let mut command = self.trellis_command.clone();
        command.args.insert(0, "--reset-admin".into());
        self.restart_control_plane_with_command(command).await
    }

    async fn restart_control_plane_with_command(
        &mut self,
        command: TrellisProcessCommand,
    ) -> Result<(), TrellisTestError> {
        let Some(mut trellis) = self.trellis.take() else {
            return Err(TrellisTestError::UnexpectedResponse(
                "Trellis process is not running".to_string(),
            ));
        };
        trellis.stop(self.shutdown_timeout)?;

        let config_path = self
            .workdir
            .path()
            .join(&self.manifest.paths.trellis_config);
        let restarted = TrellisProcess::start(
            &command,
            &config_path,
            self.workdir.path(),
            &self.trellis_url,
            self.startup_timeout,
            self.shutdown_timeout,
        )
        .await?;
        self.trellis = Some(restarted);
        Ok(())
    }

    /// Restart the control plane with new authoritative native and browser NATS endpoints.
    pub async fn restart_control_plane_with_nats_urls(
        &mut self,
        nats_url: &str,
        nats_websocket_url: &str,
    ) -> Result<(), TrellisTestError> {
        let config_path = self
            .workdir
            .path()
            .join(&self.manifest.paths.trellis_config);
        let mut config: toml::Value = toml::from_str(&fs::read_to_string(&config_path)?)
            .map_err(|error| TrellisTestError::UnexpectedResponse(error.to_string()))?;
        config["nats"]["servers"] = toml::Value::String(nats_url.to_owned());
        config["client"]["nats_servers"] =
            toml::Value::Array(vec![toml::Value::String(nats_url.to_owned())]);
        config["client"]["ws_nats_servers"] =
            toml::Value::Array(vec![toml::Value::String(nats_websocket_url.to_owned())]);
        fs::write(
            &config_path,
            toml::to_string_pretty(&config)
                .map_err(|error| TrellisTestError::UnexpectedResponse(error.to_string()))?,
        )?;
        self.nats_url = nats_url.to_owned();
        self.nats_websocket_url = nats_websocket_url.to_owned();
        self.restart_control_plane().await
    }

    /// Rotate the advertised NATS proxies and retire the previous endpoints.
    pub async fn rotate_nats_proxy(
        &mut self,
    ) -> Result<((String, String), (String, String)), TrellisTestError> {
        let replacement = NatsTcpProxy::start(&self.nats_upstream_url).await?;
        let websocket_replacement = NatsTcpProxy::start(&self.nats_websocket_upstream_url).await?;
        let previous_url = self.nats_url.clone();
        let replacement_url = replacement.url.clone();
        let previous_websocket_url = self.nats_websocket_url.clone();
        let replacement_websocket_url = websocket_replacement.url.clone();
        self.restart_control_plane_with_nats_urls(&replacement_url, &replacement_websocket_url)
            .await?;
        self.nats_proxy = Some(replacement);
        self.nats_websocket_proxy = Some(websocket_replacement);
        Ok((
            (previous_url, replacement_url),
            (previous_websocket_url, replacement_websocket_url),
        ))
    }

    /// Advertise replacement NATS proxies while keeping the previous endpoints reachable.
    pub async fn stage_nats_proxy_rotation(
        &mut self,
    ) -> Result<((String, String), (String, String)), TrellisTestError> {
        let replacement = NatsTcpProxy::start(&self.nats_upstream_url).await?;
        let websocket_replacement = NatsTcpProxy::start(&self.nats_websocket_upstream_url).await?;
        let previous_url = self.nats_url.clone();
        let replacement_url = replacement.url.clone();
        let previous_websocket_url = self.nats_websocket_url.clone();
        let replacement_websocket_url = websocket_replacement.url.clone();
        self.restart_control_plane_with_nats_urls(&replacement_url, &replacement_websocket_url)
            .await?;
        self.retiring_nats_proxy = self.nats_proxy.replace(replacement);
        self.retiring_nats_websocket_proxy =
            self.nats_websocket_proxy.replace(websocket_replacement);
        Ok((
            (previous_url, replacement_url),
            (previous_websocket_url, replacement_websocket_url),
        ))
    }

    /// Retire endpoints retained by [`Self::stage_nats_proxy_rotation`].
    pub fn retire_staged_nats_proxies(&mut self) {
        self.retiring_nats_proxy = None;
        self.retiring_nats_websocket_proxy = None;
    }

    /// Stop only the Trellis control-plane process, preserving workdir state and NATS.
    pub fn stop_control_plane(&mut self) -> Result<(), TrellisTestError> {
        let Some(mut trellis) = self.trellis.take() else {
            return Err(TrellisTestError::UnexpectedResponse(
                "Trellis process is not running".to_string(),
            ));
        };
        trellis.stop(self.shutdown_timeout)
    }

    /// Stop Trellis, remove the NATS container, and clean up the workdir.
    pub fn stop(mut self) -> Result<(), TrellisTestError> {
        self.stop_inner(self.shutdown_timeout)
    }

    fn stop_inner(&mut self, shutdown_timeout: Duration) -> Result<(), TrellisTestError> {
        if let Some(mut trellis) = self.trellis.take() {
            trellis.stop(shutdown_timeout)?;
        }
        if let Some(mut nats) = self.nats.take() {
            nats.stop()?;
        }
        Ok(())
    }
}

impl Drop for TrellisTestRuntime {
    fn drop(&mut self) {
        let _ = self.stop_inner(self.shutdown_timeout);
    }
}

/// Options for public-surface Trellis admin automation.
#[derive(Clone, Debug)]
pub struct TrellisTestAdminOptions {
    /// Trellis HTTP base URL.
    pub trellis_url: String,
    /// Password used when creating and logging in the local first-admin account.
    pub admin_password: String,
    /// Default service deployment id for helper methods.
    pub default_deployment: String,
    /// Whether deployment creation requests mutable-dev compatibility.
    pub default_mutable_dev: bool,
    /// Timeout for deployment-authority reconciliation polling.
    pub reconciliation_timeout: Duration,
    /// Physical namespace for test-owned identity and resource records.
    pub integration_namespace: Option<String>,
    admin_rpc: Option<AdminRpcProxy>,
    test_control_rpc: Option<AdminRpcProxy>,
}

/// Public-surface admin automation for live Trellis integration tests.
pub struct TrellisTestAdmin {
    trellis_url: String,
    admin_password: String,
    default_deployment: String,
    default_mutable_dev: bool,
    reconciliation_timeout: Duration,
    integration_namespace: Option<String>,
    bootstrap_complete: bool,
    client: Option<trellis_rs::generated::Caller>,
    created_deployments: HashMap<String, String>,
    deployment_authorities: std::collections::HashMap<String, String>,
    api_artifacts: std::collections::BTreeMap<String, Value>,
    admin_rpc: Option<AdminRpcProxy>,
    test_control_rpc: Option<AdminRpcProxy>,
}

#[derive(Clone, Debug)]
struct AdminRpcProxy {
    url: String,
    token: String,
}

impl AdminRpcProxy {
    async fn call<T: Serialize + ?Sized, R: DeserializeOwned>(
        &self,
        method: &str,
        input: &T,
    ) -> Result<R, TrellisTestError> {
        #[derive(Deserialize)]
        struct Response {
            ok: bool,
            output: Option<Value>,
            error: Option<String>,
        }

        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(190))
            .build()?
            .post(&self.url)
            .bearer_auth(&self.token)
            .json(&json!({ "method": method, "input": input }))
            .send()
            .await?;
        let status = response.status();
        let response: Response = response.json().await?;
        if !status.is_success() || !response.ok {
            return Err(TrellisTestError::UnexpectedResponse(
                response
                    .error
                    .unwrap_or_else(|| format!("shared admin RPC {method} failed with {status}")),
            ));
        }
        serde_json::from_value(response.output.unwrap_or(Value::Null)).map_err(Into::into)
    }

    async fn complete_client_auth(
        &self,
        trellis_url: &str,
        flow_id: &str,
        session_key: &str,
    ) -> Result<(), TrellisTestError> {
        let login_url = format!("{trellis_url}/_trellis/test?flowId={flow_id}");
        self.call::<_, Value>(
            "completeClientAuth",
            &json!({
                "loginUrl": login_url,
                "sessionKey": session_key,
                "mode": "session_key",
            }),
        )
        .await?;
        Ok(())
    }
}

impl fmt::Debug for TrellisTestAdmin {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrellisTestAdmin")
            .field("trellis_url", &self.trellis_url)
            .field("default_deployment", &self.default_deployment)
            .field("default_mutable_dev", &self.default_mutable_dev)
            .field("reconciliation_timeout", &self.reconciliation_timeout)
            .field("bootstrap_complete", &self.bootstrap_complete)
            .field("client_connected", &self.client.is_some())
            .field("created_deployments", &self.created_deployments)
            .finish_non_exhaustive()
    }
}

impl TrellisTestAdmin {
    /// Build an admin automation helper.
    #[must_use]
    pub fn new(options: TrellisTestAdminOptions) -> Self {
        Self {
            trellis_url: trim_url(options.trellis_url),
            admin_password: options.admin_password,
            default_deployment: options.default_deployment,
            default_mutable_dev: options.default_mutable_dev,
            reconciliation_timeout: options.reconciliation_timeout,
            integration_namespace: options.integration_namespace,
            bootstrap_complete: options.admin_rpc.is_some(),
            client: None,
            created_deployments: HashMap::new(),
            deployment_authorities: std::collections::HashMap::new(),
            api_artifacts: builtin_api_artifacts(),
            admin_rpc: options.admin_rpc,
            test_control_rpc: options.test_control_rpc,
        }
    }

    /// Complete first-admin bootstrap with the supplied bootstrap URL.
    pub async fn complete_bootstrap(
        &mut self,
        bootstrap_url: &str,
    ) -> Result<(), TrellisTestError> {
        if self.bootstrap_complete {
            return Ok(());
        }
        match complete_first_admin_bootstrap(&self.trellis_url, bootstrap_url, &self.admin_password)
            .await
        {
            Err(TrellisTestError::HttpStatus {
                status: 409, code, ..
            }) if code == "account_flow_consumed" => {}
            result => result?,
        }
        self.bootstrap_complete = true;
        Ok(())
    }

    /// Connect and cache an authenticated admin client using public HTTP and NATS surfaces.
    pub async fn connect_admin(
        &mut self,
        bootstrap_url: &str,
    ) -> Result<&trellis_rs::generated::Caller, TrellisTestError> {
        if self.admin_rpc.is_some() {
            return Err(TrellisTestError::UnexpectedResponse(
                "shared test runtime admin access must use the typed admin adapter".to_string(),
            ));
        }
        if self.client.is_none() {
            self.complete_bootstrap(bootstrap_url).await?;
            let challenge =
                trellis_rs::auth::start_agent_login(&trellis_rs::auth::StartAgentLoginOpts {
                    trellis_url: &self.trellis_url,
                })
                .await?;
            let flow_id = flow_id_from_url(challenge.login_url())?;
            perform_local_login(
                &self.trellis_url,
                &flow_id,
                ADMIN_USERNAME,
                &self.admin_password,
            )
            .await?;
            submit_portal_approval(&self.trellis_url, &flow_id).await?;
            let store = Arc::new(trellis_rs::client::MemoryAuthorizationContextStore::default());
            let outcome = challenge
                .complete_with_context_store(&self.trellis_url, store.clone())
                .await?;
            let state = outcome.state;
            self.client = Some(
                Caller::connect_user(UserConnectOptions::new(
                    &state.trellis_url,
                    DEFAULT_ADMIN_RPC_TIMEOUT_MS,
                    trellis_rs::client::UserSessionCredentials {
                        session_key_seed_base64url: &state.session_seed,
                    },
                    trellis_rs::client::UserAuthorizationContext {
                        initial: None,
                        binding: format!("test-admin:{}", state.trellis_url),
                        store,
                    },
                ))
                .await?,
            );
        }
        Ok(self
            .client
            .as_ref()
            .expect("admin client is initialized before returning"))
    }

    /// Attempt a CLI administrator login with an existing local user.
    pub async fn try_admin_login_as(
        &self,
        username: &str,
        password: &str,
    ) -> Result<(), TrellisTestError> {
        let challenge =
            trellis_rs::auth::start_agent_login(&trellis_rs::auth::StartAgentLoginOpts {
                trellis_url: &self.trellis_url,
            })
            .await?;
        let flow_id = flow_id_from_url(challenge.login_url())?;
        perform_local_login(&self.trellis_url, &flow_id, username, password).await?;
        submit_portal_approval(&self.trellis_url, &flow_id).await?;
        challenge
            .complete_with_context_store(
                &self.trellis_url,
                Arc::new(trellis_rs::client::MemoryAuthorizationContextStore::default()),
            )
            .await?;
        Ok(())
    }

    /// Call `State.Admin.Get` through the live shared or local administrator.
    pub async fn state_admin_get(
        &mut self,
        bootstrap_url: &str,
        request: &trellis_runtime_apis::state::types::StateAdminGetRequest,
    ) -> Result<trellis_runtime_apis::state::types::StateAdminGetResponse, TrellisTestError> {
        if let Some(proxy) = &self.admin_rpc {
            proxy.call("stateAdminGet", request).await
        } else {
            Ok(trellis_runtime_apis::state::client::StateClient::new(
                self.connect_admin(bootstrap_url).await?,
            )
            .rpc()
            .state()
            .admin_get(request)
            .await?)
        }
    }

    /// Call `State.Admin.List` through the live shared or local administrator.
    pub async fn state_admin_list(
        &mut self,
        bootstrap_url: &str,
        request: &trellis_runtime_apis::state::types::StateAdminListRequest,
    ) -> Result<trellis_runtime_apis::state::types::StateAdminListResponse, TrellisTestError> {
        if let Some(proxy) = &self.admin_rpc {
            proxy.call("stateAdminList", request).await
        } else {
            Ok(trellis_runtime_apis::state::client::StateClient::new(
                self.connect_admin(bootstrap_url).await?,
            )
            .rpc()
            .state()
            .admin_list(request)
            .await?)
        }
    }

    /// Call `State.Admin.Delete` through the live shared or local administrator.
    pub async fn state_admin_delete(
        &mut self,
        bootstrap_url: &str,
        request: &trellis_runtime_apis::state::types::StateAdminDeleteRequest,
    ) -> Result<trellis_runtime_apis::state::types::StateAdminDeleteResponse, TrellisTestError>
    {
        if let Some(proxy) = &self.admin_rpc {
            proxy.call("stateAdminDelete", request).await
        } else {
            Ok(trellis_runtime_apis::state::client::StateClient::new(
                self.connect_admin(bootstrap_url).await?,
            )
            .rpc()
            .state()
            .admin_delete(request)
            .await?)
        }
    }

    /// Create a service deployment through `Auth.Deployments.Create`.
    pub async fn create_deployment(
        &mut self,
        bootstrap_url: &str,
        deployment: Option<&str>,
        mutable_dev: Option<bool>,
    ) -> Result<String, TrellisTestError> {
        self.create_deployment_of_kind(
            bootstrap_url,
            deployment,
            mutable_dev,
            auth_sdk::types::AuthDeploymentsCreateRequestKind::Service,
            None,
            false,
        )
        .await
    }

    /// Create a device deployment with explicit delegation and review policy.
    pub async fn create_device_deployment(
        &mut self,
        bootstrap_url: &str,
        deployment: &str,
        requires_device_delegation: bool,
        review_mode: &str,
    ) -> Result<String, TrellisTestError> {
        self.create_deployment_of_kind(
            bootstrap_url,
            Some(deployment),
            None,
            auth_sdk::types::AuthDeploymentsCreateRequestKind::Device,
            Some(review_mode.to_owned()),
            requires_device_delegation,
        )
        .await
    }

    async fn create_deployment_of_kind(
        &mut self,
        bootstrap_url: &str,
        deployment: Option<&str>,
        mutable_dev: Option<bool>,
        kind: auth_sdk::types::AuthDeploymentsCreateRequestKind,
        review_mode: Option<String>,
        requires_device_delegation: bool,
    ) -> Result<String, TrellisTestError> {
        let deployment_name = deployment.unwrap_or(&self.default_deployment).to_string();
        let mutable_dev = mutable_dev.unwrap_or(self.default_mutable_dev);
        if let Some(deployment_id) = self.created_deployments.get(&deployment_name) {
            return Ok(deployment_id.clone());
        }
        let request = auth_deployments_create_request_shape(
            &deployment_name,
            mutable_dev,
            kind,
            review_mode,
            requires_device_delegation,
        )?;
        let created: auth_sdk::types::AuthDeploymentsCreateResponse =
            if let Some(proxy) = &self.admin_rpc {
                proxy.call("authDeploymentsCreate", &request).await?
            } else {
                GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                    .rpc()
                    .auth()
                    .deployments_create(&request)
                    .await?
            };
        let deployment_id = created.deployment.deployment_id;
        self.created_deployments
            .insert(deployment_name, deployment_id.clone());
        Ok(deployment_id)
    }

    /// Revoke one session through `Auth.Sessions.Revoke`.
    pub async fn revoke_session(
        &mut self,
        bootstrap_url: &str,
        request: &auth_sdk::types::AuthSessionsRevokeRequest,
    ) -> Result<auth_sdk::types::AuthSessionsRevokeResponse, TrellisTestError> {
        if let Some(proxy) = &self.admin_rpc {
            proxy.call("authSessionsRevoke", request).await
        } else {
            Ok(
                GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                    .rpc()
                    .auth()
                    .sessions_revoke(request)
                    .await?,
            )
        }
    }

    /// Disable one service instance through `Auth.ServiceInstances.Disable`.
    pub async fn disable_service_instance(
        &mut self,
        bootstrap_url: &str,
        instance_id: &str,
        expected_version: i64,
    ) -> Result<auth_sdk::types::AuthServiceInstancesDisableResponse, TrellisTestError> {
        let request = auth_sdk::types::AuthServiceInstancesDisableRequest {
            expected_version,
            idempotency_key: random_session_seed(),
            instance_id: instance_id.to_owned(),
            reason: Some("disabled by Rust integration fixture".to_owned()),
        };
        self.admin_rpc = None;
        self.bootstrap_complete = true;
        Ok(
            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                .rpc()
                .auth()
                .service_instances_disable(&request)
                .await?,
        )
    }

    /// Plan, accept, reconcile, and wait for a service contract authority update.
    pub async fn approve_contract(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        deployment: Option<&str>,
        allow_plan_classifications: &[AuthorityPlanClassification],
    ) -> Result<TrellisTestContractApproval, TrellisTestError> {
        let deployment_name = deployment
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{}-{}", self.default_deployment, &contract.digest[..8]));
        let deployment_kind = if contract.participant()["kind"] == "device" {
            auth_sdk::types::AuthDeploymentsCreateRequestKind::Device
        } else {
            auth_sdk::types::AuthDeploymentsCreateRequestKind::Service
        };
        let review_mode = (deployment_kind
            == auth_sdk::types::AuthDeploymentsCreateRequestKind::Device)
            .then(|| "none".to_owned());
        let compiled = build_test_artifacts(contract, &mut self.api_artifacts)?;
        let participant_artifact =
            value_map(&compiled.participant_value()?, "participant artifact")?;
        let mut referenced_api_artifacts = self
            .api_artifacts
            .values()
            .map(|value| value_map(value, "API artifact"))
            .collect::<Result<Vec<_>, _>>()?;
        referenced_api_artifacts.push(value_map(&compiled.api_value()?, "API artifact")?);
        let deployment = self
            .create_deployment_of_kind(
                bootstrap_url,
                Some(&deployment_name),
                None,
                deployment_kind,
                review_mode,
                false,
            )
            .await?;
        let plan_request = auth_sdk::types::AuthDeploymentAuthorityPlanRequest {
            deployment_id: deployment.clone(),
            participant_artifact,
            referenced_api_artifacts,
            expires_at: None,
            idempotency_key: random_session_seed(),
        };
        let planned: auth_sdk::types::AuthDeploymentAuthorityPlanResponse =
            if let Some(proxy) = &self.admin_rpc {
                proxy
                    .call("authDeploymentAuthorityPlan", &plan_request)
                    .await?
            } else {
                let caller = GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?);
                let mut attempts = 0;
                loop {
                    attempts += 1;
                    match caller
                        .rpc()
                        .auth()
                        .deployment_authority_plan(&plan_request)
                        .await
                    {
                        Ok(planned) => break planned,
                        Err(
                            trellis_rs::generated::CallError::Timeout
                            | trellis_rs::generated::CallError::Transport(_),
                        ) if attempts < 3 => {}
                        Err(error) => return Err(error.into()),
                    }
                }
            };
        let plan = AuthorityPlanSummary {
            plan_id: planned.proposal.proposal_id,
            classification: match planned.proposal.classification.as_str() {
                "initial" | "update" => AuthorityPlanClassification::Update,
                "migration" => AuthorityPlanClassification::Migration,
                other => {
                    return Err(TrellisTestError::UnexpectedResponse(format!(
                        "unsupported authority plan classification '{other}'"
                    )));
                }
            },
        };
        let allowed = if allow_plan_classifications.is_empty() {
            vec![AuthorityPlanClassification::Update]
        } else {
            allow_plan_classifications.to_vec()
        };
        if !allowed.contains(&plan.classification) {
            return Err(TrellisTestError::DisallowedAuthorityPlan {
                classification: plan.classification.as_str().to_string(),
                allowed: allowed
                    .iter()
                    .map(|classification| classification.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
            });
        }
        let _accepted: auth_sdk::types::AuthDeploymentAuthorityAcceptUpdateResponse = match plan
            .classification
        {
            AuthorityPlanClassification::Update => {
                let request = auth_sdk::types::AuthDeploymentAuthorityAcceptUpdateRequest {
                    proposal_id: plan.plan_id.clone(),
                    expected_base_authority_version: None,
                    reason: None,
                    idempotency_key: random_session_seed(),
                };
                if let Some(proxy) = &self.admin_rpc {
                    proxy
                        .call("authDeploymentAuthorityAcceptUpdate", &request)
                        .await?
                } else {
                    let caller = GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?);
                    let mut attempts = 0;
                    loop {
                        attempts += 1;
                        match caller
                            .rpc()
                            .auth()
                            .deployment_authority_accept_update(&request)
                            .await
                        {
                            Ok(accepted) => break accepted,
                            Err(
                                trellis_rs::generated::CallError::Timeout
                                | trellis_rs::generated::CallError::Transport(_),
                            ) if attempts < 3 => {}
                            Err(error) => return Err(error.into()),
                        }
                    }
                }
            }
            AuthorityPlanClassification::Migration => {
                let request = auth_sdk::types::AuthDeploymentAuthorityAcceptMigrationRequest {
                    proposal_id: plan.plan_id.clone(),
                    expected_base_authority_version: None,
                    reason: Some(
                        "Approved by trellis-test for an isolated integration test.".to_string(),
                    ),
                    idempotency_key: random_session_seed(),
                };
                let accepted: auth_sdk::types::AuthDeploymentAuthorityAcceptMigrationResponse =
                    if let Some(proxy) = &self.admin_rpc {
                        proxy
                            .call("authDeploymentAuthorityAcceptMigration", &request)
                            .await?
                    } else {
                        let caller =
                            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?);
                        let mut attempts = 0;
                        loop {
                            attempts += 1;
                            match caller
                                .rpc()
                                .auth()
                                .deployment_authority_accept_migration(&request)
                                .await
                            {
                                Ok(accepted) => break accepted,
                                Err(
                                    trellis_rs::generated::CallError::Timeout
                                    | trellis_rs::generated::CallError::Transport(_),
                                ) if attempts < 3 => {}
                                Err(error) => return Err(error.into()),
                            }
                        }
                    };
                serde_json::from_value(serde_json::to_value(accepted)?)?
            }
        };
        let accepted_value = serde_json::to_value(&_accepted)?;
        let authority_id = accepted_value["authority"]["authorityId"]
            .as_str()
            .ok_or_else(|| {
                TrellisTestError::UnexpectedResponse(
                    "accepted authority response missing authorityId".to_string(),
                )
            })?
            .to_owned();
        self.deployment_authorities
            .insert(deployment.clone(), authority_id);
        let compiled_api = compiled.api_value()?;
        let compiled_participant = compiled.participant_value()?;
        let compiled_participant_digest = compiled.participant_digest()?;
        let compiled_participant_needs_digest = compiled.participant_needs_digest()?;
        let api_id = compiled_api["id"]
            .as_str()
            .expect("compiled API has an id")
            .to_owned();
        self.api_artifacts
            .insert(api_id.clone(), compiled_api.clone());
        let participant_json = serde_json::to_string(&compiled_participant)?;
        let api_json = serde_json::to_string(&compiled_api)?;
        let api_digest = trellis_protocol::parse_api(&compiled_api)?.digest()?;
        let mut referenced_apis = selected_referenced_apis(&compiled)?;
        for api_id in contract_reference_ids(&compiled_participant) {
            if let std::collections::btree_map::Entry::Vacant(entry) =
                referenced_apis.entry(api_id.clone())
            {
                let artifact = self.api_artifacts.get(&api_id).ok_or_else(|| {
                    TrellisTestError::UnexpectedResponse(format!(
                        "API artifact '{api_id}' has not been approved"
                    ))
                })?;
                entry.insert(trellis_rs::contracts::ApiBuilder::new(artifact.clone()).build()?);
            }
        }
        let referenced_api_artifacts = referenced_apis
            .values()
            .map(|artifact| {
                let artifact = artifact.normalized_value()?;
                Ok((
                    serde_json::to_string(&artifact)?,
                    trellis_protocol::parse_api(&artifact)?.digest()?,
                ))
            })
            .collect::<Result<Vec<_>, TrellisTestError>>()?;
        self.reconcile(bootstrap_url, &deployment).await?;
        self.wait_ready(bootstrap_url, &deployment).await?;
        Ok(TrellisTestContractApproval {
            plan_id: plan.plan_id,
            classification: plan.classification,
            participant_id: compiled_participant["id"]
                .as_str()
                .expect("compiled participant has an id")
                .to_owned(),
            participant_digest: compiled_participant_digest,
            participant_needs_digest: compiled_participant_needs_digest,
            participant_json,
            api_json,
            api_digest,
            referenced_api_artifacts,
            deployment_id: deployment,
        })
    }

    /// Accept one existing deployment-authority update proposal through the public Auth RPC.
    pub async fn accept_authority_update(
        &mut self,
        bootstrap_url: &str,
        proposal_id: &str,
        expected_base_authority_version: Option<i64>,
    ) -> Result<(), TrellisTestError> {
        let request = auth_sdk::types::AuthDeploymentAuthorityAcceptUpdateRequest {
            expected_base_authority_version,
            idempotency_key: random_session_seed(),
            proposal_id: proposal_id.to_owned(),
            reason: Some("accepted by Rust integration fixture".to_owned()),
        };
        if let Some(proxy) = &self.admin_rpc {
            let _: serde_json::Value = proxy
                .call("authDeploymentAuthorityAcceptUpdate", &request)
                .await?;
        } else {
            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                .rpc()
                .auth()
                .deployment_authority_accept_update(&request)
                .await?;
        }
        Ok(())
    }

    /// Accept one existing deployment-authority migration proposal through the public Auth RPC.
    pub async fn accept_authority_migration(
        &mut self,
        bootstrap_url: &str,
        proposal_id: &str,
        expected_base_authority_version: Option<i64>,
    ) -> Result<(), TrellisTestError> {
        let request = auth_sdk::types::AuthDeploymentAuthorityAcceptMigrationRequest {
            expected_base_authority_version,
            idempotency_key: random_session_seed(),
            proposal_id: proposal_id.to_owned(),
            reason: Some("accepted by Rust integration fixture".to_owned()),
        };
        if let Some(proxy) = &self.admin_rpc {
            let _: serde_json::Value = proxy
                .call("authDeploymentAuthorityAcceptMigration", &request)
                .await?;
        } else {
            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                .rpc()
                .auth()
                .deployment_authority_accept_migration(&request)
                .await?;
        }
        Ok(())
    }

    /// Complete a local-password account flow through its public HTTP endpoint.
    pub async fn complete_local_password_flow(
        &self,
        completion_url: &str,
        password: &str,
    ) -> Result<(), TrellisTestError> {
        let flow_id = flow_id_from_url(completion_url).or_else(|_| {
            reqwest::Url::parse(completion_url)
                .ok()
                .and_then(|url| url.path_segments()?.next_back().map(str::to_owned))
                .filter(|value| !value.is_empty())
                .ok_or_else(|| TrellisTestError::MissingFlowId(completion_url.to_owned()))
        })?;
        let response: Value = post_json_with_origin(
            &format!(
                "{}/auth/account-flow/{}/local-password",
                trim_url(&self.trellis_url),
                flow_id
            ),
            &self.trellis_url,
            &serde_json::json!({ "password": password }),
        )
        .await?;
        if response.get("status").and_then(Value::as_str) == Some("updated") {
            Ok(())
        } else {
            Err(TrellisTestError::UnexpectedResponse(format!(
                "password flow returned {response}"
            )))
        }
    }

    /// Trigger deployment-authority reconciliation for one deployment.
    pub async fn reconcile(
        &mut self,
        bootstrap_url: &str,
        deployment: &str,
    ) -> Result<(), TrellisTestError> {
        let deployment = self
            .created_deployments
            .get(deployment)
            .cloned()
            .unwrap_or_else(|| deployment.to_owned());
        let authority_id = self
            .deployment_authorities
            .get(&deployment)
            .cloned()
            .ok_or_else(|| {
                TrellisTestError::UnexpectedResponse(format!(
                    "deployment '{deployment}' has no accepted authority"
                ))
            })?;
        let request = auth_sdk::types::AuthDeploymentAuthorityReconcileRequest {
            authority_id,
            expected_version: None,
            idempotency_key: random_session_seed(),
        };
        if let Some(proxy) = &self.admin_rpc {
            let _: serde_json::Value = proxy
                .call("authDeploymentAuthorityReconcile", &request)
                .await?;
        } else {
            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                .rpc()
                .auth()
                .deployment_authority_reconcile(&request)
                .await?;
        }
        Ok(())
    }

    /// Wait until materialized deployment authority is current.
    pub async fn wait_ready(
        &mut self,
        bootstrap_url: &str,
        deployment: &str,
    ) -> Result<(), TrellisTestError> {
        let deployment = self
            .created_deployments
            .get(deployment)
            .cloned()
            .unwrap_or_else(|| deployment.to_owned());
        let authority_id = self
            .deployment_authorities
            .get(&deployment)
            .cloned()
            .ok_or_else(|| {
                TrellisTestError::UnexpectedResponse(format!(
                    "deployment '{deployment}' has no accepted authority"
                ))
            })?;
        let deadline = Instant::now() + self.reconciliation_timeout;
        loop {
            let request = auth_sdk::types::AuthDeploymentAuthorityGetRequest {
                authority_id: authority_id.clone(),
            };
            let result: auth_sdk::types::AuthDeploymentAuthorityGetResponse =
                if let Some(proxy) = &self.admin_rpc {
                    proxy.call("authDeploymentAuthorityGet", &request).await?
                } else {
                    GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                        .rpc()
                        .auth()
                        .deployment_authority_get(&request)
                        .await?
                };
            let authority = serde_json::to_value(&result.authority)?;
            let materialized_authority = authority["materialization"].clone();
            let authority_version = result.authority.version.to_string();
            if materialized_authority_is_current(&materialized_authority, &authority_version)? {
                return Ok(());
            }
            if let Some(message) = materialized_authority_failure(&materialized_authority) {
                return Err(TrellisTestError::ReconciliationFailed {
                    deployment: deployment.to_string(),
                    message,
                });
            }
            if Instant::now() >= deadline {
                return Err(TrellisTestError::ReconciliationTimeout {
                    deployment: deployment.to_string(),
                    timeout: self.reconciliation_timeout,
                });
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Provision a service instance key through `Auth.ServiceInstances.Provision`.
    pub async fn provision_service_instance(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        deployment: Option<&str>,
        session_key_seed: Option<String>,
    ) -> Result<TrellisTestServiceKey, TrellisTestError> {
        let deployment_name = deployment.unwrap_or(&self.default_deployment).to_string();
        let approval = self
            .approve_contract(
                bootstrap_url,
                contract,
                Some(&deployment_name),
                &[AuthorityPlanClassification::Update],
            )
            .await?;
        let seed = session_key_seed.unwrap_or_else(random_session_seed);
        let auth_material = SessionAuth::from_seed_base64url(&seed)?;
        let request = auth_sdk::types::AuthServiceInstancesProvisionRequest {
            deployment_id: approval.deployment_id.clone(),
            instance_id: Some(format!("inst_{}", &auth_material.session_key[..16])),
            identity_public_key: auth_material.session_key.clone(),
            participant_id: Some(approval.participant_id.clone()),
            idempotency_key: random_session_seed(),
        };
        let mut provisioned = None;
        for attempt in 0..3 {
            let result: Result<auth_sdk::types::AuthServiceInstancesProvisionResponse, _> =
                if let Some(proxy) = &self.admin_rpc {
                    proxy.call("authServiceInstancesProvision", &request).await
                } else {
                    GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                        .rpc()
                        .auth()
                        .service_instances_provision(&request)
                        .await
                        .map_err(Into::into)
                };
            match result {
                Ok(response) => {
                    provisioned = Some(response);
                    break;
                }
                Err(error) if attempt < 2 && error.to_string().contains("WebSocket closed") => {
                    tokio::time::sleep(Duration::from_millis(100 * (attempt + 1))).await;
                }
                Err(error) => return Err(error),
            }
        }
        let instance_id = provisioned
            .expect("provisioning loop returns or succeeds")
            .instance
            .instance_id;
        Ok(TrellisTestServiceKey {
            seed: random_session_seed(),
            identity_seed: seed,
            deployment_id: approval.deployment_id,
            instance_id,
            session_key: auth_material.session_key,
            participant_id: approval.participant_id,
            participant_digest: approval.participant_digest,
            participant_needs_digest: approval.participant_needs_digest,
            participant_json: approval.participant_json,
            api_json: approval.api_json,
            api_digest: approval.api_digest,
            referenced_api_artifacts: approval.referenced_api_artifacts,
        })
    }

    /// Complete a user/client auth flow and return a connected public Rust client.
    pub async fn connect_client(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
    ) -> Result<Caller, TrellisTestError> {
        self.connect_client_with_session_seed(bootstrap_url, contract, random_session_seed())
            .await
    }

    /// Complete a user/client auth flow for a deterministic session seed.
    pub async fn connect_client_with_session_seed(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        session_seed: impl Into<String>,
    ) -> Result<Caller, TrellisTestError> {
        let (client, _) = self
            .connect_client_with_session_seed_reconnectable(bootstrap_url, contract, session_seed)
            .await?;
        Ok(client)
    }

    /// Complete a user/client auth flow for a deterministic session seed and return a bound-only reconnect handle.
    pub async fn connect_client_with_session_seed_reconnectable(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        session_seed: impl Into<String>,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        self.connect_client_with_registration(
            bootstrap_url,
            contract,
            session_seed.into(),
            LocalUserAuth::Administrator,
        )
        .await
    }

    /// Register and connect a distinct local user through public Auth browser surfaces.
    pub async fn connect_new_local_user(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Result<Caller, TrellisTestError> {
        self.enable_local_auth(bootstrap_url).await?;
        let (caller, _) = self
            .connect_client_with_registration(
                bootstrap_url,
                contract,
                random_session_seed(),
                LocalUserAuth::Register(LocalUserRegistration {
                    portal_id: "builtin".to_owned(),
                    username: username.into(),
                    password: password.into(),
                    trusted_capabilities: Vec::new(),
                }),
            )
            .await?;
        Ok(caller)
    }

    /// Register a local user with a deterministic session seed.
    pub async fn connect_new_local_user_with_session_seed_reconnectable(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        username: impl Into<String>,
        password: impl Into<String>,
        session_seed: impl Into<String>,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        self.enable_local_auth(bootstrap_url).await?;
        self.connect_client_with_registration(
            bootstrap_url,
            contract,
            session_seed.into(),
            LocalUserAuth::Register(LocalUserRegistration {
                portal_id: "builtin".to_owned(),
                username: username.into(),
                password: password.into(),
                trusted_capabilities: Vec::new(),
            }),
        )
        .await
    }

    /// Register and connect a local user whose trusted portal grants authority without consent.
    pub async fn connect_new_trusted_local_user_reconnectable(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        portal_id: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
        direct_capabilities: Vec<String>,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        self.connect_client_with_registration(
            bootstrap_url,
            contract,
            random_session_seed(),
            LocalUserAuth::Register(LocalUserRegistration {
                portal_id: portal_id.into(),
                username: username.into(),
                password: password.into(),
                trusted_capabilities: direct_capabilities,
            }),
        )
        .await
    }

    /// Register through an already configured participant portal without changing its policy.
    pub async fn connect_new_local_user_for_portal_reconnectable(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        portal_id: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        self.connect_client_with_registration(
            bootstrap_url,
            contract,
            random_session_seed(),
            LocalUserAuth::Register(LocalUserRegistration {
                portal_id: portal_id.into(),
                username: username.into(),
                password: password.into(),
                trusted_capabilities: Vec::new(),
            }),
        )
        .await
    }

    /// Register through a trusted portal using a deterministic session seed.
    pub async fn connect_trusted_local_user_reconnectable(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        registration: TrustedLocalUserRegistration,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        self.connect_client_with_registration(
            bootstrap_url,
            contract,
            registration.session_seed,
            LocalUserAuth::Register(LocalUserRegistration {
                portal_id: registration.portal_id,
                username: registration.username,
                password: registration.password,
                trusted_capabilities: registration.capabilities,
            }),
        )
        .await
    }

    /// Log in an existing local user and return a bound-only reconnect handle.
    pub async fn connect_local_user_reconnectable(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        self.enable_local_auth(bootstrap_url).await?;
        self.connect_client_with_registration(
            bootstrap_url,
            contract,
            random_session_seed(),
            LocalUserAuth::Login {
                username: username.into(),
                password: password.into(),
            },
        )
        .await
    }

    /// Log in through an already configured participant-scoped portal.
    pub async fn connect_local_user_for_portal_reconnectable(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        self.connect_client_with_registration(
            bootstrap_url,
            contract,
            random_session_seed(),
            LocalUserAuth::Login {
                username: username.into(),
                password: password.into(),
            },
        )
        .await
    }

    /// Log in through a participant portal using a deterministic session seed.
    pub async fn connect_local_user_for_portal_with_session_seed_reconnectable(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        username: impl Into<String>,
        password: impl Into<String>,
        session_seed: impl Into<String>,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        self.connect_client_with_registration(
            bootstrap_url,
            contract,
            session_seed.into(),
            LocalUserAuth::Login {
                username: username.into(),
                password: password.into(),
            },
        )
        .await
    }

    /// Authenticate through a configured OIDC provider and return reconnect material.
    pub async fn connect_oidc_user_reconnectable(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        provider_id: impl Into<String>,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        self.connect_client_with_registration(
            bootstrap_url,
            contract,
            random_session_seed(),
            LocalUserAuth::Oidc {
                provider_id: provider_id.into(),
            },
        )
        .await
    }

    async fn enable_local_auth(&mut self, bootstrap_url: &str) -> Result<(), TrellisTestError> {
        self.complete_bootstrap(bootstrap_url).await?;
        for _ in 0..3 {
            let request = auth_sdk::types::AuthPortalsListRequest {
                cursor: None,
                disabled: None,
                limit: Some(100),
            };
            let portals: auth_sdk::types::AuthPortalsListResponse =
                if let Some(proxy) = &self.admin_rpc {
                    proxy.call("authPortalsList", &request).await?
                } else {
                    GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                        .rpc()
                        .auth()
                        .portals_list(&request)
                        .await?
                };
            let current = portals
                .entries
                .into_iter()
                .find(|entry| entry.portal_id == "builtin")
                .ok_or_else(|| io::Error::other("built-in login portal is missing"))?;
            let mut providers = current.login_settings.providers.unwrap_or_default();
            let has_local_provider = providers.iter().any(|provider| provider == "local");
            if current.login_settings.local_login
                && current.login_settings.local_registration
                && has_local_provider
            {
                return Ok(());
            }
            if !has_local_provider {
                providers.push("local".to_owned());
            }
            let request = auth_sdk::types::AuthPortalsLoginSettingsUpdateRequest {
                expected_version: current.version,
                idempotency_key: random_session_seed(),
                portal_id: "builtin".to_owned(),
                settings: auth_sdk::types::AuthPortalsLoginSettingsUpdateRequestSettings {
                    federated_registration: true,
                    local_login: true,
                    local_registration: true,
                    providers: Some(providers),
                },
            };
            let result = if let Some(proxy) = &self.admin_rpc {
                proxy
                    .call::<_, serde_json::Value>("authPortalsLoginSettingsUpdate", &request)
                    .await
                    .map(|_| ())
            } else {
                GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                    .rpc()
                    .auth()
                    .portals_login_settings_update(&request)
                    .await
                    .map(|_| ())
                    .map_err(TrellisTestError::from)
            };
            match result {
                Ok(()) => return Ok(()),
                Err(error) if error.to_string().contains("conflict") => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::other("local authentication settings did not converge").into())
    }

    /// Update the built-in portal's enabled authentication providers.
    pub async fn update_login_providers(
        &mut self,
        bootstrap_url: &str,
        expected_version: i64,
        providers: Vec<String>,
    ) -> Result<(), TrellisTestError> {
        let request = auth_sdk::types::AuthPortalsLoginSettingsUpdateRequest {
            expected_version,
            idempotency_key: random_session_seed(),
            portal_id: "builtin".to_owned(),
            settings: auth_sdk::types::AuthPortalsLoginSettingsUpdateRequestSettings {
                federated_registration: true,
                local_login: true,
                local_registration: true,
                providers: Some(providers),
            },
        };
        if let Some(proxy) = &self.admin_rpc {
            let _: Value = proxy
                .call("authPortalsLoginSettingsUpdate", &request)
                .await?;
        } else {
            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                .rpc()
                .auth()
                .portals_login_settings_update(&request)
                .await?;
        }
        Ok(())
    }

    async fn connect_client_with_registration(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        session_seed: String,
        mut local_auth: LocalUserAuth,
    ) -> Result<(Caller, TrellisTestClientReconnect), TrellisTestError> {
        if let (Some(username), Some(namespace)) = (
            match &mut local_auth {
                LocalUserAuth::Register(registration) => Some(&mut registration.username),
                LocalUserAuth::Login { username, .. } => Some(username),
                LocalUserAuth::Administrator | LocalUserAuth::Oidc { .. } => None,
            },
            &self.integration_namespace,
        ) {
            username.push('-');
            username.push_str(namespace);
        }

        self.complete_bootstrap(bootstrap_url).await?;
        let auth = SessionAuth::from_seed_base64url(&session_seed)?;
        let compiled = build_test_artifacts(contract, &mut self.api_artifacts)?;
        let mut referenced_api_artifacts = selected_referenced_apis(&compiled)?
            .into_values()
            .map(|api| api.normalized_value().map_err(TrellisTestError::from))
            .collect::<Result<Vec<_>, _>>()?;
        referenced_api_artifacts.push(compiled.api_value()?);
        let redirect_to = format!("{}/_trellis/test/client-auth", self.trellis_url);
        let started = start_auth_request(
            &self.trellis_url,
            &redirect_to,
            &auth,
            &compiled,
            referenced_api_artifacts,
        )
        .await?;
        let flow_id = started.flow_id;
        if let LocalUserAuth::Register(registration) = &local_auth {
            if !registration.trusted_capabilities.is_empty() {
                let participant_id = compiled.participant_value()?["id"]
                    .as_str()
                    .expect("compiled participant has an id")
                    .to_owned();
                self.put_portal_grant_override(
                    bootstrap_url,
                    &registration.portal_id,
                    &participant_id,
                    None,
                    registration.trusted_capabilities.clone(),
                )
                .await?;
            }
            let response = register_local_user(
                &self.trellis_url,
                &flow_id,
                &registration.username,
                &registration.password,
            )
            .await?;
            if registration.trusted_capabilities.is_empty()
                && response["state"] == "approval_required"
            {
                submit_portal_approval(&self.trellis_url, &flow_id).await?;
            }
        } else {
            let requires_approval = match local_auth {
                LocalUserAuth::Login { username, password } => {
                    let response =
                        perform_local_login(&self.trellis_url, &flow_id, &username, &password)
                            .await?;
                    response["state"] == "approval_required"
                }
                LocalUserAuth::Administrator => {
                    if let Some(proxy) = &self.admin_rpc {
                        proxy
                            .complete_client_auth(&self.trellis_url, &flow_id, &auth.session_key)
                            .await?;
                        false
                    } else {
                        perform_local_login(
                            &self.trellis_url,
                            &flow_id,
                            ADMIN_USERNAME,
                            &self.admin_password,
                        )
                        .await?;
                        true
                    }
                }
                LocalUserAuth::Oidc { provider_id } => {
                    let binding = portal_binding(&flow_id)?;
                    let mut start_url = reqwest::Url::parse(&format!(
                        "{}/auth/login/{}",
                        trim_url(&self.trellis_url),
                        provider_id
                    ))
                    .map_err(|error| TrellisTestError::UnexpectedResponse(error.to_string()))?;
                    start_url
                        .query_pairs_mut()
                        .append_pair("flowId", &flow_id)
                        .append_pair("portalBindingDigest", &portal_binding_digest(&binding));
                    let client = reqwest::Client::builder()
                        .redirect(reqwest::redirect::Policy::none())
                        .no_proxy()
                        .build()?;
                    let started = client.get(start_url).send().await?;
                    let cookie = started
                        .headers()
                        .get(reqwest::header::SET_COOKIE)
                        .and_then(|value| value.to_str().ok())
                        .and_then(|value| value.split(';').next())
                        .ok_or_else(|| {
                            TrellisTestError::UnexpectedResponse(
                                "OIDC start omitted browser-binding cookie".to_owned(),
                            )
                        })?
                        .to_owned();
                    let authorization_url = started
                        .headers()
                        .get(reqwest::header::LOCATION)
                        .and_then(|value| value.to_str().ok())
                        .ok_or_else(|| {
                            TrellisTestError::UnexpectedResponse(
                                "OIDC start omitted authorization redirect".to_owned(),
                            )
                        })?;
                    let authorized = client.get(authorization_url).send().await?;
                    let callback_url = authorized
                        .headers()
                        .get(reqwest::header::LOCATION)
                        .and_then(|value| value.to_str().ok())
                        .ok_or_else(|| {
                            TrellisTestError::UnexpectedResponse(
                                "OIDC provider omitted callback redirect".to_owned(),
                            )
                        })?;
                    let response = client
                        .get(callback_url)
                        .header(reqwest::header::COOKIE, cookie)
                        .send()
                        .await?;
                    let final_status = response.status();
                    let final_url = response.url().to_string();
                    let final_body = response.text().await?;
                    let flow_url = format!("{}/auth/flow/{}", trim_url(&self.trellis_url), flow_id);
                    let flow_body = reqwest::Client::builder()
                        .no_proxy()
                        .build()?
                        .get(&flow_url)
                        .send()
                        .await?
                        .text()
                        .await?;
                    if !flow_body.contains("approved") {
                        return Err(TrellisTestError::UnexpectedResponse(format!(
                            "OIDC flow did not approve: final={final_status} {final_url} {final_body}; flow={flow_body}"
                        )));
                    }
                    false
                }
                LocalUserAuth::Register(_) => unreachable!(),
            };
            if requires_approval {
                submit_portal_approval(&self.trellis_url, &flow_id).await?;
            }
        }
        let (bound, concurrent) = tokio::join!(
            bind_flow(&self.trellis_url, &flow_id, &auth),
            bind_flow(&self.trellis_url, &flow_id, &auth),
        );
        let bound = bound?;
        let concurrent = concurrent?;
        let replay = bind_flow(&self.trellis_url, &flow_id, &auth).await?;
        if concurrent.installation.runtime.session_id != bound.installation.runtime.session_id
            || replay.installation.runtime.session_id != bound.installation.runtime.session_id
        {
            return Err(TrellisTestError::UnexpectedResponse(format!(
                "browser flow {flow_id} resolved multiple sessions: {}, {}, {}",
                bound.installation.runtime.session_id,
                concurrent.installation.runtime.session_id,
                replay.installation.runtime.session_id
            )));
        }
        let compiled_api = compiled.api_value()?;
        self.api_artifacts.insert(
            compiled_api["id"]
                .as_str()
                .expect("compiled API has an id")
                .to_owned(),
            compiled_api,
        );

        let reconnect = TrellisTestClientReconnect {
            bound: bound.clone(),
            session_seed,
            authorization_context_store: Arc::new(
                trellis_rs::client::MemoryAuthorizationContextStore::default(),
            ),
        };
        let client = connect_bound_user(
            &bound,
            &reconnect.session_seed,
            reconnect.authorization_context_store.clone(),
            false,
        )
        .await?;
        Ok((client, reconnect))
    }

    /// Start a signed browser-auth request and return its flow identifier.
    pub async fn start_browser_auth_flow(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        redirect_to: &str,
    ) -> Result<String, TrellisTestError> {
        self.complete_bootstrap(bootstrap_url).await?;
        let auth = SessionAuth::from_seed_base64url(&random_session_seed())?;
        let compiled = build_test_artifacts(contract, &mut self.api_artifacts)?;
        let mut referenced_api_artifacts = selected_referenced_apis(&compiled)?
            .into_values()
            .map(|api| api.normalized_value().map_err(TrellisTestError::from))
            .collect::<Result<Vec<_>, _>>()?;
        referenced_api_artifacts.push(compiled.api_value()?);
        Ok(start_auth_request(
            &self.trellis_url,
            redirect_to,
            &auth,
            &compiled,
            referenced_api_artifacts,
        )
        .await?
        .flow_id)
    }

    /// Complete local authentication for an already started browser flow.
    pub async fn complete_local_browser_flow(
        &self,
        flow_id: &str,
        username: &str,
        password: &str,
    ) -> Result<Value, TrellisTestError> {
        perform_local_login(&self.trellis_url, flow_id, username, password).await
    }

    /// Register a local user through a browser flow without binding its client session.
    pub async fn register_local_browser_user(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        username: &str,
        password: &str,
    ) -> Result<(), TrellisTestError> {
        let flow_id = self
            .start_browser_auth_flow(
                bootstrap_url,
                contract,
                &format!(
                    "{}/_trellis/test/register-user",
                    trim_url(&self.trellis_url)
                ),
            )
            .await?;
        register_local_user(&self.trellis_url, &flow_id, username, password).await?;
        Ok(())
    }

    /// Set claims returned by the shared live-test OIDC provider.
    pub async fn set_test_oidc_claims(&self, claims: Value) -> Result<(), TrellisTestError> {
        let proxy = self.test_control_rpc.as_ref().ok_or_else(|| {
            TrellisTestError::UnexpectedResponse(
                "test OIDC claims require the shared runtime provider".to_owned(),
            )
        })?;
        let _: Value = proxy
            .call(
                "testOidcSetClaims",
                &serde_json::json!({
                    "origin": self.trellis_url,
                    "claims": claims,
                }),
            )
            .await?;
        Ok(())
    }

    /// Exercise an account-flow OIDC callback and return status, body, and redirect location.
    pub async fn complete_test_oidc_account_flow(
        &self,
        completion_url: &str,
        provider_id: &str,
        callback_provider_id: &str,
        provider_error: bool,
    ) -> Result<(u16, String, Option<String>), TrellisTestError> {
        let flow_token = reqwest::Url::parse(completion_url)
            .map_err(|error| TrellisTestError::UnexpectedResponse(error.to_string()))?
            .path_segments()
            .and_then(Iterator::last)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                TrellisTestError::UnexpectedResponse(
                    "account-flow completion URL omitted flow token".to_owned(),
                )
            })?
            .to_owned();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()?;
        let started = client
            .get(format!(
                "{}/auth/account-flow/{flow_token}/login/{provider_id}",
                trim_url(&self.trellis_url)
            ))
            .send()
            .await?
            .error_for_status()?;
        let cookie = started
            .headers()
            .get(reqwest::header::SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .ok_or_else(|| {
                TrellisTestError::UnexpectedResponse(
                    "account-flow OIDC start omitted browser-binding cookie".to_owned(),
                )
            })?
            .to_owned();
        let authorization_url = started
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| {
                TrellisTestError::UnexpectedResponse(
                    "account-flow OIDC start omitted authorization redirect".to_owned(),
                )
            })?;
        let state = reqwest::Url::parse(authorization_url)
            .map_err(|error| TrellisTestError::UnexpectedResponse(error.to_string()))?
            .query_pairs()
            .find_map(|(key, value)| (key == "state").then(|| value.into_owned()))
            .ok_or_else(|| {
                TrellisTestError::UnexpectedResponse(
                    "account-flow OIDC authorization URL omitted state".to_owned(),
                )
            })?;
        let callback_url = if provider_error || callback_provider_id != provider_id {
            let mut callback = reqwest::Url::parse(&format!(
                "{}/auth/callback/{callback_provider_id}",
                trim_url(&self.trellis_url)
            ))
            .map_err(|error| TrellisTestError::UnexpectedResponse(error.to_string()))?;
            callback.query_pairs_mut().append_pair("state", &state);
            if provider_error {
                callback
                    .query_pairs_mut()
                    .append_pair("error", "access_denied");
            }
            callback.to_string()
        } else {
            client
                .get(authorization_url)
                .send()
                .await?
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    TrellisTestError::UnexpectedResponse(
                        "test OIDC provider omitted callback redirect".to_owned(),
                    )
                })?
                .to_owned()
        };
        let response = client
            .get(callback_url)
            .header(reqwest::header::COOKIE, cookie)
            .send()
            .await?;
        let status = response.status().as_u16();
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        Ok((status, response.text().await?, location))
    }

    /// Put one capability group through the public Auth RPC surface.
    pub async fn put_capability_group(
        &mut self,
        bootstrap_url: &str,
        group_key: &str,
        capabilities: Vec<String>,
        included_groups: Vec<String>,
    ) -> Result<(), TrellisTestError> {
        let request = auth_sdk::types::AuthCapabilityGroupsPutRequest {
            capabilities,
            description: format!("Live test capability group {group_key}"),
            display_name: group_key.to_owned(),
            expected_version: None,
            group_key: group_key.to_owned(),
            idempotency_key: random_session_seed(),
            included_groups,
        };
        if let Some(proxy) = &self.admin_rpc {
            let _: Value = proxy.call("authCapabilityGroupsPut", &request).await?;
        } else {
            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                .rpc()
                .auth()
                .capability_groups_put(&request)
                .await?;
        }
        Ok(())
    }

    /// Create one participant-scoped login portal and route through public Auth RPCs.
    pub async fn put_test_login_portal(
        &mut self,
        bootstrap_url: &str,
        portal_id: &str,
        participant_id: &str,
        providers: Vec<String>,
    ) -> Result<(), TrellisTestError> {
        self.complete_bootstrap(bootstrap_url).await?;
        let mut portal = auth_sdk::types::AuthPortalsPutRequest {
            disabled: false,
            display_name: format!("Live test portal {portal_id}"),
            entry_url: None,
            expected_version: None,
            idempotency_key: random_session_seed(),
            login_settings: auth_sdk::types::AuthPortalsPutRequestLoginSettings {
                federated_registration: true,
                local_login: true,
                local_registration: true,
                providers: Some(providers),
            },
            portal_id: portal_id.to_owned(),
        };
        let (existing_version, existing_route) = if let Some(proxy) = &self.admin_rpc {
            let mut portal_version = None;
            let mut route = None;
            let mut cursor = None;
            loop {
                let page: auth_sdk::types::AuthPortalsListResponse = proxy
                    .call(
                        "authPortalsList",
                        &auth_sdk::types::AuthPortalsListRequest {
                            cursor,
                            disabled: None,
                            limit: Some(100),
                        },
                    )
                    .await?;
                for entry in page.entries {
                    if entry.portal_id == portal_id {
                        portal_version = Some(entry.version);
                    }
                    let details: auth_sdk::types::AuthPortalsGetResponse = proxy
                        .call(
                            "authPortalsGet",
                            &auth_sdk::types::AuthPortalsGetRequest {
                                portal_id: entry.portal_id,
                            },
                        )
                        .await?;
                    if let Some(existing) = details.routes.into_iter().find(|candidate| {
                        candidate.participant_id.as_deref() == Some(participant_id)
                    }) {
                        route = Some((existing.route_id, existing.version));
                    }
                }
                let Some(next_cursor) = page.next_cursor else {
                    break;
                };
                cursor = Some(next_cursor);
            }
            (portal_version, route)
        } else {
            let client = GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?);
            let mut portal_version = None;
            let mut route = None;
            let mut cursor = None;
            loop {
                let page = client
                    .rpc()
                    .auth()
                    .portals_list(&auth_sdk::types::AuthPortalsListRequest {
                        cursor,
                        disabled: None,
                        limit: Some(100),
                    })
                    .await?;
                for entry in page.entries {
                    if entry.portal_id == portal_id {
                        portal_version = Some(entry.version);
                    }
                    let details = client
                        .rpc()
                        .auth()
                        .portals_get(&auth_sdk::types::AuthPortalsGetRequest {
                            portal_id: entry.portal_id,
                        })
                        .await?;
                    if let Some(existing) = details.routes.into_iter().find(|candidate| {
                        candidate.participant_id.as_deref() == Some(participant_id)
                    }) {
                        route = Some((existing.route_id, existing.version));
                    }
                }
                let Some(next_cursor) = page.next_cursor else {
                    break;
                };
                cursor = Some(next_cursor);
            }
            (portal_version, route)
        };
        portal.expected_version = existing_version;
        let (route_id, expected_version) = existing_route
            .map_or((None, None), |(route_id, version)| {
                (Some(route_id), Some(version))
            });
        let route = auth_sdk::types::AuthPortalsRoutesPutRequest {
            deployment_id: None,
            expected_version,
            idempotency_key: random_session_seed(),
            origin: None,
            participant_id: Some(participant_id.to_owned()),
            portal_id: portal_id.to_owned(),
            priority: 100,
            route_id,
        };
        if let Some(proxy) = &self.admin_rpc {
            let _: Value = proxy.call("authPortalsPut", &portal).await?;
            let _: Value = proxy.call("authPortalsRoutesPut", &route).await?;
        } else {
            let client = GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?);
            client.rpc().auth().portals_put(&portal).await?;
            client.rpc().auth().portals_routes_put(&route).await?;
        }
        Ok(())
    }

    /// Put one role-mapped portal grant override through the public Auth RPC surface.
    pub async fn put_portal_role_mappings(
        &mut self,
        bootstrap_url: &str,
        portal_id: &str,
        participant_id: &str,
        expected_version: Option<i64>,
        role_mappings: Vec<auth_sdk::types::AuthPortalsGrantOverridesPutRequestRoleMappingsItem>,
    ) -> Result<(), TrellisTestError> {
        let request = auth_sdk::types::AuthPortalsGrantOverridesPutRequest {
            capability_group_keys: Vec::new(),
            direct_capabilities: Vec::new(),
            expected_version,
            idempotency_key: random_session_seed(),
            participant_id: participant_id.to_owned(),
            portal_id: portal_id.to_owned(),
            role_mappings,
        };
        if let Some(proxy) = &self.admin_rpc {
            let _: Value = proxy.call("authPortalsGrantOverridesPut", &request).await?;
        } else {
            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                .rpc()
                .auth()
                .portals_grant_overrides_put(&request)
                .await?;
        }
        Ok(())
    }

    /// List physical connections for one logical session.
    pub async fn list_connections(
        &mut self,
        bootstrap_url: &str,
        session_id: &str,
    ) -> Result<Vec<auth_sdk::types::AuthConnectionsListResponseEntriesItem>, TrellisTestError>
    {
        let request = auth_sdk::types::AuthConnectionsListRequest {
            cursor: None,
            limit: Some(100),
            session_id: Some(session_id.to_owned()),
        };
        let response: auth_sdk::types::AuthConnectionsListResponse =
            if let Some(proxy) = &self.admin_rpc {
                proxy.call("authConnectionsList", &request).await?
            } else {
                GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                    .rpc()
                    .auth()
                    .connections_list(&request)
                    .await?
            };
        Ok(response.entries)
    }

    /// Remove one portal grant override through the public Auth RPC surface.
    pub async fn put_portal_grant_override(
        &mut self,
        bootstrap_url: &str,
        portal_id: &str,
        participant_id: &str,
        expected_version: Option<i64>,
        direct_capabilities: Vec<String>,
    ) -> Result<(), TrellisTestError> {
        let request = auth_sdk::types::AuthPortalsGrantOverridesPutRequest {
            capability_group_keys: Vec::new(),
            direct_capabilities,
            expected_version,
            idempotency_key: random_session_seed(),
            participant_id: participant_id.to_owned(),
            portal_id: portal_id.to_owned(),
            role_mappings: Vec::new(),
        };
        if let Some(proxy) = &self.admin_rpc {
            let _: serde_json::Value = proxy.call("authPortalsGrantOverridesPut", &request).await?;
        } else {
            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                .rpc()
                .auth()
                .portals_grant_overrides_put(&request)
                .await?;
        }
        Ok(())
    }

    /// Remove one portal grant override through the public Auth RPC surface.
    pub async fn remove_portal_grant_override(
        &mut self,
        bootstrap_url: &str,
        portal_id: &str,
        participant_id: &str,
        expected_version: i64,
    ) -> Result<(), TrellisTestError> {
        let request = auth_sdk::types::AuthPortalsGrantOverridesRemoveRequest {
            expected_version,
            idempotency_key: random_session_seed(),
            participant_id: participant_id.to_owned(),
            portal_id: portal_id.to_owned(),
        };
        if let Some(proxy) = &self.admin_rpc {
            let _: serde_json::Value = proxy
                .call("authPortalsGrantOverridesRemove", &request)
                .await?;
        } else {
            GeneratedAuthClient::new(self.connect_admin(bootstrap_url).await?)
                .rpc()
                .auth()
                .portals_grant_overrides_remove(&request)
                .await?;
        }
        Ok(())
    }
}

/// Registration options for a trusted local user with deterministic reconnect credentials.
#[derive(Clone)]
pub struct TrustedLocalUserRegistration {
    /// Portal whose trusted policy grants the requested capabilities.
    pub portal_id: String,
    /// Local username to register.
    pub username: String,
    /// Sensitive local password to register; redacted from [`Debug`](fmt::Debug) output.
    pub password: String,
    /// Capabilities granted directly by the trusted portal.
    pub capabilities: Vec<String>,
    /// Sensitive base64url-encoded Ed25519 session seed; redacted from [`Debug`](fmt::Debug) output.
    pub session_seed: String,
}

impl fmt::Debug for TrustedLocalUserRegistration {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedLocalUserRegistration")
            .field("portal_id", &self.portal_id)
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .field("capabilities", &self.capabilities)
            .field("session_seed", &"[REDACTED]")
            .finish()
    }
}

struct LocalUserRegistration {
    portal_id: String,
    username: String,
    password: String,
    trusted_capabilities: Vec<String>,
}

enum LocalUserAuth {
    Administrator,
    Register(LocalUserRegistration),
    Login { username: String, password: String },
    Oidc { provider_id: String },
}

/// Bound client reconnect material captured from a completed public auth flow.
#[derive(Clone, Debug)]
pub struct TrellisTestClientReconnect {
    bound: BoundFlowSession,
    session_seed: String,
    authorization_context_store: Arc<trellis_rs::client::MemoryAuthorizationContextStore>,
}

impl TrellisTestClientReconnect {
    /// Return the bound session ID for typed admin assertions.
    pub fn session_id(&self) -> &str {
        &self.bound.installation.runtime.session_id
    }

    /// Load the exact durable authorization state used by reconnect.
    pub fn authorization_state(
        &self,
    ) -> Result<Option<trellis_rs::client::AuthorizationClientState>, TrellisTestError> {
        Ok(trellis_rs::client::AuthorizationContextStore::load(
            self.authorization_context_store.as_ref(),
        )?)
    }

    /// Reconnect the already-bound session without starting or completing a fresh auth flow.
    pub async fn connect_bound_only(&self) -> Result<Caller, TrellisTestError> {
        connect_bound_user(
            &self.bound,
            &self.session_seed,
            self.authorization_context_store.clone(),
            true,
        )
        .await
    }

    /// Reconnect the bound session through a caller-supplied durable authorization store.
    pub async fn connect_bound_with_store(
        &self,
        store: Arc<dyn trellis_rs::client::AuthorizationContextStore>,
    ) -> Result<Caller, TrellisTestError> {
        connect_bound_user(&self.bound, &self.session_seed, store, true).await
    }

    /// Attempt one raw NATS admission with captured routing material and no context refresh.
    pub async fn connect_captured_admission(
        &self,
        context_digest: &str,
    ) -> Result<async_nats::Client, TrellisTestError> {
        let options = UserConnectOptions::new(
            &self.bound.trellis_url,
            DEFAULT_ADMIN_RPC_TIMEOUT_MS,
            trellis_rs::client::UserSessionCredentials {
                session_key_seed_base64url: &self.session_seed,
            },
            trellis_rs::client::UserAuthorizationContext {
                initial: Some(self.bound.installation.clone()),
                binding: format!("test-captured-admission:{}", self.bound.trellis_url),
                store: Arc::new(trellis_rs::client::MemoryAuthorizationContextStore::default()),
            },
        );
        Ok(trellis_rs::client::connect_captured_user_admission(options, context_digest).await?)
    }
}

/// Authoring source and digest used by admin automation helpers.
#[derive(Clone, Debug, PartialEq)]
pub struct TrellisTestContract {
    api: Value,
    participant: Value,
    referenced_apis: Vec<Value>,
    digest: String,
    needs_digest: String,
    api_digest: String,
}

impl TrellisTestContract {
    /// Build an explicitly identified self-implementing participant from one exact native API.
    pub fn from_native_api_json(
        participant_id: impl Into<String>,
        api_json: &str,
        kind: trellis_rs::contracts::ContractKind,
    ) -> Result<Self, TrellisTestError> {
        let api: Value = serde_json::from_str(api_json)?;
        let artifacts =
            trellis_rs::contracts::ContractBuilder::from_api(participant_id, api, kind)?.build()?;
        Self::from_artifacts(artifacts)
    }

    /// Build a test contract from exact native API and participant JSON.
    pub fn from_native_json(
        api_json: &str,
        participant_json: &str,
    ) -> Result<Self, TrellisTestError> {
        let api = serde_json::from_str(api_json)?;
        let participant = serde_json::from_str(participant_json)?;
        let artifacts =
            trellis_rs::contracts::ContractBuilder::from_native(api, participant).build()?;
        Self::from_artifacts(artifacts)
    }

    /// Build a test contract from finalized native artifacts.
    pub fn from_artifacts(
        artifacts: trellis_rs::contracts::ContractArtifacts,
    ) -> Result<Self, TrellisTestError> {
        build_test_contract(artifacts, vec![])
    }

    /// Finalize a typed builder with exact API evidence from referenced contracts.
    pub fn from_builder_with_referenced_contracts(
        builder: trellis_rs::contracts::ContractBuilder,
        referenced_contracts: &[&Self],
    ) -> Result<Self, TrellisTestError> {
        let mut referenced_apis = builtin_api_artifacts();
        referenced_apis.extend(
            referenced_contracts
                .iter()
                .map(|contract| (contract.id().to_owned(), contract.api.clone())),
        );
        let artifacts = builder.referenced_apis(referenced_apis).build()?;
        Self::from_artifacts_with_referenced_contracts(artifacts, referenced_contracts)
    }

    /// Build a test contract with exact API evidence from other test contracts.
    pub fn from_artifacts_with_referenced_contracts(
        artifacts: trellis_rs::contracts::ContractArtifacts,
        referenced_contracts: &[&Self],
    ) -> Result<Self, TrellisTestError> {
        let referenced_apis = referenced_contracts
            .iter()
            .map(|contract| contract.api.clone())
            .collect::<Vec<_>>();
        build_test_contract(artifacts, referenced_apis)
    }

    /// Return the exact native participant artifact represented by this test contract.
    #[must_use]
    pub fn participant(&self) -> &Value {
        &self.participant
    }

    /// Return the exact native API artifact represented by this test contract.
    #[must_use]
    pub fn api(&self) -> &Value {
        &self.api
    }

    /// Return the canonical participant digest.
    #[must_use]
    pub fn digest(&self) -> &str {
        &self.digest
    }

    /// Return the canonical resolved participant-needs digest.
    #[must_use]
    pub fn needs_digest(&self) -> &str {
        &self.needs_digest
    }

    /// Return the canonical owned API digest.
    #[must_use]
    pub fn api_digest(&self) -> &str {
        &self.api_digest
    }

    /// Return the contract ID from this test source.
    #[must_use]
    pub fn id(&self) -> &str {
        self.participant["id"]
            .as_str()
            .expect("validated test contract has an id")
    }
}

fn builtin_api_artifacts() -> std::collections::BTreeMap<String, Value> {
    let mut apis = [(
        trellis_runtime_apis::auth::API_ID.to_owned(),
        serde_json::from_str(trellis_runtime_apis::auth::API_JSON)
            .expect("embedded Auth API artifact is valid JSON"),
    )]
    .into_iter()
    .collect();
    for api_id in [
        trellis_runtime_apis::state::API_ID,
        trellis_runtime_apis::jobs::API_ID,
        trellis_runtime_apis::health::API_ID,
        trellis_runtime_apis::eventlog::API_ID,
    ] {
        ensure_builtin_api(api_id, &mut apis).expect("embedded platform API artifact parses");
    }
    apis
}

fn build_test_artifacts(
    contract: &TrellisTestContract,
    apis: &mut std::collections::BTreeMap<String, Value>,
) -> Result<trellis_rs::contracts::ContractArtifacts, TrellisTestError> {
    add_referenced_test_apis(&contract.referenced_apis, apis)?;
    for api_id in native_participant_reference_ids(contract.participant()) {
        ensure_builtin_api(&api_id, apis)?;
    }
    let artifacts = trellis_rs::contracts::ContractBuilder::from_native(
        contract.api.clone(),
        contract.participant.clone(),
    )
    .referenced_apis(apis.clone())
    .build()?;
    Ok(artifacts)
}

fn native_participant_reference_ids(participant: &Value) -> Vec<String> {
    ["required", "optional"]
        .into_iter()
        .flat_map(|group| {
            participant
                .pointer(&format!("/uses/{group}"))
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|uses| uses.values())
                .filter_map(|selection| selection.get("api").and_then(Value::as_str))
                .map(str::to_owned)
        })
        .collect()
}

fn selected_referenced_apis(
    artifacts: &trellis_rs::contracts::ContractArtifacts,
) -> Result<std::collections::BTreeMap<String, trellis_rs::contracts::ApiArtifact>, TrellisTestError>
{
    artifacts
        .resolved()
        .required_apis()
        .iter()
        .chain(artifacts.resolved().optional_apis())
        .map(|api| api.api().to_owned())
        .map(|id| {
            artifacts
                .referenced_apis()
                .get(&id)
                .cloned()
                .map(|api| (id.clone(), api))
                .ok_or_else(|| {
                    TrellisTestError::UnexpectedResponse(format!(
                        "API artifact '{id}' was not supplied"
                    ))
                })
        })
        .collect()
}

fn build_test_contract(
    artifacts: trellis_rs::contracts::ContractArtifacts,
    referenced_apis: Vec<Value>,
) -> Result<TrellisTestContract, TrellisTestError> {
    let digest = artifacts.participant_digest()?;
    let needs_digest = artifacts.participant_needs_digest()?;
    let api_digest = artifacts.api_digest()?;
    Ok(TrellisTestContract {
        api: artifacts.api_value()?,
        participant: artifacts.participant_value()?,
        referenced_apis,
        digest,
        needs_digest,
        api_digest,
    })
}

fn add_referenced_test_apis(
    sources: &[Value],
    apis: &mut std::collections::BTreeMap<String, Value>,
) -> Result<(), TrellisTestError> {
    for source in sources {
        let api = trellis_rs::contracts::ApiBuilder::new(source.clone())
            .build()?
            .normalized_value()?;
        let id = api["id"]
            .as_str()
            .expect("validated API has an id")
            .to_owned();
        apis.insert(id, api);
    }
    Ok(())
}

fn ensure_builtin_api(
    api_id: &str,
    apis: &mut std::collections::BTreeMap<String, Value>,
) -> Result<(), TrellisTestError> {
    if apis.contains_key(api_id) {
        return Ok(());
    }
    let api_json = match api_id {
        trellis_runtime_apis::core::API_ID => trellis_runtime_apis::core::API_JSON,
        trellis_runtime_apis::state::API_ID => trellis_runtime_apis::state::API_JSON,
        trellis_runtime_apis::jobs::API_ID => trellis_runtime_apis::jobs::API_JSON,
        trellis_runtime_apis::health::API_ID => trellis_runtime_apis::health::API_JSON,
        trellis_runtime_apis::eventlog::API_ID => trellis_runtime_apis::eventlog::API_JSON,
        _ => {
            return Err(TrellisTestError::UnexpectedResponse(format!(
                "API artifact '{api_id}' has not been approved"
            )))
        }
    };
    let artifact: Value = serde_json::from_str(api_json)?;
    let parsed = trellis_protocol::parse_api(&artifact)?;
    if parsed.id() != api_id {
        return Err(TrellisTestError::UnexpectedResponse(format!(
            "embedded API id '{}' does not match '{api_id}'",
            parsed.id()
        )));
    }
    apis.insert(api_id.to_owned(), artifact);
    Ok(())
}

fn contract_reference_ids(contract: &Value) -> Vec<String> {
    ["required", "optional"]
        .into_iter()
        .filter_map(|group| contract.pointer(&format!("/uses/{group}")))
        .filter_map(Value::as_object)
        .flat_map(|uses| uses.values())
        .filter_map(|used| used.get("contract"))
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

/// Deployment authority plan classifications supported by test automation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthorityPlanClassification {
    /// Non-breaking authority update.
    Update,
    /// Explicit authority migration.
    Migration,
}

impl AuthorityPlanClassification {
    fn as_str(self) -> &'static str {
        match self {
            Self::Update => "update",
            Self::Migration => "migration",
        }
    }
}

/// Result returned after a contract authority plan is accepted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisTestContractApproval {
    /// Accepted authority plan id.
    pub plan_id: String,
    /// Accepted plan classification.
    pub classification: AuthorityPlanClassification,
    /// Stable participant ID accepted by the authority plan.
    pub participant_id: String,
    /// Exact accepted participant artifact digest.
    pub participant_digest: String,
    /// Exact accepted participant needs digest.
    pub participant_needs_digest: String,
    /// Normalized native participant artifact used by service bootstrap.
    pub participant_json: String,
    /// Normalized native owned API artifact used by service bootstrap.
    pub api_json: String,
    /// Semantic digest of the owned API artifact.
    pub api_digest: String,
    /// Exact normalized referenced API artifacts and semantic digests.
    pub referenced_api_artifacts: Vec<(String, String)>,
    /// Server-assigned deployment carrying the accepted authority.
    pub deployment_id: String,
}

fn value_map(
    value: &Value,
    label: &str,
) -> Result<std::collections::BTreeMap<String, Value>, TrellisTestError> {
    let Value::Object(map) = value else {
        return Err(TrellisTestError::UnexpectedResponse(format!(
            "{label} must be a JSON object"
        )));
    };
    Ok(map.clone().into_iter().collect())
}

/// Session key material for a provisioned service instance.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisTestServiceKey {
    /// Base64url Ed25519 seed for service runtime auth.
    pub seed: String,
    /// Base64url Ed25519 seed for the immutable provisioned service identity.
    pub identity_seed: String,
    /// Deployment bound to the provisioned identity.
    pub deployment_id: String,
    /// Runtime instance bound to the provisioned identity.
    pub instance_id: String,
    /// Public session key provisioned as the service instance key.
    pub session_key: String,
    /// Stable participant ID accepted for this deployment.
    pub participant_id: String,
    /// Exact participant artifact digest accepted for this deployment.
    pub participant_digest: String,
    /// Exact participant needs digest accepted for this deployment.
    pub participant_needs_digest: String,
    /// Normalized native participant artifact used by service bootstrap.
    pub participant_json: String,
    /// Normalized native owned API artifact used by service bootstrap.
    pub api_json: String,
    /// Semantic digest of the owned API artifact.
    pub api_digest: String,
    /// Exact normalized referenced API artifacts and semantic digests.
    pub referenced_api_artifacts: Vec<(String, String)>,
}

#[derive(Debug, Deserialize)]
struct FirstAdminBootstrapResponse {
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortalFlowStatus {
    state: String,
    consent_view_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthStartResponse {
    flow_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletedFlowSession {
    server_now: i64,
    session: BoundSessionRecord,
    nats: BoundNatsRecord,
    authorization_context: trellis_rs::client::AuthorizationContextBundle,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoundSessionRecord {
    session_id: String,
    inbox_prefix: String,
    expires_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct BoundNatsRecord {
    jwt: String,
    #[serde(rename = "jwtExpiresAt")]
    jwt_expires_at: i64,
    transports: BoundNatsTransports,
}

#[derive(Debug, Deserialize)]
struct BoundNatsTransports {
    native: Option<BoundNatsRoute>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoundNatsRoute {
    nats_servers: Vec<String>,
}

#[derive(Clone, Debug)]
struct BoundFlowSession {
    trellis_url: String,
    expires_at: Option<i64>,
    installation: trellis_rs::client::AuthorizationInstallation,
}

#[derive(Debug)]
struct AuthorityPlanSummary {
    plan_id: String,
    classification: AuthorityPlanClassification,
}

fn random_session_seed() -> String {
    trellis_rs::auth::generate_session_keypair().0
}

fn trim_url(url: impl Into<String>) -> String {
    url.into().trim_end_matches('/').to_string()
}

fn flow_id_from_url(url: &str) -> Result<String, TrellisTestError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| TrellisTestError::MissingFlowId(url.to_string()))?;
    parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| TrellisTestError::MissingFlowId(url.to_string()))
}

fn first_admin_token_from_url(url: &str) -> Result<String, TrellisTestError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| TrellisTestError::MissingFlowId(url.to_string()))?;
    parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "adminAccountToken").then(|| value.into_owned()))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| TrellisTestError::MissingFlowId(url.to_string()))
}

async fn post_json<T, B>(url: &str, body: &B) -> Result<T, TrellisTestError>
where
    T: for<'de> Deserialize<'de>,
    B: Serialize + ?Sized,
{
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .post(url)
        .json(body)
        .send()
        .await?;
    decode_http_json(url, response).await
}

async fn post_json_with_origin<T, B>(
    url: &str,
    origin: &str,
    body: &B,
) -> Result<T, TrellisTestError>
where
    T: for<'de> Deserialize<'de>,
    B: Serialize + ?Sized,
{
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .post(url)
        .header(reqwest::header::ORIGIN, trim_url(origin))
        .json(body)
        .send()
        .await?;
    decode_http_json(url, response).await
}

async fn decode_http_json<T>(url: &str, response: reqwest::Response) -> Result<T, TrellisTestError>
where
    T: for<'de> Deserialize<'de>,
{
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct ErrorEnvelope {
            error: ErrorCode,
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct ErrorCode {
            code: String,
        }
        let code = serde_json::from_str::<ErrorEnvelope>(&text)
            .ok()
            .map(|envelope| envelope.error.code)
            .filter(|code| !code.is_empty())
            .unwrap_or_else(|| "invalid_http_error_envelope".to_owned());
        return Err(TrellisTestError::HttpStatus {
            url: url.to_string(),
            status: status.as_u16(),
            code,
        });
    }
    Ok(serde_json::from_str(&text)?)
}

async fn complete_first_admin_bootstrap(
    trellis_url: &str,
    bootstrap_url: &str,
    password: &str,
) -> Result<(), TrellisTestError> {
    let flow_id = first_admin_token_from_url(bootstrap_url)?;
    let response: FirstAdminBootstrapResponse = match post_json_with_origin(
        &format!(
            "{}/auth/account-flow/{}/local-password",
            trim_url(trellis_url),
            flow_id
        ),
        trellis_url,
        &first_admin_bootstrap_body(password),
    )
    .await
    {
        Ok(response) => response,
        Err(error) => return Err(error),
    };
    if matches!(response.status.as_str(), "created" | "updated") {
        Ok(())
    } else {
        Err(TrellisTestError::UnexpectedResponse(format!(
            "first-admin bootstrap returned status '{}'",
            response.status
        )))
    }
}

async fn start_auth_request(
    trellis_url: &str,
    redirect_to: &str,
    auth: &SessionAuth,
    compiled: &trellis_rs::contracts::ContractArtifacts,
    referenced_api_artifacts: Vec<Value>,
) -> Result<AuthStartResponse, TrellisTestError> {
    let request_id = ulid::Ulid::new().to_string();
    let issued_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| TrellisTestError::UnexpectedResponse(error.to_string()))?
        .as_millis() as i64;
    let participant = compiled.participant_value()?;
    let participant_digest = compiled.participant_digest()?;
    let participant_id = participant["id"]
        .as_str()
        .expect("compiled participant has an id");
    let session_nkey = auth.session_nkey()?;
    let mut raw = json!({
        "requestId": request_id,
        "issuedAt": issued_at,
        "sessionPublicKey": auth.session_key,
        "sessionNkey": session_nkey,
        "participantId": participant_id,
        "participantArtifactDigest": participant_digest,
        "participantArtifact": participant,
        "referencedApiArtifacts": referenced_api_artifacts,
        "redirectTarget": redirect_to,
        "proof": auth.sign_session_proof(&trellis_protocol::SessionProofInput::user_auth_request(
            trellis_protocol::UserAuthRequestSessionProofInput {
                request_id: request_id.clone(),
                issued_at,
                session_public_key: auth.session_key.clone(),
                session_nkey: session_nkey.clone(),
                participant_id: participant_id.to_owned(),
                participant_digest: participant_digest.clone(),
                redirect_target: redirect_to.to_owned(),
                request_digest: participant_digest.clone(),
            },
        )?)?,
    });
    let request_digest = trellis_protocol::session_proof_request_digest(&raw)?;
    let input = trellis_protocol::SessionProofInput::user_auth_request(
        trellis_protocol::UserAuthRequestSessionProofInput {
            request_id,
            issued_at,
            session_public_key: auth.session_key.clone(),
            session_nkey,
            participant_id: participant_id.to_owned(),
            participant_digest,
            redirect_target: redirect_to.to_owned(),
            request_digest,
        },
    )?;
    raw["proof"] = serde_json::to_value(auth.sign_session_proof(&input)?)?;
    post_json(&format!("{}/auth/requests", trim_url(trellis_url)), &raw).await
}

async fn perform_local_login(
    trellis_url: &str,
    flow_id: &str,
    username: &str,
    password: &str,
) -> Result<Value, TrellisTestError> {
    let binding = portal_binding(flow_id)?;
    post_json_with_origin(
        &format!("{}/auth/login/local", trim_url(trellis_url)),
        trellis_url,
        &json!({
            "flowId": flow_id,
            "username": username,
            "password": password,
            "portalBindingDigest": portal_binding_digest(&binding),
        }),
    )
    .await
}

async fn register_local_user(
    trellis_url: &str,
    flow_id: &str,
    username: &str,
    password: &str,
) -> Result<Value, TrellisTestError> {
    let binding = portal_binding(flow_id)?;
    post_json_with_origin(
        &format!(
            "{}/auth/flow/{}/register/local",
            trim_url(trellis_url),
            flow_id
        ),
        trellis_url,
        &json!({
            "username": username,
            "password": password,
            "name": username,
            "email": null,
            "portalBindingDigest": portal_binding_digest(&binding),
        }),
    )
    .await
}

async fn submit_portal_approval(trellis_url: &str, flow_id: &str) -> Result<(), TrellisTestError> {
    let binding = portal_binding(flow_id)?;
    let client = reqwest::Client::builder().no_proxy().build()?;
    let flow_url = format!("{}/auth/flow/{}/portal", trim_url(trellis_url), flow_id);
    let response = client
        .post(&flow_url)
        .header(reqwest::header::ORIGIN, trellis_url)
        .header("trellis-portal-binding", &binding)
        .send()
        .await?;
    let flow: PortalFlowStatus = decode_http_json(&flow_url, response).await?;
    if flow.state == "approved" {
        return Ok(());
    }
    if flow.state != "approval_required" {
        return Err(TrellisTestError::UnexpectedFlowStatus {
            flow_id: flow_id.to_string(),
            status: flow.state,
        });
    }
    let url = format!("{}/auth/flow/{}/approval", trim_url(trellis_url), flow_id);
    let request = json!({
        "approved": true,
        "consentViewDigest": flow.consent_view_digest,
        "selectedOptionalBundles": [],
    });
    let response = client
        .post(&url)
        .header(reqwest::header::ORIGIN, trellis_url)
        .header("trellis-portal-binding", binding)
        .json(&request)
        .send()
        .await?;
    let approved: PortalFlowStatus = decode_http_json(&url, response).await?;
    if approved.state == "approved" {
        Ok(())
    } else {
        Err(TrellisTestError::UnexpectedFlowStatus {
            flow_id: flow_id.to_string(),
            status: approved.state,
        })
    }
}

fn portal_binding(flow_id: &str) -> Result<String, TrellisTestError> {
    static BINDINGS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let mut bindings = BINDINGS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| TrellisTestError::IntegrationControl("portal binding lock poisoned".into()))?;
    Ok(bindings
        .entry(flow_id.to_string())
        .or_insert_with(|| {
            let seed = nkeys::KeyPair::new_user()
                .seed()
                .expect("encode random test portal binding seed");
            trellis_protocol::sha256_base64url(&seed)
        })
        .clone())
}

fn portal_binding_digest(binding: &str) -> String {
    let binding = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(binding)
        .expect("decode generated test portal binding");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(binding))
}

async fn bind_flow(
    trellis_url: &str,
    flow_id: &str,
    auth: &SessionAuth,
) -> Result<BoundFlowSession, TrellisTestError> {
    let request_id = ulid::Ulid::new().to_string();
    let issued_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| TrellisTestError::UnexpectedResponse(error.to_string()))?
        .as_millis() as i64;
    let mut raw = json!({
        "requestId": request_id,
        "issuedAt": issued_at,
        "proof": { "format": "trellis.session-proof.v1", "signature": "" },
    });
    let input = trellis_protocol::SessionProofInput::user_auth_bind(
        trellis_protocol::UserAuthBindSessionProofInput {
            request_id,
            issued_at,
            flow_id: flow_id.to_owned(),
            session_public_key: auth.session_key.clone(),
            request_digest: trellis_protocol::session_proof_request_digest(&raw)?,
        },
    )?;
    raw["proof"] = serde_json::to_value(auth.sign_session_proof(&input)?)?;
    let bind_url = format!("{}/auth/flow/{}/bind", trim_url(trellis_url), flow_id);
    let response = loop {
        match post_json_with_origin::<CompletedFlowSession, _>(&bind_url, trellis_url, &raw).await {
            Err(TrellisTestError::HttpStatus {
                status: 503, code, ..
            }) if code == "authorization_pending" => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            result => break result?,
        }
    };
    let response_received_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| TrellisTestError::UnexpectedResponse(error.to_string()))?
        .as_millis() as i64;
    let servers = response
        .nats
        .transports
        .native
        .map(|route| route.nats_servers)
        .unwrap_or_default();
    if servers.is_empty() {
        return Err(TrellisTestError::UnexpectedResponse(
            "completed auth flow has no NATS transport endpoints".to_string(),
        ));
    }
    let context =
        trellis_protocol::parse_authorization_context(&response.authorization_context.context)?;
    Ok(BoundFlowSession {
        trellis_url: trellis_url.to_owned(),
        expires_at: response.session.expires_at,
        installation: trellis_rs::client::AuthorizationInstallation {
            context: response.authorization_context,
            routing: trellis_rs::client::AuthorizationRoutingMaterial {
                bootstrap_jwt: response.nats.jwt,
                bootstrap_jwt_expires_at: response.nats.jwt_expires_at,
            },
            runtime: trellis_rs::client::AuthorizationRuntimeBinding {
                session_id: response.session.session_id,
                participant_id: context.unsigned.participant.id.clone(),
                participant_digest: context.unsigned.participant.artifact_digest.clone(),
                needs_digest: context.unsigned.participant.needs_digest.clone(),
                inbox_prefix: response.session.inbox_prefix,
                transports: trellis_rs::client::AuthorizationRuntimeTransports {
                    native: trellis_rs::client::AuthorizationNativeTransport {
                        nats_servers: servers,
                    },
                },
            },
            server_clock_offset_ms: response.server_now
                - issued_at
                    .checked_add(response_received_at)
                    .and_then(|sum| sum.checked_div(2))
                    .ok_or_else(|| {
                        TrellisTestError::UnexpectedResponse(
                            "browser bind clock midpoint overflow".into(),
                        )
                    })?,
        },
    })
}

async fn connect_bound_user(
    bound: &BoundFlowSession,
    session_seed: &str,
    authorization_context_store: Arc<dyn trellis_rs::client::AuthorizationContextStore>,
    refresh_before_connect: bool,
) -> Result<Caller, TrellisTestError> {
    let _ = bound.expires_at;
    let initial = match trellis_rs::client::AuthorizationContextStore::load(
        authorization_context_store.as_ref(),
    )? {
        None => Some(bound.installation.clone()),
        Some(state) if state.context.is_none() && state.routing.is_none() => {
            Some(bound.installation.clone())
        }
        Some(_) => None,
    };
    let options = UserConnectOptions::new(
        &bound.trellis_url,
        DEFAULT_ADMIN_RPC_TIMEOUT_MS,
        trellis_rs::client::UserSessionCredentials {
            session_key_seed_base64url: session_seed,
        },
        trellis_rs::client::UserAuthorizationContext {
            initial,
            binding: format!("test-admin:{}", bound.trellis_url),
            store: authorization_context_store,
        },
    );
    let options = if refresh_before_connect {
        options.with_refresh_before_connect()
    } else {
        options
    };
    Ok(Caller::connect_user(options).await?)
}

fn materialized_authority_is_current(
    materialized: &Value,
    authority_version: &str,
) -> Result<bool, TrellisTestError> {
    if materialized.is_null() {
        return Ok(false);
    }
    let object = materialized.as_object().ok_or_else(|| {
        TrellisTestError::UnexpectedResponse(
            "materializedAuthority must be null or an object".to_string(),
        )
    })?;
    Ok(
        object.get("state").and_then(Value::as_str) == Some("available")
            && object
                .get("authorityVersion")
                .and_then(Value::as_i64)
                .is_some_and(|version| version.to_string() == authority_version)
            && object
                .get("reconciledAt")
                .is_some_and(|value| !value.is_null()),
    )
}

fn materialized_authority_failure(materialized: &Value) -> Option<String> {
    let object = materialized.as_object()?;
    matches!(
        object.get("state").and_then(Value::as_str),
        Some("unavailable" | "error")
    )
    .then(|| {
        object
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown materialization failure")
            .to_string()
    })
}

async fn wait_for_bootstrap_url(
    stdout_log: &Path,
    timeout: Duration,
) -> Result<String, TrellisTestError> {
    let deadline = Instant::now() + timeout;
    loop {
        let log = fs::read_to_string(stdout_log).unwrap_or_default();
        if let Some(url) = parse_trellis_bootstrap_url(&log) {
            return Ok(url);
        }
        if Instant::now() >= deadline {
            return Err(TrellisTestError::BootstrapUrlTimeout {
                log_path: stdout_log.display().to_string(),
                timeout,
            });
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn auth_deployments_create_request_shape(
    deployment: &str,
    _mutable_dev: bool,
    kind: auth_sdk::types::AuthDeploymentsCreateRequestKind,
    review_mode: Option<String>,
    requires_device_delegation: bool,
) -> Result<auth_sdk::types::AuthDeploymentsCreateRequest, TrellisTestError> {
    Ok(auth_sdk::types::AuthDeploymentsCreateRequest {
        display_name: deployment.to_owned(),
        expires_at: None,
        idempotency_key: random_session_seed(),
        kind,
        participant_id: None,
        portal_id: None,
        requires_device_delegation,
        review_mode,
    })
}

fn first_admin_bootstrap_body(password: &str) -> Map<String, Value> {
    let mut body = Map::new();
    body.insert(
        "username".to_string(),
        Value::String(ADMIN_USERNAME.to_string()),
    );
    body.insert("password".to_string(), Value::String(password.to_string()));
    body
}

#[derive(Debug)]
struct IntegrationWorkdir {
    temp_dir: Option<TempDir>,
    path: PathBuf,
    keep: bool,
}

impl IntegrationWorkdir {
    fn create(keep: bool) -> Result<Self, TrellisTestError> {
        let repo_name = repo_root()
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("trellis")
            .to_owned();
        let prefix = format!("{repo_name}-rust-test-");
        remove_stale_marked_workdirs(&std::env::temp_dir(), &prefix);
        let temp_dir = tempfile::Builder::new().prefix(&prefix).tempdir()?;
        let path = temp_dir.path().to_path_buf();
        if let Some(parent) = path.parent() {
            remove_stale_marked_workdirs(parent, &prefix);
        }
        Ok(Self {
            temp_dir: Some(temp_dir),
            path,
            keep,
        })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for IntegrationWorkdir {
    fn drop(&mut self) {
        if let Some(temp_dir) = self.temp_dir.take() {
            if self.keep {
                let path = temp_dir.keep();
                eprintln!("preserving Trellis test workdir {}", path.display());
            }
        }
    }
}

struct LocalNatsProcess {
    server: LocalNats,
}

impl fmt::Debug for LocalNatsProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LocalNatsProcess")
            .field("nats_url", &self.server.nats_url())
            .field("websocket_url", &self.server.websocket_url())
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
struct NatsTcpProxy {
    url: String,
    stop: tokio::sync::watch::Sender<()>,
    task: JoinHandle<()>,
}

impl NatsTcpProxy {
    async fn start(upstream_url: &str) -> Result<Self, TrellisTestError> {
        let (scheme, upstream) = upstream_url
            .split_once("://")
            .unwrap_or(("nats", upstream_url));
        let upstream = upstream.to_owned();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let (stop, mut stopped) = tokio::sync::watch::channel(());
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stopped.changed() => break,
                    accepted = listener.accept() => {
                        let Ok((mut downstream, _)) = accepted else { break };
                        let upstream = upstream.clone();
                        let mut connection_stopped = stopped.clone();
                        tokio::spawn(async move {
                            let Ok(mut upstream) = tokio::net::TcpStream::connect(upstream).await else {
                                return;
                            };
                            tokio::select! {
                                _ = tokio::io::copy_bidirectional(&mut downstream, &mut upstream) => {}
                                _ = connection_stopped.changed() => {}
                            }
                        });
                    }
                }
            }
        });
        Ok(Self {
            url: format!("{scheme}://{address}"),
            stop,
            task,
        })
    }
}

impl Drop for NatsTcpProxy {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        self.task.abort();
    }
}

impl LocalNatsProcess {
    fn start(workdir: &IntegrationWorkdir) -> Result<Self, TrellisTestError> {
        let cache = std::env::var_os("TRELLIS_TEST_CACHE_DIR")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from))
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
            .unwrap_or_else(std::env::temp_dir)
            .join("trellis-test/rust-local-nats");
        let server = LocalNats::builder()
            .binary(NatsBinarySource::DownloadPinned)
            .source(workdir.path().join("nats"))
            .temporary_state()
            .ephemeral_ports()
            .cache_dir(cache)
            .output(NatsOutput::Log {
                path: workdir.path().join("nats-server.log"),
                mirror: false,
            })
            .start()?;
        record_test_process_start("nats", "trellis-local-nats")?;
        Ok(Self { server })
    }

    fn nats_url(&self) -> String {
        self.server.nats_url().to_string()
    }

    fn websocket_url(&self) -> String {
        self.server.websocket_url().to_string()
    }

    fn stop(&mut self) -> Result<(), TrellisTestError> {
        self.server.stop().map_err(Into::into)
    }
}

impl Drop for LocalNatsProcess {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[derive(Debug)]
struct TrellisProcess {
    child: Child,
    stdout_log: PathBuf,
}

impl TrellisProcess {
    async fn start(
        command: &TrellisProcessCommand,
        config_path: &Path,
        workdir: &Path,
        trellis_url: &str,
        startup_timeout: Duration,
        shutdown_timeout: Duration,
    ) -> Result<Self, TrellisTestError> {
        let stdout_log = workdir.join("trellis.stdout.log");
        let stderr_log = workdir.join("trellis.stderr.log");
        let stdout = File::create(&stdout_log)?;
        let stderr = File::create(stderr_log)?;
        let mut child_command = command.command();
        if command.args.last().is_some_and(|arg| arg == "--config") {
            child_command.arg(config_path);
        }
        child_command
            .env("TRELLIS_CONFIG", config_path)
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
        terminate_on_parent_exit(&mut child_command);
        let child = child_command.spawn()?;
        let mut process = Self { child, stdout_log };
        if let Err(error) =
            wait_for_trellis_ready(&mut process.child, trellis_url, startup_timeout).await
        {
            let cleanup = process.stop(shutdown_timeout);
            if let Err(cleanup_error) = cleanup {
                return Err(TrellisTestError::StartupCleanupFailed {
                    startup: Box::new(error),
                    cleanup: Box::new(cleanup_error),
                });
            }
            return Err(error);
        }
        record_test_process_start("trellis", process.child.id())?;
        Ok(process)
    }

    fn stdout_log(&self) -> &Path {
        &self.stdout_log
    }

    fn stop(&mut self, shutdown_timeout: Duration) -> Result<(), TrellisTestError> {
        if self.child.try_wait()?.is_some() {
            return Ok(());
        }
        #[cfg(unix)]
        {
            let status = Command::new("kill")
                .arg("-TERM")
                .arg(self.child.id().to_string())
                .status()?;
            if !status.success() {
                return Err(TrellisTestError::UnexpectedResponse(format!(
                    "failed to terminate Trellis process {}: {}",
                    self.child.id(),
                    status_text(status)
                )));
            }
        }
        #[cfg(not(unix))]
        self.child.kill()?;
        let deadline = Instant::now() + shutdown_timeout;
        loop {
            if self.child.try_wait()?.is_some() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                self.child.kill()?;
                self.child.wait()?;
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}

impl Drop for TrellisProcess {
    fn drop(&mut self) {
        let _ = self.stop(DEFAULT_SHUTDOWN_TIMEOUT);
    }
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("trellis-test crate should live under rust/crates/trellis-test")
        .to_path_buf()
}

fn repo_trellis_command() -> TrellisProcessCommand {
    repo_trellis_mode_command("all")
}

fn repo_trellis_mode_command(mode: &str) -> TrellisProcessCommand {
    let repo = repo_root();
    let server = std::env::var_os("TRELLIS_TEST_SERVER_BIN").unwrap_or_else(|| {
        repo.join("rust/target/debug/trellis-server")
            .into_os_string()
    });
    TrellisProcessCommand::new(server, [mode, "--config"], repo)
}

fn keep_workdir_from_env() -> bool {
    std::env::var("TRELLIS_TEST_KEEP_WORKDIR")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

#[derive(Debug)]
pub struct TrellisTestPortReservation {
    listener: Option<TcpListener>,
    _lock_file: File,
}

impl TrellisTestPortReservation {
    /// Returns the reserved local TCP port.
    pub fn port(&self) -> io::Result<u16> {
        self.listener
            .as_ref()
            .expect("port reservation listener is available")
            .local_addr()
            .map(|address| address.port())
    }

    /// Releases the socket immediately before spawning the process that will bind it.
    pub fn release_listener(&mut self) {
        self.listener.take();
    }
}

/// Host-wide lease for one running Trellis integration-test process.
#[derive(Debug)]
pub struct TrellisTestHostSlot {
    _lock_file: Option<File>,
    borrowed_case_slot: bool,
}

impl Drop for TrellisTestHostSlot {
    fn drop(&mut self) {
        if self.borrowed_case_slot {
            BORROWED_CASE_SLOT.store(false, Ordering::Release);
        }
    }
}

/// Configures a test child to receive `SIGTERM` if its parent test process exits.
pub fn terminate_on_parent_exit(command: &mut Command) {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt as _;

        let parent_pid = std::process::id();
        // SAFETY: `pre_exec` invokes only async-signal-safe libc calls before exec.
        unsafe {
            command.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) == -1 {
                    return Err(io::Error::last_os_error());
                }
                if libc::getppid() != parent_pid.cast_signed() {
                    return Err(io::Error::new(
                        io::ErrorKind::Interrupted,
                        "test parent exited before child startup",
                    ));
                }
                Ok(())
            });
        }
    }
}

/// Acquires an optional host-wide Trellis process slot.
pub async fn reserve_host_test_slot() -> Result<Option<TrellisTestHostSlot>, TrellisTestError> {
    if std::env::var_os("TRELLIS_TEST_CASE_SLOT").is_some()
        && BORROWED_CASE_SLOT
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    {
        return Ok(Some(TrellisTestHostSlot {
            _lock_file: None,
            borrowed_case_slot: true,
        }));
    }
    reserve_additional_host_test_slot().await
}

static BORROWED_CASE_SLOT: AtomicBool = AtomicBool::new(false);
const HOST_SLOT_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(120);

/// Acquires an optional additional host-wide Trellis process slot.
pub async fn reserve_additional_host_test_slot(
) -> Result<Option<TrellisTestHostSlot>, TrellisTestError> {
    let Some(configured) = std::env::var_os("TRELLIS_TEST_HOST_JOBS") else {
        return Ok(None);
    };
    let limit = configured
        .to_string_lossy()
        .parse::<usize>()
        .ok()
        .filter(|limit| *limit > 0)
        .ok_or_else(|| {
            TrellisTestError::UnexpectedResponse(
                "TRELLIS_TEST_HOST_JOBS must be a positive integer".to_owned(),
            )
        })?;
    let lock_root = std::env::var_os("TRELLIS_TEST_HOST_LOCK_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if cfg!(windows) {
                std::env::temp_dir()
            } else {
                PathBuf::from("/tmp")
            }
        })
        .join("trellis-test-host-slots");
    fs::create_dir_all(&lock_root)?;
    let started = std::time::Instant::now();
    loop {
        for slot in 0..limit {
            let lock_path = lock_root.join(format!("{slot}.lock"));
            if let Some(lock_file) = try_acquire_file_lock(&lock_path)? {
                return Ok(Some(TrellisTestHostSlot {
                    _lock_file: Some(lock_file),
                    borrowed_case_slot: false,
                }));
            }
        }
        if started.elapsed() >= HOST_SLOT_ACQUIRE_TIMEOUT {
            let owners = (0..limit)
                .map(|slot| {
                    let lock_path = lock_root.join(format!("{slot}.lock"));
                    let owner = fs::read_to_string(&lock_path)
                        .map_or_else(|_| "<missing>".to_owned(), |value| value.trim().to_owned());
                    format!("{}={owner}", lock_path.display())
                })
                .collect::<Vec<_>>()
                .join(", ");
            return Err(TrellisTestError::UnexpectedResponse(format!(
                "timed out acquiring a host test slot after {}s: {owners}",
                HOST_SLOT_ACQUIRE_TIMEOUT.as_secs()
            )));
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn try_acquire_file_lock(lock_path: &Path) -> io::Result<Option<File>> {
    let mut lock_file = match fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)
    {
        Ok(file) => file,
        Err(error) if error.raw_os_error() == Some(libc::EISDIR) => return Ok(None),
        Err(error) => return Err(error),
    };
    match lock_file.try_lock() {
        Ok(()) => {
            lock_file.set_len(0)?;
            lock_file.rewind()?;
            writeln!(lock_file, "{}", std::process::id())?;
            Ok(Some(lock_file))
        }
        Err(fs::TryLockError::WouldBlock) => Ok(None),
        Err(fs::TryLockError::Error(error)) => Err(error),
    }
}

/// Reserves a local TCP port with a host-wide lease held until the returned guard is dropped.
pub fn reserve_local_port() -> Result<TrellisTestPortReservation, TrellisTestError> {
    const FIRST_PRIVATE_PORT: u64 = 49_152;
    const PRIVATE_PORT_COUNT: u64 = 16_384;
    static NEXT_PORT: AtomicU64 = AtomicU64::new(0);

    let lock_root = std::env::var_os("TRELLIS_TEST_PORT_LOCK_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if cfg!(windows) {
                std::env::temp_dir()
            } else {
                PathBuf::from("/tmp")
            }
        });
    fs::create_dir_all(&lock_root)?;
    let start = u64::from(std::process::id()) % PRIVATE_PORT_COUNT;
    for _ in 0..PRIVATE_PORT_COUNT {
        let offset = NEXT_PORT.fetch_add(1, Ordering::Relaxed);
        let port = (FIRST_PRIVATE_PORT + (start + offset) % PRIVATE_PORT_COUNT) as u16;
        let lock_path = lock_root.join(format!("trellis-test-port-{port}.lock"));
        if let Some(lock_file) = try_acquire_file_lock(&lock_path)? {
            match TcpListener::bind(("127.0.0.1", port)) {
                Ok(listener) => {
                    return Ok(TrellisTestPortReservation {
                        listener: Some(listener),
                        _lock_file: lock_file,
                    });
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::AddrInUse | io::ErrorKind::PermissionDenied
                    ) => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AddrNotAvailable,
        "no private local TCP port is available",
    )
    .into())
}

fn rewrite_trellis_config(
    workdir: &Path,
    manifest: &LocalTrellisBootstrapManifest,
    options: &LocalTrellisBootstrapOptions,
    runtime_options: &TrellisTestRuntimeOptions,
) -> Result<(), TrellisTestError> {
    let config_path = workdir.join(&manifest.paths.trellis_config);
    fs::write(
        config_path,
        render_test_trellis_config(options, manifest, runtime_options),
    )?;
    Ok(())
}

fn render_test_trellis_config(
    options: &LocalTrellisBootstrapOptions,
    manifest: &LocalTrellisBootstrapManifest,
    runtime_options: &TrellisTestRuntimeOptions,
) -> String {
    let _ = manifest;
    let http_port = reqwest::Url::parse(&options.public_origin)
        .expect("test public origin is a URL")
        .port_or_known_default()
        .expect("test public origin includes a port");
    let platform = match runtime_options.nats_user_jwt_ttl_ms {
        Some(nats_jwt) => json!({
            "storage": test_storage_config("./data/platform.sqlite"),
            "ttl_ms": { "nats_jwt": nats_jwt },
        }),
        None => json!({ "storage": test_storage_config("./data/platform.sqlite") }),
    };
    let config = json!({
        "instance_name": "trellis-test",
        "event_session_seed_file": "./session.seed",
        "event_context_digest_file": "./session-context.digest",
        "http": {
            "port": http_port,
            "public_origin": options.public_origin,
            "origins": [options.public_origin],
            "allow_insecure_origins": [options.public_origin],
            "rate_limit_max": 0,
            "rate_limit_window_ms": 60_000,
        },
        "nats": {
            "servers": options.nats_server_url,
            "runtime": {
                "auth_creds_path": "../nats/creds/auth-auth.creds",
                "trellis_creds_path": "../nats/creds/trellis-auth.creds",
                "system_creds_path": "../nats/creds/system.creds",
            },
            "auth_callout": {
                "issuer_signing_seed_file": "../nats/secrets/auth-issuer-signing.seed",
                "target_signing_seed_file": "../nats/secrets/auth-target-signing.seed",
                "xkey_seed_file": "../nats/secrets/auth-sx.seed",
            },
        },
        "client": {
            "ws_nats_servers": [options.nats_websocket_url],
            "nats_servers": [options.nats_server_url],
        },
        "leases": {
            "bucket": "trellis_runtime_leases",
            "replicas": 1,
            "ttl_ms": 9_000,
            "renew_ms": 3_000,
        },
        "auth": {
            "local_identity": { "enabled": true },
            "authorization": {
                "trust_root_file": "./auth/authorization-root.json",
                "issuer_manifest_file": "./auth/authorization-issuer-manifest.json",
                "issuer_signing_seed_file": "./auth/authorization-issuer.seed",
                "context_lifetime_seconds": 300,
                "refresh_lead_seconds": 60,
                "refresh_jitter_seconds": 15,
                "minimum_context_lifetime_seconds": 76,
                "maximum_bootstrap_jwt_lifetime_seconds": 3600,
                "cleanup_grace_seconds": 3_600,
                "allowed_clock_skew_seconds": 30,
                "maximum_context_bytes": 16_384,
                "maximum_permissions": 4_096,
                "maximum_capabilities": 256,
                "trust_bucket": "trellis_authorization_trust",
                "context_bucket": "trellis_authorization_contexts",
                "registry_replicas": 1,
            },
        },
        "oauth": {
            "redirect_base": format!("{}/auth/callback", options.public_origin.trim_end_matches('/')),
            "providers": runtime_options.oauth_providers,
        },
        "platform": platform,
        "jobs": { "storage": test_storage_config("./data/jobs.sqlite") },
        "health": {
            "storage": test_storage_config("./data/health.sqlite"),
            "transport_retention_hours": 1,
            "transport_max_bytes": 16_777_216,
        },
        "eventlog": { "storage": test_storage_config("./data/eventlog.sqlite") },
    });
    toml::to_string_pretty(&config).expect("serialize Rust test runtime config")
}

fn test_storage_config(path: &str) -> Value {
    json!({
        "kind": "sqlite",
        "path": path,
        "journal_mode": "wal",
        "busy_timeout_ms": 30_000,
        "single_writer": true,
    })
}

fn trellis_creds_path(workdir: &Path) -> PathBuf {
    workdir.join("nats/creds/trellis-auth.creds")
}

fn control_plane_sqlite_path(workdir: &Path) -> PathBuf {
    workdir.join("trellis/data/platform.sqlite")
}

fn sqlite_value_to_json(value: SqliteValue) -> Value {
    match value {
        SqliteValue::Null => Value::Null,
        SqliteValue::Integer(value) => Value::Number(Number::from(value)),
        SqliteValue::Real(value) => Number::from_f64(value).map_or(Value::Null, Value::Number),
        SqliteValue::Text(value) => Value::String(value),
        SqliteValue::Blob(bytes) => Value::Array(
            bytes
                .into_iter()
                .map(|byte| Value::Number(Number::from(byte)))
                .collect(),
        ),
    }
}

fn json_to_sqlite_value(value: &Value) -> SqliteValue {
    match value {
        Value::Null => SqliteValue::Null,
        Value::Bool(value) => SqliteValue::Integer(if *value { 1 } else { 0 }),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                SqliteValue::Integer(value)
            } else if let Some(value) = value.as_f64() {
                SqliteValue::Real(value)
            } else {
                SqliteValue::Null
            }
        }
        Value::String(value) => SqliteValue::Text(value.clone()),
        Value::Array(_) | Value::Object(_) => SqliteValue::Text(value.to_string()),
    }
}

async fn ensure_shared_streams(
    servers: &str,
    trellis_creds: &Path,
) -> Result<(), TrellisTestError> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match ensure_shared_streams_once(servers, trellis_creds).await {
            Ok(()) => return Ok(()),
            Err(error) if Instant::now() >= deadline => return Err(error),
            Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
}

async fn ensure_shared_streams_once(
    servers: &str,
    trellis_creds: &Path,
) -> Result<(), TrellisTestError> {
    let client = ConnectOptions::new()
        .credentials_file(trellis_creds)
        .await?
        .connect(servers)
        .await
        .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
    let js = jetstream::new(client);
    ensure_stream(
        &js,
        stream::Config {
            name: "trellis".to_string(),
            subjects: vec!["events.>".to_string()],
            num_replicas: 1,
            ..Default::default()
        },
    )
    .await?;
    ensure_stream(
        &js,
        stream::Config {
            name: "JOBS".to_string(),
            subjects: vec!["trellis.jobs.>".to_string()],
            retention: stream::RetentionPolicy::Limits,
            allow_direct: true,
            num_replicas: 1,
            ..Default::default()
        },
    )
    .await?;
    ensure_stream(
        &js,
        stream::Config {
            name: "JOBS_WORK".to_string(),
            subjects: vec!["trellis.work.>".to_string()],
            retention: stream::RetentionPolicy::WorkQueue,
            sources: Some(vec![stream::Source {
                name: "JOBS".to_string(),
                subject_transforms: vec![
                    stream::SubjectTransform {
                        source: "trellis.jobs.*.*.*.created".to_string(),
                        destination: "trellis.work.$1.$2".to_string(),
                    },
                    stream::SubjectTransform {
                        source: "trellis.jobs.*.*.*.retried".to_string(),
                        destination: "trellis.work.$1.$2".to_string(),
                    },
                ],
                ..Default::default()
            }]),
            num_replicas: 1,
            ..Default::default()
        },
    )
    .await?;
    ensure_stream(
        &js,
        stream::Config {
            name: "JOBS_ADVISORIES".to_string(),
            subjects: vec!["$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>".to_string()],
            retention: stream::RetentionPolicy::Limits,
            num_replicas: 1,
            ..Default::default()
        },
    )
    .await?;
    Ok(())
}

async fn ensure_stream(
    js: &jetstream::Context,
    config: stream::Config,
) -> Result<(), TrellisTestError> {
    match js.get_stream(&config.name).await {
        Ok(_) => {}
        Err(_) => {
            js.create_stream(config).await.map_err(nats_io_error)?;
        }
    }
    Ok(())
}

fn nats_io_error(error: async_nats::jetstream::context::CreateStreamError) -> TrellisTestError {
    TrellisTestError::Io(io::Error::other(error))
}

fn is_jetstream_not_found_error(error: &impl fmt::Display) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("not found") || message.contains("does not exist")
}

async fn wait_for_trellis_ready(
    child: &mut Child,
    trellis_url: &str,
    timeout: Duration,
) -> Result<(), TrellisTestError> {
    let version_url = format!("{}/readyz", trellis_url.trim_end_matches('/'));
    let deadline = Instant::now() + timeout;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .no_proxy()
        .build()?;
    loop {
        if let Some(status) = child.try_wait()? {
            return Err(TrellisTestError::TrellisExitedBeforeReady {
                url: version_url,
                status: status_text(status),
            });
        }
        match client.get(&version_url).send().await {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(_) | Err(_) if Instant::now() >= deadline => {
                return Err(TrellisTestError::TrellisReadyTimeout {
                    url: version_url,
                    timeout,
                });
            }
            Ok(_) | Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
}

fn status_text(status: std::process::ExitStatus) -> String {
    status
        .code()
        .map_or_else(|| "signal".to_string(), |code| format!("exit code {code}"))
}

fn remove_stale_marked_workdirs(parent: &Path, prefix: &str) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.starts_with(prefix) || !path.is_dir() {
            continue;
        }
        let marker_path = path.join(WORKDIR_OWNER_MARKER);
        let owner_pid = fs::read_to_string(marker_path)
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok());
        if owner_pid.is_some_and(process_is_gone) {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn process_is_gone(pid: u32) -> bool {
    let proc = Path::new("/proc");
    proc.is_dir() && !proc.join(pid.to_string()).exists()
}

fn cleanup_started(
    trellis: &mut Option<TrellisProcess>,
    nats: &mut Option<LocalNatsProcess>,
    shutdown_timeout: Duration,
) -> Result<(), TrellisTestError> {
    if let Some(mut process) = trellis.take() {
        process.stop(shutdown_timeout)?;
    }
    if let Some(mut container) = nats.take() {
        container.stop()?;
    }
    Ok(())
}

fn parse_trellis_bootstrap_url(log: &str) -> Option<String> {
    let marker = "\"adminAccountUrl\":\"";
    for line in log.lines() {
        if let Some(start) = line.find(marker) {
            let url_start = start + marker.len();
            if let Some(end) = line[url_start..].find('"') {
                return Some(line[url_start..url_start + end].replace("\\/", "/"));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        auth_deployments_create_request_shape, first_admin_bootstrap_body, flow_id_from_url,
        materialized_authority_failure, materialized_authority_is_current,
        parse_trellis_bootstrap_url, remove_stale_marked_workdirs, repo_trellis_command,
        reserve_local_port, try_acquire_file_lock, ContainerRuntime, TrellisControlPlaneSqlite,
        TrustedLocalUserRegistration, WORKDIR_OWNER_MARKER,
    };
    use rusqlite::params;
    use serde_json::{json, Value};
    use std::fs;

    #[test]
    fn file_locks_treat_legacy_directories_as_occupied() {
        let dir = tempfile::tempdir().expect("create legacy lock tempdir");
        let lock_path = dir.path().join("legacy.lock");
        fs::create_dir(&lock_path).expect("create legacy lock directory");

        assert!(try_acquire_file_lock(&lock_path)
            .expect("inspect legacy lock")
            .is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn deno_and_rust_file_locks_interoperate() {
        use std::io::{BufRead as _, Write as _};
        use std::process::{Command, Stdio};

        const TRY_LOCK: &str = r#"
const file = Deno.openSync(Deno.args[0], { read: true, write: true });
console.log(file.tryLockSync() ? "acquired" : "blocked");
file.close();
"#;
        const HOLD_LOCK: &str = r#"
const file = Deno.openSync(Deno.args[0], { read: true, write: true });
if (!file.tryLockSync()) Deno.exit(2);
console.log("locked");
await Deno.stdin.read(new Uint8Array(1));
file.close();
"#;

        let dir = tempfile::tempdir().expect("create lock interoperability tempdir");
        let lock_path = dir.path().join("interop.lock");
        fs::write(&lock_path, b"").expect("create lock file");
        let rust_file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&lock_path)
            .expect("open Rust lock file");
        rust_file.try_lock().expect("acquire Rust lock");

        let output = Command::new("deno")
            .args(["eval", TRY_LOCK, "--"])
            .arg(&lock_path)
            .output()
            .expect("run Deno lock probe");
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "blocked");
        rust_file.unlock().expect("release Rust lock");

        let spawn_holder = || {
            Command::new("deno")
                .args(["eval", HOLD_LOCK, "--"])
                .arg(&lock_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .expect("spawn Deno lock holder")
        };
        let wait_until_locked = |child: &mut std::process::Child| {
            let mut line = String::new();
            std::io::BufReader::new(child.stdout.as_mut().expect("Deno holder stdout"))
                .read_line(&mut line)
                .expect("read Deno lock status");
            assert_eq!(line.trim(), "locked");
        };

        let mut deno = spawn_holder();
        wait_until_locked(&mut deno);
        assert!(matches!(
            rust_file.try_lock(),
            Err(fs::TryLockError::WouldBlock)
        ));
        deno.stdin
            .take()
            .expect("Deno holder stdin")
            .write_all(b"\n")
            .expect("release Deno lock");
        assert!(deno.wait().expect("wait for Deno lock release").success());
        rust_file.try_lock().expect("acquire Deno-released lock");
        rust_file.unlock().expect("release reacquired lock");

        let mut deno = spawn_holder();
        wait_until_locked(&mut deno);
        deno.kill().expect("kill Deno lock holder");
        deno.wait().expect("wait for killed Deno lock holder");
        rust_file
            .try_lock()
            .expect("acquire lock after owner death");
    }

    #[test]
    fn stale_marked_workdir_cleanup_keeps_live_and_unmarked_dirs() {
        if !std::path::Path::new("/proc").is_dir() {
            return;
        }
        let temp = tempfile::tempdir().expect("create cleanup tempdir");
        let live = temp.path().join("trellis-test-live");
        let dead = temp.path().join("trellis-test-dead");
        let unmarked = temp.path().join("trellis-test-unmarked");
        fs::create_dir(&live).expect("create live dir");
        fs::create_dir(&dead).expect("create dead dir");
        fs::create_dir(&unmarked).expect("create unmarked dir");
        fs::write(
            live.join(WORKDIR_OWNER_MARKER),
            format!("{}\n", std::process::id()),
        )
        .expect("write live marker");
        fs::write(dead.join(WORKDIR_OWNER_MARKER), "999999999\n").expect("write dead marker");

        remove_stale_marked_workdirs(temp.path(), "trellis-test-");

        assert!(live.exists());
        assert!(!dead.exists());
        assert!(unmarked.exists());
    }

    #[test]
    fn local_port_reservation_holds_the_port() {
        let mut reservation = reserve_local_port().expect("reserve local port");
        let port = reservation.port().expect("read local port");
        let expected_root = std::env::var_os("TRELLIS_TEST_PORT_LOCK_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                if cfg!(windows) {
                    std::env::temp_dir()
                } else {
                    std::path::PathBuf::from("/tmp")
                }
            });
        let lock_path = expected_root.join(format!("trellis-test-port-{port}.lock"));

        assert_eq!(lock_path.parent(), Some(expected_root.as_path()));
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_err());
        let competitor = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&lock_path)
            .expect("open competing port lock");
        assert!(matches!(
            competitor.try_lock(),
            Err(fs::TryLockError::WouldBlock)
        ));
        reservation.release_listener();
        assert!(lock_path.exists());
        let _listener = std::net::TcpListener::bind(("127.0.0.1", port))
            .expect("retain released port during lock assertion");
        drop(reservation);
        competitor.try_lock().expect("acquire released port lock");
    }

    #[test]
    fn parse_bootstrap_url_accepts_json_log_line() {
        let log =
            r#"{"adminAccountUrl":"http://127.0.0.1:3000/console/profile?adminAccountToken=abc"}"#;

        assert_eq!(
            parse_trellis_bootstrap_url(log).unwrap(),
            "http://127.0.0.1:3000/console/profile?adminAccountToken=abc"
        );
    }

    #[test]
    fn control_plane_sqlite_queries_and_mutates_database() {
        let dir = tempfile::tempdir().expect("create temp sqlite dir");
        let sqlite = TrellisControlPlaneSqlite::new(dir.path().join("trellis.sqlite"));

        sqlite
            .execute(
                "create table auth_sessions (session_id text primary key, session_public_key text unique, value text)",
                [],
            )
            .expect("create test table");
        let inserted = sqlite
            .execute(
                "insert into auth_sessions (session_id, session_public_key, value) values (?, ?, ?)",
                params!["ses_1", "session-1", "before"],
            )
            .expect("insert test row");
        assert_eq!(inserted.rows_affected, 1);

        let rows = sqlite
            .query(
                "select session_id, session_public_key, value from auth_sessions where session_public_key = ?",
                params!["session-1"],
            )
            .expect("query test row");
        assert_eq!(
            rows,
            vec![
                json!({ "session_id": "ses_1", "session_public_key": "session-1", "value": "before" })
                    .as_object()
                    .expect("object row")
                    .clone()
            ]
        );

        let snapshot = sqlite
            .take_session("session-1")
            .expect("take session row")
            .expect("session row exists");
        assert_eq!(
            sqlite
                .query("select * from auth_sessions", [])
                .expect("query empty after take"),
            Vec::new()
        );
        assert_eq!(
            snapshot
                .restore()
                .expect("restore session row")
                .rows_affected,
            1
        );
        assert_eq!(
            sqlite
                .query("select * from auth_sessions", [])
                .expect("query restored table"),
            vec![
                json!({ "session_id": "ses_1", "session_public_key": "session-1", "value": "before" })
                    .as_object()
                    .expect("object row")
                    .clone()
            ]
        );

        let deleted = sqlite
            .execute(
                "delete from auth_sessions where session_public_key = ?",
                params!["session-1"],
            )
            .expect("delete test row");
        assert_eq!(deleted.rows_affected, 1);
        assert_eq!(
            sqlite
                .query("select * from auth_sessions", [])
                .expect("query empty table"),
            Vec::new()
        );
    }

    #[test]
    fn flow_id_from_url_requires_flow_id_query_parameter() {
        assert_eq!(
            flow_id_from_url("http://127.0.0.1:3000/login/admin/bootstrap?flowId=flow_123")
                .unwrap(),
            "flow_123"
        );
        assert!(flow_id_from_url("http://127.0.0.1:3000/login/admin/bootstrap").is_err());
    }

    #[test]
    fn first_admin_bootstrap_body_matches_public_http_shape() {
        assert_eq!(
            serde_json::to_value(first_admin_bootstrap_body("secret-password")).unwrap(),
            json!({ "username": "admin", "password": "secret-password" })
        );
    }

    #[test]
    fn deployment_create_request_matches_clean_auth_shape() {
        let value = serde_json::to_value(
            auth_deployments_create_request_shape(
                "test",
                false,
                super::auth_sdk::types::AuthDeploymentsCreateRequestKind::Service,
                None,
                false,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(value["displayName"], json!("test"));
        assert_eq!(value["kind"], json!("service"));
        assert_eq!(value["reviewMode"], Value::Null);
        assert_eq!(value["requiresDeviceDelegation"], json!(false));
        assert!(value["idempotencyKey"].as_str().is_some());
    }

    #[test]
    fn built_in_contracts_compile_to_protocol_apis() {
        let mut apis = super::builtin_api_artifacts();
        super::ensure_builtin_api(trellis_runtime_apis::core::API_ID, &mut apis).unwrap();
        super::ensure_builtin_api(trellis_runtime_apis::state::API_ID, &mut apis).unwrap();
        assert!(apis.contains_key(trellis_runtime_apis::core::API_ID));
        assert!(apis.contains_key(trellis_runtime_apis::state::API_ID));
    }

    #[test]
    fn materialized_authority_status_helpers_match_ready_and_failed_shapes() {
        let current = json!({
            "state": "available",
            "authorityVersion": 1,
            "reconciledAt": "2026-06-16T00:00:00Z"
        });
        let failed = json!({ "state": "error", "error": "resource failure" });

        assert!(materialized_authority_is_current(&current, "1").unwrap());
        assert!(!materialized_authority_is_current(&Value::Null, "1").unwrap());
        assert_eq!(
            materialized_authority_failure(&failed).unwrap(),
            "resource failure"
        );
    }

    #[test]
    fn repo_command_targets_trellis_service_entrypoint() {
        let command = repo_trellis_command();

        assert!(command
            .display_command()
            .ends_with("trellis-server all --config"));
    }

    #[test]
    fn container_runtime_maps_to_bootstrap_runtime() {
        assert_eq!(
            ContainerRuntime::Podman.to_bootstrap(),
            trellis_local_bootstrap::ContainerRuntime::Podman
        );
        assert_eq!(
            ContainerRuntime::Docker.to_bootstrap(),
            trellis_local_bootstrap::ContainerRuntime::Docker
        );
    }

    #[test]
    fn trusted_local_user_registration_debug_redacts_secrets() {
        let registration = TrustedLocalUserRegistration {
            portal_id: "trusted-portal".to_owned(),
            username: "local-user".to_owned(),
            password: "secret-password".to_owned(),
            capabilities: vec!["documents.read".to_owned()],
            session_seed: "secret-session-seed".to_owned(),
        };

        let debug = format!("{registration:?}");
        assert!(debug.contains("trusted-portal"));
        assert!(debug.contains("local-user"));
        assert!(debug.contains("documents.read"));
        assert!(!debug.contains("secret-password"));
        assert!(!debug.contains("secret-session-seed"));
        assert_eq!(debug.matches("[REDACTED]").count(), 2);
    }
}
