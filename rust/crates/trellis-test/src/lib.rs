//! Private Rust integration-test helpers for live Trellis runtime scenarios.
//!
//! This crate is the Rust equivalent foundation for the TypeScript
//! `@qlever-llc/trellis-test` runtime helper. It owns isolated test workdirs,
//! NATS container lifecycle, repo-local Trellis process lifecycle, readiness
//! probing, and deterministic cleanup. Admin/client/service automation will be
//! layered on this foundation as Rust live integration cases migrate.

use std::ffi::OsString;
use std::fs::{self, File};
use std::io;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{collections::HashSet, fmt};

use async_nats::jetstream::{self, stream};
use async_nats::ConnectOptions;
use futures_util::StreamExt;
use rusqlite::{params_from_iter, types::Value as SqliteValue, Connection, Params};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};
use tempfile::TempDir;
use tokio::task::JoinHandle;
use trellis_local_bootstrap::{
    render_trellis_config, ContainerRuntime as BootstrapContainerRuntime, LocalBootstrapError,
    LocalTrellisBootstrapManifest, LocalTrellisBootstrapOptions,
};
use trellis_rs::client::{SessionAuth, TrellisClient, TrellisClientError, UserConnectOptions};
use trellis_rs::sdk::auth::{self as auth_sdk, AuthClient as GeneratedAuthClient};

const DEFAULT_STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_RECONCILIATION_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_ADMIN_RPC_TIMEOUT_MS: u64 = 5_000;
const NATS_IMAGE: &str = "docker.io/library/nats:2-alpine";
const ADMIN_USERNAME: &str = "admin";
const ADMIN_RPC_CALLS: &[&str] = &[
    "Auth.DeploymentAuthority.AcceptMigration",
    "Auth.DeploymentAuthority.AcceptUpdate",
    "Auth.DeploymentAuthority.Get",
    "Auth.DeploymentAuthority.Plan",
    "Auth.DeploymentAuthority.Plans.List",
    "Auth.DeploymentAuthority.Reject",
    "Auth.DeploymentAuthority.Reconcile",
    "Auth.Deployments.Create",
    "Auth.DeviceUserAuthorities.List",
    "Auth.DeviceUserAuthorities.Reviews.Decide",
    "Auth.DeviceUserAuthorities.Reviews.List",
    "Auth.DeviceUserAuthorities.Revoke",
    "Auth.Devices.Provision",
    "Auth.ServiceInstances.List",
    "Auth.ServiceInstances.Provision",
    "Auth.Sessions.List",
    "Auth.Sessions.Me",
    "Auth.Sessions.Revoke",
    "Auth.Users.Update",
];

