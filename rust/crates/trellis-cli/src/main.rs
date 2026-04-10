mod cli;
mod cli_contract;
mod contract_input;
mod core_client;
mod output;

use std::env;
use std::fs;
use std::io;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use async_nats::jetstream;
use async_nats::jetstream::kv;
use async_nats::jetstream::stream;
use async_nats::ConnectOptions;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use bytes::Bytes;
use clap::{CommandFactory, Parser};
use clap_complete::generate;
use cli::*;
use cli_contract::cli_contract_json;
use contract_input::{
    default_image_contract_path, resolve_contract_input, resolve_contract_inputs,
};
use ed25519_dalek::SigningKey;
use miette::IntoDiagnostic;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tracing_subscriber::EnvFilter;
use trellis_auth as authlib;
use trellis_client::{ServiceConnectOptions, SessionAuth, TrellisClient};
use trellis_codegen_rust::{
    generate_rust_participant_facade, generate_rust_sdk, GenerateRustParticipantFacadeOpts,
    GenerateRustSdkOpts, ParticipantAliasMapping, RustRuntimeDeps,
    RustRuntimeSource as CodegenRustRuntimeSource,
};
use trellis_codegen_ts::{
    generate_ts_sdk, GenerateTsSdkOpts, TsRuntimeDeps, TsRuntimeSource as CodegenTsRuntimeSource,
};
use trellis_contracts::{pack_loaded_manifests, write_catalog_pack, CatalogPack, ContractManifest};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct KvBucketSpec {
    name: &'static str,
    ttl_ms: u64,
}

