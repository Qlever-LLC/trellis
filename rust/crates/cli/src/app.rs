use std::env;
use std::io;
use std::path::Path;
use std::time::Duration;

use crate::agent_contract::agent_contract_json;
use crate::cli::*;
use crate::output;
use crate::self_update::{ReleaseChannel, SelfUpdateTarget};
use async_nats::jetstream;
use async_nats::jetstream::kv;
use async_nats::jetstream::stream;
use async_nats::ConnectOptions;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use clap::{CommandFactory, Parser};
use clap_complete::generate;
use ed25519_dalek::SigningKey;
use miette::IntoDiagnostic;
use qrcode::{render::unicode, QrCode};
use serde_json::Value;
use tracing_subscriber::EnvFilter;
use trellis::auth as authlib;
use trellis::client::{TrellisClient, TrellisClientError};

mod auth;
mod bootstrap;
mod deploy;
mod runtime;
mod self_cmd;

const SELF_UPDATE_TARGET: SelfUpdateTarget = SelfUpdateTarget::new(
    "qlever-llc",
    "trellis",
    "trellis",
    env!("CARGO_PKG_VERSION"),
);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct KvBucketSpec {
    pub(crate) name: &'static str,
    pub(crate) ttl_ms: u64,
}

pub(crate) const AUTH_BOOTSTRAP_BUCKETS: &[KvBucketSpec] = &[
    KvBucketSpec {
        name: "trellis_oauth_states",
        ttl_ms: 5 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_pending_auth",
        ttl_ms: 5 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_browser_flows",
        ttl_ms: 30 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_connections",
        ttl_ms: 2 * 60 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_state",
        ttl_ms: 0,
    },
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BucketEnsureStatus {
    Created,
    Updated,
    Exists,
}

pub async fn run() -> miette::Result<()> {
    let cli = Cli::parse();
    init_tracing(cli.verbose)?;
    let format = cli.format;

    match cli.command {
        TopLevelCommand::Login(args) => auth::login(format, &args).await?,
        TopLevelCommand::Logout => auth::logout(format).await?,
        TopLevelCommand::Whoami => auth::whoami(format).await?,
        TopLevelCommand::Approvals(command) => auth::approvals(format, command).await?,
        TopLevelCommand::Users(command) => auth::users(format, command).await?,
        TopLevelCommand::Portals(command) => auth::portals(format, command).await?,
        TopLevelCommand::Grants(command) => deploy::run_grants(format, command).await?,
        TopLevelCommand::Svc(command) => deploy::run_svc(format, command).await?,
        TopLevelCommand::Dev(command) => deploy::run_dev(format, command).await?,
        TopLevelCommand::Local(command) => bootstrap::local(format, command)?,
        TopLevelCommand::Infra(command) => bootstrap::infra(format, command).await?,
        TopLevelCommand::Init(command) => bootstrap::init(format, command).await?,
        TopLevelCommand::Keys(command) => match command.command {
            KeysSubcommand::New(args) => runtime::keygen_command(format, &args)?,
        },
        TopLevelCommand::Upgrade(command) => self_cmd::run_upgrade(format, command)?,
        TopLevelCommand::Completion { shell } => {
            let mut command = Cli::command();
            generate(shell, &mut command, "trellis", &mut io::stdout());
        }
        TopLevelCommand::Version => runtime::version_command(format)?,
    }

    Ok(())
}

fn init_tracing(verbose: u8) -> miette::Result<()> {
    let filter = match verbose {
        0 => EnvFilter::new("warn"),
        1 => EnvFilter::new("info"),
        _ => EnvFilter::new("debug"),
    };

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(io::stderr)
        .try_init()
        .map_err(|error| miette::miette!(error.to_string()))?;
    Ok(())
}

pub(crate) fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) async fn connect_authenticated_cli_client(
    format: OutputFormat,
) -> miette::Result<(authlib::AdminSessionState, TrellisClient)> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let agent_contract_json = agent_contract_json();
    let agent_contract_digest = authlib::contract_digest(agent_contract_json).into_diagnostic()?;
    if state.contract_digest != agent_contract_digest {
        if !output::is_json(format) {
            output::print_info(
                "Saved agent session contract changed; starting agent reauthentication",
            );
        }
        state = complete_admin_reauth(format, &state, agent_contract_json).await?;
    }

    let connected = match authlib::connect_admin_client_async(&state).await {
        Ok(connected) => connected,
        Err(error) => return Err(map_admin_session_error(error)),
    };

    match authlib::AuthClient::new(&connected).me().await {
        Ok(_) => {}
        Err(error) => return Err(map_admin_session_error(error)),
    }

    Ok((state, connected))
}

