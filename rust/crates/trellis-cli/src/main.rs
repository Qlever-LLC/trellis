mod cli;
mod cli_contract;
mod contract_input;
mod output;

use std::env;
use std::fs;
use std::io;
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
use rand::rngs::OsRng;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tracing_subscriber::EnvFilter;
use trellis_auth as authlib;
use trellis_client::{ServiceConnectOptions, SessionAuth};
use trellis_codegen_rust::{
    generate_rust_participant_facade, generate_rust_sdk, GenerateRustParticipantFacadeOpts,
    GenerateRustSdkOpts, ParticipantAliasMapping, RustRuntimeDeps,
    RustRuntimeSource as CodegenRustRuntimeSource,
};
use trellis_codegen_ts::{
    generate_ts_sdk, GenerateTsSdkOpts, TsRuntimeDeps, TsRuntimeSource as CodegenTsRuntimeSource,
};
use trellis_contracts::{pack_loaded_manifests, write_catalog_pack, CatalogPack, ContractManifest};
use trellis_cli_participant::{connect_admin as connect_cli_admin, connect_service as connect_cli_service};

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
            let mut seed = [0u8; 32];
            OsRng.fill_bytes(&mut seed);
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
) -> miette::Result<bool> {
    let client = connect_with_creds(servers, creds).await?;
    let js = jetstream::new(client);
    if js.get_key_value(bucket).await.is_ok() {
        return Ok(false);
    }
    js.create_key_value(kv::Config {
        bucket: bucket.to_string(),
        history,
        max_age: Duration::from_millis(ttl_ms),
        ..Default::default()
    })
    .await
    .into_diagnostic()?;
    Ok(true)
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
    let buckets = [
        ("trellis_sessions", 24 * 60 * 60_000_u64),
        ("trellis_oauth_states", 5 * 60_000_u64),
        ("trellis_pending_auth", 5 * 60_000_u64),
        ("trellis_binding_tokens", 2 * 60 * 60_000_u64),
        ("trellis_connections", 2 * 60 * 60_000_u64),
        ("trellis_services", 0_u64),
        ("trellis_contracts", 0_u64),
        ("trellis_contract_approvals", 0_u64),
        ("trellis_users", 0_u64),
    ];

    let mut rows = vec![vec![
        "stream".to_string(),
        "trellis".to_string(),
        if stream_created { "created" } else { "exists" }.to_string(),
    ]];
    for (bucket, ttl_ms) in buckets {
        let created = ensure_bucket(&servers, &args.auth_creds, bucket, 1, ttl_ms).await?;
        rows.push(vec![
            "bucket".to_string(),
            bucket.to_string(),
            if created { "created" } else { "exists" }.to_string(),
        ]);
    }
    println!("{}", output::table(&["kind", "name", "status"], rows));
    Ok(())
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
        vec!["admin".to_string()]
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

    if let Some(parent) = args.out_manifest.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    fs::write(&args.out_manifest, format!("{}\n", resolved.loaded.canonical)).into_diagnostic()?;

    if let Some(ts_out) = &args.ts_out {
        generate_ts_sdk(&GenerateTsSdkOpts {
            manifest_path: args.out_manifest.clone(),
            out_dir: ts_out.clone(),
            package_name: args
                .package_name
                .clone()
                .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id)),
            package_version: args.package_version.clone(),
            runtime_deps: ts_runtime_deps(
                args.runtime_source,
                args.runtime_version.clone(),
                args.runtime_repo_root.clone(),
            ),
        })
        .into_diagnostic()?;
    }

    if let Some(rust_out) = &args.rust_out {
        generate_rust_sdk(&GenerateRustSdkOpts {
            manifest_path: args.out_manifest.clone(),
            out_dir: rust_out.clone(),
            crate_name: args
                .crate_name
                .clone()
                .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id)),
            crate_version: args.crate_version.clone(),
            runtime_deps: rust_runtime_deps(
                args.runtime_source,
                args.runtime_version.clone(),
                args.runtime_repo_root.clone(),
            ),
        })
        .into_diagnostic()?;
    }

    output::print_success(&format!(
        "generated contract artifacts for {}",
        resolved.loaded.manifest.id
    ));
    output::print_info(&format!("manifest={}", args.out_manifest.display()));
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
    let connected = connect_cli_service(ServiceConnectOptions {
        servers: &args.servers,
        sentinel_creds_path: &creds,
        session_key_seed_base64url: &args.session_seed,
        timeout_ms: 5_000,
    })
    .await
    .into_diagnostic()?;

    let participant = connected.facade();
    let core_client = participant.core();
    let catalog = core_client.trellis_catalog().await.into_diagnostic()?.catalog;
    let mut verified = Vec::new();
    for (index, entry) in catalog.contracts.iter().enumerate() {
        if args.limit.is_some_and(|limit| index >= limit) {
            break;
        }
        let contract = core_client
            .trellis_contract_get(&trellis_cli_participant::uses::core::TrellisContractGetRequest {
                digest: entry.digest.clone(),
            })
            .await
            .into_diagnostic()?
            .contract;
        let computed = trellis_contracts::digest_json(
            &serde_json::to_value(&contract).into_diagnostic()?,
        )
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
    generate_ts_sdk(&GenerateTsSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        package_name,
        package_version: args.package_version.clone(),
        runtime_deps: ts_runtime_deps(
            args.runtime_source,
            args.runtime_version.clone(),
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
    generate_rust_sdk(&GenerateRustSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        crate_name,
        crate_version: args.crate_version.clone(),
        runtime_deps: rust_runtime_deps(
            args.runtime_source,
            args.runtime_version.clone(),
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
    let crate_name = args
        .crate_name
        .clone()
        .unwrap_or_else(|| format!("{}-participant", default_rust_crate_name_from_id(&resolved.loaded.manifest.id)));
    let owned_sdk_crate_name = args
        .owned_sdk_crate_name
        .clone()
        .or_else(|| {
            args.owned_sdk_path
                .as_ref()
                .map(|_| default_rust_crate_name_from_id(&resolved.loaded.manifest.id))
        });
    let alias_mappings = args
        .use_sdks
        .iter()
        .map(|value| parse_participant_alias_mapping(value))
        .collect::<miette::Result<Vec<_>>>()?;

    generate_rust_participant_facade(&GenerateRustParticipantFacadeOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        crate_name,
        crate_version: args.crate_version.clone(),
        runtime_deps: rust_runtime_deps(
            args.runtime_source,
            args.runtime_version.clone(),
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
    generate_ts_sdk(&GenerateTsSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.ts_out.clone(),
        package_name: args
            .package_name
            .clone()
            .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id)),
        package_version: args.package_version.clone(),
        runtime_deps: ts_runtime_deps(
            args.runtime_source,
            args.runtime_version.clone(),
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
        crate_version: args.crate_version.clone(),
        runtime_deps: rust_runtime_deps(
            args.runtime_source,
            args.runtime_version.clone(),
            args.runtime_repo_root.clone(),
        ),
    })
    .into_diagnostic()?;
    output::print_success("generated TypeScript and Rust SDKs");
    Ok(())
}

fn generate_session_keypair() -> (String, String) {
    let mut seed = [0u8; 32];
    OsRng.fill_bytes(&mut seed);
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
        vec!["kind".to_string(), loaded.manifest.kind.clone()],
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

async fn auth_login_command(
    format: OutputFormat,
    global_nats_servers: Option<String>,
    args: &AuthLoginArgs,
) -> miette::Result<()> {
    let nats_servers = resolve_servers(global_nats_servers, None);
    let challenge = authlib::start_browser_login(&authlib::StartBrowserLoginOpts {
        auth_url: &args.auth_url,
        provider: &args.provider,
        listen: &args.listen,
        contract_json: &cli_contract_json(),
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
        match connect_cli_admin(&state).await {
            Ok(connected) => {
                match connected.facade().auth().auth_logout().await {
                    Ok(response) => revoked = response.success,
                    Err(error) => revoke_error = Some(error.to_string()),
                }
            }
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
    let connected = connect_cli_admin(&state)
        .await
        .into_diagnostic()?;
    let participant = connected.facade();
    let me = participant.auth().auth_me().await.into_diagnostic()?.user;
    connected
        .renew_admin_session(&mut state)
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
    let connected = connect_cli_admin(&state)
        .await
        .into_diagnostic()?;
    let services = connected
        .facade()
        .auth()
        .auth_list_services()
        .await
        .into_diagnostic()?
        .services;
    connected
        .renew_admin_session(&mut state)
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
    let connected = connect_cli_admin(&state)
        .await
        .into_diagnostic()?;
    let participant = connected.facade();
    let approvals = participant
        .auth()
        .auth_list_approvals(&trellis_cli_participant::uses::auth::AuthListApprovalsRequest {
            user: args.user.clone(),
            digest: args.digest.clone(),
        })
        .await
        .into_diagnostic()?
        .approvals;
    connected
        .renew_admin_session(&mut state)
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
    let connected = connect_cli_admin(&state)
        .await
        .into_diagnostic()?;
    let participant = connected.facade();
    let success = participant
        .auth()
        .auth_revoke_approval(&trellis_cli_participant::uses::auth::AuthRevokeApprovalRequest {
            contract_digest: args.digest.clone(),
            user: args.user.clone(),
        })
        .await
        .into_diagnostic()?
        .success;
    connected
        .renew_admin_session(&mut state)
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
    let connected = connect_cli_admin(&state)
        .await
        .into_diagnostic()?;
    let participant = connected.facade();
    let contract = loaded
        .value
        .as_object()
        .cloned()
        .map(|contract| contract.into_iter().collect())
        .ok_or_else(|| miette::miette!("service contract payload must be a JSON object"))?;
    let rpc_result = participant
        .auth()
        .auth_install_service(&trellis_cli_participant::uses::auth::AuthInstallServiceRequest {
            session_key: session_key.clone(),
            display_name: display_name.clone(),
            active: Some(!args.inactive),
            namespaces: namespaces.clone(),
            description: description.clone(),
            contract,
        })
        .await;
    let renew_result = connected.renew_admin_session(&mut state).await;
    let response = rpc_result.into_diagnostic()?;
    if let Err(error) = renew_result {
        if output::is_json(format) {
            return Err(miette::miette!(error.to_string()));
        }
        output::print_info(&format!("warning: admin session was not renewed: {error}"));
    }

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
        output::print_info(&format!(
            "contractId={}",
            response.contract_id
        ));
        output::print_info(&format!(
            "contractDigest={}",
            response.contract_digest
        ));
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
    let connected = connect_cli_admin(&state)
        .await
        .into_diagnostic()?;
    let participant = connected.facade();
    let services = participant
        .auth()
        .auth_list_services()
        .await
        .into_diagnostic()?
        .services;
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
    let rpc_result = participant
        .auth()
        .auth_upgrade_service_contract(&trellis_cli_participant::uses::auth::AuthUpgradeServiceContractRequest {
            session_key: service_key.clone(),
            contract,
        })
        .await;
    let renew_result = connected.renew_admin_session(&mut state).await;
    let response = rpc_result.into_diagnostic()?;
    if let Err(error) = renew_result {
        if output::is_json(format) {
            return Err(miette::miette!(error.to_string()));
        }
        output::print_info(&format!("warning: admin session was not renewed: {error}"));
    }

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
        output::print_info(&format!(
            "contractId={}",
            response.contract_id
        ));
        output::print_info(&format!(
            "contractDigest={}",
            response.contract_digest
        ));
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
        "trellis-auth" => "@trellis/sdk-auth".to_string(),
        "trellis-activity" => "@trellis/sdk-activity".to_string(),
        "trellis-core" => "@trellis/sdk-core".to_string(),
        other => format!("@trellis/sdk-{other}"),
    }
}

fn default_rust_crate_name_from_id(contract_id: &str) -> String {
    trellis_codegen_rust::default_sdk_crate_name(contract_id)
}

fn parse_participant_alias_mapping(value: &str) -> miette::Result<ParticipantAliasMapping> {
    let mut parts = value.splitn(3, '=');
    let alias = parts.next().unwrap_or_default();
    let crate_name = parts.next().unwrap_or_default();
    let manifest_path = parts.next().unwrap_or_default();
    if alias.is_empty() || crate_name.is_empty() || manifest_path.is_empty() {
        return Err(miette::miette!(
            "invalid --use-sdk mapping '{value}'; expected ALIAS=CRATE=MANIFEST"
        ));
    }
    Ok(ParticipantAliasMapping {
        alias: alias.to_string(),
        crate_name: crate_name.to_string(),
        manifest_path: PathBuf::from(manifest_path),
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