const AUTH_BOOTSTRAP_BUCKETS: &[KvBucketSpec] = &[
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
        name: "trellis_portal_workload_selections",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_browser_flows",
        ttl_ms: 5 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_workload_profiles",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_workload_instances",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_workload_activation_handoffs",
        ttl_ms: 30 * 60_000_u64,
    },
    KvBucketSpec {
        name: "trellis_workload_provisioning_secrets",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_workload_activations",
        ttl_ms: 0,
    },
    KvBucketSpec {
        name: "trellis_workload_activation_reviews",
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

const DEFAULT_TRELLIS_CONFIG_PATH: &str = "/etc/trellis/config.jsonc";

#[derive(Debug, serde::Deserialize)]
struct BootstrapConfigFile {
    #[serde(rename = "ttlMs")]
    ttl_ms: Option<BootstrapTtlConfig>,
}

#[derive(Debug, serde::Deserialize)]
struct BootstrapTtlConfig {
    #[serde(rename = "bindingTokens")]
    binding_tokens: Option<BootstrapBindingTokenConfig>,
}

#[derive(Debug, serde::Deserialize)]
struct BootstrapBindingTokenConfig {
    bucket: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BucketEnsureStatus {
    Created,
    Updated,
    Exists,
}

#[tokio::main]
async fn main() -> miette::Result<()> {
    let cli = Cli::parse();
    init_tracing(cli.verbose)?;
    let format = cli.format;
    let global_nats_servers = cli.nats_servers.clone();
    let global_creds = cli.creds.clone();

    match cli.command {
        TopLevelCommand::Completions { shell } => {
            let mut command = Cli::command();
            generate(shell, &mut command, "trellis", &mut io::stdout());
        }
        TopLevelCommand::Auth(command) => match command.command {
            AuthSubcommand::Login(args) => {
                auth_login_command(format, global_nats_servers.clone(), &args).await?
            }
            AuthSubcommand::Logout => auth_logout_command(format).await?,
            AuthSubcommand::Approvals(command) => match command.command {
                AuthApprovalsSubcommand::List(args) => {
                    auth_approvals_list_command(format, &args).await?
                }
                AuthApprovalsSubcommand::Revoke(args) => {
                    auth_approvals_revoke_command(format, &args).await?
                }
            },
            AuthSubcommand::Status => auth_status_command(format).await?,
        },
        TopLevelCommand::Portals(command) => match command.command {
            PortalsSubcommand::List => portals_list_command(format).await?,
            PortalsSubcommand::Create(args) => portals_create_command(format, &args).await?,
            PortalsSubcommand::Disable(args) => portals_disable_command(format, &args).await?,
            PortalsSubcommand::Logins(logins) => match logins.command {
                PortalsLoginsSubcommand::Default(defaults) => match defaults.command {
                    PortalsDefaultSubcommand::Show => portals_logins_default_show_command(format).await?,
                    PortalsDefaultSubcommand::Set(args) => {
                        portals_logins_default_set_command(format, &args).await?
                    }
                },
                PortalsLoginsSubcommand::List => portals_logins_list_command(format).await?,
                PortalsLoginsSubcommand::Set(args) => {
                    portals_logins_set_command(format, &args).await?
                }
                PortalsLoginsSubcommand::Clear(args) => {
                    portals_logins_clear_command(format, &args).await?
                }
            },
            PortalsSubcommand::Workloads(workloads) => match workloads.command {
                PortalsWorkloadsSubcommand::Default(defaults) => match defaults.command {
                    PortalsDefaultSubcommand::Show => portals_workloads_default_show_command(format).await?,
                    PortalsDefaultSubcommand::Set(args) => {
                        portals_workloads_default_set_command(format, &args).await?
                    }
                },
                PortalsWorkloadsSubcommand::List => portals_workloads_list_command(format).await?,
                PortalsWorkloadsSubcommand::Set(args) => {
                    portals_workloads_set_command(format, &args).await?
                }
                PortalsWorkloadsSubcommand::Clear(args) => {
                    portals_workloads_clear_command(format, &args).await?
                }
            },
        },
        TopLevelCommand::Keygen(args) => keygen_command(format, &args)?,
        TopLevelCommand::Bootstrap(command) => match command.command {
            BootstrapSubcommand::Nats(args) => nats_bootstrap_command(&args).await?,
            BootstrapSubcommand::Admin(args) => {
                bootstrap_admin_command(global_nats_servers.clone(), global_creds.clone(), &args)
                    .await?
            }
        },
        TopLevelCommand::Service(command) => match command.command {
            ServiceSubcommand::List => service_list_command(format).await?,
            ServiceSubcommand::Install(args) => {
                service_install_command(
                    format,
                    global_nats_servers.clone(),
                    global_creds.clone(),
                    &args,
                )
                .await?
            }
            ServiceSubcommand::Upgrade(args) => {
                service_upgrade_command(
                    format,
                    global_nats_servers.clone(),
                    global_creds.clone(),
                    &args,
                )
                .await?
            }
        },
        TopLevelCommand::Workloads(command) => match command.command {
            WorkloadsSubcommand::Provision(args) => {
                workloads_provision_command(format, &args).await?
            }
            WorkloadsSubcommand::Profiles(profiles) => match profiles.command {
                WorkloadsProfilesSubcommand::List(args) => {
                    workloads_profiles_list_command(format, &args).await?
                }
                WorkloadsProfilesSubcommand::Create(args) => {
                    workloads_profiles_create_command(format, &args).await?
                }
                WorkloadsProfilesSubcommand::Disable(args) => {
                    workloads_profiles_disable_command(format, &args).await?
                }
            },
            WorkloadsSubcommand::Instances(instances) => match instances.command {
                WorkloadsInstancesSubcommand::List(args) => {
                    workloads_instances_list_command(format, &args).await?
                }
                WorkloadsInstancesSubcommand::Disable(args) => {
                    workloads_instances_disable_command(format, &args).await?
                }
            },
            WorkloadsSubcommand::Activations(activations) => match activations.command {
                WorkloadsActivationsSubcommand::List(args) => {
                    workloads_activations_list_command(format, &args).await?
                }
                WorkloadsActivationsSubcommand::Revoke(args) => {
                    workloads_activations_revoke_command(format, &args).await?
                }
            },
            WorkloadsSubcommand::Reviews(reviews) => match reviews.command {
                WorkloadsReviewsSubcommand::List(args) => {
                    workloads_reviews_list_command(format, &args).await?
                }
                WorkloadsReviewsSubcommand::Decide(args) => {
                    workloads_reviews_decide_command(format, &args).await?
                }
            },
        },
        TopLevelCommand::Generate(command) => match command.command {
            GenerateSubcommand::Manifest(args) => generate_manifest_command(&args)?,
            GenerateSubcommand::Ts(args) => generate_ts_sdk_command(&args)?,
            GenerateSubcommand::Rust(args) => generate_rust_sdk_command(&args)?,
            GenerateSubcommand::All(args) => generate_all_command(&args)?,
        },
        TopLevelCommand::Contracts(command) => match command.command {
            ContractsSubcommand::Build(args) => build_contract_command(&args)?,
            ContractsSubcommand::Verify(args) => verify_manifest_command(format, &args)?,
            ContractsSubcommand::Pack(args) => pack_contracts_command(format, &args)?,
            ContractsSubcommand::VerifyLive(args) => verify_live_command(format, &args).await?,
        },
        TopLevelCommand::Sdk(command) => match command.command {
            SdkSubcommand::Generate(generate) => match generate.target {
                GenerateSdkTarget::Ts(args) => generate_ts_sdk_command(&args)?,
                GenerateSdkTarget::Rust(args) => generate_rust_sdk_command(&args)?,
                GenerateSdkTarget::Facade(args) => generate_rust_participant_facade_command(&args)?,
                GenerateSdkTarget::All(args) => generate_all_sdk_command(&args)?,
            },
        },
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

fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn trellis_id_from_origin_id(origin: &str, id: &str) -> String {
    let digest = Sha256::digest(format!("{origin}:{id}").as_bytes());
    base64url_encode(&digest)[..22].to_string()
}

fn keygen_command(format: OutputFormat, args: &KeygenArgs) -> miette::Result<()> {
    let (seed_b64, public_b64, derived_only) = match &args.seed {
        Some(seed_b64) => {
            miette::ensure!(
                args.out.is_none(),
                "--out cannot be used with --seed; the seed is already provided"
            );
            let seed = URL_SAFE_NO_PAD.decode(seed_b64).into_diagnostic()?;
            miette::ensure!(
                seed.len() == 32,
                "invalid Ed25519 seed length: {} (expected 32 bytes)",
                seed.len()
            );
            let mut seed32 = [0u8; 32];
            seed32.copy_from_slice(&seed);
            let signing_key = SigningKey::from_bytes(&seed32);
            let public_key = signing_key.verifying_key().to_bytes();
            (seed_b64.clone(), base64url_encode(&public_key), true)
        }
        None => {
            let seed: [u8; 32] = rand::random();
            let signing_key = SigningKey::from_bytes(&seed);
            let public_key = signing_key.verifying_key().to_bytes();
            (
                base64url_encode(&seed),
                base64url_encode(&public_key),
                false,
            )
        }
    };

    if let Some(path) = &args.out {
        fs::write(path, format!("{seed_b64}\n")).into_diagnostic()?;
    }
    if let Some(path) = &args.pubout {
        fs::write(path, format!("{public_b64}\n")).into_diagnostic()?;
    }

    if output::is_json(format) {
        if derived_only {
            output::print_json(&json!({
                "sessionKey": public_b64,
            }))?;
        } else {
            output::print_json(&json!({
                "seed": seed_b64,
                "sessionKey": public_b64,
            }))?;
        }
        return Ok(());
    }

    if !derived_only && args.out.is_none() {
        println!("seed={seed_b64}");
    }
    if args.pubout.is_none() {
        println!("sessionKey={public_b64}");
    }

    Ok(())
}

async fn connect_with_creds(servers: &str, creds: &Path) -> miette::Result<async_nats::Client> {
    ConnectOptions::new()
        .credentials_file(creds)
        .await
        .into_diagnostic()?
        .connect(servers)
        .await
        .into_diagnostic()
}

async fn ensure_stream(
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

async fn ensure_bucket(
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

fn resolve_auth_config_path() -> PathBuf {
    env::var("TRELLIS_CONFIG")
        .or_else(|_| env::var("TRELLIS_AUTH_CONFIG"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(DEFAULT_TRELLIS_CONFIG_PATH))
}

fn load_binding_token_bucket_ttl_ms(path: &Path) -> miette::Result<Option<u64>> {
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

async fn nats_bootstrap_command(args: &NatsBootstrapArgs) -> miette::Result<()> {
    let servers = args
        .servers
        .clone()
        .or_else(|| env::var("TRELLIS_NATS_SERVERS").ok())
        .or_else(|| env::var("NATS_SERVERS").ok())
        .unwrap_or_else(|| "localhost".to_string());

    let stream_created = ensure_stream(
        &servers,
        &args.trellis_creds,
        "trellis",
        vec!["events.>".to_string()],
    )
    .await?;
    let auth_config_path = resolve_auth_config_path();
    let binding_token_bucket_ttl_ms = load_binding_token_bucket_ttl_ms(&auth_config_path)?
        .unwrap_or_else(|| {
            AUTH_BOOTSTRAP_BUCKETS
                .iter()
                .find(|bucket| bucket.name == "trellis_binding_tokens")
                .map(|bucket| bucket.ttl_ms)
                .expect("binding token bootstrap bucket present")
        });
    let mut rows = vec![vec![
        "stream".to_string(),
        "trellis".to_string(),
        if stream_created { "created" } else { "exists" }.to_string(),
    ]];
    for bucket in AUTH_BOOTSTRAP_BUCKETS {
        let ttl_ms = if bucket.name == "trellis_binding_tokens" {
            binding_token_bucket_ttl_ms
        } else {
            bucket.ttl_ms
        };
        let status = ensure_bucket(&servers, &args.auth_creds, bucket.name, 1, ttl_ms).await?;
        rows.push(vec![
            "bucket".to_string(),
            bucket.name.to_string(),
            match status {
                BucketEnsureStatus::Created => "created",
                BucketEnsureStatus::Updated => "updated",
                BucketEnsureStatus::Exists => "exists",
            }
            .to_string(),
        ]);
    }
    println!("{}", output::table(&["kind", "name", "status"], rows));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{KvBucketSpec, AUTH_BOOTSTRAP_BUCKETS};

    #[derive(Debug, Eq, PartialEq)]
    struct RuntimeBucketSpec {
        name: String,
        ttl_ms: u64,
    }

    #[test]
    fn bootstrap_buckets_match_runtime_globals() {
        let runtime = parse_runtime_bucket_specs(include_str!(
            "../../../../js/services/trellis/bootstrap/globals.ts"
        ));
        let bootstrap = AUTH_BOOTSTRAP_BUCKETS
            .iter()
            .map(|bucket| RuntimeBucketSpec {
                name: bucket.name.to_string(),
                ttl_ms: bucket.ttl_ms,
            })
            .collect::<Vec<_>>();

        assert_eq!(bootstrap, runtime);
    }

    fn parse_runtime_bucket_specs(source: &str) -> Vec<RuntimeBucketSpec> {
        let mut specs = Vec::new();
        let mut current_name: Option<String> = None;

        for line in source.lines() {
            if current_name.is_none() {
                current_name = extract_bucket_name(line);
                continue;
            }

            if let Some(ttl_ms) = extract_ttl_ms(line) {
                specs.push(RuntimeBucketSpec {
                    name: current_name
                        .take()
                        .expect("bucket name should be present when ttl is parsed"),
                    ttl_ms,
                });
            }
        }

        assert!(
            current_name.is_none(),
            "found bucket without ttl in globals.ts"
        );
        specs
    }

    fn extract_bucket_name(line: &str) -> Option<String> {
        if !line.contains('"') || !line.contains("trellis_") {
            return None;
        }

        let start = line.find('"')? + 1;
        let rest = &line[start..];
        let end = rest.find('"')?;
        let name = &rest[..end];

        name.starts_with("trellis_").then(|| name.to_string())
    }

    fn extract_ttl_ms(line: &str) -> Option<u64> {
        let ttl = line
            .split_once("ttl:")?
            .1
            .trim()
            .trim_end_matches(',')
            .trim_end_matches('}')
            .trim();

        Some(match ttl {
            "0" => 0,
            "config.ttlMs.sessions" => 24 * 60 * 60_000_u64,
            "config.ttlMs.oauth" => 5 * 60_000_u64,
            "config.ttlMs.workloadHandoff" => 30 * 60_000_u64,
            "config.ttlMs.pendingAuth" => 5 * 60_000_u64,
            "config.ttlMs.bindingTokens.bucket" => 24 * 60 * 60_000_u64,
            "config.ttlMs.connections" => 2 * 60 * 60_000_u64,
            other => panic!("unexpected ttl expression in globals.ts: {other}"),
        })
    }

    #[test]
    fn bootstrap_bucket_names_are_unique() {
        let mut names = AUTH_BOOTSTRAP_BUCKETS
            .iter()
            .map(|bucket: &KvBucketSpec| bucket.name)
            .collect::<Vec<_>>();
        let original_len = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), original_len);
    }
}

async fn bootstrap_admin_command(
    global_nats_servers: Option<String>,
    global_creds: Option<PathBuf>,
    args: &BootstrapAdminArgs,
) -> miette::Result<()> {
    let servers = resolve_servers(global_nats_servers, args.servers.clone());
    let creds = args
        .creds
        .clone()
        .or(global_creds)
        .or_else(|| env::var("TRELLIS_NATS_CREDS").ok().map(PathBuf::from))
        .or_else(|| env::var("NATS_CREDS").ok().map(PathBuf::from))
        .ok_or_else(|| miette::miette!("missing creds path"))?;
    let capabilities = if args.capabilities.is_empty() {
        vec![
            "admin".to_string(),
            "trellis.catalog.read".to_string(),
            "trellis.contract.read".to_string(),
        ]
    } else {
        args.capabilities.clone()
    };

    let client = connect_with_creds(&servers, &creds).await?;
    let js = jetstream::new(client);
    let users = match js.get_key_value("trellis_users").await {
        Ok(store) => store,
        Err(_) => js
            .create_key_value(kv::Config {
                bucket: "trellis_users".to_string(),
                history: 1,
                ..Default::default()
            })
            .await
            .into_diagnostic()?,
    };

    let trellis_id = trellis_id_from_origin_id(&args.origin, &args.id);
    let payload = json!({
        "origin": args.origin,
        "id": args.id,
        "active": true,
        "capabilities": capabilities,
    });
    users
        .put(
            &trellis_id,
            Bytes::from(serde_json::to_vec_pretty(&payload).into_diagnostic()?),
        )
        .await
        .into_diagnostic()?;

    output::print_success("bootstrapped admin user");
    output::print_info(&format!("trellisId={trellis_id}"));
    output::print_info(&format!("payload={payload}"));
    Ok(())
}

fn build_contract_command(args: &BuildContractArgs) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        None,
        Some(args.source.as_path()),
        None,
        &args.source_export,
        default_image_contract_path(),
    )?;
    let owner_version = required_owner_version(&resolved, "build SDKs from contract source")?;
    write_contract_outputs(
        &resolved,
        Some(owner_version),
        &args.out_manifest,
        args.ts_out.as_deref(),
        args.rust_out.as_deref(),
        args.package_name.as_ref(),
        args.crate_name.as_ref(),
        args.runtime_source,
        args.runtime_repo_root.clone(),
        "generated contract artifacts",
    )
}

fn generate_all_command(args: &GenerateAllArgs) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let artifact_version = args
        .artifact_version
        .clone()
        .or(resolved.owner_version.clone())
        .ok_or_else(|| {
            miette::miette!(
                "cannot generate all artifacts: no version could be inferred; pass --artifact-version when using --manifest or --image"
            )
        })?;
    write_contract_outputs(
        &resolved,
        Some(artifact_version),
        &args.out_manifest,
        args.ts_out.as_deref(),
        args.rust_out.as_deref(),
        args.package_name.as_ref(),
        args.crate_name.as_ref(),
        args.runtime_source,
        args.runtime_repo_root.clone(),
        "generated contract artifacts",
    )
}

fn generate_manifest_command(args: &GenerateManifestArgs) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;

    if let Some(parent) = args.out.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    fs::write(&args.out, format!("{}\n", resolved.loaded.canonical)).into_diagnostic()?;

    output::print_success(&format!(
        "generated canonical manifest for {}",
        resolved.loaded.manifest.id
    ));
    output::print_info(&format!("manifest={}", args.out.display()));
    output::print_info(&format!("digest={}", resolved.loaded.digest));
    Ok(())
}

fn write_contract_outputs(
    resolved: &contract_input::ResolvedContractInput,
    artifact_version: Option<String>,
    out_manifest: &Path,
    ts_out: Option<&Path>,
    rust_out: Option<&Path>,
    package_name: Option<&String>,
    crate_name: Option<&String>,
    runtime_source: RustRuntimeSource,
    runtime_repo_root: Option<PathBuf>,
    success_message: &str,
) -> miette::Result<()> {
    let runtime_version = artifact_version
        .or_else(|| resolved.owner_version.clone())
        .ok_or_else(|| {
            miette::miette!(
                "cannot generate contract artifacts: no version could be inferred; pass --artifact-version when using --manifest or --image"
            )
        })?;

    if let Some(parent) = out_manifest.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    fs::write(out_manifest, format!("{}\n", resolved.loaded.canonical)).into_diagnostic()?;

    if let Some(ts_out) = ts_out {
        generate_ts_sdk(&GenerateTsSdkOpts {
            manifest_path: out_manifest.to_path_buf(),
            out_dir: ts_out.to_path_buf(),
            package_name: package_name
                .cloned()
                .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id)),
            package_version: runtime_version.clone(),
            runtime_deps: ts_runtime_deps(
                runtime_source,
                runtime_version.clone(),
                runtime_repo_root.clone(),
            ),
        })
        .into_diagnostic()?;
    }

    if let Some(rust_out) = rust_out {
        generate_rust_sdk(&GenerateRustSdkOpts {
            manifest_path: out_manifest.to_path_buf(),
            out_dir: rust_out.to_path_buf(),
            crate_name: crate_name
                .cloned()
                .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id)),
            crate_version: runtime_version.clone(),
            runtime_deps: rust_runtime_deps(runtime_source, runtime_version, runtime_repo_root),
        })
        .into_diagnostic()?;
    }

    output::print_success(&format!(
        "{} for {}",
        success_message, resolved.loaded.manifest.id
    ));
    output::print_info(&format!("manifest={}", out_manifest.display()));
    output::print_info(&format!("digest={}", resolved.loaded.digest));
    Ok(())
}

