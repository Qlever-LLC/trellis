use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::cli::*;
use crate::contract_input::{default_image_contract_path, resolve_contract_input};
use crate::self_update::{ReleaseChannel, SelfUpdateTarget};
use crate::{contract_input, core_client};
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
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tracing_subscriber::EnvFilter;
use trellis_auth as authlib;
use trellis_client::{SessionAuth, TrellisClient};
use trellis_contracts::{CatalogPack, ContractManifest};

mod auth;
mod bootstrap;
mod contracts;
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
        name: "trellis_portal_device_selections",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_browser_flows",
        ttl_ms: 5 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_device_profiles",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_device_instances",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_device_activation_handoffs",
        ttl_ms: 30 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_device_provisioning_secrets",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_device_activations",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_device_activation_reviews",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_connections",
        ttl_ms: 2 * 60 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_services",
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
    let global_nats_servers = cli.nats_servers.clone();
    let global_creds = cli.creds.clone();

    match cli.command {
        TopLevelCommand::Completion { shell } => {
            let mut command = Cli::command();
            generate(shell, &mut command, "trellis", &mut io::stdout());
        }
        TopLevelCommand::Auth(command) => {
            auth::run(format, global_nats_servers.clone(), command).await?
        }
        TopLevelCommand::Bootstrap(command) => {
            bootstrap::run(global_nats_servers.clone(), global_creds.clone(), command).await?
        }
        TopLevelCommand::Keygen(args) => runtime::keygen_command(format, &args)?,
        TopLevelCommand::Portals(command) => portals::run(format, command).await?,
        TopLevelCommand::Service(command) => {
            service::run(
                format,
                global_nats_servers.clone(),
                global_creds.clone(),
                command,
            )
            .await?
        }
        TopLevelCommand::Devices(command) => devices::run(format, command).await?,
        TopLevelCommand::Contracts(command) => contracts::run(format, command).await?,
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

pub(crate) fn default_display_name(manifest_path: &Path) -> String {
    manifest_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("service")
        .split('@')
        .next()
        .unwrap_or("service")
        .replace('.', "-")
}

pub(crate) fn infer_namespaces(manifest: &ContractManifest) -> Vec<String> {
    let mut namespaces = BTreeSet::new();
    let namespace_from_subject = |subject: &str| {
        let mut parts = subject.split('.');
        let kind = parts.next()?;
        let version = parts.next()?;
        let namespace = parts.next()?;
        if (kind == "rpc" || kind == "events") && version.starts_with('v') {
            Some(namespace.to_string())
        } else {
            None
        }
    };

    for method in manifest.rpc.values() {
        if let Some(namespace) = namespace_from_subject(&method.subject) {
            namespaces.insert(namespace);
        }
    }
    for event in manifest.events.values() {
        if let Some(namespace) = namespace_from_subject(&event.subject) {
            namespaces.insert(namespace);
        }
    }

    namespaces.into_iter().collect()
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

pub(crate) fn resolve_upgrade_service_key(
    args: &ServiceUpgradeArgs,
    services: &[authlib::ServiceListEntry],
    contract_id: &str,
) -> miette::Result<String> {
    miette::ensure!(
        !(args.seed.is_some() && args.service_key.is_some()),
        "pass only one of --seed or --service-key"
    );
    if let Some(seed) = &args.seed {
        let auth = SessionAuth::from_seed_base64url(seed).into_diagnostic()?;
        return Ok(auth.session_key);
    }
    if let Some(service_key) = &args.service_key {
        return Ok(service_key.clone());
    }

    let matches: Vec<&authlib::ServiceListEntry> = services
        .iter()
        .filter(|service| service.contract_id.as_deref() == Some(contract_id))
        .collect();

    match matches.as_slice() {
        [service] => Ok(service.session_key.clone()),
        [] => Err(miette::miette!(
            "no installed service found for contract '{contract_id}'; pass --service-key or --seed"
        )),
        _ => Err(miette::miette!(
            "multiple installed services use contract '{contract_id}'; pass --service-key or --seed"
        )),
    }
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

pub(crate) async fn resolve_device_profile_contract(
    connected: &TrellisClient,
    contract: &str,
) -> miette::Result<(String, Vec<String>, Option<BTreeMap<String, Value>>)> {
    if let Some(resolved) = resolve_device_contract_source(contract)? {
        let contract = resolved
            .loaded
            .value
            .as_object()
            .cloned()
            .map(|contract| contract.into_iter().collect());
        return Ok((
            resolved.loaded.manifest.id,
            vec![resolved.loaded.digest],
            contract,
        ));
    }

    let core_client = core_client::CoreClient::new(connected);
    let catalog = core_client.catalog().await.into_diagnostic()?.catalog;
    let digests = catalog
        .contracts
        .into_iter()
        .filter(|entry| entry.id == contract)
        .map(|entry| entry.digest)
        .collect::<Vec<_>>();

    miette::ensure!(
        !digests.is_empty(),
        "no active contract found for id '{contract}'"
    );

    Ok((contract.to_string(), digests, None))
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

pub(crate) fn pack_json(pack: &CatalogPack, output: &Path, contracts_out: Option<&Path>) -> Value {
    json!({
        "catalogPath": output,
        "contractsOut": contracts_out,
        "contracts": pack.catalog.contracts,
    })
}