/// Error returned by Rust Trellis integration-test runtime helpers.
#[derive(Debug, thiserror::Error)]
pub enum TrellisTestError {
    /// Filesystem or process I/O failed.
    #[error(transparent)]
    Io(#[from] io::Error),

    /// Local NATS/Trellis bootstrap generation failed.
    #[error(transparent)]
    LocalBootstrap(#[from] LocalBootstrapError),

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

    /// Control-plane SQLite access failed.
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),

    /// Contract manifest parsing or digesting failed.
    #[error(transparent)]
    Contract(#[from] trellis_rs::contracts::ContractsError),

    /// No supported container runtime was available on `PATH`.
    #[error("Trellis tests require podman or docker on PATH")]
    ContainerRuntimeNotFound,

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
    #[error("Trellis HTTP request failed ({status}) for {url}: {body}")]
    HttpStatus {
        /// Requested URL.
        url: String,
        /// HTTP status code.
        status: u16,
        /// Response body, when readable.
        body: String,
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

    /// A child command exited with a non-zero status.
    #[error("{context}: command `{command}` exited with status {status}\nstdout tail:\n{stdout_tail}\nstderr tail:\n{stderr_tail}")]
    CommandFailed {
        /// Description of the failed operation.
        context: &'static str,
        /// Display form of the command.
        command: String,
        /// Exit status text.
        status: String,
        /// Tail of stdout.
        stdout_tail: String,
        /// Tail of stderr.
        stderr_tail: String,
    },

    /// Published container port output could not be parsed.
    #[error("failed to parse published container port from `{0}`")]
    PublishedPortParse(String),

    /// A TCP endpoint did not become ready before the deadline.
    #[error("timed out waiting for TCP listener on 127.0.0.1:{port}: {source}")]
    TcpReadyTimeout {
        /// Host port that was probed.
        port: u16,
        /// Last observed connection error.
        source: io::Error,
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

/// Container runtime used for isolated NATS test containers.
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
    fn resolve(self) -> Result<ResolvedContainerRuntime, TrellisTestError> {
        match self {
            Self::Podman => Ok(ResolvedContainerRuntime::Podman),
            Self::Docker => Ok(ResolvedContainerRuntime::Docker),
            Self::Auto if command_exists("podman") => Ok(ResolvedContainerRuntime::Podman),
            Self::Auto if command_exists("docker") => Ok(ResolvedContainerRuntime::Docker),
            Self::Auto => Err(TrellisTestError::ContainerRuntimeNotFound),
        }
    }

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
    /// Named fail-once hooks injected into the isolated test control-plane config.
    pub fail_once_hooks: Vec<String>,
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
            fail_once_hooks: Vec::new(),
        }
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
    nats: Option<NatsContainer>,
    trellis: Option<TrellisProcess>,
    trellis_url: String,
    nats_url: String,
    nats_websocket_url: String,
    manifest: LocalTrellisBootstrapManifest,
    admin_password: String,
    default_deployment: String,
    default_mutable_dev: bool,
    reconciliation_timeout: Duration,
    startup_timeout: Duration,
    shutdown_timeout: Duration,
    trellis_command: TrellisProcessCommand,
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
            &format!("INSERT OR IGNORE INTO sessions ({column_sql}) VALUES ({placeholders})"),
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
            "SELECT * FROM sessions WHERE session_key = ?",
            [session_key],
        )?;
        let Some(row) = rows.into_iter().next() else {
            return Ok(None);
        };
        self.execute("DELETE FROM sessions WHERE session_key = ?", [session_key])?;
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
    /// Raw key in the `trellis_connections` KV bucket.
    pub key: String,
    /// Raw JSON value written to the `trellis_connections` KV bucket.
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

impl TrellisTestRuntime {
    /// Start an isolated NATS container and repo-local Trellis control plane.
    pub async fn start(options: TrellisTestRuntimeOptions) -> Result<Self, TrellisTestError> {
        let resolved_runtime = options.container_runtime.resolve()?;
        let workdir = IntegrationWorkdir::create(options.keep_workdir)?;

        let port = reserve_local_port()?;
        let trellis_url = format!("http://127.0.0.1:{port}");
        let mut bootstrap_options = LocalTrellisBootstrapOptions::new(workdir.path());
        bootstrap_options.force = false;
        bootstrap_options.container_runtime = options.container_runtime.to_bootstrap();
        bootstrap_options.trellis_port = port;
        bootstrap_options.public_origin = trellis_url.clone();
        let manifest =
            trellis_local_bootstrap::generate_local_trellis_bootstrap(&bootstrap_options)?;

        let mut nats = None;
        let mut trellis = None;
        let started = async {
            let started_nats = NatsContainer::start(resolved_runtime, &workdir)?;
            bootstrap_options.nats_server_url = started_nats.nats_url();
            bootstrap_options.nats_websocket_url = started_nats.websocket_url();
            rewrite_trellis_config(workdir.path(), &manifest, &bootstrap_options, &options)?;
            ensure_shared_streams(
                &started_nats.nats_url(),
                &trellis_creds_path(workdir.path()),
            )
            .await?;

            let config_path = workdir.path().join(&manifest.paths.trellis_config);
            let started_trellis = TrellisProcess::start(
                &options.trellis_command,
                &config_path,
                workdir.path(),
                &trellis_url,
                options.startup_timeout,
                options.shutdown_timeout,
            )
            .await?;
            let nats_url = started_nats.nats_url();
            let nats_websocket_url = started_nats.websocket_url();
            nats = Some(started_nats);
            trellis = Some(started_trellis);
            Ok::<_, TrellisTestError>((nats_url, nats_websocket_url))
        }
        .await;

        let (nats_url, nats_websocket_url) = match started {
            Ok(urls) => urls,
            Err(error) => {
                let cleanup = cleanup_started(&mut trellis, &mut nats, options.shutdown_timeout);
                if let Err(cleanup_error) = cleanup {
                    return Err(TrellisTestError::StartupCleanupFailed {
                        startup: Box::new(error),
                        cleanup: Box::new(cleanup_error),
                    });
                }
                return Err(error);
            }
        };

        Ok(Self {
            workdir,
            nats,
            trellis,
            trellis_url,
            nats_url,
            nats_websocket_url,
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
        })
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
        TrellisControlPlaneSqlite::new(control_plane_sqlite_path(self.workdir.path()))
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
        let stream = js
            .get_stream("trellis")
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
        let mut consumers = stream.consumers();
        let mut infos = Vec::new();

        while let Some(info) = consumers.next().await {
            let info = info.map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
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

    /// Start a live NATS observer for JetStream ACK frames on the Trellis event stream.
    pub async fn start_jetstream_ack_observer(
        &self,
    ) -> Result<TrellisJetStreamAckObserver, TrellisTestError> {
        let client = ConnectOptions::new()
            .credentials_file(trellis_creds_path(self.workdir.path()))
            .await?
            .connect(&self.nats_url)
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
        let mut subscription = client
            .subscribe("$JS.ACK.trellis.>".to_string())
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
        client
            .flush()
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;

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
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
        client
            .flush()
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;

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
        let stream = js
            .get_stream("trellis")
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;

        match stream.delete_consumer(durable_name).await {
            Ok(_) => Ok(true),
            Err(error) if is_jetstream_not_found_error(&error) => Ok(false),
            Err(error) => Err(io::Error::new(io::ErrorKind::Other, error).into()),
        }
    }

    /// Seeds one raw auth connection-presence KV entry for malformed-entry tests.
    pub async fn seed_raw_auth_connection_presence(
        &self,
        entry: TrellisRawAuthConnectionPresence,
    ) -> Result<(), TrellisTestError> {
        let client = ConnectOptions::new()
            .credentials_file(auth_creds_path(self.workdir.path()))
            .await?
            .connect(&self.nats_url)
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))?;
        let js = jetstream::new(client);
        let kv = js
            .get_key_value("trellis_connections")
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
        kv.put(entry.key, entry.value.to_string().into())
            .await
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
        Ok(())
    }

    /// Return the generated local bootstrap manifest.
    #[must_use]
    pub fn manifest(&self) -> &LocalTrellisBootstrapManifest {
        &self.manifest
    }

    /// Return the first admin bootstrap URL observed in Trellis stdout, if present.
    pub fn bootstrap_url(&self) -> Result<Option<String>, TrellisTestError> {
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
        })
    }

    /// Build public Rust service connect options for a provisioned service key.
    #[must_use]
    pub fn service_connect_options<'a>(
        &'a self,
        name: &'a str,
        service_key: &'a TrellisTestServiceKey,
    ) -> trellis_rs::service::ServiceConnectOptions<'a> {
        trellis_rs::service::ServiceConnectOptions::new(&self.trellis_url, name, &service_key.seed)
    }

    /// Complete first-admin bootstrap through the public Trellis HTTP surface.
    pub async fn complete_bootstrap(&self) -> Result<(), TrellisTestError> {
        let bootstrap_url = self
            .wait_for_bootstrap_url(self.reconciliation_timeout)
            .await?;
        complete_first_admin_bootstrap(&self.trellis_url, &bootstrap_url, &self.admin_password)
            .await
    }

    /// Restart only the Trellis control-plane process, preserving workdir state and NATS.
    pub async fn restart_control_plane(&mut self) -> Result<(), TrellisTestError> {
        if self.nats.is_none() {
            return Err(TrellisTestError::UnexpectedResponse(
                "NATS container is not running".to_string(),
            ));
        }

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
            &self.trellis_command,
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
}