fn verify_manifest_command(format: OutputFormat, args: &VerifyManifestArgs) -> miette::Result<()> {
    let manifest = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    if output::is_json(format) {
        output::print_json(&json!({
            "id": manifest.loaded.manifest.id,
            "digest": manifest.loaded.digest,
            "path": manifest.manifest_path,
        }))?;
        return Ok(());
    }
    println!(
        "{}",
        output::table(
            &["id", "digest", "path"],
            vec![vec![
                manifest.loaded.manifest.id,
                manifest.loaded.digest,
                manifest.manifest_path.display().to_string(),
            ]],
        )
    );
    Ok(())
}

fn pack_contracts_command(format: OutputFormat, args: &PackContractsArgs) -> miette::Result<()> {
    let resolved = resolve_contract_inputs(
        &args.manifests,
        &args.sources,
        &args.images,
        &args.source_export,
        &args.image_contract_path,
    )?;
    let pack = pack_loaded_manifests(resolved.into_iter().map(|entry| entry.loaded).collect())
        .into_diagnostic()?;
    write_catalog_pack(&pack, &args.output, args.contracts_out.as_ref()).into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&pack_json(
            &pack,
            &args.output,
            args.contracts_out.as_deref(),
        ))?;
        return Ok(());
    }

    let rows = pack
        .contracts
        .iter()
        .map(|manifest| {
            vec![
                manifest.manifest.id.clone(),
                manifest.digest.clone(),
                manifest.path.display().to_string(),
            ]
        })
        .collect();
    println!("{}", output::table(&["id", "digest", "path"], rows));
    output::print_success(&format!(
        "wrote {} contract(s) to {}",
        pack.contracts.len(),
        args.output.display()
    ));
    Ok(())
}