fn map_admin_session_error(error: authlib::TrellisAuthError) -> miette::Report {
    match rejected_admin_session_error_report(&error) {
        Ok(Some(report)) => report,
        Ok(None) if is_admin_session_authorization_violation_error(&error) => {
            generic_admin_authorization_violation_report()
        }
        Ok(None) => miette::miette!(error.to_string()),
        Err(report) => report,
    }
}

fn map_admin_session_result<T>(result: Result<T, authlib::TrellisAuthError>) -> miette::Result<T> {
    result.map_err(map_admin_session_error)
}

fn rejected_admin_session_error_report(
    error: &authlib::TrellisAuthError,
) -> miette::Result<Option<miette::Report>> {
    if is_rejected_admin_session_error(error) {
        Ok(Some(rejected_admin_session_report()?))
    } else {
        Ok(None)
    }
}

fn is_rejected_admin_session_error(error: &authlib::TrellisAuthError) -> bool {
    match error {
        authlib::TrellisAuthError::TrellisClient(
            TrellisClientError::NatsConnect(message) | TrellisClientError::NatsRequest(message),
        )
        | authlib::TrellisAuthError::AuthRequestHttpFailure(_, message)
        | authlib::TrellisAuthError::BindHttpFailure(_, message) => {
            is_rejected_admin_session_message(message)
        }
        authlib::TrellisAuthError::TrellisClient(TrellisClientError::RpcError(payload)) => {
            is_rejected_admin_session_message(payload.raw())
        }
        _ => false,
    }
}

fn is_rejected_admin_session_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("revoked")
        || message.contains("rejected")
        || message.contains("session_not_found")
}

fn is_admin_session_authorization_violation_error(error: &authlib::TrellisAuthError) -> bool {
    match error {
        authlib::TrellisAuthError::TrellisClient(
            TrellisClientError::NatsConnect(message) | TrellisClientError::NatsRequest(message),
        ) => message
            .to_ascii_lowercase()
            .contains("authorization violation"),
        authlib::TrellisAuthError::TrellisClient(TrellisClientError::RpcError(payload)) => payload
            .raw()
            .to_ascii_lowercase()
            .contains("authorization violation"),
        _ => false,
    }
}

fn generic_admin_authorization_violation_report() -> miette::Report {
    miette::miette!(
        "Saved agent session authorization was denied by the server; run `trellis auth login` to reauthenticate."
    )
}

fn rejected_admin_session_report() -> miette::Result<miette::Report> {
    let cleared = authlib::clear_admin_session().into_diagnostic()?;
    let message = if cleared {
        "Saved agent session was rejected by the server and the stored local session was cleared; run `trellis auth login` explicitly."
    } else {
        "Saved agent session was rejected by the server; run `trellis auth login` explicitly."
    };
    Ok(miette::miette!(message))
}