/// Public-surface admin automation for live Trellis integration tests.
pub struct TrellisTestAdmin {
    trellis_url: String,
    admin_password: String,
    default_deployment: String,
    default_mutable_dev: bool,
    reconciliation_timeout: Duration,
    bootstrap_complete: bool,
    client: Option<TrellisClient>,
    created_deployments: HashSet<String>,
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
            bootstrap_complete: false,
            client: None,
            created_deployments: HashSet::new(),
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
        complete_first_admin_bootstrap(&self.trellis_url, bootstrap_url, &self.admin_password)
            .await?;
        self.bootstrap_complete = true;
        Ok(())
    }

    /// Connect and cache an authenticated admin client using public HTTP and NATS surfaces.
    pub async fn connect_admin(
        &mut self,
        bootstrap_url: &str,
    ) -> Result<&TrellisClient, TrellisTestError> {
        if self.client.is_none() {
            self.complete_bootstrap(bootstrap_url).await?;
            let contract = admin_contract()?;
            let connected =
                connect_user_with_local_admin(&self.trellis_url, &self.admin_password, &contract)
                    .await?;
            self.client = Some(connected);
        }
        Ok(self
            .client
            .as_ref()
            .expect("admin client is initialized before returning"))
    }

    /// Create a service deployment through `Auth.Deployments.Create`.
    pub async fn create_deployment(
        &mut self,
        bootstrap_url: &str,
        deployment: Option<&str>,
        mutable_dev: Option<bool>,
    ) -> Result<(), TrellisTestError> {
        let deployment = deployment.unwrap_or(&self.default_deployment).to_string();
        let mutable_dev = mutable_dev.unwrap_or(self.default_mutable_dev);
        if self.created_deployments.contains(&deployment) {
            return Ok(());
        }
        let client = self.connect_admin(bootstrap_url).await?;
        let auth = GeneratedAuthClient::new(client);
        auth.rpc()
            .auth()
            .deployments_create(&auth_deployments_create_request_shape(
                &deployment,
                mutable_dev,
            ))
            .await?;
        self.created_deployments.insert(deployment);
        Ok(())
    }

    /// Plan, accept, reconcile, and wait for a service contract authority update.
    pub async fn approve_contract(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        deployment: Option<&str>,
        allow_plan_classifications: &[AuthorityPlanClassification],
    ) -> Result<TrellisTestContractApproval, TrellisTestError> {
        let deployment = deployment.unwrap_or(&self.default_deployment).to_string();
        self.create_deployment(bootstrap_url, Some(&deployment), None)
            .await?;
        let client = self.connect_admin(bootstrap_url).await?;
        let auth = GeneratedAuthClient::new(client);
        let planned = auth
            .rpc()
            .auth()
            .deployment_authority_plan(&auth_sdk::types::AuthDeploymentAuthorityPlanRequest {
                deployment_id: deployment.clone(),
                contract: contract.manifest_map()?,
                expected_digest: contract.digest.clone(),
            })
            .await?;
        let plan = AuthorityPlanSummary::from_value(&planned.plan)?;
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
        match plan.classification {
            AuthorityPlanClassification::Update => {
                auth.rpc()
                    .auth()
                    .deployment_authority_accept_update(
                        &auth_sdk::types::AuthDeploymentAuthorityAcceptUpdateRequest {
                            plan_id: plan.plan_id.clone(),
                            expected_desired_version: None,
                        },
                    )
                    .await?;
            }
            AuthorityPlanClassification::Migration => {
                auth.rpc()
                    .auth()
                    .deployment_authority_accept_migration(
                        &auth_sdk::types::AuthDeploymentAuthorityAcceptMigrationRequest {
                            plan_id: plan.plan_id.clone(),
                            expected_desired_version: None,
                            acknowledgement:
                                "Approved by trellis-test for an isolated integration test."
                                    .to_string(),
                        },
                    )
                    .await?;
            }
        }
        self.reconcile(bootstrap_url, &deployment).await?;
        self.wait_ready(bootstrap_url, &deployment).await?;
        Ok(TrellisTestContractApproval {
            plan_id: plan.plan_id,
            classification: plan.classification,
        })
    }

    /// Trigger deployment-authority reconciliation for one deployment.
    pub async fn reconcile(
        &mut self,
        bootstrap_url: &str,
        deployment: &str,
    ) -> Result<(), TrellisTestError> {
        let client = self.connect_admin(bootstrap_url).await?;
        let auth = GeneratedAuthClient::new(client);
        auth.rpc()
            .auth()
            .deployment_authority_reconcile(
                &auth_sdk::types::AuthDeploymentAuthorityReconcileRequest {
                    deployment_id: deployment.to_string(),
                    desired_version: None,
                },
            )
            .await?;
        Ok(())
    }

    /// Wait until materialized deployment authority is current.
    pub async fn wait_ready(
        &mut self,
        bootstrap_url: &str,
        deployment: &str,
    ) -> Result<(), TrellisTestError> {
        let deadline = Instant::now() + self.reconciliation_timeout;
        loop {
            let client = self.connect_admin(bootstrap_url).await?;
            let auth = GeneratedAuthClient::new(client);
            let result = auth
                .rpc()
                .auth()
                .deployment_authority_get(&auth_sdk::types::AuthDeploymentAuthorityGetRequest {
                    deployment_id: deployment.to_string(),
                })
                .await?;
            if materialized_authority_is_current(
                &result.materialized_authority,
                &result.authority.version,
            )? {
                return Ok(());
            }
            if let Some(message) = materialized_authority_failure(&result.materialized_authority) {
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
        let deployment = deployment.unwrap_or(&self.default_deployment).to_string();
        self.approve_contract(
            bootstrap_url,
            contract,
            Some(&deployment),
            &[AuthorityPlanClassification::Update],
        )
        .await?;
        let seed = session_key_seed.unwrap_or_else(random_session_seed);
        let auth_material = SessionAuth::from_seed_base64url(&seed)?;
        let client = self.connect_admin(bootstrap_url).await?;
        let auth = GeneratedAuthClient::new(client);
        auth.rpc()
            .auth()
            .service_instances_provision(&auth_sdk::types::AuthServiceInstancesProvisionRequest {
                deployment_id: deployment,
                instance_key: auth_material.session_key.clone(),
            })
            .await?;
        Ok(TrellisTestServiceKey {
            seed,
            session_key: auth_material.session_key,
        })
    }

    /// Complete a user/client local auth flow as the test admin user.
    pub async fn complete_client_auth(
        &mut self,
        bootstrap_url: &str,
        login_url: &str,
    ) -> Result<String, TrellisTestError> {
        self.complete_bootstrap(bootstrap_url).await?;
        let flow_id = flow_id_from_url(login_url)?;
        perform_local_login(&self.trellis_url, &flow_id, &self.admin_password).await?;
        approve_local_flow_if_needed(self, bootstrap_url, &flow_id).await?;
        Ok(flow_id)
    }

    /// Complete a user/client auth flow and return a connected public Rust client.
    pub async fn connect_client(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
    ) -> Result<TrellisClient, TrellisTestError> {
        self.connect_client_with_session_seed(bootstrap_url, contract, random_session_seed())
            .await
    }

    /// Complete a user/client auth flow for a deterministic session seed.
    pub async fn connect_client_with_session_seed(
        &mut self,
        bootstrap_url: &str,
        contract: &TrellisTestContract,
        session_seed: impl Into<String>,
    ) -> Result<TrellisClient, TrellisTestError> {
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
    ) -> Result<(TrellisClient, TrellisTestClientReconnect), TrellisTestError> {
        self.complete_bootstrap(bootstrap_url).await?;
        let session_seed = session_seed.into();
        let auth = SessionAuth::from_seed_base64url(&session_seed)?;
        let redirect_to = format!("{}/_trellis/test/client-auth", self.trellis_url);
        let started = start_auth_request(&self.trellis_url, &redirect_to, &auth, contract).await?;
        let bound = match started {
            trellis_rs::auth::AuthStartResponse::FlowStarted { login_url, .. } => {
                let flow_id = self.complete_client_auth(bootstrap_url, &login_url).await?;
                bind_flow(&self.trellis_url, &auth, &flow_id).await?
            }
            trellis_rs::auth::AuthStartResponse::Bound {
                expires,
                sentinel,
                transports,
                ..
            } => bound_flow_session_from_parts(expires, sentinel, transports)?,
        };

        let reconnect = TrellisTestClientReconnect {
            bound: bound.clone(),
            session_seed,
            contract_digest: contract.digest.clone(),
        };
        let client =
            connect_bound_user(&bound, &reconnect.session_seed, &reconnect.contract_digest).await?;
        Ok((client, reconnect))
    }

    /// Reconnect a user/client session only when Trellis reports the session is already bound.
    pub async fn connect_client_with_session_seed_bound_only(
        &self,
        contract: &TrellisTestContract,
        session_seed: impl Into<String>,
    ) -> Result<TrellisClient, TrellisTestError> {
        let session_seed = session_seed.into();
        let auth = SessionAuth::from_seed_base64url(&session_seed)?;
        let redirect_to = format!("{}/_trellis/test/client-auth", self.trellis_url);
        let started = start_auth_request(&self.trellis_url, &redirect_to, &auth, contract).await?;
        let bound = match started {
            trellis_rs::auth::AuthStartResponse::Bound {
                expires,
                sentinel,
                transports,
                ..
            } => bound_flow_session_from_parts(expires, sentinel, transports)?,
            trellis_rs::auth::AuthStartResponse::FlowStarted { flow_id, .. } => {
                return Err(TrellisTestError::UnexpectedResponse(format!(
                    "bound-only client reconnect started fresh auth flow {flow_id}"
                )));
            }
        };

        connect_bound_user(&bound, &session_seed, contract.digest()).await
    }
}

/// Bound client reconnect material captured from a completed public auth flow.
#[derive(Clone, Debug)]
pub struct TrellisTestClientReconnect {
    bound: BoundFlowSession,
    session_seed: String,
    contract_digest: String,
}

impl TrellisTestClientReconnect {
    /// Reconnect the already-bound session without starting or completing a fresh auth flow.
    pub async fn connect_bound_only(&self) -> Result<TrellisClient, TrellisTestError> {
        connect_bound_user(&self.bound, &self.session_seed, &self.contract_digest).await
    }
}

/// Contract manifest and digest used by admin automation helpers.
#[derive(Clone, Debug, PartialEq)]
pub struct TrellisTestContract {
    manifest: Value,
    digest: String,
}

impl TrellisTestContract {
    /// Build a test contract from manifest JSON, computing its canonical digest.
    pub fn from_manifest_json(manifest_json: &str) -> Result<Self, TrellisTestError> {
        let manifest = serde_json::from_str(manifest_json)?;
        let digest = trellis_rs::contracts::digest_contract_json(manifest_json)?;
        Ok(Self { manifest, digest })
    }

    /// Build a test contract from a manifest value, computing its canonical digest.
    pub fn from_manifest_value(manifest: Value) -> Result<Self, TrellisTestError> {
        let digest = trellis_rs::contracts::digest_contract_value(&manifest)?;
        Ok(Self { manifest, digest })
    }

    /// Return the manifest value sent to public Auth RPCs.
    #[must_use]
    pub fn manifest(&self) -> &Value {
        &self.manifest
    }

    /// Return the canonical manifest digest.
    #[must_use]
    pub fn digest(&self) -> &str {
        &self.digest
    }

    fn manifest_map(&self) -> Result<std::collections::BTreeMap<String, Value>, TrellisTestError> {
        let Value::Object(map) = &self.manifest else {
            return Err(TrellisTestError::UnexpectedResponse(
                "contract manifest must be a JSON object".to_string(),
            ));
        };
        Ok(map.clone().into_iter().collect())
    }
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
}

/// Session key material for a provisioned service instance.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrellisTestServiceKey {
    /// Base64url Ed25519 seed for service runtime auth.
    pub seed: String,
    /// Public session key provisioned as the service instance key.
    pub session_key: String,
}