async fn verify_live_command(format: OutputFormat, args: &VerifyLiveArgs) -> miette::Result<()> {
    let creds = args.creds.display().to_string();
    let connected = TrellisClient::connect_service(ServiceConnectOptions {
        servers: &args.servers,
        sentinel_creds_path: &creds,
        session_key_seed_base64url: &args.session_seed,
        timeout_ms: 5_000,
    })
    .await
    .into_diagnostic()?;

    let core_client = core_client::CoreClient::new(&connected);
    let catalog = core_client.catalog().await.into_diagnostic()?.catalog;
    let mut verified = Vec::new();
    for (index, entry) in catalog.contracts.iter().enumerate() {
        if args.limit.is_some_and(|limit| index >= limit) {
            break;
        }
        let contract = core_client
            .contract_get(&entry.digest)
            .await
            .into_diagnostic()?
            .contract;
        let computed =
            trellis_contracts::digest_json(&serde_json::to_value(&contract).into_diagnostic()?)
                .into_diagnostic()?;
        miette::ensure!(computed == entry.digest, "digest mismatch for {}", entry.id);
        verified.push(json!({ "id": entry.id, "digest": entry.digest }));
    }

    if output::is_json(format) {
        output::print_json(&json!({
            "catalogContracts": catalog.contracts.len(),
            "verified": verified,
        }))?;
        return Ok(());
    }

    let rows = verified
        .iter()
        .map(|row| {
            vec![
                row.get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                row.get("digest")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            ]
        })
        .collect();
    println!("{}", output::table(&["id", "digest"], rows));
    Ok(())
}

fn generate_ts_sdk_command(args: &GenerateTsSdkArgs) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let package_name = args
        .package_name
        .clone()
        .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id));
    let artifact_version = args
        .artifact_version
        .clone()
        .or(resolved.owner_version.clone())
        .ok_or_else(|| {
            miette::miette!(
                "cannot generate a TypeScript SDK: no version could be inferred; pass --artifact-version when using --manifest or --image"
            )
        })?;
    let runtime_version = artifact_version.clone();
    generate_ts_sdk(&GenerateTsSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        package_name,
        package_version: artifact_version,
        runtime_deps: ts_runtime_deps(
            args.runtime_source,
            runtime_version,
            args.runtime_repo_root.clone(),
        ),
    })
    .into_diagnostic()?;
    output::print_success(&format!(
        "generated TypeScript SDK at {}",
        args.out.display()
    ));
    Ok(())
}

fn generate_rust_sdk_command(args: &GenerateRustSdkArgs) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let crate_name = args
        .crate_name
        .clone()
        .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id));
    let artifact_version = args
        .artifact_version
        .clone()
        .or(resolved.owner_version.clone())
        .ok_or_else(|| {
            miette::miette!(
                "cannot generate a Rust SDK: no version could be inferred; pass --artifact-version when using --manifest or --image"
            )
        })?;
    let runtime_version = artifact_version.clone();
    generate_rust_sdk(&GenerateRustSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        crate_name,
        crate_version: artifact_version,
        runtime_deps: rust_runtime_deps(
            args.runtime_source,
            runtime_version,
            args.runtime_repo_root.clone(),
        ),
    })
    .into_diagnostic()?;
    output::print_success(&format!("generated Rust SDK at {}", args.out.display()));
    Ok(())
}

fn generate_rust_participant_facade_command(
    args: &GenerateRustParticipantFacadeArgs,
) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let crate_name = args.crate_name.clone().unwrap_or_else(|| {
        format!(
            "{}-participant",
            default_rust_crate_name_from_id(&resolved.loaded.manifest.id)
        )
    });
    let owned_sdk_crate_name = args.owned_sdk_crate_name.clone().or_else(|| {
        args.owned_sdk_path
            .as_ref()
            .map(|_| default_rust_crate_name_from_id(&resolved.loaded.manifest.id))
    });
    let alias_mappings = args
        .use_sdks
        .iter()
        .map(|value| parse_participant_alias_mapping(value))
        .collect::<miette::Result<Vec<_>>>()?;
    let owner_version = required_owner_version(&resolved, "generate a Rust participant facade")?;
    let runtime_version = owner_version.clone();

    generate_rust_participant_facade(&GenerateRustParticipantFacadeOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        crate_name,
        crate_version: owner_version,
        runtime_deps: rust_runtime_deps(
            args.runtime_source,
            runtime_version,
            args.runtime_repo_root.clone(),
        ),
        owned_sdk_crate_name,
        owned_sdk_path: args.owned_sdk_path.clone(),
        alias_mappings,
    })
    .into_diagnostic()?;
    output::print_success(&format!(
        "generated Rust participant facade at {}",
        args.out.display()
    ));
    Ok(())
}

