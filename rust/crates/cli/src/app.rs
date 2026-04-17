use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::cli::*;
use crate::cli_contract::cli_contract_json;
use crate::contract_input::{default_image_contract_path, resolve_contract_input};
use crate::output;
use crate::self_update::{ReleaseChannel, SelfUpdateTarget};
use crate::{contract_input, core_client};
use async_nats::ConnectOptions;
use async_nats::jetstream;
use async_nats::jetstream::kv;
use async_nats::jetstream::stream;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use clap::{CommandFactory, Parser};
use clap_complete::generate;
use ed25519_dalek::SigningKey;
use miette::IntoDiagnostic;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tracing_subscriber::EnvFilter;
use trellis_auth as authlib;
use trellis_client::{TrellisClient, TrellisClientError};

mod auth;
mod bootstrap;
mod devices;
mod portals;
mod runtime;
mod self_cmd;
mod service;

const SELF_UPDATE_TARGET: SelfUpdateTarget = SelfUpdateTarget::new(
    "qlever-llc",
    "trellis",
    "trellis",
    env!("CARGO_PKG_VERSION"),
);

const DEFAULT_TRELLIS_CONFIG_PATH: &str = "/etc/trellis/config.jsonc";
const DEFAULT_AUTH_REAUTH_LISTEN: &str = "127.0.0.1:0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct KvBucketSpec {
    pub(crate) name: &'static str,
    pub(crate) ttl_ms: u64,
}

pub(crate) const AUTH_BOOTSTRAP_BUCKETS: &[KvBucketSpec] = &[
    KvBucketSpec {
        name: "trellis_sessions",
        ttl_ms: 24 * 60 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_oauth_states",
        ttl_ms: 5 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_pending_auth",
        ttl_ms: 5 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_contract_approvals",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_binding_tokens",
        ttl_ms: 24 * 60 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_portals",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_portal_defaults",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_portal_login_selections",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_instance_grant_policies",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_portal_device_selections",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_browser_flows",
        ttl_ms: 5 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_device_profiles_v2",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_device_instances_v2",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_device_provisioning_secrets_v2",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_device_activations_v2",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_device_activation_reviews_v2",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_connections",
        ttl_ms: 2 * 60 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_service_profiles",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_service_instances",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_contracts",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_users",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_state",
        ttl_ms: 0,
    },
];