#[derive(Debug, Deserialize)]
struct FirstAdminBootstrapResponse {
    status: String,
}

#[derive(Debug, Deserialize)]
struct PortalFlowStatus {
    status: String,
    #[serde(rename = "missingCapabilities", default)]
    missing_capabilities: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum BindFlowResponse {
    Bound {
        expires: String,
        sentinel: trellis_rs::auth::SentinelCredsRecord,
        transports: trellis_rs::auth::ClientTransportsRecord,
    },
    InsufficientCapabilities,
    ApprovalRequired,
    ApprovalDenied,
}

#[derive(Clone, Debug)]
struct BoundFlowSession {
    nats_servers: String,
    sentinel_jwt: String,
    sentinel_seed: String,
    expires: String,
}

#[derive(Debug)]
struct AuthorityPlanSummary {
    plan_id: String,
    classification: AuthorityPlanClassification,
}

impl AuthorityPlanSummary {
    fn from_value(value: &Value) -> Result<Self, TrellisTestError> {
        let plan_id = value
            .get("planId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                TrellisTestError::UnexpectedResponse(
                    "authority plan response missing planId".to_string(),
                )
            })?
            .to_string();
        let classification = match value.get("classification").and_then(Value::as_str) {
            Some("update") => AuthorityPlanClassification::Update,
            Some("migration") => AuthorityPlanClassification::Migration,
            Some(other) => {
                return Err(TrellisTestError::UnexpectedResponse(format!(
                    "unsupported authority plan classification '{other}'"
                )));
            }
            None => {
                return Err(TrellisTestError::UnexpectedResponse(
                    "authority plan response missing classification".to_string(),
                ));
            }
        };
        Ok(Self {
            plan_id,
            classification,
        })
    }
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

async fn get_json<T>(url: &str) -> Result<T, TrellisTestError>
where
    T: for<'de> Deserialize<'de>,
{
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .get(url)
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
        return Err(TrellisTestError::HttpStatus {
            url: url.to_string(),
            status: status.as_u16(),
            body: text,
        });
    }
    Ok(serde_json::from_str(&text)?)
}

async fn complete_first_admin_bootstrap(
    trellis_url: &str,
    bootstrap_url: &str,
    password: &str,
) -> Result<(), TrellisTestError> {
    let flow_id = flow_id_from_url(bootstrap_url)?;
    let response: FirstAdminBootstrapResponse = post_json(
        &format!(
            "{}/auth/account-flow/{}/local-password",
            trim_url(trellis_url),
            flow_id
        ),
        &first_admin_bootstrap_body(password),
    )
    .await?;
    if response.status == "created" {
        Ok(())
    } else {
        Err(TrellisTestError::UnexpectedResponse(format!(
            "first-admin bootstrap returned status '{}'",
            response.status
        )))
    }
}

async fn connect_user_with_local_admin(
    trellis_url: &str,
    password: &str,
    contract: &TrellisTestContract,
) -> Result<TrellisClient, TrellisTestError> {
    let session_seed = random_session_seed();
    let auth = SessionAuth::from_seed_base64url(&session_seed)?;
    let redirect_to = format!("{}/_trellis/test/admin-auth", trim_url(trellis_url));
    let started = start_auth_request(trellis_url, &redirect_to, &auth, contract).await?;
    let flow_id = match started {
        trellis_rs::auth::AuthStartResponse::FlowStarted { login_url, .. } => {
            complete_local_auth_flow(trellis_url, password, &login_url).await?
        }
        trellis_rs::auth::AuthStartResponse::Bound { .. } => {
            return Err(TrellisTestError::UnexpectedResponse(
                "fresh admin auth unexpectedly returned bound".to_string(),
            ));
        }
    };
    let bound = bind_flow(trellis_url, &auth, &flow_id).await?;
    connect_bound_user(&bound, &session_seed, contract.digest()).await
}