fn generate_all_sdk_command(args: &GenerateAllSdkArgs) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let owner_version = required_owner_version(&resolved, "generate SDKs")?;
    let runtime_version = owner_version.clone();
    generate_ts_sdk(&GenerateTsSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.ts_out.clone(),
        package_name: args
            .package_name
            .clone()
            .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id)),
        package_version: owner_version.clone(),
        runtime_deps: ts_runtime_deps(
            args.runtime_source,
            runtime_version.clone(),
            args.runtime_repo_root.clone(),
        ),
    })
    .into_diagnostic()?;
    generate_rust_sdk(&GenerateRustSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.rust_out.clone(),
        crate_name: args
            .crate_name
            .clone()
            .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id)),
        crate_version: owner_version,
        runtime_deps: rust_runtime_deps(
            args.runtime_source,
            runtime_version,
            args.runtime_repo_root.clone(),
        ),
    })
    .into_diagnostic()?;
    output::print_success("generated TypeScript and Rust SDKs");
    Ok(())
}

fn required_owner_version(
    resolved: &contract_input::ResolvedContractInput,
    action: &str,
) -> miette::Result<String> {
    resolved.owner_version.clone().ok_or_else(|| {
        miette::miette!(
            "cannot {action}: no owning workspace version could be inferred from the contract input; use a source file or a manifest located under a versioned workspace"
        )
    })
}

fn generate_session_keypair() -> (String, String) {
    let seed: [u8; 32] = rand::random();
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key().to_bytes();
    (base64url_encode(&seed), base64url_encode(&public_key))
}

fn default_display_name(manifest_path: &Path) -> String {
    manifest_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("service")
        .split('@')
        .next()
        .unwrap_or("service")
        .replace('.', "-")
}

fn infer_namespaces(manifest: &ContractManifest) -> Vec<String> {
    let mut namespaces = std::collections::BTreeSet::new();
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

fn contract_review_rows(loaded: &trellis_contracts::LoadedManifest) -> Vec<Vec<String>> {
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

fn prompt_for_confirmation(prompt: &str) -> miette::Result<bool> {
    print!("{prompt} [y/N]: ");
    io::Write::flush(&mut io::stdout()).into_diagnostic()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line).into_diagnostic()?;
    let trimmed = line.trim().to_ascii_lowercase();
    Ok(trimmed == "y" || trimmed == "yes")
}

fn try_open_browser(url: &str) {
    let _ = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    };
}

fn resolve_upgrade_service_key(
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

fn json_value_label(value: &Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| value.to_string())
}

fn portal_target_id(target: &PortalTargetArgs) -> Option<&str> {
    if target.builtin {
        None
    } else {
        target.portal_id.as_deref()
    }
}

fn portal_target_label(portal_id: Option<&str>) -> String {
    portal_id.unwrap_or("builtin").to_string()
}

#[derive(Debug, serde::Serialize)]
struct WorkloadProvisionOutput {
    #[serde(rename = "profileId")]
    profile_id: String,
    #[serde(rename = "instanceId")]
    instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    public_identity_key: String,
    #[serde(rename = "rootSecret")]
    root_secret: String,
}

fn resolve_workload_contract_source(value: &str) -> miette::Result<Option<contract_input::ResolvedContractInput>> {
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

async fn resolve_workload_profile_contract(
    connected: &TrellisClient,
    contract: &str,
) -> miette::Result<(String, Vec<String>, Option<BTreeMap<String, Value>>)> {
    if let Some(resolved) = resolve_workload_contract_source(contract)? {
        let contract = resolved
            .loaded
            .value
            .as_object()
            .cloned()
            .map(|contract| contract.into_iter().collect());
        return Ok((resolved.loaded.manifest.id, vec![resolved.loaded.digest], contract));
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

fn review_decision_label(args: &ReviewDecisionArgs) -> &'static str {
    if args.approve {
        "approve"
    } else {
        "reject"
    }
}

async fn portals_list_command(format: OutputFormat) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let portals = auth_client.list_portals().await.into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "portals": portals }))?;
        return Ok(());
    }
    if portals.is_empty() {
        output::print_info("no portals configured");
        return Ok(());
    }
    let rows = portals
        .into_iter()
        .map(|portal| {
            vec![
                portal.portal_id,
                portal.app_contract_id.unwrap_or_else(|| "-".to_string()),
                portal.entry_url,
                if portal.disabled { "Disabled" } else { "Active" }.to_string(),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["portal", "app contract", "entry", "state"], rows));
    Ok(())
}

async fn portals_create_command(format: OutputFormat, args: &PortalsCreateArgs) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let portal = auth_client
        .create_portal(&args.portal_id, args.app_contract_id.as_deref(), &args.entry_url)
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "portal": portal }))?;
        return Ok(());
    }
    output::print_success("portal created");
    output::print_info(&format!("portalId={}", portal.portal_id));
    output::print_info(&format!("entry={}", portal.entry_url));
    Ok(())
}

async fn portals_disable_command(format: OutputFormat, args: &PortalsDisableArgs) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client.disable_portal(&args.portal_id).await.into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "portalId": args.portal_id }))?;
        return Ok(());
    }
    if success {
        output::print_success("portal disabled");
    } else {
        output::print_info("no matching portal found");
    }
    Ok(())
}

async fn portals_logins_default_show_command(format: OutputFormat) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let default_portal = auth_client.get_login_portal_default().await.into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "defaultPortal": default_portal }))?;
        return Ok(());
    }
    output::print_info(&format!(
        "portal={}",
        portal_target_label(default_portal.portal_id.as_deref())
    ));
    Ok(())
}

async fn portals_logins_default_set_command(
    format: OutputFormat,
    args: &PortalsDefaultSetArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let default_portal = auth_client
        .set_login_portal_default(portal_target_id(&args.target))
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "defaultPortal": default_portal }))?;
        return Ok(());
    }
    output::print_success("login portal default updated");
    output::print_info(&format!(
        "portal={}",
        portal_target_label(default_portal.portal_id.as_deref())
    ));
    Ok(())
}

async fn portals_logins_list_command(format: OutputFormat) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let selections = auth_client.list_login_portal_selections().await.into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "selections": selections }))?;
        return Ok(());
    }
    if selections.is_empty() {
        output::print_info("no login portal selections configured");
        return Ok(());
    }
    let rows = selections
        .into_iter()
        .map(|selection| {
            vec![
                selection.contract_id,
                portal_target_label(selection.portal_id.as_deref()),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["contract", "portal"], rows));
    Ok(())
}

async fn portals_logins_set_command(
    format: OutputFormat,
    args: &PortalsLoginsSetArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let selection = auth_client
        .set_login_portal_selection(&args.contract_id, portal_target_id(&args.target))
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "selection": selection }))?;
        return Ok(());
    }
    output::print_success("login portal selection updated");
    output::print_info(&format!("contractId={}", selection.contract_id));
    output::print_info(&format!(
        "portal={}",
        portal_target_label(selection.portal_id.as_deref())
    ));
    Ok(())
}

async fn portals_logins_clear_command(
    format: OutputFormat,
    args: &PortalsLoginsClearArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .clear_login_portal_selection(&args.contract_id)
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "contractId": args.contract_id }))?;
        return Ok(());
    }
    if success {
        output::print_success("login portal selection cleared");
    } else {
        output::print_info("no matching login portal selection found");
    }
    Ok(())
}