#[derive(Debug, serde::Deserialize)]
pub(crate) struct BootstrapConfigFile {
    #[serde(rename = "ttlMs")]
    pub(crate) ttl_ms: Option<BootstrapTtlConfig>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct BootstrapTtlConfig {
    #[serde(rename = "bindingTokens")]
    pub(crate) binding_tokens: Option<BootstrapBindingTokenConfig>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct BootstrapBindingTokenConfig {
    pub(crate) bucket: Option<u64>,
}

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
        TopLevelCommand::Completion { shell } => {
            let mut command = Cli::command();
            generate(shell, &mut command, "trellis", &mut io::stdout());
        }
        TopLevelCommand::Auth(command) => auth::run(format, command).await?,
        TopLevelCommand::Bootstrap(command) => bootstrap::run(command).await?,
        TopLevelCommand::Keygen(args) => runtime::keygen_command(format, &args)?,
        TopLevelCommand::Portal(command) => portals::run(format, command).await?,
        TopLevelCommand::Service(command) => service::run(format, command).await?,
        TopLevelCommand::Device(command) => devices::run(format, command).await?,
        TopLevelCommand::Self_(command) => self_cmd::run(format, command)?,
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

pub(crate) fn trellis_id_from_origin_id(origin: &str, id: &str) -> String {
    let digest = Sha256::digest(format!("{origin}:{id}").as_bytes());
    base64url_encode(&digest)[..22].to_string()
}

pub(crate) fn contract_digest(contract_json: &str) -> String {
    base64url_encode(&Sha256::digest(contract_json.as_bytes()))
}

pub(crate) async fn connect_authenticated_cli_client(
    format: OutputFormat,
) -> miette::Result<(authlib::AdminSessionState, TrellisClient)> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let cli_contract_json = cli_contract_json();
    let cli_contract_digest = contract_digest(cli_contract_json);
    let connected = match authlib::connect_admin_client_async(&state).await {
        Ok(connected) => connected,
        Err(error) if should_start_admin_reauth(&error) => {
            if !output::is_json(format) {
                output::print_info(
                    "Saved admin session was rejected; starting browser reauthentication",
                );
            }
            state = complete_admin_reauth(format, &state, cli_contract_json).await?;
            authlib::connect_admin_client_async(&state)
                .await
                .into_diagnostic()?
        }
        Err(error) => return Err(miette::miette!(error.to_string())),
    };
    let auth_client = authlib::AuthClient::new(&connected);

    match auth_client
        .renew_binding_token(&mut state, &cli_contract_digest)
        .await
        .into_diagnostic()?
    {
        authlib::RenewBindingTokenResponse::Bound { .. } => {}
        authlib::RenewBindingTokenResponse::ContractChanged => {
            state = complete_admin_reauth(format, &state, cli_contract_json).await?;
        }
    }

    let refreshed = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    Ok((state, refreshed))
}

fn should_start_admin_reauth(error: &authlib::TrellisAuthError) -> bool {
    match error {
        authlib::TrellisAuthError::TrellisClient(TrellisClientError::NatsConnect(message)) => {
            message.contains("authorization violation")
        }
        authlib::TrellisAuthError::TrellisClient(TrellisClientError::NatsRequest(message)) => {
            message.contains("authorization violation")
        }
        _ => false,
    }
}

async fn complete_admin_reauth(
    format: OutputFormat,
    state: &authlib::AdminSessionState,
    cli_contract_json: &str,
) -> miette::Result<authlib::AdminSessionState> {
    let next_state =
        match authlib::start_admin_reauth(state, DEFAULT_AUTH_REAUTH_LISTEN, cli_contract_json)
            .await
            .into_diagnostic()?
        {
            authlib::AdminReauthOutcome::Bound(outcome) => outcome.state,
            authlib::AdminReauthOutcome::Flow(challenge) => {
                let login_url = challenge.login_url().to_string();
                if !output::is_json(format) {
                    output::print_info(&format!("Open this URL to continue auth: {login_url}"));
                }
                try_open_browser(&login_url);
                challenge
                    .complete(&state.auth_url)
                    .await
                    .into_diagnostic()?
                    .state
            }
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
) -> miette::Result<bool> {
    let client = connect_with_creds(servers, creds).await?;
    let js = jetstream::new(client);
    if js.get_stream(name).await.is_ok() {
        return Ok(false);
    }
    js.create_stream(stream::Config {
        name: name.to_string(),
        subjects,
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
        ..Default::default()
    })
    .await
    .into_diagnostic()?;
    Ok(BucketEnsureStatus::Created)
}

pub(crate) fn resolve_auth_config_path() -> PathBuf {
    env::var("TRELLIS_CONFIG")
        .or_else(|_| env::var("TRELLIS_AUTH_CONFIG"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(DEFAULT_TRELLIS_CONFIG_PATH))
}

pub(crate) fn load_binding_token_bucket_ttl_ms(path: &Path) -> miette::Result<Option<u64>> {
    if !path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(path).into_diagnostic()?;
    let parsed: BootstrapConfigFile = json5::from_str(&text).into_diagnostic()?;
    Ok(parsed
        .ttl_ms
        .and_then(|ttl| ttl.binding_tokens)
        .and_then(|binding_tokens| binding_tokens.bucket))
}

pub(crate) fn generate_session_keypair() -> (String, String) {
    let seed: [u8; 32] = rand::random();
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key().to_bytes();
    (base64url_encode(&seed), base64url_encode(&public_key))
}

pub(crate) fn contract_review_rows(loaded: &trellis_contracts::LoadedManifest) -> Vec<Vec<String>> {
    let kv_resources = loaded
        .value
        .get("resources")
        .and_then(Value::as_object)
        .and_then(|resources| resources.get("kv"))
        .and_then(Value::as_object)
        .map(|kv| kv.len())
        .unwrap_or(0);

    vec![
        vec!["contract".to_string(), loaded.manifest.id.clone()],
        vec![
            "display name".to_string(),
            loaded.manifest.display_name.clone(),
        ],
        vec![
            "description".to_string(),
            loaded.manifest.description.clone(),
        ],
        vec!["digest".to_string(), loaded.digest.clone()],
        vec![
            "rpc methods".to_string(),
            loaded.manifest.rpc.len().to_string(),
        ],
        vec![
            "events".to_string(),
            loaded.manifest.events.len().to_string(),
        ],
        vec![
            "subjects".to_string(),
            loaded.manifest.subjects.len().to_string(),
        ],
        vec!["kv resources".to_string(), kv_resources.to_string()],
    ]
}

pub(crate) fn prompt_for_confirmation(prompt: &str) -> miette::Result<bool> {
    print!("{prompt} [y/N]: ");
    io::Write::flush(&mut io::stdout()).into_diagnostic()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line).into_diagnostic()?;
    let trimmed = line.trim().to_ascii_lowercase();
    Ok(trimmed == "y" || trimmed == "yes")
}

pub(crate) fn try_open_browser(url: &str) {
    let _ = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    };
}

pub(crate) fn json_value_label(value: &Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| value.to_string())
}

pub(crate) fn portal_target_id(target: &PortalTargetArgs) -> Option<&str> {
    if target.builtin {
        None
    } else {
        target.portal_id.as_deref()
    }
}

pub(crate) fn portal_target_label(portal_id: Option<&str>) -> String {
    portal_id.unwrap_or("builtin").to_string()
}

pub(crate) fn resolve_device_contract_source(
    value: &str,
) -> miette::Result<Option<contract_input::ResolvedContractInput>> {
    let path = Path::new(value);
    if !path.exists() {
        return Ok(None);
    }

    let resolved = if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
    {
        resolve_contract_input(
            Some(path),
            None,
            None,
            "CONTRACT",
            default_image_contract_path(),
        )?
    } else {
        resolve_contract_input(
            None,
            Some(path),
            None,
            "CONTRACT",
            default_image_contract_path(),
        )?
    };

    Ok(Some(resolved))
}

pub(crate) async fn resolve_contract_lineage_id(
    connected: &TrellisClient,
    contract: &str,
) -> miette::Result<String> {
    if let Some(resolved) = resolve_device_contract_source(contract)? {
        return Ok(resolved.loaded.manifest.id);
    }

    let core_client = core_client::CoreClient::new(connected);
    let catalog = core_client.catalog().await.into_diagnostic()?.catalog;
    let exists = catalog
        .contracts
        .into_iter()
        .any(|entry| entry.id == contract);

    miette::ensure!(exists, "no active contract found for id '{contract}'");
    Ok(contract.to_string())
}

pub(crate) fn release_channel(prerelease: bool) -> ReleaseChannel {
    ReleaseChannel::from_prerelease_flag(prerelease)
}

pub(crate) fn resolve_servers(global: Option<String>, local: Option<String>) -> String {
    local
        .or(global)
        .or_else(|| env::var("TRELLIS_NATS_SERVERS").ok())
        .or_else(|| env::var("NATS_SERVERS").ok())
        .unwrap_or_else(|| "localhost".to_string())
}