async fn start_auth_request(
    trellis_url: &str,
    redirect_to: &str,
    auth: &SessionAuth,
    contract: &TrellisTestContract,
) -> Result<trellis_rs::auth::AuthStartResponse, TrellisTestError> {
    let sig = auth.sign_sha256_domain(
        "oauth-init",
        &auth_start_signature_payload(redirect_to, contract.manifest(), None)?,
    );
    post_json(
        &format!("{}/auth/requests", trim_url(trellis_url)),
        &trellis_rs::auth::AuthStartRequest {
            provider: None,
            redirect_to: redirect_to.to_string(),
            session_key: auth.session_key.clone(),
            sig,
            contract: contract.manifest_map()?,
            context: None,
        },
    )
    .await
}

fn auth_start_signature_payload(
    redirect_to: &str,
    contract: &Value,
    context: Option<&Value>,
) -> Result<String, TrellisTestError> {
    Ok(format!(
        "{}:{}:{}:{}",
        redirect_to,
        "",
        trellis_rs::contracts::canonicalize_json(contract)?,
        trellis_rs::contracts::canonicalize_json(context.unwrap_or(&Value::Null))?,
    ))
}

async fn complete_local_auth_flow(
    trellis_url: &str,
    password: &str,
    login_url: &str,
) -> Result<String, TrellisTestError> {
    let flow_id = flow_id_from_url(login_url)?;
    perform_local_login(trellis_url, &flow_id, password).await?;
    approve_local_flow_without_grants(trellis_url, &flow_id).await?;
    Ok(flow_id)
}

async fn perform_local_login(
    trellis_url: &str,
    flow_id: &str,
    password: &str,
) -> Result<(), TrellisTestError> {
    let _: Value = post_json(
        &format!("{}/auth/login/local", trim_url(trellis_url)),
        &json!({ "flowId": flow_id, "username": ADMIN_USERNAME, "password": password }),
    )
    .await?;
    Ok(())
}

async fn approve_local_flow_without_grants(
    trellis_url: &str,
    flow_id: &str,
) -> Result<(), TrellisTestError> {
    let state = fetch_flow_state(trellis_url, flow_id).await?;
    match state.status.as_str() {
        "redirect" => Ok(()),
        "approval_required" => submit_portal_approval(trellis_url, flow_id).await,
        status => Err(TrellisTestError::UnexpectedFlowStatus {
            flow_id: flow_id.to_string(),
            status: status.to_string(),
        }),
    }
}

async fn approve_local_flow_if_needed(
    admin: &mut TrellisTestAdmin,
    bootstrap_url: &str,
    flow_id: &str,
) -> Result<(), TrellisTestError> {
    let mut state = fetch_flow_state(&admin.trellis_url, flow_id).await?;
    if state.status == "insufficient_capabilities" {
        grant_client_capabilities(admin, bootstrap_url, &state.missing_capabilities).await?;
        state = fetch_flow_state(&admin.trellis_url, flow_id).await?;
    }
    match state.status.as_str() {
        "redirect" => Ok(()),
        "approval_required" => submit_portal_approval(&admin.trellis_url, flow_id).await,
        "insufficient_capabilities" => Err(TrellisTestError::UnexpectedResponse(format!(
            "admin user still lacks capabilities: {}",
            state.missing_capabilities.join(", ")
        ))),
        status => Err(TrellisTestError::UnexpectedFlowStatus {
            flow_id: flow_id.to_string(),
            status: status.to_string(),
        }),
    }
}

async fn fetch_flow_state(
    trellis_url: &str,
    flow_id: &str,
) -> Result<PortalFlowStatus, TrellisTestError> {
    get_json(&format!("{}/auth/flow/{}", trim_url(trellis_url), flow_id)).await
}

async fn submit_portal_approval(trellis_url: &str, flow_id: &str) -> Result<(), TrellisTestError> {
    let state: PortalFlowStatus = post_json(
        &format!("{}/auth/flow/{}/approval", trim_url(trellis_url), flow_id),
        &json!({ "approved": true }),
    )
    .await?;
    if state.status == "redirect" {
        Ok(())
    } else {
        Err(TrellisTestError::UnexpectedFlowStatus {
            flow_id: flow_id.to_string(),
            status: state.status,
        })
    }
}

async fn grant_client_capabilities(
    admin: &mut TrellisTestAdmin,
    bootstrap_url: &str,
    missing_capabilities: &[String],
) -> Result<(), TrellisTestError> {
    admin.create_deployment(bootstrap_url, None, None).await?;
    let client = admin.connect_admin(bootstrap_url).await?;
    let auth = GeneratedAuthClient::new(client);
    let me = auth.rpc().auth().sessions_me().await?;
    let user = me.user.as_object().ok_or_else(|| {
        TrellisTestError::UnexpectedResponse("admin session did not resolve to a user".to_string())
    })?;
    let user_id = user.get("userId").and_then(Value::as_str).ok_or_else(|| {
        TrellisTestError::UnexpectedResponse("admin session user is missing userId".to_string())
    })?;
    let mut capabilities = user
        .get("capabilities")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            TrellisTestError::UnexpectedResponse(
                "admin session user is missing capabilities".to_string(),
            )
        })?
        .iter()
        .filter_map(|value| value.as_str().map(ToOwned::to_owned))
        .collect::<Vec<_>>();
    capabilities.extend(missing_capabilities.iter().cloned());
    capabilities.sort();
    capabilities.dedup();
    auth.rpc()
        .auth()
        .users_update(&auth_sdk::types::AuthUsersUpdateRequest {
            user_id: user_id.to_string(),
            active: None,
            capabilities: Some(capabilities),
            capability_groups: None,
            email: None,
            name: None,
        })
        .await?;
    Ok(())
}

async fn bind_flow(
    trellis_url: &str,
    auth: &SessionAuth,
    flow_id: &str,
) -> Result<BoundFlowSession, TrellisTestError> {
    let sig = auth.sign_sha256_domain("bind-flow", flow_id);
    let response: BindFlowResponse = post_json(
        &format!("{}/auth/flow/{}/bind", trim_url(trellis_url), flow_id),
        &json!({ "sessionKey": auth.session_key, "sig": sig }),
    )
    .await?;
    match response {
        BindFlowResponse::Bound {
            expires,
            sentinel,
            transports,
        } => bound_flow_session_from_parts(expires, sentinel, transports),
        BindFlowResponse::InsufficientCapabilities => Err(TrellisTestError::UnexpectedResponse(
            "bind returned insufficient_capabilities".to_string(),
        )),
        BindFlowResponse::ApprovalRequired => Err(TrellisTestError::UnexpectedResponse(
            "bind returned approval_required".to_string(),
        )),
        BindFlowResponse::ApprovalDenied => Err(TrellisTestError::UnexpectedResponse(
            "bind returned approval_denied".to_string(),
        )),
    }
}

fn bound_flow_session_from_parts(
    expires: String,
    sentinel: trellis_rs::auth::SentinelCredsRecord,
    transports: trellis_rs::auth::ClientTransportsRecord,
) -> Result<BoundFlowSession, TrellisTestError> {
    let native = transports.native.ok_or_else(|| {
        TrellisTestError::UnexpectedResponse(
            "bound auth flow did not include native NATS transport".to_string(),
        )
    })?;
    if native.nats_servers.is_empty() {
        return Err(TrellisTestError::UnexpectedResponse(
            "bound auth flow native transport has no NATS servers".to_string(),
        ));
    }
    Ok(BoundFlowSession {
        nats_servers: native.nats_servers.join(","),
        sentinel_jwt: sentinel.jwt,
        sentinel_seed: sentinel.seed,
        expires,
    })
}