async fn portals_workloads_default_show_command(format: OutputFormat) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let default_portal = auth_client.get_workload_portal_default().await.into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "defaultPortal": default_portal }))?;
        return Ok(());
    }
    output::print_info(&format!(
        "portal={}",
        portal_target_label(default_portal.portal_id.as_deref())
    ));
    Ok(())
}

async fn portals_workloads_default_set_command(
    format: OutputFormat,
    args: &PortalsDefaultSetArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let default_portal = auth_client
        .set_workload_portal_default(portal_target_id(&args.target))
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "defaultPortal": default_portal }))?;
        return Ok(());
    }
    output::print_success("workload portal default updated");
    output::print_info(&format!(
        "portal={}",
        portal_target_label(default_portal.portal_id.as_deref())
    ));
    Ok(())
}

async fn portals_workloads_list_command(format: OutputFormat) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let selections = auth_client
        .list_workload_portal_selections()
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "selections": selections }))?;
        return Ok(());
    }
    if selections.is_empty() {
        output::print_info("no workload portal selections configured");
        return Ok(());
    }
    let rows = selections
        .into_iter()
        .map(|selection| {
            vec![
                selection.profile_id,
                portal_target_label(selection.portal_id.as_deref()),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["profile", "portal"], rows));
    Ok(())
}

async fn portals_workloads_set_command(
    format: OutputFormat,
    args: &PortalsWorkloadsSetArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let selection = auth_client
        .set_workload_portal_selection(&args.profile, portal_target_id(&args.target))
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "selection": selection }))?;
        return Ok(());
    }
    output::print_success("workload portal selection updated");
    output::print_info(&format!("profileId={}", selection.profile_id));
    output::print_info(&format!(
        "portal={}",
        portal_target_label(selection.portal_id.as_deref())
    ));
    Ok(())
}

async fn portals_workloads_clear_command(
    format: OutputFormat,
    args: &PortalsWorkloadsClearArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .clear_workload_portal_selection(&args.profile)
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "profileId": args.profile }))?;
        return Ok(());
    }
    if success {
        output::print_success("workload portal selection cleared");
    } else {
        output::print_info("no matching workload portal selection found");
    }
    Ok(())
}

async fn workloads_profiles_list_command(
    format: OutputFormat,
    args: &WorkloadsProfilesListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let profiles = auth_client
        .list_workload_profiles(args.contract.as_deref(), args.disabled)
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "profiles": profiles }))?;
        return Ok(());
    }
    if profiles.is_empty() {
        output::print_info("no workload profiles configured");
        return Ok(());
    }
    let rows = profiles
        .into_iter()
        .map(|profile| {
            vec![
                profile.profile_id,
                profile.contract_id,
                profile.allowed_digests.len().to_string(),
                profile
                    .review_mode
                    .as_ref()
                    .map(json_value_label)
                    .unwrap_or_else(|| "none".to_string()),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["profile", "contract", "digests", "review"], rows));
    Ok(())
}

async fn workloads_profiles_create_command(
    format: OutputFormat,
    args: &WorkloadsProfilesCreateArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let (contract_id, allowed_digests, contract) =
        resolve_workload_profile_contract(&connected, &args.contract).await?;
    let profile = auth_client
        .create_workload_profile(
            &args.profile,
            &contract_id,
            &allowed_digests,
            args.review_mode.as_deref(),
            contract,
        )
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "profile": profile }))?;
        return Ok(());
    }
    output::print_success("workload profile created");
    output::print_info(&format!("profileId={}", profile.profile_id));
    output::print_info(&format!("contractId={}", profile.contract_id));
    output::print_info(&format!("allowedDigests={}", profile.allowed_digests.len()));
    Ok(())
}

async fn workloads_profiles_disable_command(
    format: OutputFormat,
    args: &WorkloadsProfilesDisableArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client.disable_workload_profile(&args.profile).await.into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "profileId": args.profile }))?;
        return Ok(());
    }
    Ok(())
}

async fn workloads_provision_command(
    format: OutputFormat,
    args: &WorkloadsProvisionArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);

    let seed: [u8; 32] = rand::random();
    let root_secret = URL_SAFE_NO_PAD.encode(seed);
    let identity = authlib::derive_workload_identity(&seed).into_diagnostic()?;
    let instance = auth_client
        .provision_workload_instance(
            &args.profile,
            &identity.public_identity_key,
            &identity.activation_key_base64url,
        )
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    let bundle = WorkloadProvisionOutput {
        profile_id: args.profile.clone(),
        instance_id: instance.instance_id.clone(),
        public_identity_key: identity.public_identity_key,
        root_secret,
    };

    if output::is_json(format) {
        output::print_json(&bundle)?;
        return Ok(());
    }

    output::print_success("workload provisioned");
    output::print_info(&format!("profileId={}", bundle.profile_id));
    output::print_info(&format!("instanceId={}", bundle.instance_id));
    output::print_info(&format!("publicIdentityKey={}", bundle.public_identity_key));
    output::print_info(&format!("rootSecret={}", bundle.root_secret));
    output::print_info("store the root secret securely; it will not be shown again");
    Ok(())
}

async fn workloads_instances_list_command(
    format: OutputFormat,
    args: &WorkloadsInstancesListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let instances = auth_client
        .list_workload_instances(args.profile.as_deref(), args.state.as_deref())
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "instances": instances }))?;
        return Ok(());
    }
    let rows = instances
        .into_iter()
        .map(|instance| vec![instance.instance_id, instance.profile_id, json_value_label(&instance.state)])
        .collect::<Vec<_>>();
    println!("{}", output::table(&["instance", "profile", "state"], rows));
    Ok(())
}

async fn workloads_instances_disable_command(
    format: OutputFormat,
    args: &WorkloadsInstancesDisableArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client.disable_workload_instance(&args.instance).await.into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "instanceId": args.instance }))?;
        return Ok(());
    }
    Ok(())
}

async fn workloads_activations_list_command(
    format: OutputFormat,
    args: &WorkloadsActivationsListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let activations = auth_client
        .list_workload_activations(
            args.instance.as_deref(),
            args.profile.as_deref(),
            args.state.as_deref(),
        )
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "activations": activations }))?;
        return Ok(());
    }
    let rows = activations
        .into_iter()
        .map(|activation| vec![activation.instance_id, activation.profile_id, json_value_label(&activation.state)])
        .collect::<Vec<_>>();
    println!("{}", output::table(&["instance", "profile", "state"], rows));
    Ok(())
}

async fn workloads_activations_revoke_command(
    format: OutputFormat,
    args: &WorkloadsActivationsRevokeArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client.revoke_workload_activation(&args.instance).await.into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "instanceId": args.instance }))?;
        return Ok(());
    }
    Ok(())
}

async fn workloads_reviews_list_command(
    format: OutputFormat,
    args: &WorkloadsReviewsListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let reviews = auth_client
        .list_workload_activation_reviews(
            args.instance.as_deref(),
            args.profile.as_deref(),
            args.state.as_deref(),
        )
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "reviews": reviews }))?;
        return Ok(());
    }
    if reviews.is_empty() {
        output::print_info("no workload reviews pending");
        return Ok(());
    }
    let rows = reviews
        .into_iter()
        .map(|review| {
            vec![
                review.review_id,
                review.instance_id,
                review.profile_id,
                json_value_label(&review.state),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["review", "instance", "profile", "state"], rows));
    Ok(())
}