#[cfg(test)]
mod tests {
    use super::{
        is_rejected_admin_session_error, map_admin_session_error, map_admin_session_result,
        rejected_admin_session_error_report, rejected_admin_session_report,
    };
    use std::env;
    use std::fs;
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};
    use trellis::auth::{save_admin_session, AdminSessionState, TrellisAuthError};
    use trellis::client::{RpcErrorPayload, TrellisClientError};

    fn config_env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn unique_test_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        env::temp_dir().join(format!("trellis-cli-{label}-{nanos}"))
    }

    fn admin_session_path(root: &Path) -> std::path::PathBuf {
        root.join("trellis").join("admin-session.json")
    }

    fn test_admin_session_state() -> AdminSessionState {
        AdminSessionState {
            trellis_url: "http://localhost:3000".to_string(),
            nats_servers: "localhost".to_string(),
            session_seed: "seed".to_string(),
            session_key: "key".to_string(),
            contract_digest: "digest".to_string(),
            sentinel_jwt: "jwt".to_string(),
            sentinel_seed: "sentinel".to_string(),
            expires: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn does_not_treat_generic_connect_authorization_violation_as_rejected_session() {
        let error = TrellisAuthError::TrellisClient(TrellisClientError::NatsConnect(
            "authorization violation".to_string(),
        ));

        assert!(!is_rejected_admin_session_error(&error));
    }

    #[test]
    fn does_not_treat_generic_request_authorization_violation_as_rejected_session() {
        let error = TrellisAuthError::TrellisClient(TrellisClientError::NatsRequest(
            "authorization violation".to_string(),
        ));

        assert!(!is_rejected_admin_session_error(&error));
    }

    #[test]
    fn does_not_treat_generic_rpc_authorization_violation_as_rejected_session() {
        let error = TrellisAuthError::TrellisClient(TrellisClientError::RpcError(
            RpcErrorPayload::from_message("authorization violation"),
        ));

        assert!(!is_rejected_admin_session_error(&error));
    }

    #[test]
    fn does_not_treat_mixed_case_authorization_violation_as_rejected_session() {
        let error = TrellisAuthError::TrellisClient(TrellisClientError::NatsRequest(
            "Authorization Violation".to_string(),
        ));

        assert!(!is_rejected_admin_session_error(&error));
    }

    #[test]
    fn treats_revoked_session_message_as_rejected_session() {
        let error = TrellisAuthError::TrellisClient(TrellisClientError::NatsConnect(
            "Session revoked by server".to_string(),
        ));

        assert!(is_rejected_admin_session_error(&error));
    }

    #[test]
    fn treats_session_not_found_message_as_rejected_session() {
        let error = TrellisAuthError::TrellisClient(TrellisClientError::RpcError(
            RpcErrorPayload::from_message("session_not_found"),
        ));

        assert!(is_rejected_admin_session_error(&error));
    }

    #[test]
    fn treats_auth_request_http_rejection_as_rejected_session() {
        let error =
            TrellisAuthError::AuthRequestHttpFailure(401, "session rejected by server".to_string());

        assert!(is_rejected_admin_session_error(&error));
    }

    #[test]
    fn treats_bind_http_revocation_as_rejected_session() {
        let error = TrellisAuthError::BindHttpFailure(403, "session revoked".to_string());

        assert!(is_rejected_admin_session_error(&error));
    }

    #[test]
    fn rejected_session_report_clears_local_session_and_requires_explicit_login() {
        let _guard = config_env_lock().lock().expect("lock config env");
        let test_dir = unique_test_dir("rejected-session-report");
        fs::create_dir_all(test_dir.join("trellis")).expect("create test config dir");
        unsafe {
            env::set_var("XDG_CONFIG_HOME", &test_dir);
        }

        save_admin_session(&test_admin_session_state()).expect("save admin session");
        assert!(admin_session_path(&test_dir).exists());

        let report = rejected_admin_session_report().expect("build rejected-session report");
        assert!(!admin_session_path(&test_dir).exists());
        assert!(report
            .to_string()
            .contains("run `trellis auth login` explicitly"));

        unsafe {
            env::remove_var("XDG_CONFIG_HOME");
        }
        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn generic_rejected_session_request_authorization_violation_does_not_clear_local_session() {
        let _guard = config_env_lock().lock().expect("lock config env");
        let test_dir = unique_test_dir("generic-rejected-session-request-error");
        fs::create_dir_all(test_dir.join("trellis")).expect("create test config dir");
        unsafe {
            env::set_var("XDG_CONFIG_HOME", &test_dir);
        }

        save_admin_session(&test_admin_session_state()).expect("save admin session");
        assert!(admin_session_path(&test_dir).exists());

        let error = TrellisAuthError::TrellisClient(TrellisClientError::NatsRequest(
            "authorization violation".to_string(),
        ));
        assert!(rejected_admin_session_error_report(&error)
            .expect("map generic authorization request error")
            .is_none());
        let report = map_admin_session_error(error);

        assert!(admin_session_path(&test_dir).exists());
        assert!(report.to_string().contains("run `trellis auth login`"));
        assert!(report.to_string().contains("reauthenticate"));

        unsafe {
            env::remove_var("XDG_CONFIG_HOME");
        }
        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn mapped_rejected_session_result_clears_local_session_and_requires_explicit_login() {
        let _guard = config_env_lock().lock().expect("lock config env");
        let test_dir = unique_test_dir("mapped-rejected-session-result");
        fs::create_dir_all(test_dir.join("trellis")).expect("create test config dir");
        unsafe {
            env::set_var("XDG_CONFIG_HOME", &test_dir);
        }

        save_admin_session(&test_admin_session_state()).expect("save admin session");
        assert!(admin_session_path(&test_dir).exists());

        let error = TrellisAuthError::TrellisClient(TrellisClientError::NatsRequest(
            "Authorization Violation: session revoked".to_string(),
        ));
        let report = map_admin_session_result::<()>(Err(error))
            .expect_err("rejected-session result should map to report");

        assert!(!admin_session_path(&test_dir).exists());
        assert!(report
            .to_string()
            .contains("run `trellis auth login` explicitly"));

        unsafe {
            env::remove_var("XDG_CONFIG_HOME");
        }
        let _ = fs::remove_dir_all(test_dir);
    }

    fn assert_rejected_session_error_clears_local_session(label: &str, error: TrellisAuthError) {
        let _guard = config_env_lock().lock().expect("lock config env");
        let test_dir = unique_test_dir(label);
        fs::create_dir_all(test_dir.join("trellis")).expect("create test config dir");
        unsafe {
            env::set_var("XDG_CONFIG_HOME", &test_dir);
        }

        save_admin_session(&test_admin_session_state()).expect("save admin session");
        assert!(admin_session_path(&test_dir).exists());

        let report = map_admin_session_result::<()>(Err(error))
            .expect_err("explicit rejected-session signal should map to report");

        assert!(!admin_session_path(&test_dir).exists());
        assert!(report
            .to_string()
            .contains("run `trellis auth login` explicitly"));

        unsafe {
            env::remove_var("XDG_CONFIG_HOME");
        }
        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn explicit_session_not_found_rejected_session_clears_local_session() {
        assert_rejected_session_error_clears_local_session(
            "session-not-found-rejected-session",
            TrellisAuthError::TrellisClient(TrellisClientError::RpcError(
                RpcErrorPayload::from_message("session_not_found"),
            )),
        );
    }

    #[test]
    fn explicit_revoked_rejected_session_clears_local_session() {
        assert_rejected_session_error_clears_local_session(
            "revoked-rejected-session",
            TrellisAuthError::TrellisClient(TrellisClientError::NatsRequest(
                "session revoked".to_string(),
            )),
        );
    }

    #[test]
    fn explicit_rejected_session_clears_local_session() {
        assert_rejected_session_error_clears_local_session(
            "rejected-rejected-session",
            TrellisAuthError::AuthRequestHttpFailure(401, "session rejected".to_string()),
        );
    }
}

async fn complete_admin_reauth(
    format: OutputFormat,
    state: &authlib::AdminSessionState,
    agent_contract_json: &str,
) -> miette::Result<authlib::AdminSessionState> {
    let next_state = match authlib::start_admin_reauth(state, agent_contract_json).await {
        Ok(authlib::AdminReauthOutcome::Bound(outcome)) => outcome.state,
        Ok(authlib::AdminReauthOutcome::Flow(challenge)) => {
            let login_url = challenge.login_url().to_string();
            if output::is_json(format) {
                output::print_json_progress(&pending_agent_login_json(&login_url))?;
            } else {
                output::print_info(&render_agent_login_instructions(&login_url)?);
            }
            map_admin_session_result(challenge.complete(&state.trellis_url).await)?.state
        }
        Err(error) => return Err(map_admin_session_error(error)),
    };

    authlib::save_admin_session(&next_state).into_diagnostic()?;
    Ok(next_state)
}

pub(crate) async fn connect_with_creds(
    servers: &str,
    creds: &Path,
) -> miette::Result<async_nats::Client> {
    ConnectOptions::new()
        .credentials_file(creds)
        .await
        .into_diagnostic()?
        .connect(servers)
        .await
        .into_diagnostic()
}

pub(crate) async fn ensure_stream(
    servers: &str,
    creds: &Path,
    name: &str,
    subjects: Vec<String>,
    num_replicas: usize,
) -> miette::Result<bool> {
    let client = connect_with_creds(servers, creds).await?;
    let js = jetstream::new(client);
    if js.get_stream(name).await.is_ok() {
        return Ok(false);
    }
    js.create_stream(stream::Config {
        name: name.to_string(),
        subjects,
        num_replicas,
        ..Default::default()
    })
    .await
    .into_diagnostic()?;
    Ok(true)
}

pub(crate) async fn ensure_bucket(
    servers: &str,
    creds: &Path,
    bucket: &str,
    history: i64,
    ttl_ms: u64,
    num_replicas: usize,
) -> miette::Result<BucketEnsureStatus> {
    let client = connect_with_creds(servers, creds).await?;
    let js = jetstream::new(client);
    if let Ok(store) = js.get_key_value(bucket).await {
        let status = store.status().await.into_diagnostic()?;
        let current_ttl_ms = status.max_age().as_millis() as u64;
        if status.history() == history && current_ttl_ms == ttl_ms {
            return Ok(BucketEnsureStatus::Exists);
        }

        js.update_key_value(kv::Config {
            bucket: bucket.to_string(),
            history,
            max_age: Duration::from_millis(ttl_ms),
            num_replicas,
            ..Default::default()
        })
        .await
        .into_diagnostic()?;
        return Ok(BucketEnsureStatus::Updated);
    }

    js.create_key_value(kv::Config {
        bucket: bucket.to_string(),
        history,
        max_age: Duration::from_millis(ttl_ms),
        num_replicas,
        ..Default::default()
    })
    .await
    .into_diagnostic()?;
    Ok(BucketEnsureStatus::Created)
}

pub(crate) fn generate_session_keypair() -> (String, String) {
    let seed: [u8; 32] = rand::random();
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key().to_bytes();
    (base64url_encode(&seed), base64url_encode(&public_key))
}

pub(crate) fn json_value_label(value: &Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| value.to_string())
}

fn render_agent_login_instructions(login_url: &str) -> miette::Result<String> {
    let qr = QrCode::new(login_url.as_bytes()).into_diagnostic()?;
    let qr = qr.render::<unicode::Dense1x2>().quiet_zone(false).build();
    Ok(format!(
        "Open this activation URL:\n{login_url}\n\nScan this QR code:\n{qr}"
    ))
}

fn pending_agent_login_json(login_url: &str) -> Value {
    serde_json::json!({
        "status": "pending",
        "loginUrl": login_url,
    })
}

pub(crate) fn release_channel(prerelease: bool) -> ReleaseChannel {
    ReleaseChannel::from_prerelease_flag(prerelease)
}