async fn connect_bound_user(
    bound: &BoundFlowSession,
    session_seed: &str,
    contract_digest: &str,
) -> Result<TrellisClient, TrellisTestError> {
    let _ = &bound.expires;
    Ok(TrellisClient::connect_user(UserConnectOptions {
        servers: &bound.nats_servers,
        sentinel_jwt: &bound.sentinel_jwt,
        sentinel_seed: &bound.sentinel_seed,
        session_key_seed_base64url: session_seed,
        contract_digest,
        timeout_ms: DEFAULT_ADMIN_RPC_TIMEOUT_MS,
    })
    .await?)
}

fn admin_contract() -> Result<TrellisTestContract, TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.test.admin@v1",
        "Trellis Test Admin",
        "Automates Trellis test runtime administration through Auth RPCs.",
        trellis_rs::contracts::ContractKind::Agent,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(ADMIN_RPC_CALLS.iter().copied())
            .with_operation_call(["Auth.DeviceUserAuthorities.Resolve"]),
    )
    .build()?;
    TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
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
        object.get("status").and_then(Value::as_str) == Some("current")
            && object.get("desiredVersion").and_then(Value::as_str) == Some(authority_version)
            && object
                .get("reconciledAt")
                .is_some_and(|value| !value.is_null()),
    )
}