async fn workloads_reviews_decide_command(
    format: OutputFormat,
    args: &WorkloadsReviewsDecideArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state).await.into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let decision = review_decision_label(&args.decision);
    let response = auth_client
        .decide_workload_activation_review(&args.review, decision, args.reason.as_deref())
        .await
        .into_diagnostic()?;
    auth_client.renew_binding_token(&mut state).await.into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&response)?;
        return Ok(());
    }
    output::print_success("workload review updated");
    output::print_info(&format!("reviewId={}", response.review.review_id));
    output::print_info(&format!("state={}", json_value_label(&response.review.state)));
    if let Some(code) = response.confirmation_code.as_deref() {
        output::print_info(&format!("confirmationCode={code}"));
    }
    Ok(())
}

async fn auth_login_command(
    format: OutputFormat,
    global_nats_servers: Option<String>,
    args: &AuthLoginArgs,
) -> miette::Result<()> {
    let nats_servers = resolve_servers(global_nats_servers, None);
    let challenge = authlib::start_browser_login(&authlib::StartBrowserLoginOpts {
        auth_url: &args.auth_url,
        listen: &args.listen,
        contract_json: cli_contract_json(),
    })
    .await
    .into_diagnostic()?;
    let login_url = challenge.login_url().to_string();

    if !output::is_json(format) {
        output::print_info(&format!("Open this URL to sign in: {login_url}"));
    }
    try_open_browser(&login_url);

    let outcome = challenge
        .complete(&args.auth_url, &nats_servers)
        .await
        .into_diagnostic()?;
    let state = outcome.state;
    let me = outcome.user;

    if output::is_json(format) {
        output::print_json(&json!({
            "sessionKey": state.session_key,
            "origin": me.origin,
            "id": me.id,
            "name": me.name,
            "capabilities": me.capabilities,
            "expires": state.expires,
        }))?;
    } else {
        output::print_success("logged in admin session");
        output::print_info(&format!("user={}:{}", me.origin, me.id));
        output::print_info(&format!("name={}", me.name));
        output::print_info(&format!("sessionKey={}", state.session_key));
        output::print_info(&format!("expires={}", state.expires));
    }

    Ok(())
}

async fn auth_logout_command(format: OutputFormat) -> miette::Result<()> {
    let mut revoked = false;
    let mut revoke_error = None;
    if let Ok(state) = authlib::load_admin_session() {
        match authlib::connect_admin_client_async(&state).await {
            Ok(connected) => match authlib::AuthClient::new(&connected).logout().await {
                Ok(response) => revoked = response,
                Err(error) => revoke_error = Some(error.to_string()),
            },
            Err(error) => revoke_error = Some(error.to_string()),
        }
    }
    let removed = authlib::clear_admin_session().into_diagnostic()?;
    if output::is_json(format) {
        let mut response = json!({ "cleared": removed, "revoked": revoked });
        if let Some(error) = &revoke_error {
            response["revokeError"] = Value::String(error.clone());
        }
        output::print_json(&response)?;
    } else if removed {
        if revoked {
            output::print_success("revoked remote session and cleared local admin session");
        } else if let Some(error) = &revoke_error {
            output::print_success("cleared stored admin session");
            output::print_info(&format!(
                "warning: remote session revocation failed: {error}"
            ));
        } else {
            output::print_success("cleared stored admin session");
        }
    } else {
        output::print_info("no stored admin session found");
    }
    Ok(())
}

async fn auth_status_command(format: OutputFormat) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let me = auth_client.me().await.into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "loggedIn": true,
            "origin": me.origin,
            "id": me.id,
            "name": me.name,
            "capabilities": me.capabilities,
            "sessionKey": state.session_key,
            "expires": state.expires,
        }))?;
    } else {
        output::print_success("admin session is active");
        output::print_info(&format!("user={}:{}", me.origin, me.id));
        output::print_info(&format!("name={}", me.name));
        output::print_info(&format!("sessionKey={}", state.session_key));
        output::print_info(&format!("expires={}", state.expires));
    }

    Ok(())
}

async fn service_list_command(format: OutputFormat) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let services = auth_client.list_services().await.into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "services": services }))?;
        return Ok(());
    }

    if services.is_empty() {
        output::print_info("no installed services found");
        return Ok(());
    }

    let rows = services
        .into_iter()
        .map(|service| {
            vec![
                service.session_key,
                service.display_name,
                service.contract_id.unwrap_or_default(),
                service.contract_digest.unwrap_or_default(),
                service.active.to_string(),
                service.namespaces.join(", "),
                service.description,
            ]
        })
        .collect::<Vec<_>>();

    println!(
        "{}",
        output::table(
            &[
                "service key",
                "display name",
                "contract id",
                "contract digest",
                "active",
                "namespaces",
                "description",
            ],
            rows,
        )
    );

    Ok(())
}

async fn auth_approvals_list_command(
    format: OutputFormat,
    args: &AuthApprovalsListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let approvals = auth_client
        .list_approvals(args.user.as_deref(), args.digest.as_deref())
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "user": args.user,
            "digest": args.digest,
            "approvals": approvals,
        }))?;
        return Ok(());
    }

    output::print_info(&format!("matched approvals={}", approvals.len()));
    if let Some(user) = &args.user {
        output::print_info(&format!("user={user}"));
    }
    if let Some(digest) = &args.digest {
        output::print_info(&format!("digest={digest}"));
    }

    let rows = approvals
        .into_iter()
        .map(|entry| {
            let answer = entry
                .answer
                .as_str()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| entry.answer.to_string());
            vec![
                entry.user,
                entry.approval.display_name,
                answer,
                entry.approval.contract_digest,
                entry.updated_at,
            ]
        })
        .collect();
    println!(
        "{}",
        output::table(&["user", "app", "answer", "digest", "updated"], rows)
    );
    Ok(())
}

async fn auth_approvals_revoke_command(
    format: OutputFormat,
    args: &AuthApprovalsRevokeArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .revoke_approval(&args.digest, args.user.as_deref())
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "success": success,
            "digest": args.digest,
            "user": args.user,
        }))?;
        return Ok(());
    }

    if success {
        output::print_success("revoked approval");
    } else {
        output::print_info("no matching approval found");
    }
    output::print_info(&format!("digest={}", args.digest));
    if let Some(user) = &args.user {
        output::print_info(&format!("user={user}"));
    }
    Ok(())
}

async fn service_install_command(
    format: OutputFormat,
    _global_nats_servers: Option<String>,
    _global_creds: Option<PathBuf>,
    args: &ServiceInstallArgs,
) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let loaded = &resolved.loaded;
    let default_name = if loaded.manifest.display_name.is_empty() {
        default_display_name(&resolved.manifest_path)
    } else {
        loaded.manifest.display_name.clone()
    };
    let display_name = args.display_name.clone().unwrap_or(default_name);
    let description = args
        .description
        .clone()
        .unwrap_or_else(|| loaded.manifest.description.clone());
    let namespaces = {
        let mut values = std::collections::BTreeSet::new();
        values.extend(infer_namespaces(&loaded.manifest));
        values.extend(args.extra_namespaces.iter().cloned());
        values.into_iter().collect::<Vec<_>>()
    };
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive install review"
    );

    if !output::is_json(format) {
        output::print_info("Install review");
        println!(
            "{}",
            output::table(
                &["field", "value"],
                [
                    contract_review_rows(loaded),
                    vec![
                        vec!["service display name".to_string(), display_name.clone()],
                        vec!["service description".to_string(), description.clone()],
                        vec!["active".to_string(), (!args.inactive).to_string()],
                        vec!["namespaces".to_string(), namespaces.join(", ")],
                    ],
                ]
                .concat(),
            )
        );
        if !args.force
            && !prompt_for_confirmation(&format!(
                "Proceed with service install for digest {}?",
                loaded.digest
            ))?
        {
            return Err(miette::miette!("service install cancelled"));
        }
    }

    let (seed, session_key) = generate_session_keypair();

    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let contract = loaded
        .value
        .as_object()
        .cloned()
        .map(|contract| contract.into_iter().collect())
        .ok_or_else(|| miette::miette!("service contract payload must be a JSON object"))?;
    let response = auth_client
        .install_service(&authlib::AuthInstallServiceRequest {
            session_key: session_key.clone(),
            display_name: display_name.clone(),
            active: Some(!args.inactive),
            namespaces: namespaces.clone(),
            description: description.clone(),
            contract,
        })
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "sessionKey": session_key,
            "displayName": display_name,
            "contractId": response.contract_id,
            "contractDigest": response.contract_digest,
            "resourceBindings": response.resource_bindings,
            "seedOmitted": true,
        }))?;
    } else {
        output::print_success("installed service contract");
        output::print_info(&format!("sessionKey={session_key}"));
        output::print_info(&format!("contractId={}", response.contract_id));
        output::print_info(&format!("contractDigest={}", response.contract_digest));
        output::print_info(&format!("seed={seed}"));
        output::print_info("store the seed securely; it will not be shown again");
    }

    Ok(())
}

async fn service_upgrade_command(
    format: OutputFormat,
    _global_nats_servers: Option<String>,
    _global_creds: Option<PathBuf>,
    args: &ServiceUpgradeArgs,
) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let loaded = &resolved.loaded;
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive upgrade review"
    );
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let services = auth_client.list_services().await.into_diagnostic()?;
    let service_key = resolve_upgrade_service_key(args, &services, &loaded.manifest.id)?;

    if !output::is_json(format) {
        let current = services
            .iter()
            .find(|service| service.session_key == service_key);
        output::print_info("Upgrade review");
        let mut rows = contract_review_rows(loaded);
        rows.push(vec!["service key".to_string(), service_key.clone()]);
        if let Some(service) = current {
            rows.push(vec![
                "display name".to_string(),
                service.display_name.clone(),
            ]);
            rows.push(vec![
                "current digest".to_string(),
                service.contract_digest.clone().unwrap_or_default(),
            ]);
            rows.push(vec!["active".to_string(), service.active.to_string()]);
            rows.push(vec![
                "namespaces".to_string(),
                service.namespaces.join(", "),
            ]);
            rows.push(vec!["description".to_string(), service.description.clone()]);
        }
        println!("{}", output::table(&["field", "value"], rows));
        if !args.force
            && !prompt_for_confirmation(&format!(
                "Proceed with service upgrade to digest {}?",
                loaded.digest
            ))?
        {
            return Err(miette::miette!("service upgrade cancelled"));
        }
    }

    let contract = loaded
        .value
        .as_object()
        .cloned()
        .map(|contract| contract.into_iter().collect())
        .ok_or_else(|| miette::miette!("service contract payload must be a JSON object"))?;
    let response = auth_client
        .upgrade_service_contract(&authlib::AuthUpgradeServiceContractRequest {
            session_key: service_key.clone(),
            contract,
        })
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "sessionKey": service_key,
            "contractId": response.contract_id,
            "contractDigest": response.contract_digest,
            "resourceBindings": response.resource_bindings,
        }))?;
    } else {
        output::print_success("upgraded service contract");
        output::print_info(&format!("sessionKey={}", service_key));
        output::print_info(&format!("contractId={}", response.contract_id));
        output::print_info(&format!("contractDigest={}", response.contract_digest));
    }

    Ok(())
}

fn resolve_servers(global: Option<String>, local: Option<String>) -> String {
    local
        .or(global)
        .or_else(|| env::var("TRELLIS_NATS_SERVERS").ok())
        .or_else(|| env::var("NATS_SERVERS").ok())
        .unwrap_or_else(|| "localhost".to_string())
}

fn pack_json(pack: &CatalogPack, output: &Path, contracts_out: Option<&Path>) -> Value {
    json!({
        "catalogPath": output,
        "contractsOut": contracts_out,
        "contracts": pack.catalog.contracts,
    })
}

fn default_ts_package_name_from_id(contract_id: &str) -> String {
    let stem = contract_id
        .split('@')
        .next()
        .unwrap_or("trellis-sdk")
        .replace('.', "-");
    match stem.as_str() {
        "trellis-auth" => "@qlever-llc/trellis-sdk-auth".to_string(),
        "trellis-activity" => "@qlever-llc/trellis-sdk-activity".to_string(),
        "trellis-core" => "@qlever-llc/trellis-sdk-core".to_string(),
        other => format!("@qlever-llc/trellis-sdk-{other}"),
    }
}

fn default_rust_crate_name_from_id(contract_id: &str) -> String {
    trellis_codegen_rust::default_sdk_crate_name(contract_id)
}

fn parse_participant_alias_mapping(value: &str) -> miette::Result<ParticipantAliasMapping> {
    let mut parts = value.splitn(4, '=');
    let alias = parts.next().unwrap_or_default();
    let crate_name = parts.next().unwrap_or_default();
    let manifest_path = parts.next().unwrap_or_default();
    let crate_path = parts.next();
    if alias.is_empty() || crate_name.is_empty() || manifest_path.is_empty() {
        return Err(miette::miette!(
            "invalid --use-sdk mapping '{value}'; expected ALIAS=CRATE=MANIFEST[=CRATE_PATH]"
        ));
    }
    Ok(ParticipantAliasMapping {
        alias: alias.to_string(),
        crate_name: crate_name.to_string(),
        manifest_path: PathBuf::from(manifest_path),
        crate_path: crate_path
            .filter(|value| !value.is_empty())
            .map(PathBuf::from),
    })
}

fn rust_runtime_deps(
    source: RustRuntimeSource,
    version: String,
    repo_root: Option<PathBuf>,
) -> RustRuntimeDeps {
    RustRuntimeDeps {
        source: match source {
            RustRuntimeSource::Registry => CodegenRustRuntimeSource::Registry,
            RustRuntimeSource::Local => CodegenRustRuntimeSource::Local,
        },
        version,
        repo_root,
    }
}

fn ts_runtime_deps(
    source: RustRuntimeSource,
    version: String,
    repo_root: Option<PathBuf>,
) -> TsRuntimeDeps {
    TsRuntimeDeps {
        source: match source {
            RustRuntimeSource::Registry => CodegenTsRuntimeSource::Registry,
            RustRuntimeSource::Local => CodegenTsRuntimeSource::Local,
        },
        version,
        repo_root,
    }
}