fn materialized_authority_failure(materialized: &Value) -> Option<String> {
    let object = materialized.as_object()?;
    (object.get("status").and_then(Value::as_str) == Some("failed")).then(|| {
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
    mutable_dev: bool,
) -> auth_sdk::types::AuthDeploymentsCreateRequest {
    auth_sdk::types::AuthDeploymentsCreateRequest(json!({
        "deploymentId": deployment,
        "kind": "service",
        "namespaces": [],
        "contractCompatibilityMode": if mutable_dev { "mutable-dev" } else { "strict" },
    }))
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
        let temp_dir = tempfile::Builder::new()
            .prefix(&format!("{repo_name}-rust-test-"))
            .tempdir()?;
        let path = temp_dir.path().to_path_buf();
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResolvedContainerRuntime {
    Podman,
    Docker,
}

impl ResolvedContainerRuntime {
    fn program(self) -> &'static str {
        match self {
            Self::Podman => "podman",
            Self::Docker => "docker",
        }
    }

    fn is_podman(self) -> bool {
        self == Self::Podman
    }
}

#[derive(Debug)]
struct NatsContainer {
    runtime: ResolvedContainerRuntime,
    name: String,
    nats_port: u16,
    websocket_port: u16,
    stopped: bool,
}

impl NatsContainer {
    fn start(
        runtime: ResolvedContainerRuntime,
        workdir: &IntegrationWorkdir,
    ) -> Result<Self, TrellisTestError> {
        let nats_dir = workdir.path().join("nats");
        fs::create_dir_all(nats_dir.join("data"))?;
        let name = unique_container_name("nats")?;
        let spec = CommandSpec::new(runtime.program())
            .arg("run")
            .arg("--detach")
            .arg("--name")
            .arg(&name)
            .arg("--publish")
            .arg("127.0.0.1::4222")
            .arg("--publish")
            .arg("127.0.0.1::8080")
            .arg("--volume")
            .arg(container_mount(
                &nats_dir.join("nats.conf"),
                "/etc/nats/nats.conf",
                runtime,
                MountMode::ReadOnly,
            ))
            .arg("--volume")
            .arg(container_mount(
                &nats_dir.join("jwt.conf"),
                "/etc/nats/jwt.conf",
                runtime,
                MountMode::ReadOnly,
            ))
            .arg("--volume")
            .arg(container_mount(
                &nats_dir.join("data"),
                "/data",
                runtime,
                MountMode::ReadWrite,
            ))
            .arg(NATS_IMAGE)
            .arg("-c")
            .arg("/etc/nats/nats.conf");

        let output = run_output(&spec)?;
        if !output.status.success() {
            return Err(command_failed(
                "failed to start NATS container",
                &spec,
                output,
            ));
        }

        let started = (|| {
            let nats_port = inspect_container_port(runtime, &name, 4222)?;
            let websocket_port = inspect_container_port(runtime, &name, 8080)?;
            wait_for_tcp_ready(nats_port, Duration::from_secs(30))?;
            wait_for_tcp_ready(websocket_port, Duration::from_secs(30))?;
            Ok::<_, TrellisTestError>(Self {
                runtime,
                name: name.clone(),
                nats_port,
                websocket_port,
                stopped: false,
            })
        })();

        if started.is_err() {
            let _ = remove_container(runtime, &name);
        }
        started
    }

    fn nats_url(&self) -> String {
        format!("nats://127.0.0.1:{}", self.nats_port)
    }

    fn websocket_url(&self) -> String {
        format!("ws://127.0.0.1:{}", self.websocket_port)
    }

    fn stop(&mut self) -> Result<(), TrellisTestError> {
        if self.stopped {
            return Ok(());
        }
        remove_container(self.runtime, &self.name)?;
        self.stopped = true;
        Ok(())
    }
}

impl Drop for NatsContainer {
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
        child_command
            .env("TRELLIS_CONFIG", config_path)
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
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
        Ok(process)
    }

    fn stdout_log(&self) -> &Path {
        &self.stdout_log
    }

    fn stop(&mut self, shutdown_timeout: Duration) -> Result<(), TrellisTestError> {
        if self.child.try_wait()?.is_some() {
            return Ok(());
        }
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MountMode {
    ReadOnly,
    ReadWrite,
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("trellis-test crate should live under rust/crates/trellis-test")
        .to_path_buf()
}

fn repo_trellis_command() -> TrellisProcessCommand {
    let repo = repo_root();
    TrellisProcessCommand::new(
        "deno",
        [
            "run",
            "--env",
            "--allow-env",
            "--allow-sys",
            "--allow-read",
            "--allow-write",
            "--allow-net",
            "--allow-ffi",
            "main.ts",
        ],
        repo.join("js/services/trellis"),
    )
}

fn command_exists(program: &str) -> bool {
    Command::new(program)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn keep_workdir_from_env() -> bool {
    std::env::var("TRELLIS_TEST_KEEP_WORKDIR")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

fn reserve_local_port() -> Result<u16, TrellisTestError> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
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
    let config = render_trellis_config(options, &manifest.nats).replacen(
        "  \"storage\": {",
        "  \"httpRateLimit\": {\n    \"windowMs\": 60000,\n    \"max\": 0\n  },\n  \"storage\": {",
        1,
    );
    let config = if runtime_options.oauth_providers.is_empty() {
        config
    } else {
        config.replacen(
            "    \"providers\": {}",
            &format!(
                "    \"providers\": {}",
                serde_json::to_string_pretty(&runtime_options.oauth_providers)
                    .expect("serialize test OAuth providers")
            ),
            1,
        )
    };
    if runtime_options.fail_once_hooks.is_empty() {
        return config;
    }
    config.replacen(
        "  \"oauth\": {",
        &format!(
            "  \"trellisTest\": {{\n    \"failOnce\": {}\n  }},\n  \"oauth\": {{",
            serde_json::to_string_pretty(&runtime_options.fail_once_hooks)
                .expect("serialize test fail-once hooks")
        ),
        1,
    )
}

fn trellis_creds_path(workdir: &Path) -> PathBuf {
    workdir.join("nats/creds/trellis-auth.creds")
}

fn auth_creds_path(workdir: &Path) -> PathBuf {
    workdir.join("nats/creds/auth-auth.creds")
}

fn control_plane_sqlite_path(workdir: &Path) -> PathBuf {
    workdir.join("trellis/data/trellis.sqlite")
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
    TrellisTestError::Io(io::Error::new(io::ErrorKind::Other, error))
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
    let version_url = format!("{}/version", trellis_url.trim_end_matches('/'));
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

fn inspect_container_port(
    runtime: ResolvedContainerRuntime,
    name: &str,
    container_port: u16,
) -> Result<u16, TrellisTestError> {
    let spec = CommandSpec::new(runtime.program())
        .arg("port")
        .arg(name)
        .arg(format!("{container_port}/tcp"));
    let output = run_output(&spec)?;
    if !output.status.success() {
        return Err(command_failed(
            "failed to inspect NATS container port",
            &spec,
            output,
        ));
    }
    parse_published_port(&String::from_utf8(output.stdout)?)
}

fn parse_published_port(output: &str) -> Result<u16, TrellisTestError> {
    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(port) = line.rsplit(':').next() {
            if let Ok(port) = port.parse::<u16>() {
                return Ok(port);
            }
        }
    }
    Err(TrellisTestError::PublishedPortParse(output.to_string()))
}

fn wait_for_tcp_ready(port: u16, timeout: Duration) -> Result<(), TrellisTestError> {
    let deadline = Instant::now() + timeout;
    loop {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(_) => return Ok(()),
            Err(error) if Instant::now() >= deadline => {
                return Err(TrellisTestError::TcpReadyTimeout {
                    port,
                    source: error,
                });
            }
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn remove_container(runtime: ResolvedContainerRuntime, name: &str) -> Result<(), TrellisTestError> {
    let spec = CommandSpec::new(runtime.program())
        .arg("rm")
        .arg("--force")
        .arg(name);
    let output = run_output(&spec)?;
    if output.status.success() {
        return Ok(());
    }
    Err(command_failed(
        "failed to remove NATS container",
        &spec,
        output,
    ))
}

fn container_mount(
    host_path: &Path,
    container_path: &str,
    runtime: ResolvedContainerRuntime,
    mode: MountMode,
) -> String {
    let mode = match (mode, runtime.is_podman()) {
        (MountMode::ReadOnly, true) => "ro,Z",
        (MountMode::ReadOnly, false) => "ro",
        (MountMode::ReadWrite, true) => "rw,Z",
        (MountMode::ReadWrite, false) => "rw",
    };
    format!("{}:{container_path}:{mode}", host_path.display())
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct CommandSpec {
    program: OsString,
    args: Vec<OsString>,
}

impl CommandSpec {
    fn new(program: impl Into<OsString>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
        }
    }

    fn arg(mut self, arg: impl Into<OsString>) -> Self {
        self.args.push(arg.into());
        self
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.args);
        command
    }

    fn display_command(&self) -> String {
        let mut parts = Vec::with_capacity(self.args.len() + 1);
        parts.push(self.program.to_string_lossy().into_owned());
        parts.extend(
            self.args
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned()),
        );
        parts.join(" ")
    }
}

fn run_output(spec: &CommandSpec) -> Result<Output, TrellisTestError> {
    Ok(spec
        .command()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?)
}

fn command_failed(context: &'static str, spec: &CommandSpec, output: Output) -> TrellisTestError {
    TrellisTestError::CommandFailed {
        context,
        command: spec.display_command(),
        status: status_text(output.status),
        stdout_tail: output_tail(&output.stdout),
        stderr_tail: output_tail(&output.stderr),
    }
}

fn output_tail(output: &[u8]) -> String {
    const OUTPUT_TAIL_BYTES: usize = 4096;
    if output.is_empty() {
        return "<empty>".to_string();
    }
    let start = output.len().saturating_sub(OUTPUT_TAIL_BYTES);
    String::from_utf8_lossy(&output[start..]).trim().to_string()
}

fn unique_container_name(prefix: &str) -> Result<String, TrellisTestError> {
    let process_id = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    Ok(format!("trellis-test-{prefix}-{process_id}-{nanos}"))
}

fn cleanup_started(
    trellis: &mut Option<TrellisProcess>,
    nats: &mut Option<NatsContainer>,
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
    let marker = "\"bootstrapUrl\":\"";
    for line in log.lines() {
        if let Some(start) = line.find(marker) {
            let url_start = start + marker.len();
            if let Some(end) = line[url_start..].find('"') {
                return Some(line[url_start..url_start + end].replace("\\/", "/"));
            }
        }
        if let Some(start) = line.find("TRELLIS_ADMIN_BOOTSTRAP_URL=") {
            let value = &line[start + "TRELLIS_ADMIN_BOOTSTRAP_URL=".len()..];
            return value.split_whitespace().next().map(ToOwned::to_owned);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        admin_contract, auth_deployments_create_request_shape, auth_start_signature_payload,
        bound_flow_session_from_parts, container_mount, first_admin_bootstrap_body,
        flow_id_from_url, materialized_authority_failure, materialized_authority_is_current,
        parse_published_port, parse_trellis_bootstrap_url, repo_trellis_command,
        AuthorityPlanClassification, AuthorityPlanSummary, ContainerRuntime, MountMode,
        ResolvedContainerRuntime, TrellisControlPlaneSqlite,
    };
    use rusqlite::params;
    use serde_json::{json, Value};

    #[test]
    fn container_mount_relabels_podman_volumes() {
        let path = std::path::Path::new("/tmp/trellis/nats.conf");

        assert_eq!(
            container_mount(
                path,
                "/etc/nats/nats.conf",
                ResolvedContainerRuntime::Podman,
                MountMode::ReadOnly,
            ),
            "/tmp/trellis/nats.conf:/etc/nats/nats.conf:ro,Z"
        );
        assert_eq!(
            container_mount(
                path,
                "/etc/nats/nats.conf",
                ResolvedContainerRuntime::Docker,
                MountMode::ReadOnly,
            ),
            "/tmp/trellis/nats.conf:/etc/nats/nats.conf:ro"
        );
    }

    #[test]
    fn parse_published_port_accepts_container_runtime_output() {
        assert_eq!(parse_published_port("127.0.0.1:49152\n").unwrap(), 49152);
        assert_eq!(parse_published_port("0.0.0.0:42221\n").unwrap(), 42221);
        assert_eq!(parse_published_port("[::1]:43333\n").unwrap(), 43333);
    }

    #[test]
    fn parse_bootstrap_url_accepts_json_log_line() {
        let log = r#"{"bootstrapUrl":"http://127.0.0.1:3000/_trellis/portal/admin/bootstrap?flowId=abc"}"#;

        assert_eq!(
            parse_trellis_bootstrap_url(log).unwrap(),
            "http://127.0.0.1:3000/_trellis/portal/admin/bootstrap?flowId=abc"
        );
    }

    #[test]
    fn control_plane_sqlite_queries_and_mutates_database() {
        let dir = tempfile::tempdir().expect("create temp sqlite dir");
        let sqlite = TrellisControlPlaneSqlite::new(dir.path().join("trellis.sqlite"));

        sqlite
            .execute(
                "create table sessions (session_key text primary key, value text)",
                [],
            )
            .expect("create test table");
        let inserted = sqlite
            .execute(
                "insert into sessions (session_key, value) values (?, ?)",
                params!["session-1", "before"],
            )
            .expect("insert test row");
        assert_eq!(inserted.rows_affected, 1);

        let rows = sqlite
            .query(
                "select session_key, value from sessions where session_key = ?",
                params!["session-1"],
            )
            .expect("query test row");
        assert_eq!(
            rows,
            vec![json!({ "session_key": "session-1", "value": "before" })
                .as_object()
                .expect("object row")
                .clone()]
        );

        let snapshot = sqlite
            .take_session("session-1")
            .expect("take session row")
            .expect("session row exists");
        assert_eq!(
            sqlite
                .query("select * from sessions", [])
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
                .query("select * from sessions", [])
                .expect("query restored table"),
            vec![json!({ "session_key": "session-1", "value": "before" })
                .as_object()
                .expect("object row")
                .clone()]
        );

        let deleted = sqlite
            .execute(
                "delete from sessions where session_key = ?",
                params!["session-1"],
            )
            .expect("delete test row");
        assert_eq!(deleted.rows_affected, 1);
        assert_eq!(
            sqlite
                .query("select * from sessions", [])
                .expect("query empty table"),
            Vec::new()
        );
    }

    #[test]
    fn flow_id_from_url_requires_flow_id_query_parameter() {
        assert_eq!(
            flow_id_from_url(
                "http://127.0.0.1:3000/_trellis/portal/admin/bootstrap?flowId=flow_123"
            )
            .unwrap(),
            "flow_123"
        );
        assert!(flow_id_from_url("http://127.0.0.1:3000/_trellis/portal/admin/bootstrap").is_err());
    }

    #[test]
    fn first_admin_bootstrap_body_matches_public_http_shape() {
        assert_eq!(
            serde_json::to_value(first_admin_bootstrap_body("secret-password")).unwrap(),
            json!({ "username": "admin", "password": "secret-password" })
        );
    }

    #[test]
    fn deployment_create_request_includes_mutable_dev_mode() {
        assert_eq!(
            serde_json::to_value(auth_deployments_create_request_shape("test", true)).unwrap(),
            json!({
                "deploymentId": "test",
                "kind": "service",
                "namespaces": [],
                "contractCompatibilityMode": "mutable-dev"
            })
        );
        assert_eq!(
            serde_json::to_value(auth_deployments_create_request_shape("prod", false)).unwrap()
                ["contractCompatibilityMode"],
            json!("strict")
        );
    }

    #[test]
    fn admin_contract_requests_required_auth_admin_rpcs() {
        let contract = admin_contract().expect("build admin contract");
        let uses = contract.manifest()["uses"]["required"]["auth"]["rpc"]["call"]
            .as_array()
            .expect("admin contract auth rpc call list");

        assert!(uses.contains(&json!("Auth.Deployments.Create")));
        assert!(uses.contains(&json!("Auth.DeviceUserAuthorities.Reviews.Decide")));
        assert!(uses.contains(&json!("Auth.DeviceUserAuthorities.Reviews.List")));
        assert!(uses.contains(&json!("Auth.DeviceUserAuthorities.Revoke")));
        assert!(uses.contains(&json!("Auth.ServiceInstances.Provision")));
        assert_eq!(contract.manifest()["kind"], json!("agent"));
        assert!(!contract.digest().is_empty());
    }

    #[test]
    fn bound_flow_session_requires_native_transport() {
        let missing_native = bound_flow_session_from_parts(
            "2026-06-16T00:00:00Z".to_string(),
            trellis_rs::auth::SentinelCredsRecord {
                jwt: "sentinel.jwt".to_string(),
                seed: "sentinel.seed".to_string(),
            },
            trellis_rs::auth::ClientTransportsRecord {
                native: None,
                websocket: None,
            },
        );
        assert!(missing_native.is_err());

        let bound = bound_flow_session_from_parts(
            "2026-06-16T00:00:00Z".to_string(),
            trellis_rs::auth::SentinelCredsRecord {
                jwt: "sentinel.jwt".to_string(),
                seed: "sentinel.seed".to_string(),
            },
            trellis_rs::auth::ClientTransportsRecord {
                native: Some(trellis_rs::auth::ClientTransportRecord {
                    nats_servers: vec![
                        "nats://127.0.0.1:4222".to_string(),
                        "nats://127.0.0.1:4223".to_string(),
                    ],
                }),
                websocket: None,
            },
        )
        .expect("native transport should connect");

        assert_eq!(
            bound.nats_servers,
            "nats://127.0.0.1:4222,nats://127.0.0.1:4223"
        );
        assert_eq!(bound.sentinel_jwt, "sentinel.jwt");
        assert_eq!(bound.sentinel_seed, "sentinel.seed");
    }

    #[test]
    fn auth_start_signature_payload_uses_canonical_contract_json() {
        let contract = json!({ "id": "test@v1", "z": 1, "a": [2, 1] });

        assert_eq!(
            auth_start_signature_payload("http://127.0.0.1/return", &contract, None).unwrap(),
            "http://127.0.0.1/return::{\"a\":[2,1],\"id\":\"test@v1\",\"z\":1}:null"
        );
    }

    #[test]
    fn authority_plan_summary_parses_supported_classifications() {
        let plan = AuthorityPlanSummary::from_value(&json!({
            "planId": "plan_123",
            "classification": "migration"
        }))
        .unwrap();

        assert_eq!(plan.plan_id, "plan_123");
        assert_eq!(plan.classification, AuthorityPlanClassification::Migration);
    }

    #[test]
    fn materialized_authority_status_helpers_match_ready_and_failed_shapes() {
        let current = json!({
            "status": "current",
            "desiredVersion": "v1",
            "reconciledAt": "2026-06-16T00:00:00Z"
        });
        let failed = json!({ "status": "failed", "error": "resource failure" });

        assert!(materialized_authority_is_current(&current, "v1").unwrap());
        assert!(!materialized_authority_is_current(&Value::Null, "v1").unwrap());
        assert_eq!(
            materialized_authority_failure(&failed).unwrap(),
            "resource failure"
        );
    }

    #[test]
    fn repo_command_targets_trellis_service_entrypoint() {
        let command = repo_trellis_command();

        assert_eq!(
            command.display_command(),
            "deno run --env --allow-env --allow-sys --allow-read --allow-write --allow-net --allow-ffi main.ts"
        );
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
}
