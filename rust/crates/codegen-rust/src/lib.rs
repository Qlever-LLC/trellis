//! Rust SDK generation from canonical Trellis contract manifests.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use trellis_contracts::{load_manifest, ContractUseRef};

/// Errors returned while generating a Rust SDK crate.
#[derive(thiserror::Error, Debug)]
pub enum CodegenRustError {
    #[error("contracts error: {0}")]
    Contracts(#[from] trellis_contracts::ContractsError),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("toml parse error: {0}")]
    Toml(#[from] toml::de::Error),

    #[error("missing runtime repo root for local runtime source")]
    MissingRuntimeRepoRoot,

    #[error("participant mapping alias '{alias}' is not declared in the participant uses")]
    UnknownParticipantMappingAlias { alias: String },

    #[error("participant uses alias '{alias}' for contract '{contract}' requires an explicit alias mapping")]
    MissingParticipantMappingAlias { alias: String, contract: String },

    #[error("participant mapping alias '{alias}' targets contract '{actual_contract}', expected '{expected_contract}'")]
    InvalidParticipantMappingContract {
        alias: String,
        expected_contract: String,
        actual_contract: String,
    },

    #[error("participant mapping alias '{alias}' does not expose rpc '{key}'")]
    MissingMappedRpc { alias: String, key: String },

    #[error("participant mapping alias '{alias}' does not expose operation '{key}'")]
    MissingMappedOperation { alias: String, key: String },

    #[error("participant mapping alias '{alias}' does not expose event '{key}'")]
    MissingMappedEvent { alias: String, key: String },

    #[error("participant mapping alias '{alias}' does not expose feed '{key}'")]
    MissingMappedFeed { alias: String, key: String },

    #[error("workspace does not declare package '{package_name}'")]
    MissingWorkspacePackage { package_name: String },

    #[error("workspace member '{member}' is missing a [package].name declaration")]
    MissingWorkspaceMemberPackageName { member: String },

    #[error("invalid generated Rust source for {path}: {message}")]
    RustSyntax { path: String, message: String },
}

/// Options for generating one Rust SDK crate.
#[derive(Debug, Clone)]
pub struct GenerateRustSdkOpts {
    /// Canonical contract manifest to load.
    pub manifest_path: PathBuf,
    /// Directory where the crate will be written.
    pub out_dir: PathBuf,
    /// Cargo crate name for the generated SDK.
    pub crate_name: String,
    /// Crate version written into `Cargo.toml`.
    pub crate_version: String,
    /// How generated code should depend on Trellis runtime crates.
    pub runtime_deps: RustRuntimeDeps,
}

/// One explicit `uses` alias mapping for participant-facade generation.
#[derive(Debug, Clone)]
pub struct ParticipantAliasMapping {
    /// Local `uses` alias from the participant manifest.
    pub alias: String,
    /// Crate name that satisfies the alias at compile time.
    pub crate_name: String,
    /// Manifest for the dependency crate; used to validate exposed RPCs/events.
    pub manifest_path: PathBuf,
    /// Optional local crate path override.
    ///
    /// When omitted, the generator assumes the dependency crate lives next to
    /// the provided manifest path.
    pub crate_path: Option<PathBuf>,
}

/// Options for generating one local Rust participant facade crate.
#[derive(Debug, Clone)]
pub struct GenerateRustParticipantFacadeOpts {
    /// Participant manifest that owns the facade.
    pub manifest_path: PathBuf,
    /// Output directory for the generated crate.
    pub out_dir: PathBuf,
    /// Cargo crate name for the facade crate.
    pub crate_name: String,
    /// Crate version written into `Cargo.toml`.
    pub crate_version: String,
    /// How generated code should depend on Trellis runtime crates.
    pub runtime_deps: RustRuntimeDeps,
    /// Optional owned SDK crate name to import from generated facade code.
    pub owned_sdk_crate_name: Option<String>,
    /// Optional path to the owned SDK crate used during local generation.
    pub owned_sdk_path: Option<PathBuf>,
    /// Explicit mappings for locally resolvable `uses` aliases declared by the participant.
    pub alias_mappings: Vec<ParticipantAliasMapping>,
}

/// Runtime dependency configuration for generated Rust SDKs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RustRuntimeDeps {
    /// Whether dependencies come from crates.io or the local repo.
    pub source: RustRuntimeSource,
    /// Version string used for registry dependencies.
    pub version: String,
    /// Repo root required when `source` is `Local`.
    pub repo_root: Option<PathBuf>,
}

/// Where generated SDKs should resolve Trellis runtime crates from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RustRuntimeSource {
    Registry,
    Local,
}

#[derive(Debug, Deserialize)]
struct WorkspaceManifest {
    workspace: WorkspaceSection,
}

#[derive(Debug, Deserialize)]
struct WorkspaceSection {
    members: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PackageManifest {
    package: Option<PackageSection>,
}

#[derive(Debug, Deserialize)]
struct PackageSection {
    name: String,
}

fn workspace_package_dir(
    repo_root: &Path,
    package_name: &str,
) -> Result<PathBuf, CodegenRustError> {
    let workspace_manifest_path = repo_root.join("rust/Cargo.toml");
    let workspace_manifest: WorkspaceManifest =
        toml::from_str(&fs::read_to_string(&workspace_manifest_path)?)?;

    for member in workspace_manifest.workspace.members {
        let member_manifest_path = repo_root.join("rust").join(&member).join("Cargo.toml");
        let member_manifest: PackageManifest =
            toml::from_str(&fs::read_to_string(&member_manifest_path)?)?;
        let package = member_manifest.package.ok_or_else(|| {
            CodegenRustError::MissingWorkspaceMemberPackageName {
                member: member.clone(),
            }
        })?;
        if package.name == package_name {
            return Ok(member_manifest_path
                .parent()
                .expect("Cargo.toml should always have a parent directory")
                .to_path_buf());
        }
    }

    Err(CodegenRustError::MissingWorkspacePackage {
        package_name: package_name.to_string(),
    })
}

/// Derive the default Rust SDK crate name for a contract id.
pub fn default_sdk_crate_name(contract_id: &str) -> String {
    format!("trellis-sdk-{}", default_sdk_stem(contract_id))
}

/// Derive the default Rust SDK stem used for crate and facade naming.
pub fn default_sdk_stem(contract_id: &str) -> String {
    let stem = contract_id
        .split('@')
        .next()
        .unwrap_or("trellis-sdk")
        .replace('.', "-");
    stem.strip_prefix("trellis-").unwrap_or(&stem).to_string()
}

/// Generate a Rust SDK crate for one manifest.
pub fn generate_rust_sdk(opts: &GenerateRustSdkOpts) -> Result<(), CodegenRustError> {
    let loaded = load_manifest(&opts.manifest_path)?;

    fs::create_dir_all(opts.out_dir.join("src"))?;
    write_if_changed(
        &opts.out_dir.join("Cargo.toml"),
        &render_cargo_toml(opts, !loaded.manifest.feeds.is_empty()),
    )?;
    write_runtime_patch_config(opts)?;
    write_rust_if_changed(
        &opts.out_dir.join("src").join("contract.rs"),
        &render_contract_rs(opts, &loaded),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src").join("types.rs"),
        &render_types_rs(&loaded),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src").join("rpc.rs"),
        &render_rpc_rs(&loaded),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src").join("operations.rs"),
        &render_operations_rs(&loaded),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src").join("events.rs"),
        &render_events_rs(&loaded),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src").join("feeds.rs"),
        &render_feeds_rs(&loaded),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src").join("client.rs"),
        &render_client_rs(&loaded),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src").join("server.rs"),
        &render_server_rs(&loaded),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src").join("lib.rs"),
        &render_lib_rs(&loaded),
    )?;

    Ok(())
}

/// Validate the minimal generated Rust SDK manifest invariants used by freshness checks.
pub fn rust_sdk_cargo_manifest_is_valid(
    cargo_toml_path: &Path,
    crate_name: &str,
    crate_version: &str,
) -> bool {
    let Ok(contents) = fs::read_to_string(cargo_toml_path) else {
        return false;
    };
    let Ok(manifest) = contents.parse::<toml::Table>() else {
        return false;
    };
    let Some(package) = manifest.get("package").and_then(toml::Value::as_table) else {
        return false;
    };
    let Some(dependencies) = manifest.get("dependencies").and_then(toml::Value::as_table) else {
        return false;
    };

    package.get("name").and_then(toml::Value::as_str) == Some(crate_name)
        && package.get("version").and_then(toml::Value::as_str) == Some(crate_version)
        && [
            "serde",
            "serde_json",
            "trellis-client",
            "trellis-contracts",
            "trellis-service",
        ]
        .into_iter()
        .all(|dependency| dependencies.contains_key(dependency))
}

/// Generate only the build-time Rust sources for a participant facade.
///
/// This is used from generated `build.rs` code after the crate skeleton and
/// copied manifests already exist on disk.
pub fn generate_rust_participant_generated_sources(
    opts: &GenerateRustParticipantFacadeOpts,
) -> Result<(), CodegenRustError> {
    let loaded = load_manifest(&opts.manifest_path)?;
    let mappings = validate_participant_mappings(&loaded, &opts.alias_mappings)?;

    fs::create_dir_all(opts.out_dir.join("src/uses"))?;
    write_rust_if_changed(
        &opts.out_dir.join("src/facade.rs"),
        &render_participant_facade_rs(&loaded, &mappings),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src/owned.rs"),
        &render_participant_owned_rs(&loaded, opts.owned_sdk_crate_name.as_deref()),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src/state.rs"),
        &render_participant_state_rs(&loaded),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src/uses/mod.rs"),
        &render_participant_uses_mod_rs(&mappings),
    )?;

    for mapping in &mappings {
        write_rust_if_changed(
            &opts
                .out_dir
                .join("src/uses")
                .join(format!("{}.rs", key_to_snake(&mapping.alias))),
            &render_participant_use_alias_rs(mapping),
        )?;
    }

    Ok(())
}

/// Generate a complete local Rust participant-facade crate.
///
/// The facade crate wraps one owned participant contract plus explicit `uses`
/// alias mappings so local development can type-check the full integration.
pub fn generate_rust_participant_facade(
    opts: &GenerateRustParticipantFacadeOpts,
) -> Result<(), CodegenRustError> {
    let loaded = load_manifest(&opts.manifest_path)?;
    let mappings = validate_participant_mappings(&loaded, &opts.alias_mappings)?;
    let manifest_file_name = opts
        .manifest_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("participant.contract.json")
        .to_string();

    let contracts_dir = opts.out_dir.join("contracts");
    if contracts_dir.exists() {
        fs::remove_dir_all(&contracts_dir)?;
    }
    fs::create_dir_all(opts.out_dir.join("src"))?;
    fs::create_dir_all(&contracts_dir)?;
    write_if_changed(
        &opts.out_dir.join("Cargo.toml"),
        &render_participant_cargo_toml(opts, &mappings, !loaded.manifest.feeds.is_empty()),
    )?;
    write_runtime_patch_config_for_participant(opts)?;
    fs::copy(&opts.manifest_path, opts.out_dir.join(&manifest_file_name))?;
    for mapping in &mappings {
        fs::copy(
            &mapping.manifest.path,
            contracts_dir.join(format!("{}.json", mapping.alias_ident)),
        )?;
    }
    write_rust_if_changed(
        &opts.out_dir.join("build.rs"),
        &render_participant_build_rs(opts, &mappings, &manifest_file_name),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src/lib.rs"),
        &render_participant_shim_lib_rs(),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src/connect.rs"),
        &render_participant_connect_rs(),
    )?;
    write_rust_if_changed(
        &opts.out_dir.join("src/contract.rs"),
        &render_participant_contract_rs(&loaded, &manifest_file_name),
    )?;

    Ok(())
}

fn render_cargo_toml(opts: &GenerateRustSdkOpts, has_feeds: bool) -> String {
    let mut dependency_lines = runtime_dependency_lines(&opts.runtime_deps);
    if has_feeds {
        dependency_lines.push("futures-util = \"0.3\"".to_string());
    }
    dependency_lines.sort();
    let description = format!("Generated Rust SDK crate for {}.", opts.crate_name);
    format!(
        "[package]\nname = \"{}\"\nversion = \"{}\"\nedition = \"2021\"\nlicense = \"Apache-2.0\"\nrepository = \"https://github.com/qlever-llc/trellis\"\ndescription = \"{}\"\n\n[dependencies]\nserde = {{ version = \"1.0\", features = [\"derive\"] }}\nserde_json = \"1.0\"\n{}\n",
        opts.crate_name,
        opts.crate_version,
        description,
        dependency_lines.join("\n"),
    )
}

fn runtime_dependency_lines(runtime_deps: &RustRuntimeDeps) -> Vec<String> {
    match runtime_deps.source {
        RustRuntimeSource::Registry => vec![
            format!("trellis-client = \"{}\"", runtime_deps.version),
            format!("trellis-contracts = \"{}\"", runtime_deps.version),
            format!("trellis-service = \"{}\"", runtime_deps.version),
        ],
        RustRuntimeSource::Local => {
            let repo_root = runtime_deps
                .repo_root
                .as_ref()
                .expect("local runtime source requires repo root");
            let repo_root = fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.clone());
            ["trellis-client", "trellis-contracts", "trellis-service"]
                .into_iter()
                .map(|crate_name| {
                    let crate_path = workspace_package_dir(&repo_root, crate_name)
                        .unwrap_or_else(|error| panic!("{error}"));
                    format!(
                        "{crate_name} = {{ path = {} }}",
                        string_literal(&crate_path.display().to_string())
                    )
                })
                .collect()
        }
    }
}

#[derive(Debug, Clone)]
struct ValidatedParticipantAlias {
    alias: String,
    alias_ident: String,
    crate_name: String,
    crate_ident: String,
    crate_path: PathBuf,
    contract_id: String,
    manifest: trellis_contracts::LoadedManifest,
    use_ref: ContractUseRef,
}

fn validate_participant_mappings(
    local: &trellis_contracts::LoadedManifest,
    mappings: &[ParticipantAliasMapping],
) -> Result<Vec<ValidatedParticipantAlias>, CodegenRustError> {
    let mut validated = Vec::new();
    let mut mapped_aliases = std::collections::BTreeSet::new();

    for mapping in mappings {
        let use_ref = local.manifest.uses.get(&mapping.alias).ok_or_else(|| {
            CodegenRustError::UnknownParticipantMappingAlias {
                alias: mapping.alias.clone(),
            }
        })?;
        let manifest = load_manifest(&mapping.manifest_path)?;
        if manifest.manifest.id != use_ref.contract {
            return Err(CodegenRustError::InvalidParticipantMappingContract {
                alias: mapping.alias.clone(),
                expected_contract: use_ref.contract.clone(),
                actual_contract: manifest.manifest.id.clone(),
            });
        }

        if let Some(rpc) = &use_ref.rpc {
            for key in rpc.call.as_deref().unwrap_or(&[]) {
                if !manifest.manifest.rpc.contains_key(key) {
                    return Err(CodegenRustError::MissingMappedRpc {
                        alias: mapping.alias.clone(),
                        key: key.clone(),
                    });
                }
            }
        }
        if let Some(operations) = &use_ref.operations {
            for key in operations.call.as_deref().unwrap_or(&[]) {
                if !manifest.manifest.operations.contains_key(key) {
                    return Err(CodegenRustError::MissingMappedOperation {
                        alias: mapping.alias.clone(),
                        key: key.clone(),
                    });
                }
            }
        }
        if let Some(events) = &use_ref.events {
            for key in events.publish.as_deref().unwrap_or(&[]) {
                if !manifest.manifest.events.contains_key(key) {
                    return Err(CodegenRustError::MissingMappedEvent {
                        alias: mapping.alias.clone(),
                        key: key.clone(),
                    });
                }
            }
            for key in events.subscribe.as_deref().unwrap_or(&[]) {
                if !manifest.manifest.events.contains_key(key) {
                    return Err(CodegenRustError::MissingMappedEvent {
                        alias: mapping.alias.clone(),
                        key: key.clone(),
                    });
                }
            }
        }
        if let Some(feeds) = &use_ref.feeds {
            for key in feeds.subscribe.as_deref().unwrap_or(&[]) {
                if !manifest.manifest.feeds.contains_key(key) {
                    return Err(CodegenRustError::MissingMappedFeed {
                        alias: mapping.alias.clone(),
                        key: key.clone(),
                    });
                }
            }
        }
        validated.push(ValidatedParticipantAlias {
            alias: mapping.alias.clone(),
            alias_ident: rust_ident(&key_to_snake(&mapping.alias)),
            crate_name: mapping.crate_name.clone(),
            crate_ident: crate_ident(&mapping.crate_name),
            crate_path: mapping.crate_path.clone().unwrap_or_else(|| {
                mapping
                    .manifest_path
                    .parent()
                    .unwrap_or(Path::new("."))
                    .to_path_buf()
            }),
            contract_id: manifest.manifest.id.clone(),
            manifest,
            use_ref: use_ref.clone(),
        });
        mapped_aliases.insert(mapping.alias.clone());
    }

    for (alias, use_ref) in local.manifest.uses.iter() {
        if !mapped_aliases.contains(alias)
            && participant_use_requires_mapping(local, alias, use_ref)
        {
            return Err(CodegenRustError::MissingParticipantMappingAlias {
                alias: alias.clone(),
                contract: use_ref.contract.clone(),
            });
        }
    }

    validated.sort_by(|left, right| left.alias.cmp(&right.alias));
    Ok(validated)
}

/// Return whether a participant `uses` alias requires an explicit local SDK mapping.
pub fn participant_use_requires_mapping(
    local: &trellis_contracts::LoadedManifest,
    alias: &str,
    use_ref: &ContractUseRef,
) -> bool {
    !is_runtime_owned_baseline_use(local, alias, use_ref)
}

fn is_runtime_owned_baseline_use(
    local: &trellis_contracts::LoadedManifest,
    alias: &str,
    use_ref: &ContractUseRef,
) -> bool {
    if alias == "health"
        && use_ref.contract == "trellis.health@v1"
        && use_ref.rpc.is_none()
        && use_ref.operations.is_none()
    {
        return use_ref.events.as_ref().is_some_and(|events| {
            events.subscribe.as_deref().unwrap_or(&[]).is_empty()
                && events.publish.as_deref().unwrap_or(&[]) == ["Health.Heartbeat"]
        });
    }

    if alias == "state"
        && use_ref.contract == "trellis.state@v1"
        && !local.manifest.state.is_empty()
        && use_ref.operations.is_none()
        && use_ref.events.is_none()
    {
        return use_ref.rpc.as_ref().is_some_and(|rpc| {
            rpc.call.as_deref().unwrap_or(&[]).iter().all(|key| {
                matches!(
                    key.as_str(),
                    "State.Get" | "State.Put" | "State.Delete" | "State.List"
                )
            })
        });
    }

    false
}

fn render_participant_cargo_toml(
    opts: &GenerateRustParticipantFacadeOpts,
    mappings: &[ValidatedParticipantAlias],
    has_owned_feeds: bool,
) -> String {
    let mut dependency_lines = runtime_dependency_lines(&opts.runtime_deps);
    if has_owned_feeds
        || mappings.iter().any(|mapping| {
            let subscribes_events = mapping
                .use_ref
                .events
                .as_ref()
                .and_then(|events| events.subscribe.as_ref())
                .is_some_and(|subscribe| !subscribe.is_empty());
            let subscribes_feeds = mapping
                .use_ref
                .feeds
                .as_ref()
                .and_then(|feeds| feeds.subscribe.as_ref())
                .is_some_and(|subscribe| !subscribe.is_empty());
            subscribes_events || subscribes_feeds
        })
    {
        dependency_lines.push("futures-util = \"0.3\"".to_string());
    }
    if let (Some(crate_name), Some(path)) = (&opts.owned_sdk_crate_name, &opts.owned_sdk_path) {
        let path = fs::canonicalize(path).unwrap_or_else(|_| path.clone());
        dependency_lines.push(format!(
            "{} = {{ path = {} }}",
            crate_name,
            string_literal(&path.display().to_string())
        ));
    }
    for mapping in mappings {
        let path =
            fs::canonicalize(&mapping.crate_path).unwrap_or_else(|_| mapping.crate_path.clone());
        dependency_lines.push(format!(
            "{} = {{ path = {} }}",
            mapping.crate_name,
            string_literal(&path.display().to_string())
        ));
    }
    dependency_lines.sort();

    let build_dependency = match opts.runtime_deps.source {
        RustRuntimeSource::Registry => {
            format!("trellis-codegen-rust = \"{}\"", env!("CARGO_PKG_VERSION"))
        }
        RustRuntimeSource::Local => {
            let repo_root = opts
                .runtime_deps
                .repo_root
                .as_ref()
                .expect("local participant facade generation requires repo root");
            let repo_root = fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.clone());
            let crate_path = workspace_package_dir(&repo_root, env!("CARGO_PKG_NAME"))
                .unwrap_or_else(|error| panic!("{error}"));
            format!(
                "trellis-codegen-rust = {{ path = {} }}",
                string_literal(&crate_path.display().to_string())
            )
        }
    };

    format!(
        "[package]\nname = \"{}\"\nversion = \"{}\"\nedition = \"2021\"\nlicense = \"Apache-2.0\"\nbuild = \"build.rs\"\n\n[build-dependencies]\n{}\n\n[dependencies]\nserde = {{ version = \"1.0\", features = [\"derive\"] }}\nserde_json = \"1.0\"\n{}\n",
        opts.crate_name,
        opts.crate_version,
        build_dependency,
        dependency_lines.join("\n")
    )
}

fn render_participant_build_rs(
    opts: &GenerateRustParticipantFacadeOpts,
    mappings: &[ValidatedParticipantAlias],
    manifest_file_name: &str,
) -> String {
    let mut mapping_entries = Vec::new();
    for mapping in mappings {
        mapping_entries.push(format!(
            "trellis_codegen_rust::ParticipantAliasMapping {{ alias: {}.to_string(), crate_name: {}.to_string(), manifest_path: manifest_dir.join(\"contracts/{}.json\"), crate_path: Some(manifest_dir.join({})) }}",
            string_literal(&mapping.alias),
            string_literal(&mapping.crate_name),
            mapping.alias_ident,
            string_literal(&mapping.crate_path.display().to_string()),
        ));
    }

    let owned_sdk_crate_name = opts
        .owned_sdk_crate_name
        .as_ref()
        .map(|value| format!("Some({})", string_literal(value)))
        .unwrap_or_else(|| "None".to_string());
    let owned_sdk_path = opts
        .owned_sdk_path
        .as_ref()
        .map(|path| {
            format!(
                "Some(manifest_dir.join({}))",
                string_literal(&path.display().to_string())
            )
        })
        .unwrap_or_else(|| "None".to_string());
    let runtime_source = match opts.runtime_deps.source {
        RustRuntimeSource::Registry => "Registry",
        RustRuntimeSource::Local => "Local",
    };
    let runtime_repo_root = opts
        .runtime_deps
        .repo_root
        .as_ref()
        .map(|path| {
            format!(
                "Some(manifest_dir.join({}))",
                string_literal(&path.display().to_string())
            )
        })
        .unwrap_or_else(|| "None".to_string());

    format!(
        "use std::env;\nuse std::path::PathBuf;\n\nfn main() {{\n    let manifest_dir = PathBuf::from(env::var(\"CARGO_MANIFEST_DIR\").expect(\"manifest dir\"));\n    let out_dir = PathBuf::from(env::var(\"OUT_DIR\").expect(\"out dir\")).join(\"generated\");\n\n    println!(\"cargo:rerun-if-changed={}\");\n{}\n\n    trellis_codegen_rust::generate_rust_participant_generated_sources(&trellis_codegen_rust::GenerateRustParticipantFacadeOpts {{\n        manifest_path: manifest_dir.join({}),\n        out_dir,\n        crate_name: {}.to_string(),\n        crate_version: {}.to_string(),\n        runtime_deps: trellis_codegen_rust::RustRuntimeDeps {{\n            source: trellis_codegen_rust::RustRuntimeSource::{},\n            version: {}.to_string(),\n            repo_root: {},\n        }},\n        owned_sdk_crate_name: {},\n        owned_sdk_path: {},\n        alias_mappings: vec![{}],\n    }}).expect(\"generate participant facade\");\n}}\n",
        manifest_file_name,
        mappings
            .iter()
            .map(|mapping| format!(
                "    println!(\"cargo:rerun-if-changed=contracts/{}.json\");",
                mapping.alias_ident
            ))
            .collect::<Vec<_>>()
            .join("\n"),
        string_literal(manifest_file_name),
        string_literal(&opts.crate_name),
        string_literal(&opts.crate_version),
        runtime_source,
        string_literal(&opts.runtime_deps.version),
        runtime_repo_root,
        owned_sdk_crate_name,
        owned_sdk_path,
        mapping_entries.join(", "),
    )
}

fn render_participant_shim_lib_rs() -> String {
    "//! Generated Rust participant facade crate.\n\npub mod connect;\npub mod contract;\ninclude!(concat!(env!(\"OUT_DIR\"), \"/generated/src/facade.rs\"));\npub use connect::{connect_service, connect_user, ConnectedClient};\n".to_string()
}

fn render_participant_connect_rs() -> String {
    "//! Generic connection helpers for the local participant facade.\n\nuse trellis_client::{ServiceConnectOptions, TrellisClient, TrellisClientError, UserConnectOptions};\n\nuse crate::Client;\n\npub struct ConnectedClient { inner: TrellisClient }\n\nimpl ConnectedClient {\n    pub fn new(inner: TrellisClient) -> Self { Self { inner } }\n    pub fn facade(&self) -> Client<'_> { Client::new(&self.inner) }\n    pub fn raw(&self) -> &TrellisClient { &self.inner }\n}\n\npub async fn connect_service(opts: ServiceConnectOptions<'_>) -> Result<ConnectedClient, TrellisClientError> {\n    Ok(ConnectedClient::new(TrellisClient::connect_service(opts).await?))\n}\n\npub async fn connect_user(opts: UserConnectOptions<'_>) -> Result<ConnectedClient, TrellisClientError> {\n    Ok(ConnectedClient::new(TrellisClient::connect_user(opts).await?))\n}\n".to_string()
}

fn render_participant_contract_rs(
    loaded: &trellis_contracts::LoadedManifest,
    manifest_file_name: &str,
) -> String {
    format!(
        "//! Contract metadata for `{}`.\n\nuse trellis_contracts::ContractManifest;\n\npub const CONTRACT_ID: &str = {};\npub const CONTRACT_DIGEST: &str = {};\npub const CONTRACT_NAME: &str = {};\n\npub fn contract_manifest() -> ContractManifest {{\n    serde_json::from_str(include_str!(concat!(\"../\", {}))).expect(\"participant manifest\")\n}}\n\npub fn contract_json() -> String {{\n    include_str!(concat!(\"../\", {})).trim().to_string()\n}}\n",
        loaded.manifest.id,
        string_literal(&loaded.manifest.id),
        string_literal(&loaded.digest),
        string_literal(&loaded.manifest.display_name),
        string_literal(manifest_file_name),
        string_literal(manifest_file_name),
    )
}

fn write_runtime_patch_config_for_participant(
    opts: &GenerateRustParticipantFacadeOpts,
) -> Result<(), CodegenRustError> {
    let sdk_opts = GenerateRustSdkOpts {
        manifest_path: opts.manifest_path.clone(),
        out_dir: opts.out_dir.clone(),
        crate_name: opts.crate_name.clone(),
        crate_version: opts.crate_version.clone(),
        runtime_deps: opts.runtime_deps.clone(),
    };
    write_runtime_patch_config(&sdk_opts)
}

fn render_participant_facade_rs(
    _loaded: &trellis_contracts::LoadedManifest,
    mappings: &[ValidatedParticipantAlias],
) -> String {
    let mut lines = vec![
        "pub mod owned {".to_string(),
        "    include!(concat!(env!(\"OUT_DIR\"), \"/generated/src/owned.rs\"));".to_string(),
        "}".to_string(),
        String::new(),
        "pub mod state {".to_string(),
        "    include!(concat!(env!(\"OUT_DIR\"), \"/generated/src/state.rs\"));".to_string(),
        "}".to_string(),
        String::new(),
        "pub mod uses {".to_string(),
    ];
    for mapping in mappings {
        lines.push(format!("    pub mod {} {{", mapping.alias_ident));
        lines.push(format!(
            "        include!(concat!(env!(\"OUT_DIR\"), \"/generated/src/uses/{}.rs\"));",
            mapping.alias_ident
        ));
        lines.push("    }".to_string());
    }
    lines.extend([
        "}".to_string(),
        String::new(),
        "/// Contract-shaped outbound facade for this participant.".to_string(),
        "pub struct Client<'a> {".to_string(),
        "    inner: &'a trellis_client::TrellisClient,".to_string(),
        "}".to_string(),
        String::new(),
        "/// Service-side facade for owned handlers plus outbound alias access.".to_string(),
        "pub struct Service<'a> {".to_string(),
        "    inner: &'a trellis_client::TrellisClient,".to_string(),
        "}".to_string(),
        String::new(),
        "impl<'a> Client<'a> {".to_string(),
        "    /// Wrap an already connected low-level Trellis client.".to_string(),
        "    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self { Self { inner } }"
            .to_string(),
        "    /// Access the participant's owned contract surface.".to_string(),
        "    pub fn owned(&self) -> owned::Client<'a> { owned::Client::new(self.inner) }"
            .to_string(),
        "    /// Access typed state stores declared by this participant.".to_string(),
        "    pub fn state(&self) -> state::State<'a> { state::State::new(self.inner) }".to_string(),
    ]);
    for mapping in mappings {
        lines.push(format!(
            "    /// Access the `{}` dependency alias facade.",
            mapping.alias
        ));
        lines.push(format!(
            "    pub fn {}(&self) -> uses::{}::Client<'a> {{ uses::{}::Client::new(self.inner) }}",
            mapping.alias_ident, mapping.alias_ident, mapping.alias_ident
        ));
    }
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push("impl<'a> Service<'a> {".to_string());
    lines.push(
        "    /// Wrap an already connected low-level Trellis client for outbound service calls."
            .to_string(),
    );
    lines.push(
        "    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self { Self { inner } }"
            .to_string(),
    );
    lines.push("    /// Access owned handler and publish helpers.".to_string());
    lines.push(
        "    pub fn owned(&self) -> owned::Service<'a> { owned::Service::new(self.inner) }"
            .to_string(),
    );
    for mapping in mappings {
        lines.push(format!(
            "    /// Access the `{}` dependency alias facade for outbound calls.",
            mapping.alias
        ));
        lines.push(format!(
            "    pub fn {}(&self) -> uses::{}::Client<'a> {{ uses::{}::Client::new(self.inner) }}",
            mapping.alias_ident, mapping.alias_ident, mapping.alias_ident
        ));
    }
    lines.push("}".to_string());
    lines.push(String::new());
    format!("{}\n", lines.join("\n"))
}

fn render_participant_owned_rs(
    loaded: &trellis_contracts::LoadedManifest,
    owned_sdk_crate_name: Option<&str>,
) -> String {
    if loaded.manifest.rpc.is_empty()
        && loaded.manifest.events.is_empty()
        && loaded.manifest.feeds.is_empty()
    {
        return format!(
            "/// Owned facade for `{}`.\n/// Reusable owned contract vocabulary for this participant.\npub struct OwnedContract;\n\nimpl OwnedContract {{\n    pub const CONTRACT_ID: &'static str = {};\n    pub const CONTRACT_NAME: &'static str = {};\n    pub const CONTRACT_DIGEST: &'static str = {};\n    pub fn manifest() -> trellis_contracts::ContractManifest {{ serde_json::from_str(r#\"{}\"#).expect(\"participant manifest\") }}\n}}\n\npub struct Client<'a> {{ _inner: &'a trellis_client::TrellisClient }}\nimpl<'a> Client<'a> {{ pub fn new(inner: &'a trellis_client::TrellisClient) -> Self {{ Self {{ _inner: inner }} }} }}\n\npub struct Service<'a> {{ _inner: &'a trellis_client::TrellisClient }}\nimpl<'a> Service<'a> {{ pub fn new(inner: &'a trellis_client::TrellisClient) -> Self {{ Self {{ _inner: inner }} }} }}\n",
            loaded.manifest.id,
            string_literal(&loaded.manifest.id),
            string_literal(&loaded.manifest.display_name),
            string_literal(&loaded.digest),
            loaded.canonical,
        );
    }

    let owned_sdk_crate_name = owned_sdk_crate_name.expect("owned sdk crate required");
    let owned_crate_ident = crate_ident(owned_sdk_crate_name);
    let owned_client_name = format!("{}Client", sdk_stem_pascal(loaded));
    let mut lines = vec![
        format!("/// Owned facade for `{}`.", loaded.manifest.id),
        String::new(),
        format!("use {} as sdk;", owned_crate_ident),
        String::new(),
        "/// Reusable owned contract vocabulary for this participant.".to_string(),
        "pub struct OwnedContract;".to_string(),
        String::new(),
        "impl OwnedContract {".to_string(),
        "    pub const CONTRACT_ID: &'static str = sdk::CONTRACT_ID;".to_string(),
        "    pub const CONTRACT_NAME: &'static str = sdk::CONTRACT_NAME;".to_string(),
        "    pub const CONTRACT_DIGEST: &'static str = sdk::CONTRACT_DIGEST;".to_string(),
        "    pub fn manifest() -> trellis_contracts::ContractManifest { sdk::contract_manifest() }"
            .to_string(),
        "}".to_string(),
        String::new(),
        "pub struct Client<'a> { inner: sdk::".to_string() + &owned_client_name + "<'a> }",
        "impl<'a> Client<'a> {".to_string(),
        "    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self { Self { inner: sdk::"
            .to_string()
            + &owned_client_name
            + "::new(inner) } }",
    ];
    for key in loaded.manifest.rpc.keys() {
        let method = key_to_snake(key);
        let base = key_to_pascal(key);
        let input_empty = is_empty_object_schema(resolve_schema_ref(
            loaded,
            &loaded.manifest.rpc[key].input.schema,
        ));
        let output_type = if is_empty_object_schema(resolve_schema_ref(
            loaded,
            &loaded.manifest.rpc[key].output.schema,
        )) {
            "sdk::rpc::Empty".to_string()
        } else {
            format!("sdk::{base}Response")
        };
        if input_empty {
            lines.push(format!("    pub async fn {method}(&self) -> Result<{output_type}, trellis_client::TrellisClientError> {{ self.inner.{method}().await }}"));
        } else {
            lines.push(format!("    pub async fn {method}(&self, input: &sdk::{base}Request) -> Result<{output_type}, trellis_client::TrellisClientError> {{ self.inner.{method}(input).await }}"));
        }
    }
    for key in loaded.manifest.events.keys() {
        let method = format!("publish_{}", key_to_snake(key));
        let base = key_to_pascal(key);
        lines.push(format!("    pub async fn {method}(&self, event: &sdk::{base}Event) -> Result<(), trellis_client::TrellisClientError> {{ self.inner.{method}(event).await }}"));
    }
    for (key, feed) in &loaded.manifest.feeds {
        let method = key_to_snake(key);
        let base = key_to_pascal(key);
        if is_empty_object_schema(resolve_schema_ref(loaded, &feed.input.schema)) {
            lines.push(format!("    pub async fn {method}(&self) -> Result<futures_util::stream::BoxStream<'static, Result<sdk::{base}Event, trellis_client::TrellisClientError>>, trellis_client::TrellisClientError> {{ self.inner.{method}().await }}"));
        } else {
            lines.push(format!("    pub async fn {method}(&self, input: &sdk::{base}Input) -> Result<futures_util::stream::BoxStream<'static, Result<sdk::{base}Event, trellis_client::TrellisClientError>>, trellis_client::TrellisClientError> {{ self.inner.{method}(input).await }}"));
        }
    }
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push("pub struct Service<'a> { inner: &'a trellis_client::TrellisClient }".to_string());
    lines.push("impl<'a> Service<'a> {".to_string());
    lines.push(
        "    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self { Self { inner } }"
            .to_string(),
    );
    lines.push("    pub fn client(&self) -> Client<'a> { Client::new(self.inner) }".to_string());
    for key in loaded.manifest.rpc.keys() {
        let method = format!("register_{}", key_to_snake(key));
        let base = key_to_pascal(key);
        let input_type = if is_empty_object_schema(resolve_schema_ref(
            loaded,
            &loaded.manifest.rpc[key].input.schema,
        )) {
            "sdk::rpc::Empty".to_string()
        } else {
            format!("sdk::{base}Request")
        };
        let output_type = if is_empty_object_schema(resolve_schema_ref(
            loaded,
            &loaded.manifest.rpc[key].output.schema,
        )) {
            "sdk::rpc::Empty".to_string()
        } else {
            format!("sdk::{base}Response")
        };
        lines.push(format!("    pub fn {method}<F, Fut>(&self, router: &mut trellis_service::Router, handler: F) where F: Fn(trellis_service::RequestContext, {input_type}) -> Fut + Send + Sync + 'static, Fut: std::future::Future<Output = trellis_service::HandlerResult<{output_type}>> + Send + 'static {{ sdk::server::{method}(router, handler); }}"));
    }
    for key in loaded.manifest.events.keys() {
        let method = format!("publish_{}", key_to_snake(key));
        let base = key_to_pascal(key);
        lines.push(format!("    pub async fn {method}(&self, publisher: &trellis_service::EventPublisher, event: &sdk::{base}Event) -> Result<(), trellis_service::ServerError> {{ sdk::server::{method}(publisher, event).await }}"));
    }
    for (key, feed) in &loaded.manifest.feeds {
        let method = format!("register_{}", key_to_snake(key));
        let base = key_to_pascal(key);
        let input_type = if is_empty_object_schema(resolve_schema_ref(loaded, &feed.input.schema)) {
            "sdk::rpc::Empty".to_string()
        } else {
            format!("sdk::{base}Input")
        };
        lines.push(format!("    pub fn {method}<F, S>(&self, router: &mut trellis_service::Router, handler: F) where F: Fn(trellis_service::RequestContext, {input_type}) -> S + Send + Sync + 'static, S: futures_util::Stream<Item = Result<sdk::{base}Event, trellis_service::ServerError>> + Send + 'static {{ sdk::server::{method}(router, handler); }}"));
    }
    lines.push("}".to_string());
    lines.push(String::new());
    format!("{}\n", lines.join("\n"))
}

fn render_participant_state_rs(loaded: &trellis_contracts::LoadedManifest) -> String {
    let mut renderer = TypeRenderer::default();
    let mut stores = loaded.manifest.state.iter().collect::<Vec<_>>();
    stores.sort_by(|left, right| left.0.cmp(right.0));

    let schema_names = stores
        .iter()
        .map(|(_, store)| store.schema.schema.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let mut used_type_names = std::collections::BTreeSet::new();
    let mut schema_type_names = std::collections::BTreeMap::new();
    for schema_name in schema_names {
        let base = state_type_name(&schema_name);
        let mut candidate = base.clone();
        let mut suffix = 2;
        while used_type_names.contains(&candidate) {
            candidate = format!("{base}{suffix}");
            suffix += 1;
        }
        used_type_names.insert(candidate.clone());
        schema_type_names.insert(schema_name, candidate);
    }

    for (_, store) in &stores {
        let type_name = schema_type_names
            .get(&store.schema.schema)
            .expect("state schema type name");
        renderer.render_named_type(type_name, resolve_schema_ref(loaded, &store.schema.schema));
    }

    let rendered = renderer.finish();
    let mut lines = vec![format!(
        "// Typed state store helpers for `{}`.",
        loaded.manifest.id
    )];

    if !rendered.is_empty() {
        lines.push(String::new());
        lines.push("use serde::{Deserialize, Serialize};".to_string());
        if rendered.iter().any(|line| line.contains("Value")) {
            lines.push("use serde_json::Value;".to_string());
        }
        if rendered.iter().any(|line| line.contains("BTreeMap<")) {
            lines.push("use std::collections::BTreeMap;".to_string());
        }
    }

    lines.push(String::new());
    lines.push("/// Typed access to state stores declared by this participant.".to_string());
    lines.push("pub struct State<'a> {".to_string());
    lines.push("    inner: &'a trellis_client::TrellisClient,".to_string());
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push("impl<'a> State<'a> {".to_string());
    lines.push("    /// Wrap an already connected low-level Trellis client.".to_string());
    lines.push(
        "    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self { Self { inner } }"
            .to_string(),
    );

    for (name, store) in stores {
        let method_name = rust_ident(&key_to_snake(name));
        let ty = schema_type_names
            .get(&store.schema.schema)
            .expect("state schema type name");
        match &store.kind {
            trellis_contracts::ContractStateKind::Value => {
                lines.push(format!("    /// Access the `{name}` value state store."));
                lines.push(format!("    pub fn {method_name}(&self) -> trellis_client::ValueStateStore<'a, trellis_client::TrellisClient, {ty}> {{"));
                lines.push(format!(
                    "        trellis_client::ValueStateStore::new(self.inner, {})",
                    string_literal(name)
                ));
                lines.push("    }".to_string());
            }
            trellis_contracts::ContractStateKind::Map => {
                lines.push(format!("    /// Access the `{name}` map state store."));
                lines.push(format!("    pub fn {method_name}(&self) -> trellis_client::MapStateStore<'a, trellis_client::TrellisClient, {ty}> {{"));
                lines.push(format!(
                    "        trellis_client::MapStateStore::new(self.inner, {})",
                    string_literal(name)
                ));
                lines.push("    }".to_string());
            }
        }
    }

    lines.push("}".to_string());
    lines.push(String::new());
    lines.extend(rendered);
    format!("{}\n", lines.join("\n"))
}

fn state_type_name(schema_name: &str) -> String {
    let base = key_to_pascal(schema_name);
    if base == "State" {
        return "StateValue".to_string();
    }
    if base.ends_with("State") {
        base
    } else {
        format!("{base}State")
    }
}

fn render_participant_uses_mod_rs(mappings: &[ValidatedParticipantAlias]) -> String {
    let mut lines = vec![
        "//! Generated dependency alias facades.".to_string(),
        String::new(),
    ];
    for mapping in mappings {
        lines.push(format!("pub mod {};", mapping.alias_ident));
    }
    lines.push(String::new());
    format!("{}\n", lines.join("\n"))
}

fn render_participant_use_alias_rs(mapping: &ValidatedParticipantAlias) -> String {
    let remote_client_name = format!(
        "{}Client",
        sdk_stem_from_contract_id_pascal(&mapping.contract_id)
    );
    let needs_transport = mapping
        .use_ref
        .events
        .as_ref()
        .and_then(|events| events.subscribe.as_ref())
        .is_some_and(|subscribe| !subscribe.is_empty())
        || mapping
            .use_ref
            .feeds
            .as_ref()
            .and_then(|feeds| feeds.subscribe.as_ref())
            .is_some_and(|subscribe| !subscribe.is_empty());
    let client_struct = if needs_transport {
        "pub struct Client<'a> { inner: sdk::".to_string()
            + &remote_client_name
            + "<'a>, transport: &'a trellis_client::TrellisClient }"
    } else {
        "pub struct Client<'a> { inner: sdk::".to_string() + &remote_client_name + "<'a> }"
    };
    let client_new = if needs_transport {
        "    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self { Self { inner: sdk::"
            .to_string()
            + &remote_client_name
            + "::new(inner), transport: inner } }"
    } else {
        "    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self { Self { inner: sdk::"
            .to_string()
            + &remote_client_name
            + "::new(inner) } }"
    };
    let mut lines = vec![
        format!("/// Facade for the `{}` dependency alias.", mapping.alias),
        format!("use {} as sdk;", mapping.crate_ident),
        String::new(),
        client_struct,
        "impl<'a> Client<'a> {".to_string(),
        client_new,
        format!(
            "    pub const CONTRACT_ID: &'static str = {};",
            string_literal(&mapping.contract_id)
        ),
    ];

    if let Some(rpc) = &mapping.use_ref.rpc {
        for key in rpc.call.as_deref().unwrap_or(&[]) {
            let method = key_to_snake(key);
            let base = key_to_pascal(key);
            let input_empty = is_empty_object_schema(resolve_schema_ref(
                &mapping.manifest,
                &mapping.manifest.manifest.rpc[key].input.schema,
            ));
            let output_type = if is_empty_object_schema(resolve_schema_ref(
                &mapping.manifest,
                &mapping.manifest.manifest.rpc[key].output.schema,
            )) {
                "sdk::Empty".to_string()
            } else {
                format!("sdk::{base}Response")
            };
            if input_empty {
                lines.push(format!("    pub async fn {method}(&self) -> Result<{output_type}, trellis_client::TrellisClientError> {{ self.inner.{method}().await }}"));
            } else {
                lines.push(format!("    pub async fn {method}(&self, input: &sdk::{base}Request) -> Result<{output_type}, trellis_client::TrellisClientError> {{ self.inner.{method}(input).await }}"));
            }
        }
    }
    if let Some(operations) = &mapping.use_ref.operations {
        for key in operations.call.as_deref().unwrap_or(&[]) {
            let method = key_to_snake(key);
            let base = key_to_pascal(key);
            lines.push(format!("    pub fn {method}(&self) -> trellis_client::OperationInvoker<'a, trellis_client::TrellisClient, sdk::operations::{base}Operation> {{ self.inner.{method}() }}"));
        }
    }
    if let Some(events) = &mapping.use_ref.events {
        for key in events.publish.as_deref().unwrap_or(&[]) {
            let method = format!("publish_{}", key_to_snake(key));
            let base = key_to_pascal(key);
            lines.push(format!("    pub async fn {method}(&self, event: &sdk::{base}Event) -> Result<(), trellis_client::TrellisClientError> {{ self.inner.{method}(event).await }}"));
        }
        for key in events.subscribe.as_deref().unwrap_or(&[]) {
            let method = format!("subscribe_{}", key_to_snake(key));
            let base = key_to_pascal(key);
            lines.push(format!("    pub async fn {method}(&self) -> Result<futures_util::stream::BoxStream<'static, Result<sdk::{base}Event, trellis_client::TrellisClientError>>, trellis_client::TrellisClientError> {{ self.transport.subscribe::<sdk::events::{base}EventDescriptor>().await }}"));
        }
    }
    if let Some(feeds) = &mapping.use_ref.feeds {
        for key in feeds.subscribe.as_deref().unwrap_or(&[]) {
            let method = key_to_snake(key);
            let base = key_to_pascal(key);
            let input_empty = is_empty_object_schema(resolve_schema_ref(
                &mapping.manifest,
                &mapping.manifest.manifest.feeds[key].input.schema,
            ));
            if input_empty {
                lines.push(format!("    pub async fn {method}(&self) -> Result<futures_util::stream::BoxStream<'static, Result<sdk::{base}Event, trellis_client::TrellisClientError>>, trellis_client::TrellisClientError> {{ self.transport.feed::<sdk::feeds::{base}FeedDescriptor>(&sdk::rpc::Empty {{}}).await }}"));
            } else {
                lines.push(format!("    pub async fn {method}(&self, input: &sdk::{base}Input) -> Result<futures_util::stream::BoxStream<'static, Result<sdk::{base}Event, trellis_client::TrellisClientError>>, trellis_client::TrellisClientError> {{ self.transport.feed::<sdk::feeds::{base}FeedDescriptor>(input).await }}"));
            }
        }
    }
    lines.push("}".to_string());

    lines.push(String::new());
    format!("{}\n", lines.join("\n"))
}

fn write_runtime_patch_config(opts: &GenerateRustSdkOpts) -> Result<(), CodegenRustError> {
    let cargo_dir = opts.out_dir.join(".cargo");
    let config_path = cargo_dir.join("config.toml");

    match opts.runtime_deps.source {
        RustRuntimeSource::Registry => {
            if config_path.exists() {
                fs::remove_file(&config_path)?;
            }
            if cargo_dir.exists() && cargo_dir.read_dir()?.next().is_none() {
                fs::remove_dir(&cargo_dir)?;
            }
            Ok(())
        }
        RustRuntimeSource::Local => {
            let repo_root = opts
                .runtime_deps
                .repo_root
                .as_ref()
                .ok_or(CodegenRustError::MissingRuntimeRepoRoot)?;
            let repo_root = repo_root.canonicalize()?;
            let config = format!(
                "[patch.crates-io]\ntrellis-client = {{ path = \"{}\" }}\ntrellis-contracts = {{ path = \"{}\" }}\ntrellis-service = {{ path = \"{}\" }}\n",
                workspace_package_dir(&repo_root, "trellis-client")?.display(),
                workspace_package_dir(&repo_root, "trellis-contracts")?.display(),
                workspace_package_dir(&repo_root, "trellis-service")?.display(),
            );
            write_if_changed(&config_path, &config)
        }
    }
}

fn render_contract_rs(
    opts: &GenerateRustSdkOpts,
    loaded: &trellis_contracts::LoadedManifest,
) -> String {
    let contract_name = manifest_display_name(loaded);
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    format!(
        "//! Contract metadata for `{}`.\n//! Generated from {}\n\n/// Canonical Trellis contract id.\npub const CONTRACT_ID: &str = {};\n\n/// Stable digest for the canonical manifest JSON.\npub const CONTRACT_DIGEST: &str = {};\n\n/// Human-readable contract name.\npub const CONTRACT_NAME: &str = {};\n\n/// Canonical manifest JSON embedded in the SDK crate.\npub const CONTRACT_JSON: &str = r#\"{}\"#;\n\n/// Deserialize the embedded contract manifest.\npub fn contract_manifest() -> trellis_contracts::ContractManifest {{\n    serde_json::from_str(CONTRACT_JSON).expect(\"generated manifest json\")\n}}\n",
        loaded.manifest.id,
        source_reference,
        string_literal(&loaded.manifest.id),
        string_literal(&loaded.digest),
        string_literal(&contract_name),
        loaded.canonical,
    )
}

fn manifest_source_reference(manifest_path: &Path, repo_root: Option<&Path>) -> String {
    let manifest_path = manifest_path
        .canonicalize()
        .unwrap_or_else(|_| manifest_path.to_path_buf());

    if let Some(repo_root) = repo_root {
        let repo_root = repo_root
            .canonicalize()
            .unwrap_or_else(|_| repo_root.to_path_buf());
        if let Ok(relative) = manifest_path.strip_prefix(&repo_root) {
            return normalize_relative_path_string(relative.to_string_lossy().replace('\\', "/"));
        }
    }

    normalize_relative_path_string(manifest_path.to_string_lossy().replace('\\', "/"))
}

fn normalize_relative_path_string(path: String) -> String {
    if path.is_empty() || path.starts_with("../") || path.starts_with("./") || path.starts_with('/')
    {
        return path;
    }
    format!("./{path}")
}

fn render_types_rs(loaded: &trellis_contracts::LoadedManifest) -> String {
    let mut renderer = TypeRenderer::default();
    let mut lines = vec![format!(
        "//! Shared request and response types for `{}`.",
        loaded.manifest.id
    )];

    for (key, rpc) in &loaded.manifest.rpc {
        let base = key_to_pascal(key);
        if !is_empty_object_schema(resolve_schema_ref(loaded, &rpc.input.schema)) {
            renderer.render_named_type(
                &format!("{base}Request"),
                resolve_schema_ref(loaded, &rpc.input.schema),
            );
        }
        if !is_empty_object_schema(resolve_schema_ref(loaded, &rpc.output.schema)) {
            renderer.render_named_type(
                &format!("{base}Response"),
                resolve_schema_ref(loaded, &rpc.output.schema),
            );
        }
    }

    for (key, operation) in &loaded.manifest.operations {
        let base = key_to_pascal(key);
        if !is_empty_object_schema(resolve_schema_ref(loaded, &operation.input.schema)) {
            renderer.render_named_type(
                &format!("{base}Input"),
                resolve_schema_ref(loaded, &operation.input.schema),
            );
        }
        if let Some(progress) = &operation.progress {
            if !is_empty_object_schema(resolve_schema_ref(loaded, &progress.schema)) {
                renderer.render_named_type(
                    &format!("{base}Progress"),
                    resolve_schema_ref(loaded, &progress.schema),
                );
            }
        }
        if let Some(output) = &operation.output {
            if !is_empty_object_schema(resolve_schema_ref(loaded, &output.schema)) {
                renderer.render_named_type(
                    &format!("{base}Output"),
                    resolve_schema_ref(loaded, &output.schema),
                );
            }
        }
    }

    for key in loaded.manifest.events.keys() {
        let base = key_to_pascal(key);
        renderer.render_named_type(
            &format!("{base}Event"),
            resolve_schema_ref(loaded, &loaded.manifest.events[key].event.schema),
        );
    }

    for (key, feed) in &loaded.manifest.feeds {
        let base = key_to_pascal(key);
        if !is_empty_object_schema(resolve_schema_ref(loaded, &feed.input.schema)) {
            renderer.render_named_type(
                &format!("{base}Input"),
                resolve_schema_ref(loaded, &feed.input.schema),
            );
        }
        renderer.render_named_type(
            &format!("{base}Event"),
            resolve_schema_ref(loaded, &feed.event.schema),
        );
    }

    for schema_name in &loaded.manifest.exports.schemas {
        renderer.render_named_type(
            key_to_pascal(schema_name).as_str(),
            resolve_schema_ref(loaded, schema_name),
        );
    }

    let rendered = renderer.finish();
    lines.push(String::new());
    lines.push("use serde::{Deserialize, Serialize};".to_string());
    lines.push("use serde_json::Value;".to_string());
    if rendered.iter().any(|line| line.contains("BTreeMap<")) {
        lines.push("use std::collections::BTreeMap;".to_string());
    }
    lines.push(String::new());
    lines.extend(rendered);
    format!("{}\n", lines.join("\n"))
}

fn render_rpc_rs(loaded: &trellis_contracts::LoadedManifest) -> String {
    let mut lines = vec![
        format!("//! Typed RPC descriptors for `{}`.", loaded.manifest.id),
        String::new(),
        "use serde::{Deserialize, Serialize};".to_string(),
        String::new(),
    ];

    if !loaded.manifest.rpc.is_empty() {
        lines.push("use trellis_client::RpcDescriptor;".to_string());
        lines.push("use trellis_service::RpcDescriptor as ServerRpcDescriptor;".to_string());
        lines.push(String::new());
    }

    lines.push("/// Empty request or response payload used by zero-argument RPCs.".to_string());
    lines.push(
        "#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]".to_string(),
    );
    lines.push("pub struct Empty {}".to_string());
    lines.push(String::new());

    for (key, rpc) in &loaded.manifest.rpc {
        let base = key_to_pascal(key);
        let input_type = if is_empty_object_schema(resolve_schema_ref(loaded, &rpc.input.schema)) {
            "Empty".to_string()
        } else {
            format!("crate::types::{base}Request")
        };
        let output_type = if is_empty_object_schema(resolve_schema_ref(loaded, &rpc.output.schema))
        {
            "Empty".to_string()
        } else {
            format!("crate::types::{base}Response")
        };
        let capabilities = rpc
            .capabilities
            .as_ref()
            .and_then(|caps| caps.call.as_ref())
            .cloned()
            .unwrap_or_default();
        let errors = rpc
            .errors
            .as_ref()
            .map(|values| {
                values
                    .iter()
                    .map(|value| value.error_type.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        lines.push(format!("/// Descriptor for `{key}`."));
        lines.push(format!("pub struct {base}Rpc;"));
        lines.push(String::new());
        lines.push(format!("impl RpcDescriptor for {base}Rpc {{"));
        lines.push(format!("    type Input = {input_type};"));
        lines.push(format!("    type Output = {output_type};"));
        lines.push(format!(
            "    const KEY: &'static str = {};",
            string_literal(key)
        ));
        lines.push(format!(
            "    const SUBJECT: &'static str = {};",
            string_literal(&rpc.subject)
        ));
        lines.push(format!(
            "    const CALLER_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&capabilities)
        ));
        lines.push(format!(
            "    const ERRORS: &'static [&'static str] = &[{}];",
            join_string_literals(&errors)
        ));
        lines.push("}".to_string());
        lines.push(String::new());
        lines.push(format!("impl ServerRpcDescriptor for {base}Rpc {{"));
        lines.push(format!("    type Input = {input_type};"));
        lines.push(format!("    type Output = {output_type};"));
        lines.push(format!(
            "    const KEY: &'static str = {};",
            string_literal(key)
        ));
        lines.push(format!(
            "    const SUBJECT: &'static str = {};",
            string_literal(&rpc.subject)
        ));
        lines.push(format!(
            "    const CALLER_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&capabilities)
        ));
        lines.push("}".to_string());
        lines.push(String::new());
    }

    format!("{}\n", lines.join("\n"))
}

fn render_events_rs(loaded: &trellis_contracts::LoadedManifest) -> String {
    let mut lines = vec![
        format!("//! Typed event descriptors for `{}`.", loaded.manifest.id),
        String::new(),
    ];

    if !loaded.manifest.events.is_empty() {
        lines.push("use trellis_client::EventDescriptor;".to_string());
        lines.push("use trellis_service::EventDescriptor as ServerEventDescriptor;".to_string());
        lines.push(String::new());
    }

    for (key, event) in &loaded.manifest.events {
        let base = key_to_pascal(key);
        let publish = event
            .capabilities
            .as_ref()
            .and_then(|caps| caps.publish.as_ref())
            .cloned()
            .unwrap_or_default();
        let subscribe = event
            .capabilities
            .as_ref()
            .and_then(|caps| caps.subscribe.as_ref())
            .cloned()
            .unwrap_or_default();
        lines.push(format!("/// Descriptor for `{key}`."));
        lines.push(format!("pub struct {base}EventDescriptor;"));
        lines.push(String::new());
        lines.push(format!("impl EventDescriptor for {base}EventDescriptor {{"));
        lines.push(format!("    type Event = crate::types::{base}Event;"));
        lines.push(format!(
            "    const KEY: &'static str = {};",
            string_literal(key)
        ));
        lines.push(format!(
            "    const SUBJECT: &'static str = {};",
            string_literal(&event.subject)
        ));
        lines.push(format!(
            "    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&publish)
        ));
        lines.push(format!(
            "    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&subscribe)
        ));
        lines.push("}".to_string());
        lines.push(String::new());
        lines.push(format!(
            "impl ServerEventDescriptor for {base}EventDescriptor {{"
        ));
        lines.push(format!("    type Event = crate::types::{base}Event;"));
        lines.push(format!(
            "    const KEY: &'static str = {};",
            string_literal(key)
        ));
        lines.push(format!(
            "    const SUBJECT: &'static str = {};",
            string_literal(&event.subject)
        ));
        lines.push("}".to_string());
        lines.push(String::new());
    }

    format!("{}\n", lines.join("\n"))
}

fn render_feeds_rs(loaded: &trellis_contracts::LoadedManifest) -> String {
    let mut lines = vec![
        format!("//! Typed feed descriptors for `{}`.", loaded.manifest.id),
        String::new(),
    ];

    if !loaded.manifest.feeds.is_empty() {
        lines.push("use trellis_client::FeedDescriptor;".to_string());
        lines.push("use trellis_service::FeedDescriptor as ServerFeedDescriptor;".to_string());
        lines.push(String::new());
    }

    for (key, feed) in &loaded.manifest.feeds {
        let base = key_to_pascal(key);
        let input_type = if is_empty_object_schema(resolve_schema_ref(loaded, &feed.input.schema)) {
            "crate::rpc::Empty".to_string()
        } else {
            format!("crate::types::{base}Input")
        };
        let event_type = format!("crate::types::{base}Event");
        let subscribe = feed
            .capabilities
            .as_ref()
            .and_then(|caps| caps.subscribe.as_ref())
            .cloned()
            .unwrap_or_default();

        lines.push(format!("/// Descriptor for `{key}`."));
        lines.push(format!("pub struct {base}FeedDescriptor;"));
        lines.push(String::new());
        lines.push(format!("impl FeedDescriptor for {base}FeedDescriptor {{"));
        lines.push(format!("    type Input = {input_type};"));
        lines.push(format!("    type Event = {event_type};"));
        lines.push(format!(
            "    const KEY: &'static str = {};",
            string_literal(key)
        ));
        lines.push(format!(
            "    const SUBJECT: &'static str = {};",
            string_literal(&feed.subject)
        ));
        lines.push(format!(
            "    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&subscribe)
        ));
        lines.push("}".to_string());
        lines.push(String::new());
        lines.push(format!(
            "impl ServerFeedDescriptor for {base}FeedDescriptor {{"
        ));
        lines.push(format!("    type Input = {input_type};"));
        lines.push(format!("    type Event = {event_type};"));
        lines.push(format!(
            "    const KEY: &'static str = {};",
            string_literal(key)
        ));
        lines.push(format!(
            "    const SUBJECT: &'static str = {};",
            string_literal(&feed.subject)
        ));
        lines.push(format!(
            "    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&subscribe)
        ));
        lines.push("}".to_string());
        lines.push(String::new());
    }

    format!("{}\n", lines.join("\n"))
}

fn render_operations_rs(loaded: &trellis_contracts::LoadedManifest) -> String {
    let mut lines = vec![format!(
        "//! Typed operation descriptors for `{}`.",
        loaded.manifest.id
    )];

    if loaded.manifest.operations.is_empty() {
        lines.push(String::new());
        return format!("{}\n", lines.join("\n"));
    }

    lines.push(String::new());
    if loaded
        .manifest
        .operations
        .values()
        .any(|operation| operation.transfer.is_some())
    {
        lines.push(
            "use trellis_client::{OperationDescriptor, TransferOperationDescriptor};".to_string(),
        );
    } else {
        lines.push("use trellis_client::OperationDescriptor;".to_string());
    }
    lines
        .push("use trellis_service::OperationDescriptor as ServerOperationDescriptor;".to_string());
    lines.push(String::new());

    for (key, operation) in &loaded.manifest.operations {
        let base = key_to_pascal(key);
        let input_type =
            if is_empty_object_schema(resolve_schema_ref(loaded, &operation.input.schema)) {
                "crate::rpc::Empty".to_string()
            } else {
                format!("crate::types::{base}Input")
            };
        let progress_type = match &operation.progress {
            Some(progress)
                if !is_empty_object_schema(resolve_schema_ref(loaded, &progress.schema)) =>
            {
                format!("crate::types::{base}Progress")
            }
            _ => "crate::rpc::Empty".to_string(),
        };
        let output_type = match &operation.output {
            Some(output) if !is_empty_object_schema(resolve_schema_ref(loaded, &output.schema)) => {
                format!("crate::types::{base}Output")
            }
            _ => "crate::rpc::Empty".to_string(),
        };
        let caller = operation
            .capabilities
            .as_ref()
            .and_then(|caps| caps.call.as_ref())
            .cloned()
            .unwrap_or_default();
        let read = operation
            .capabilities
            .as_ref()
            .and_then(|caps| caps.read.as_ref())
            .cloned()
            .unwrap_or_else(|| caller.clone());
        let cancel = operation
            .capabilities
            .as_ref()
            .and_then(|caps| caps.cancel.as_ref())
            .cloned()
            .unwrap_or_default();
        let control = operation
            .capabilities
            .as_ref()
            .and_then(|caps| caps.control.as_ref())
            .cloned()
            .unwrap_or_default();

        lines.push(format!("/// Descriptor for `{key}`."));
        lines.push(format!("pub struct {base}Operation;"));
        lines.push(String::new());
        lines.push(format!("impl OperationDescriptor for {base}Operation {{"));
        lines.push(format!("    type Input = {input_type};"));
        lines.push(format!("    type Progress = {progress_type};"));
        lines.push(format!("    type Output = {output_type};"));
        lines.push(format!(
            "    const KEY: &'static str = {};",
            string_literal(key)
        ));
        lines.push(format!(
            "    const SUBJECT: &'static str = {};",
            string_literal(&operation.subject)
        ));
        lines.push(format!(
            "    const CALLER_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&caller)
        ));
        lines.push(format!(
            "    const READ_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&read)
        ));
        lines.push(format!(
            "    const CANCEL_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&cancel)
        ));
        lines.push(format!(
            "    const CONTROL_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&control)
        ));
        lines.push(format!(
            "    const CANCELABLE: bool = {};",
            operation.cancel.unwrap_or(false)
        ));
        lines.push("}".to_string());
        lines.push(String::new());
        if operation.transfer.is_some() {
            lines.push(format!(
                "impl TransferOperationDescriptor for {base}Operation {{}}"
            ));
            lines.push(String::new());
        }
        lines.push(format!(
            "impl ServerOperationDescriptor for {base}Operation {{"
        ));
        lines.push(format!("    type Input = {input_type};"));
        lines.push(format!("    type Progress = {progress_type};"));
        lines.push(format!("    type Output = {output_type};"));
        lines.push(format!(
            "    const KEY: &'static str = {};",
            string_literal(key)
        ));
        lines.push(format!(
            "    const SUBJECT: &'static str = {};",
            string_literal(&operation.subject)
        ));
        lines.push(format!(
            "    const CALLER_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&caller)
        ));
        lines.push(format!(
            "    const READ_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&read)
        ));
        lines.push(format!(
            "    const CANCEL_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&cancel)
        ));
        lines.push(format!(
            "    const CONTROL_CAPABILITIES: &'static [&'static str] = &[{}];",
            join_string_literals(&control)
        ));
        lines.push(format!(
            "    const CANCELABLE: bool = {};",
            operation.cancel.unwrap_or(false)
        ));
        lines.push("}".to_string());
        lines.push(String::new());
    }

    format!("{}\n", lines.join("\n"))
}

fn render_client_rs(loaded: &trellis_contracts::LoadedManifest) -> String {
    let client_name = format!("{}Client", sdk_stem_pascal(loaded));
    let mut lines = vec![
        format!(
            "//! Thin typed client helpers for `{}`.",
            loaded.manifest.id
        ),
        String::new(),
        "use trellis_client::TrellisClientError;".to_string(),
        String::new(),
        format!(
            "/// Typed API wrapper for the `{}` contract.",
            loaded.manifest.id
        ),
        format!("pub struct {client_name}<'a> {{"),
        "    inner: &'a trellis_client::TrellisClient,".to_string(),
        "}".to_string(),
        String::new(),
        format!("impl<'a> {client_name}<'a> {{"),
        "    /// Wrap an already connected low-level Trellis client.".to_string(),
        "    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self {".to_string(),
        "        Self { inner }".to_string(),
        "    }".to_string(),
        String::new(),
    ];

    for (key, rpc) in &loaded.manifest.rpc {
        let base = key_to_pascal(key);
        let method_name = key_to_snake(key);
        let input_type = if is_empty_object_schema(resolve_schema_ref(loaded, &rpc.input.schema)) {
            None
        } else {
            Some(format!("crate::types::{base}Request"))
        };
        let output_type = if is_empty_object_schema(resolve_schema_ref(loaded, &rpc.output.schema))
        {
            "crate::rpc::Empty".to_string()
        } else {
            format!("crate::types::{base}Response")
        };
        lines.push(format!("    /// Call `{key}`."));
        match input_type {
            Some(input_type) => {
                lines.push(format!(
                    "    pub async fn {method_name}(&self, input: &{input_type}) -> Result<{output_type}, TrellisClientError> {{"
                ));
                lines.push(format!(
                    "        self.inner.call::<crate::rpc::{base}Rpc>(input).await"
                ));
            }
            None => {
                lines.push(format!(
                    "    pub async fn {method_name}(&self) -> Result<{output_type}, TrellisClientError> {{"
                ));
                lines.push(format!(
                    "        self.inner.call::<crate::rpc::{base}Rpc>(&crate::rpc::Empty {{}}).await"
                ));
            }
        }
        lines.push("    }".to_string());
        lines.push(String::new());
    }

    for key in loaded.manifest.operations.keys() {
        let base = key_to_pascal(key);
        let method_name = key_to_snake(key);
        lines.push(format!("    /// Start or control `{key}`."));
        lines.push(format!(
            "    pub fn {method_name}(&self) -> trellis_client::OperationInvoker<'a, trellis_client::TrellisClient, crate::operations::{base}Operation> {{"
        ));
        lines.push(format!(
            "        self.inner.operation::<crate::operations::{base}Operation>()"
        ));
        lines.push("    }".to_string());
        lines.push(String::new());
    }

    for key in loaded.manifest.events.keys() {
        let base = key_to_pascal(key);
        let method_name = format!("publish_{}", key_to_snake(key));
        lines.push(format!("    /// Publish `{key}`."));
        lines.push(format!(
            "    pub async fn {method_name}(&self, event: &crate::types::{base}Event) -> Result<(), TrellisClientError> {{"
        ));
        lines.push(format!(
            "        self.inner.publish::<crate::events::{base}EventDescriptor>(event).await"
        ));
        lines.push("    }".to_string());
        lines.push(String::new());
    }

    for (key, feed) in &loaded.manifest.feeds {
        let base = key_to_pascal(key);
        let method_name = key_to_snake(key);
        lines.push(format!("    /// Subscribe to `{key}`."));
        if is_empty_object_schema(resolve_schema_ref(loaded, &feed.input.schema)) {
            lines.push(format!("    pub async fn {method_name}(&self) -> Result<futures_util::stream::BoxStream<'static, Result<crate::types::{base}Event, TrellisClientError>>, TrellisClientError> {{"));
            lines.push(format!("        self.inner.feed::<crate::feeds::{base}FeedDescriptor>(&crate::rpc::Empty {{}}).await"));
        } else {
            lines.push(format!("    pub async fn {method_name}(&self, input: &crate::types::{base}Input) -> Result<futures_util::stream::BoxStream<'static, Result<crate::types::{base}Event, TrellisClientError>>, TrellisClientError> {{"));
            lines.push(format!(
                "        self.inner.feed::<crate::feeds::{base}FeedDescriptor>(input).await"
            ));
        }
        lines.push("    }".to_string());
        lines.push(String::new());
    }

    lines.push("}".to_string());
    lines.push(String::new());
    format!("{}\n", lines.join("\n"))
}

fn render_server_rs(loaded: &trellis_contracts::LoadedManifest) -> String {
    let mut imports = Vec::new();
    if !loaded.manifest.rpc.is_empty() {
        imports.extend(["HandlerResult", "RequestContext", "Router"]);
    }
    if !loaded.manifest.operations.is_empty() {
        if !imports.contains(&"RequestContext") {
            imports.push("RequestContext");
        }
        if !imports.contains(&"Router") {
            imports.push("Router");
        }
    }
    if !loaded.manifest.events.is_empty() {
        imports.push("EventPublisher");
        imports.push("ServerError");
    }
    if !loaded.manifest.feeds.is_empty() {
        if !imports.contains(&"RequestContext") {
            imports.push("RequestContext");
        }
        if !imports.contains(&"Router") {
            imports.push("Router");
        }
        if !imports.contains(&"ServerError") {
            imports.push("ServerError");
        }
    }
    let mut lines = vec![
        format!("//! Thin server-side helpers for `{}`.", loaded.manifest.id),
        String::new(),
    ];

    if !imports.is_empty() {
        lines.push(format!("use trellis_service::{{{}}};", imports.join(", ")));
        lines.push(String::new());
    }

    for (key, rpc) in &loaded.manifest.rpc {
        let base = key_to_pascal(key);
        let fn_name = format!("register_{}", key_to_snake(key));
        let input_type = if is_empty_object_schema(resolve_schema_ref(loaded, &rpc.input.schema)) {
            "crate::rpc::Empty".to_string()
        } else {
            format!("crate::types::{base}Request")
        };
        let output_type = if is_empty_object_schema(resolve_schema_ref(loaded, &rpc.output.schema))
        {
            "crate::rpc::Empty".to_string()
        } else {
            format!("crate::types::{base}Response")
        };
        lines.push(format!("/// Register a handler for `{key}`."));
        lines.push(format!(
            "pub fn {fn_name}<F, Fut>(router: &mut Router, handler: F)"
        ));
        lines.push("where".to_string());
        lines.push(format!(
            "    F: Fn(RequestContext, {input_type}) -> Fut + Send + Sync + 'static,"
        ));
        lines.push(format!(
            "    Fut: std::future::Future<Output = HandlerResult<{output_type}>> + Send + 'static,"
        ));
        lines.push("{".to_string());
        lines.push(format!(
            "    router.register_rpc::<crate::rpc::{base}Rpc, _, _>(handler);"
        ));
        lines.push("}".to_string());
        lines.push(String::new());
    }

    for (key, operation) in &loaded.manifest.operations {
        let base = key_to_pascal(key);
        let fn_name = format!("register_{}", key_to_snake(key));
        let input_type =
            if is_empty_object_schema(resolve_schema_ref(loaded, &operation.input.schema)) {
                "crate::rpc::Empty".to_string()
            } else {
                format!("crate::types::{base}Input")
            };
        let progress_type = match &operation.progress {
            Some(progress)
                if !is_empty_object_schema(resolve_schema_ref(loaded, &progress.schema)) =>
            {
                format!("crate::types::{base}Progress")
            }
            _ => "crate::rpc::Empty".to_string(),
        };
        let output_type = match &operation.output {
            Some(output) if !is_empty_object_schema(resolve_schema_ref(loaded, &output.schema)) => {
                format!("crate::types::{base}Output")
            }
            _ => "crate::rpc::Empty".to_string(),
        };
        lines.push(format!("/// Register a handler for `{key}`."));
        lines.push(format!(
            "pub fn {fn_name}<FStart, FutStart, FGet, FutGet, FWait, FutWait, FCancel, FutCancel>(router: &mut Router, start: FStart, get: FGet, wait: FWait, cancel: FCancel)"
        ));
        lines.push("where".to_string());
        lines.push(format!(
            "    FStart: Fn(RequestContext, {input_type}) -> FutStart + Send + Sync + 'static,"
        ));
        lines.push(format!(
            "    FutStart: std::future::Future<Output = Result<trellis_service::AcceptedOperation<{progress_type}, {output_type}>, trellis_service::ServerError>> + Send + 'static,"
        ));
        lines.push(
            "    FGet: Fn(RequestContext, String) -> FutGet + Send + Sync + 'static,".to_string(),
        );
        lines.push(format!(
            "    FutGet: std::future::Future<Output = Result<trellis_service::OperationSnapshot<{progress_type}, {output_type}>, trellis_service::ServerError>> + Send + 'static,"
        ));
        lines.push(
            "    FWait: Fn(RequestContext, String) -> FutWait + Send + Sync + 'static,".to_string(),
        );
        lines.push(format!(
            "    FutWait: std::future::Future<Output = Result<trellis_service::OperationSnapshot<{progress_type}, {output_type}>, trellis_service::ServerError>> + Send + 'static,"
        ));
        lines.push(
            "    FCancel: Fn(RequestContext, String) -> FutCancel + Send + Sync + 'static,"
                .to_string(),
        );
        lines.push(format!(
            "    FutCancel: std::future::Future<Output = Result<trellis_service::OperationSnapshot<{progress_type}, {output_type}>, trellis_service::ServerError>> + Send + 'static,"
        ));
        lines.push("{".to_string());
        lines.push(format!(
            "    router.register_operation::<crate::operations::{base}Operation, _, _, _, _, _, _, _, _>(start, get, wait, cancel);"
        ));
        lines.push("}".to_string());
        lines.push(String::new());

        lines.push(format!("/// Register a provider for `{key}`."));
        lines.push(format!(
            "pub fn {fn_name}_provider<P>(router: &mut Router, provider: P)"
        ));
        lines.push("where".to_string());
        lines.push(format!(
            "    P: trellis_service::OperationProvider<crate::operations::{base}Operation>,"
        ));
        lines.push("{".to_string());
        lines.push(format!(
            "    router.register_operation_provider::<crate::operations::{base}Operation, _>(provider);"
        ));
        lines.push("}".to_string());
        lines.push(String::new());
    }

    for key in loaded.manifest.events.keys() {
        let base = key_to_pascal(key);
        let fn_name = format!("publish_{}", key_to_snake(key));
        lines.push(format!("/// Publish `{key}` from a service handler."));
        lines.push(format!(
            "pub async fn {fn_name}(publisher: &EventPublisher, event: &crate::types::{base}Event) -> Result<(), ServerError> {{"
        ));
        lines.push(format!(
            "    publisher.publish::<crate::events::{base}EventDescriptor>(event).await"
        ));
        lines.push("}".to_string());
        lines.push(String::new());
    }

    for (key, feed) in &loaded.manifest.feeds {
        let base = key_to_pascal(key);
        let fn_name = format!("register_{}", key_to_snake(key));
        let input_type = if is_empty_object_schema(resolve_schema_ref(loaded, &feed.input.schema)) {
            "crate::rpc::Empty".to_string()
        } else {
            format!("crate::types::{base}Input")
        };
        lines.push(format!("/// Register a feed handler for `{key}`."));
        lines.push(format!(
            "pub fn {fn_name}<F, S>(router: &mut Router, handler: F)"
        ));
        lines.push("where".to_string());
        lines.push(format!(
            "    F: Fn(RequestContext, {input_type}) -> S + Send + Sync + 'static,"
        ));
        lines.push(format!(
            "    S: futures_util::Stream<Item = Result<crate::types::{base}Event, ServerError>> + Send + 'static,"
        ));
        lines.push("{".to_string());
        lines.push(format!(
            "    router.register_feed::<crate::feeds::{base}FeedDescriptor, _, _>(handler);"
        ));
        lines.push("}".to_string());
        lines.push(String::new());
    }

    format!("{}\n", lines.join("\n"))
}

fn write_if_changed(path: &Path, contents: &str) -> Result<(), CodegenRustError> {
    if fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)?;
    Ok(())
}

fn write_rust_if_changed(path: &Path, contents: &str) -> Result<(), CodegenRustError> {
    let contents = format_generated_rust_source(path, contents)?;
    write_if_changed(path, &contents)
}

fn format_generated_rust_source(
    path: impl AsRef<Path>,
    contents: &str,
) -> Result<String, CodegenRustError> {
    let path = path.as_ref().display().to_string();
    let file = syn::parse_file(contents).map_err(|error| CodegenRustError::RustSyntax {
        path,
        message: error.to_string(),
    })?;
    Ok(prettyplease::unparse(&file))
}

fn key_to_pascal(value: &str) -> String {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<String>()
}

fn key_to_snake(value: &str) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    let mut out = String::new();
    let mut prev_was_sep = false;
    for (index, ch) in chars.iter().copied().enumerate() {
        if ch.is_ascii_alphanumeric() {
            let prev = index.checked_sub(1).and_then(|i| chars.get(i)).copied();
            let next = chars.get(index + 1).copied();
            let starts_new_word = ch.is_ascii_uppercase()
                && !out.is_empty()
                && !prev_was_sep
                && (prev.is_some_and(|value| value.is_ascii_lowercase() || value.is_ascii_digit())
                    || next.is_some_and(|value| value.is_ascii_lowercase()));

            if starts_new_word {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
            prev_was_sep = false;
        } else if !out.is_empty() && !prev_was_sep {
            out.push('_');
            prev_was_sep = true;
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    out
}

fn rust_ident(value: &str) -> String {
    match value {
        "as" | "break" | "const" | "continue" | "crate" | "else" | "enum" | "extern" | "false"
        | "fn" | "for" | "if" | "impl" | "in" | "let" | "loop" | "match" | "mod" | "move"
        | "mut" | "pub" | "ref" | "return" | "self" | "Self" | "static" | "struct" | "super"
        | "trait" | "true" | "type" | "unsafe" | "use" | "where" | "while" | "async" | "await"
        | "dyn" | "abstract" | "become" | "box" | "do" | "final" | "macro" | "override"
        | "priv" | "typeof" | "unsized" | "virtual" | "yield" | "try" => format!("r#{value}"),
        _ => value.to_string(),
    }
}

#[derive(Default)]
struct TypeRenderer {
    rendered: std::collections::BTreeSet<String>,
    defs: Vec<String>,
}

impl TypeRenderer {
    fn render_named_type(&mut self, type_name: &str, schema: &serde_json::Value) {
        if self.rendered.contains(type_name) {
            return;
        }
        self.rendered.insert(type_name.to_string());

        self.defs
            .push(format!("/// Generated schema type `{type_name}`."));

        if let Some(fields) = object_fields(schema) {
            let mut field_lines = Vec::new();
            for (field_name, field_schema) in fields {
                let rust_field_base = key_to_snake(field_name);
                let rust_field = rust_ident(&rust_field_base);
                if rust_field_base != *field_name {
                    field_lines.push(format!(
                        "    #[serde(rename = {})]",
                        string_literal(field_name)
                    ));
                }
                let required = schema_required(schema, field_name);
                let field_type_name = format!("{type_name}{}", key_to_pascal(field_name));
                let ty = self.type_expr(&field_type_name, field_schema);
                if required {
                    field_lines.push(format!("    pub {rust_field}: {ty},"));
                } else {
                    field_lines.push(
                        "    #[serde(skip_serializing_if = \"Option::is_none\")]".to_string(),
                    );
                    field_lines.push(format!("    pub {rust_field}: Option<{ty}>,"));
                }
            }
            self.defs
                .push("#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]".to_string());
            self.defs.push(format!("pub struct {type_name} {{"));
            self.defs.extend(field_lines);
            self.defs.push("}".to_string());
            self.defs.push(String::new());
            return;
        }

        let expr = self.scalar_or_container_expr(type_name, schema);
        self.defs
            .push("#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]".to_string());
        self.defs
            .push(format!("pub struct {type_name}(pub {expr});"));
        self.defs.push(String::new());
    }

    fn type_expr(&mut self, type_name: &str, schema: &serde_json::Value) -> String {
        if object_fields(schema).is_some() {
            self.render_named_type(type_name, schema);
            return type_name.to_string();
        }

        self.scalar_or_container_expr(type_name, schema)
    }

    fn scalar_or_container_expr(&mut self, type_name: &str, schema: &serde_json::Value) -> String {
        if let Some(types) = schema.get("type").and_then(serde_json::Value::as_array) {
            let non_null = types
                .iter()
                .filter_map(serde_json::Value::as_str)
                .filter(|kind| *kind != "null")
                .collect::<Vec<_>>();
            if non_null.len() == 1 {
                let mut cloned = schema.clone();
                cloned["type"] = serde_json::Value::String(non_null[0].to_string());
                return self.scalar_or_container_expr(type_name, &cloned);
            }
            return "Value".to_string();
        }

        if schema.get("enum").is_some() || schema.get("const").is_some() {
            return literal_base_type(schema).unwrap_or("Value").to_string();
        }

        match schema.get("type").and_then(serde_json::Value::as_str) {
            Some("string") => "String".to_string(),
            Some("boolean") => "bool".to_string(),
            Some("integer") => "i64".to_string(),
            Some("number") => "f64".to_string(),
            Some("array") => {
                let item_schema = schema.get("items").unwrap_or(&serde_json::Value::Null);
                let item_name = format!("{type_name}Item");
                let item_type = self.type_expr(&item_name, item_schema);
                format!("Vec<{item_type}>")
            }
            Some("object") => {
                if let Some(value_schema) = object_map_value_schema(schema) {
                    let value_name = format!("{type_name}Value");
                    let value_type = self.type_expr(&value_name, value_schema);
                    return format!("BTreeMap<String, {value_type}>");
                }
                "BTreeMap<String, Value>".to_string()
            }
            _ => "Value".to_string(),
        }
    }

    fn finish(self) -> Vec<String> {
        self.defs
    }
}

fn object_fields(
    schema: &serde_json::Value,
) -> Option<&serde_json::Map<String, serde_json::Value>> {
    let is_object = schema.get("type").and_then(serde_json::Value::as_str) == Some("object");
    if !is_object {
        return None;
    }
    schema
        .get("properties")
        .and_then(serde_json::Value::as_object)
        .filter(|properties| !properties.is_empty())
}

fn schema_required(schema: &serde_json::Value, field_name: &str) -> bool {
    schema
        .get("required")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|required| {
            required
                .iter()
                .any(|value| value.as_str() == Some(field_name))
        })
}

fn object_map_value_schema(schema: &serde_json::Value) -> Option<&serde_json::Value> {
    if let Some(additional) = schema.get("additionalProperties") {
        if additional.as_bool() == Some(false) {
            return schema
                .get("patternProperties")
                .and_then(serde_json::Value::as_object)
                .and_then(single_map_schema_value);
        }
        return Some(additional);
    }

    schema
        .get("patternProperties")
        .and_then(serde_json::Value::as_object)
        .and_then(single_map_schema_value)
}

fn single_map_schema_value(
    schemas: &serde_json::Map<String, serde_json::Value>,
) -> Option<&serde_json::Value> {
    if schemas.len() == 1 {
        schemas.values().next()
    } else {
        None
    }
}

fn literal_base_type(schema: &serde_json::Value) -> Option<&'static str> {
    if let Some(value) = schema.get("const") {
        return match value {
            serde_json::Value::String(_) => Some("String"),
            serde_json::Value::Bool(_) => Some("bool"),
            serde_json::Value::Number(number) if number.is_i64() => Some("i64"),
            serde_json::Value::Number(_) => Some("f64"),
            _ => Some("Value"),
        };
    }

    let values = schema.get("enum")?.as_array()?;
    let first = values.first()?;
    match first {
        serde_json::Value::String(_) => Some("String"),
        serde_json::Value::Bool(_) => Some("bool"),
        serde_json::Value::Number(number) if number.is_i64() => Some("i64"),
        serde_json::Value::Number(_) => Some("f64"),
        _ => Some("Value"),
    }
}

fn join_string_literals(values: &[String]) -> String {
    values
        .iter()
        .map(|value| string_literal(value))
        .collect::<Vec<_>>()
        .join(", ")
}

fn string_literal(value: &str) -> String {
    serde_json::to_string(value).expect("string literal")
}

fn manifest_display_name(loaded: &trellis_contracts::LoadedManifest) -> String {
    loaded.manifest.display_name.clone()
}

fn sdk_stem_pascal(loaded: &trellis_contracts::LoadedManifest) -> String {
    sdk_stem_from_contract_id_pascal(&loaded.manifest.id)
}

fn sdk_stem_from_contract_id_pascal(contract_id: &str) -> String {
    default_sdk_stem(contract_id)
        .split('.')
        .flat_map(|segment| segment.split('-'))
        .map(key_to_pascal)
        .collect::<String>()
}

fn crate_ident(crate_name: &str) -> String {
    crate_name.replace('-', "_")
}

fn resolve_schema_ref<'a>(
    loaded: &'a trellis_contracts::LoadedManifest,
    schema_name: &str,
) -> &'a serde_json::Value {
    loaded
        .manifest
        .schemas
        .get(schema_name)
        .unwrap_or_else(|| panic!("missing schema '{schema_name}' in manifest"))
}

fn is_empty_object_schema(schema: &serde_json::Value) -> bool {
    let Some(kind) = schema.get("type").and_then(serde_json::Value::as_str) else {
        return false;
    };
    if kind != "object" {
        return false;
    }

    let properties_empty = schema
        .get("properties")
        .and_then(serde_json::Value::as_object)
        .is_none_or(|properties| properties.is_empty());
    let required_empty = schema
        .get("required")
        .and_then(serde_json::Value::as_array)
        .is_none_or(|required| required.is_empty());

    properties_empty && required_empty
}

fn render_lib_rs(loaded: &trellis_contracts::LoadedManifest) -> String {
    let client_name = format!("{}Client", sdk_stem_pascal(loaded));
    let operations_reexport = if loaded.manifest.operations.is_empty() {
        String::new()
    } else {
        "pub use operations::*;\n".to_string()
    };
    let events_reexport = if loaded.manifest.events.is_empty() {
        String::new()
    } else {
        "pub use events::*;\n".to_string()
    };
    let feeds_reexport = if loaded.manifest.feeds.is_empty() {
        String::new()
    } else {
        "pub use feeds::*;\n".to_string()
    };
    let feeds_module = if loaded.manifest.feeds.is_empty() {
        String::new()
    } else {
        "pub mod feeds;\n".to_string()
    };
    format!(
        "//! Generated Rust SDK crate for one Trellis contract.\n\npub mod client;\npub mod contract;\npub mod events;\n{feeds_module}pub mod operations;\npub mod rpc;\npub mod server;\npub mod types;\n\npub use client::{client_name};\npub use contract::{{contract_manifest, CONTRACT_DIGEST, CONTRACT_ID, CONTRACT_JSON, CONTRACT_NAME}};\n{events_reexport}{feeds_reexport}{operations_reexport}pub use rpc::*;\npub use types::*;\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("trellis-codegen-rust-{label}-{nanos}"))
    }

    fn write_sample_manifest(root: &Path) -> PathBuf {
        let manifest_path = root.join("trellis.core@v1.json");
        let manifest: serde_json::Value = serde_json::from_str(
            r#"{
                "format": "trellis.contract.v1",
                "id": "trellis.core@v1",
                "displayName": "Trellis Core",
                "description": "Trellis core runtime surface.",
                "kind": "service",
                "schemas": {
                    "CatalogInput": {"type":"object","properties":{},"required":[]},
                    "CatalogOutput": {"type":"object","properties":{"catalog":{"type":"object"}},"required":["catalog"]},
                    "ProcessInput": {"type":"object","properties":{"amount":{"type":"number"}},"required":["amount"]},
                    "ProcessProgress": {"type":"object","properties":{"step":{"type":"string"}},"required":["step"]},
                    "ProcessOutput": {"type":"object","properties":{"done":{"type":"boolean"}},"required":["done"]},
                    "AuthChangedEvent": {"type":"object","properties":{"status":{"type":"string"}},"required":["status"]},
                    "AuditFeedInput": {"type":"object","properties":{"since":{"type":"string"}},"required":["since"]},
                    "AuditFeedEvent": {"type":"object","properties":{"message":{"type":"string"}},"required":["message"]},
                    "ExternalCheckpoint": {"type":"object","properties":{"cursor":{"type":"string"}},"required":["cursor"]}
                },
                "exports": {"schemas": ["ExternalCheckpoint"]},
                "rpc": {
                    "Trellis.Catalog": {"version":"v1","subject":"rpc.v1.Trellis.Catalog","input":{"schema":"CatalogInput"},"output":{"schema":"CatalogOutput"}}
                },
                "operations": {
                    "Trellis.Process": {"version":"v1","subject":"operations.v1.Trellis.Process","input":{"schema":"ProcessInput"},"progress":{"schema":"ProcessProgress"},"output":{"schema":"ProcessOutput"},"transfer":{"direction":"send","store":"uploads","key":"/uploadKey"},"capabilities":{"call":["service"],"read":["service"],"cancel":["service"]},"cancel":true},
                    "Trellis.Audit": {"version":"v1","subject":"operations.v1.Trellis.Audit","input":{"schema":"ProcessInput"},"progress":{"schema":"ProcessProgress"},"output":{"schema":"ProcessOutput"}}
                },
                "events": {
                    "Auth.Changed": {"version":"v1","subject":"events.v1.Auth.Changed","event":{"schema":"AuthChangedEvent"},"capabilities":{"publish":["auth.event.publish"],"subscribe":["auth.event.subscribe"]}}
                },
                "feeds": {
                    "Audit.Feed": {"version":"v1","subject":"feeds.v1.Audit.Feed","input":{"schema":"AuditFeedInput"},"event":{"schema":"AuditFeedEvent"},"capabilities":{"subscribe":["audit.feed.subscribe"]}}
                }
            }"#,
        )
        .unwrap();

        fs::write(
            &manifest_path,
            trellis_contracts::canonicalize_json(&manifest).unwrap(),
        )
        .unwrap();
        manifest_path
    }

    fn write_remote_manifest(root: &Path, file_name: &str, manifest: serde_json::Value) -> PathBuf {
        let manifest_path = root.join(file_name);
        fs::write(
            &manifest_path,
            trellis_contracts::canonicalize_json(&manifest).unwrap(),
        )
        .unwrap();
        manifest_path
    }

    #[test]
    fn cargo_toml_uses_registry_dependencies() {
        let cargo = render_cargo_toml(
            &GenerateRustSdkOpts {
                manifest_path: PathBuf::from("generated/contracts/manifests/trellis.core@v1.json"),
                out_dir: PathBuf::from("generated/packages/cargo/trellis-core"),
                crate_name: "trellis-sdk-core".to_string(),
                crate_version: "0.1.0".to_string(),
                runtime_deps: RustRuntimeDeps {
                    source: RustRuntimeSource::Registry,
                    version: "0.1.0".to_string(),
                    repo_root: None,
                },
            },
            false,
        );

        assert!(cargo.contains("description = \"Generated Rust SDK crate for trellis-sdk-core.\""));
        assert!(cargo.contains("repository = \"https://github.com/qlever-llc/trellis\""));
        assert!(cargo.contains("trellis-client = \"0.1.0\""));
        assert!(!cargo.contains("path ="));
    }

    #[test]
    fn cargo_toml_uses_workspace_member_paths_for_local_runtime_deps() {
        let repo_root = unique_temp_dir("workspace-runtime-paths");
        fs::create_dir_all(repo_root.join("rust/crates/runtime-client")).unwrap();
        fs::create_dir_all(repo_root.join("rust/crates/runtime-contracts")).unwrap();
        fs::create_dir_all(repo_root.join("rust/crates/runtime-service")).unwrap();
        fs::create_dir_all(repo_root.join("rust/crates/sdk-generator")).unwrap();
        fs::write(
            repo_root.join("rust/Cargo.toml"),
            concat!(
                "[workspace]\n",
                "members = [\n",
                "  \"crates/runtime-client\",\n",
                "  \"crates/runtime-contracts\",\n",
                "  \"crates/runtime-service\",\n",
                "  \"crates/sdk-generator\",\n",
                "]\n",
            ),
        )
        .unwrap();
        fs::write(
            repo_root.join("rust/crates/runtime-client/Cargo.toml"),
            "[package]\nname = \"trellis-client\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .unwrap();
        fs::write(
            repo_root.join("rust/crates/runtime-contracts/Cargo.toml"),
            "[package]\nname = \"trellis-contracts\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .unwrap();
        fs::write(
            repo_root.join("rust/crates/runtime-service/Cargo.toml"),
            "[package]\nname = \"trellis-service\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .unwrap();
        fs::write(
            repo_root.join("rust/crates/sdk-generator/Cargo.toml"),
            "[package]\nname = \"trellis-codegen-rust\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .unwrap();

        let cargo = render_cargo_toml(
            &GenerateRustSdkOpts {
                manifest_path: PathBuf::from("generated/contracts/manifests/trellis.core@v1.json"),
                out_dir: PathBuf::from("generated/packages/cargo/trellis-core"),
                crate_name: "trellis-sdk-core".to_string(),
                crate_version: "0.1.0".to_string(),
                runtime_deps: RustRuntimeDeps {
                    source: RustRuntimeSource::Local,
                    version: "0.1.0".to_string(),
                    repo_root: Some(repo_root.clone()),
                },
            },
            false,
        );

        assert!(cargo.contains(
            &repo_root
                .join("rust/crates/runtime-client")
                .display()
                .to_string()
        ));
        assert!(cargo.contains(
            &repo_root
                .join("rust/crates/runtime-contracts")
                .display()
                .to_string()
        ));
        assert!(cargo.contains(
            &repo_root
                .join("rust/crates/runtime-service")
                .display()
                .to_string()
        ));
        assert!(!cargo.contains("rust/crates/client"));
    }

    #[test]
    fn cargo_toml_integrity_check_accepts_generated_sdk_manifest() {
        let out_dir = unique_temp_dir("sdk-cargo-integrity-valid");
        fs::create_dir_all(&out_dir).unwrap();
        let manifest_path = write_sample_manifest(&out_dir);
        let sdk_out = out_dir.join("generated");

        generate_rust_sdk(&GenerateRustSdkOpts {
            manifest_path,
            out_dir: sdk_out.clone(),
            crate_name: "trellis-sdk-core".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Registry,
                version: "0.1.0".to_string(),
                repo_root: None,
            },
        })
        .unwrap();

        assert!(rust_sdk_cargo_manifest_is_valid(
            &sdk_out.join("Cargo.toml"),
            "trellis-sdk-core",
            "0.1.0"
        ));

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn cargo_toml_integrity_check_rejects_missing_required_dependencies() {
        let out_dir = unique_temp_dir("sdk-cargo-integrity-invalid");
        fs::create_dir_all(&out_dir).unwrap();
        let cargo_toml = out_dir.join("Cargo.toml");
        fs::write(
            &cargo_toml,
            concat!(
                "[package]\n",
                "name = \"trellis-sdk-core\"\n",
                "version = \"0.1.0\"\n",
                "edition = \"2021\"\n\n",
                "[dependencies]\n",
                "trellis-client = \"0.1.0\"\n",
            ),
        )
        .unwrap();

        assert!(!rust_sdk_cargo_manifest_is_valid(
            &cargo_toml,
            "trellis-sdk-core",
            "0.1.0"
        ));

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_rust_source_validation_rejects_invalid_source() {
        let error = format_generated_rust_source("src/lib.rs", "pub fn broken(").unwrap_err();

        assert!(matches!(error, CodegenRustError::RustSyntax { path, .. } if path == "src/lib.rs"));
    }

    #[test]
    fn generated_rust_source_validation_formats_valid_source() {
        let formatted = format_generated_rust_source("src/lib.rs", "pub fn ok(){ }").unwrap();

        assert_eq!(formatted, "pub fn ok() {}\n");
    }

    #[test]
    fn invalid_generated_rust_is_rejected_before_write() {
        let out_dir = unique_temp_dir("invalid-rust-before-write");
        let target = out_dir.join("broken.rs");

        let error = write_rust_if_changed(&target, "pub fn broken(").unwrap_err();

        assert!(matches!(error, CodegenRustError::RustSyntax { .. }));
        assert!(!target.exists());

        if out_dir.exists() {
            fs::remove_dir_all(out_dir).unwrap();
        }
    }

    #[test]
    fn default_sdk_name_drops_duplicate_trellis_prefix() {
        assert_eq!(
            default_sdk_crate_name("trellis.core@v1"),
            "trellis-sdk-core"
        );
        assert_eq!(
            default_sdk_crate_name("trellis.auth@v1"),
            "trellis-sdk-auth"
        );
        assert_eq!(default_sdk_crate_name("graph@v1"), "trellis-sdk-graph");
    }

    #[test]
    fn key_to_snake_keeps_acronyms_together() {
        assert_eq!(key_to_snake("Jobs.ListDLQ"), "jobs_list_dlq");
        assert_eq!(key_to_snake("Jobs.ReplayDLQ"), "jobs_replay_dlq");
        assert_eq!(key_to_snake("HTTPServer"), "http_server");
    }

    #[test]
    fn local_runtime_source_writes_patch_config() {
        let out_dir = unique_temp_dir("local-runtime");
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()
            .unwrap();

        write_runtime_patch_config(&GenerateRustSdkOpts {
            manifest_path: repo_root.join("generated/contracts/manifests/trellis.core@v1.json"),
            out_dir: out_dir.clone(),
            crate_name: "trellis-sdk-core".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Local,
                version: "0.1.0".to_string(),
                repo_root: Some(repo_root.clone()),
            },
        })
        .unwrap();

        let config = fs::read_to_string(out_dir.join(".cargo/config.toml")).unwrap();
        assert!(config.contains("[patch.crates-io]"));
        assert!(config.contains(&repo_root.join("rust/crates/client").display().to_string()));

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_sdk_uses_contract_modules_shape() {
        let out_dir = unique_temp_dir("sdk-shape");
        fs::create_dir_all(&out_dir).unwrap();
        let manifest_path = write_sample_manifest(&out_dir);

        generate_rust_sdk(&GenerateRustSdkOpts {
            manifest_path,
            out_dir: out_dir.join("generated"),
            crate_name: "trellis-sdk-core".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Registry,
                version: "0.1.0".to_string(),
                repo_root: None,
            },
        })
        .unwrap();

        let lib_rs = fs::read_to_string(out_dir.join("generated/src/lib.rs")).unwrap();
        let contract_rs = fs::read_to_string(out_dir.join("generated/src/contract.rs")).unwrap();
        let types_rs = fs::read_to_string(out_dir.join("generated/src/types.rs")).unwrap();
        let rpc_rs = fs::read_to_string(out_dir.join("generated/src/rpc.rs")).unwrap();
        let operations_rs =
            fs::read_to_string(out_dir.join("generated/src/operations.rs")).unwrap();
        let events_rs = fs::read_to_string(out_dir.join("generated/src/events.rs")).unwrap();
        let feeds_rs = fs::read_to_string(out_dir.join("generated/src/feeds.rs")).unwrap();
        let client_rs = fs::read_to_string(out_dir.join("generated/src/client.rs")).unwrap();
        let server_rs = fs::read_to_string(out_dir.join("generated/src/server.rs")).unwrap();

        assert!(lib_rs.contains("pub mod rpc;"));
        assert!(lib_rs.contains("pub mod operations;"));
        assert!(lib_rs.contains("pub mod events;"));
        assert!(lib_rs.contains("pub mod feeds;"));
        assert!(lib_rs.contains("pub use feeds::*;"));
        assert!(!lib_rs.contains("pub mod subjects;"));
        assert!(contract_rs.contains("//! Generated from"));
        assert!(contract_rs.contains("pub const CONTRACT_NAME: &str = \"Trellis Core\";"));
        assert!(types_rs.contains("pub struct TrellisCatalogResponse {"));
        assert!(types_rs.contains("pub struct TrellisProcessInput {"));
        assert!(types_rs.contains("pub struct TrellisProcessProgress {"));
        assert!(types_rs.contains("pub struct TrellisProcessOutput {"));
        assert!(types_rs.contains("pub struct AuthChangedEvent {"));
        assert!(types_rs.contains("pub struct AuditFeedInput {"));
        assert!(types_rs.contains("pub struct AuditFeedEvent {"));
        assert!(types_rs.contains("pub struct ExternalCheckpoint {"));
        assert!(types_rs.contains("pub status: String,"));
        assert!(rpc_rs.contains("pub struct TrellisCatalogRpc;"));
        assert!(rpc_rs.contains("type Input = Empty;"));
        assert!(operations_rs.contains("pub struct TrellisProcessOperation;"));
        assert!(operations_rs
            .contains("use trellis_client::{OperationDescriptor, TransferOperationDescriptor};"));
        assert!(operations_rs
            .contains("use trellis_service::OperationDescriptor as ServerOperationDescriptor;"));
        assert!(operations_rs.contains("impl OperationDescriptor for TrellisProcessOperation"));
        assert!(operations_rs
            .contains("impl TransferOperationDescriptor for TrellisProcessOperation {}"));
        assert!(operations_rs.contains("impl OperationDescriptor for TrellisAuditOperation"));
        assert!(!operations_rs
            .contains("impl TransferOperationDescriptor for TrellisAuditOperation {}"));
        assert!(
            operations_rs.contains("impl ServerOperationDescriptor for TrellisProcessOperation")
        );
        assert!(events_rs.contains("pub struct AuthChangedEventDescriptor;"));
        assert!(events_rs.contains(
            "const PUBLISH_CAPABILITIES: &'static [&'static str] = &[\"auth.event.publish\"];"
        ));
        assert!(events_rs.contains("const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["));
        assert!(events_rs.contains("\"auth.event.subscribe\""));
        assert!(feeds_rs.contains("pub struct AuditFeedFeedDescriptor;"));
        assert!(feeds_rs.contains("impl FeedDescriptor for AuditFeedFeedDescriptor"));
        assert!(feeds_rs.contains("impl ServerFeedDescriptor for AuditFeedFeedDescriptor"));
        assert!(feeds_rs.contains("type Input = crate::types::AuditFeedInput;"));
        assert!(feeds_rs.contains("type Event = crate::types::AuditFeedEvent;"));
        assert!(feeds_rs.contains("const SUBJECT: &'static str = \"feeds.v1.Audit.Feed\";"));
        assert!(feeds_rs.contains(
            "const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[\"audit.feed.subscribe\"];"
        ));
        assert!(client_rs.contains("pub struct CoreClient<'a>"));
        assert!(client_rs.contains("pub async fn trellis_catalog("));
        assert!(client_rs.contains("pub async fn audit_feed("));
        assert!(client_rs.contains("futures_util::stream::BoxStream"));
        assert!(client_rs.contains("self.inner.feed::<crate::feeds::AuditFeedFeedDescriptor>"));
        assert!(client_rs.contains("trellis_client::OperationInvoker<"));
        assert!(client_rs.contains("crate::operations::TrellisProcessOperation"));
        assert!(server_rs.contains("register_trellis_catalog"));
        assert!(server_rs.contains("register_trellis_process"));
        assert!(server_rs.contains("register_audit_feed"));
        assert!(server_rs.contains("router.register_feed::<crate::feeds::AuditFeedFeedDescriptor"));
        assert!(server_rs.contains(
            "S: futures_util::Stream<Item = Result<crate::types::AuditFeedEvent, ServerError>>"
        ));
        assert!(server_rs.contains("pub fn register_trellis_process_provider<P>"));
        assert!(server_rs.contains(
            "P: trellis_service::OperationProvider<crate::operations::TrellisProcessOperation>,"
        ));
        assert!(server_rs.contains("router"));
        assert!(server_rs.contains("register_operation_provider::<"));
        assert!(server_rs.contains("crate::operations::TrellisProcessOperation"));

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_event_only_sdk_omits_unused_imports() {
        let out_dir = unique_temp_dir("event-only-sdk-imports");
        fs::create_dir_all(&out_dir).unwrap();
        let manifest_path = write_remote_manifest(
            &out_dir,
            "trellis.health@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "trellis.health@v1",
                "displayName": "Trellis Health",
                "description": "Trellis health events.",
                "kind": "service",
                "schemas": {
                    "Heartbeat": {
                        "type": "object",
                        "properties": { "service": { "type": "string" } },
                        "required": ["service"]
                    }
                },
                "events": {
                    "Health.Heartbeat": {
                        "version": "v1",
                        "subject": "events.v1.Health.Heartbeat",
                        "event": { "schema": "Heartbeat" }
                    }
                }
            }),
        );

        generate_rust_sdk(&GenerateRustSdkOpts {
            manifest_path,
            out_dir: out_dir.join("generated"),
            crate_name: "trellis-sdk-health".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Registry,
                version: "0.1.0".to_string(),
                repo_root: None,
            },
        })
        .unwrap();

        let rpc_rs = fs::read_to_string(out_dir.join("generated/src/rpc.rs")).unwrap();
        let server_rs = fs::read_to_string(out_dir.join("generated/src/server.rs")).unwrap();

        assert!(!rpc_rs.contains("trellis_client::RpcDescriptor"));
        assert!(!rpc_rs.contains("trellis_service::RpcDescriptor"));
        assert!(!server_rs.contains("HandlerResult"));
        assert!(!server_rs.contains("RequestContext"));
        assert!(!server_rs.contains("Router"));
        assert!(server_rs.contains("use trellis_service::{EventPublisher, ServerError};"));

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_sdk_types_use_typed_pattern_properties() {
        let out_dir = unique_temp_dir("sdk-pattern-properties");
        fs::create_dir_all(&out_dir).unwrap();
        let manifest = serde_json::from_str(
            r#"{
                "format": "trellis.contract.v1",
                "id": "trellis.core@v1",
                "displayName": "Trellis Core",
                "description": "Core.",
                "kind": "service",
                "schemas": {
                    "BindingsGetInput": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    },
                    "BindingsGetOutput": {
                        "type": "object",
                        "properties": {
                            "binding": {
                                "type": "object",
                                "required": ["resources"],
                                "properties": {
                                    "resources": {
                                        "type": "object",
                                        "required": ["streams"],
                                        "properties": {
                                            "streams": {
                                                "type": "object",
                                                "patternProperties": {
                                                    "^.*$": {
                                                        "type": "object",
                                                        "required": ["name", "sources"],
                                                        "properties": {
                                                            "name": { "type": "string" },
                                                            "sources": {
                                                                "type": "array",
                                                                "items": {
                                                                    "type": "object",
                                                                    "required": ["fromAlias", "streamName"],
                                                                    "properties": {
                                                                        "fromAlias": { "type": "string" },
                                                                        "streamName": { "type": "string" }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "required": ["binding"]
                    }
                },
                "rpc": {
                    "Trellis.Bindings.Get": {
                        "version": "v1",
                        "subject": "rpc.v1.Trellis.Bindings.Get",
                        "input": { "schema": "BindingsGetInput" },
                        "output": { "schema": "BindingsGetOutput" }
                    }
                }
            }"#,
        )
        .unwrap();
        let manifest_path = write_remote_manifest(&out_dir, "trellis.core@v1.json", manifest);

        generate_rust_sdk(&GenerateRustSdkOpts {
            manifest_path,
            out_dir: out_dir.join("generated"),
            crate_name: "trellis-sdk-core".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Registry,
                version: "0.1.0".to_string(),
                repo_root: None,
            },
        })
        .unwrap();

        let types_rs = fs::read_to_string(out_dir.join("generated/src/types.rs")).unwrap();

        assert!(types_rs.contains("pub streams: BTreeMap<"));
        assert!(types_rs.contains("TrellisBindingsGetResponseBindingResourcesStreamsValue"));
        assert!(types_rs
            .contains("pub struct TrellisBindingsGetResponseBindingResourcesStreamsValue {"));
        assert!(types_rs.contains(
            "pub struct TrellisBindingsGetResponseBindingResourcesStreamsValueSourcesItem {"
        ));
        assert!(!types_rs.contains("pub streams: BTreeMap<String, Value>"));

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_participant_facade_rejects_partial_alias_mappings() {
        let out_dir = unique_temp_dir("participant-partial-aliases");
        fs::create_dir_all(&out_dir).unwrap();

        let local_manifest = write_remote_manifest(
            &out_dir,
            "device@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "device@v1",
                "displayName": "Device",
                "description": "Device.",
                "kind": "device",
                "uses": {
                    "required": {
                        "core": {
                            "contract": "trellis.core@v1",
                            "rpc": { "call": ["Trellis.Catalog"] }
                        },
                        "auth": {
                            "contract": "trellis.auth@v1",
                            "rpc": { "call": ["Auth.Sessions.Me"] }
                        }
                    }
                }
            }),
        );
        let core_manifest = write_remote_manifest(
            &out_dir,
            "trellis.core@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "trellis.core@v1",
                "displayName": "Trellis Core",
                "description": "Core.",
                "kind": "service",
                "schemas": {
                    "CatalogInput": {"type":"object","properties":{},"required":[]},
                    "CatalogOutput": {"type":"object","properties":{},"required":[]}
                },
                "rpc": {
                    "Trellis.Catalog": {
                        "version":"v1",
                        "subject":"rpc.v1.Trellis.Catalog",
                        "input":{"schema":"CatalogInput"},
                        "output":{"schema":"CatalogOutput"}
                    }
                }
            }),
        );

        let error = generate_rust_participant_facade(&GenerateRustParticipantFacadeOpts {
            manifest_path: local_manifest,
            out_dir: out_dir.join("facade"),
            crate_name: "device-participant".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Registry,
                version: "0.1.0".to_string(),
                repo_root: None,
            },
            owned_sdk_crate_name: None,
            owned_sdk_path: None,
            alias_mappings: vec![ParticipantAliasMapping {
                alias: "core".to_string(),
                crate_name: "trellis-sdk-core".to_string(),
                manifest_path: core_manifest,
                crate_path: None,
            }],
        })
        .unwrap_err();

        assert!(matches!(
            error,
            CodegenRustError::MissingParticipantMappingAlias { alias, contract }
                if alias == "auth" && contract == "trellis.auth@v1"
        ));

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_participant_facade_allows_runtime_owned_health_baseline_without_mapping() {
        let out_dir = unique_temp_dir("participant-health-baseline-alias");
        fs::create_dir_all(&out_dir).unwrap();

        let local_manifest = write_remote_manifest(
            &out_dir,
            "device@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "device@v1",
                "displayName": "Device",
                "description": "Device.",
                "kind": "device",
                "uses": {
                    "required": {
                        "health": {
                            "contract": "trellis.health@v1",
                            "events": { "publish": ["Health.Heartbeat"] }
                        }
                    }
                }
            }),
        );

        generate_rust_participant_facade(&GenerateRustParticipantFacadeOpts {
            manifest_path: local_manifest,
            out_dir: out_dir.join("facade"),
            crate_name: "device-participant".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Registry,
                version: "0.1.0".to_string(),
                repo_root: None,
            },
            owned_sdk_crate_name: None,
            owned_sdk_path: None,
            alias_mappings: vec![],
        })
        .unwrap();

        assert!(out_dir.join("facade/Cargo.toml").exists());
        assert!(!out_dir.join("facade/contracts/health.json").exists());

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_participant_facade_exposes_owned_and_used_aliases() {
        let out_dir = unique_temp_dir("participant-facade");
        fs::create_dir_all(&out_dir).unwrap();

        let local_manifest = write_remote_manifest(
            &out_dir,
            "audit@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "audit@v1",
                "displayName": "Audit",
                "description": "Audit service.",
                "kind": "service",
                "schemas": {
                    "AuditListInput": {"type":"object","properties":{},"required":[]},
                    "AuditListOutput": {"type":"object","properties":{"items":{"type":"array","items":{"type":"string"}}},"required":["items"]}
                },
                "uses": {
                    "required": {
                        "core": {
                            "contract": "trellis.core@v1",
                            "rpc": { "call": ["Trellis.Catalog"] }
                        },
                        "auth": {
                            "contract": "trellis.auth@v1",
                            "rpc": { "call": ["Auth.Sessions.Me"] },
                            "events": { "publish": ["Auth.Connections.Opened"], "subscribe": ["Auth.Connections.Opened"] }
                        }
                    }
                },
                "rpc": {
                    "Audit.List": {
                        "version": "v1",
                        "subject": "rpc.v1.Audit.List",
                        "input": {"schema":"AuditListInput"},
                        "output": {"schema":"AuditListOutput"}
                    }
                }
            }),
        );
        let core_manifest = write_remote_manifest(
            &out_dir,
            "trellis.core@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "trellis.core@v1",
                "displayName": "Trellis Core",
                "description": "Core.",
                "kind": "service",
                "schemas": {
                    "CatalogInput": {"type":"object","properties":{},"required":[]},
                    "CatalogOutput": {"type":"object","properties":{},"required":[]},
                    "ContractGetInput": {"type":"object","properties":{"digest":{"type":"string"}},"required":["digest"]},
                    "ContractGetOutput": {"type":"object","properties":{},"required":[]}
                },
                "rpc": {
                    "Trellis.Catalog": {
                        "version":"v1",
                        "subject":"rpc.v1.Trellis.Catalog",
                        "input":{"schema":"CatalogInput"},
                        "output":{"schema":"CatalogOutput"}
                    },
                    "Trellis.Contract.Get": {
                        "version":"v1",
                        "subject":"rpc.v1.Trellis.Contract.Get",
                        "input":{"schema":"ContractGetInput"},
                        "output":{"schema":"ContractGetOutput"}
                    }
                }
            }),
        );
        let auth_manifest = write_remote_manifest(
            &out_dir,
            "trellis.auth@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "trellis.auth@v1",
                "displayName": "Trellis Auth",
                "description": "Auth.",
                "kind": "service",
                "schemas": {
                    "AuthSessionsMeInput": {"type":"object","properties":{},"required":[]},
                    "AuthSessionsMeOutput": {"type":"object","properties":{},"required":[]},
                    "AuthConnectionsOpenedEvent": {"type":"object","properties":{"user":{"type":"string"}},"required":["user"]}
                },
                "rpc": {
                    "Auth.Sessions.Me": {
                        "version":"v1",
                        "subject":"rpc.v1.Auth.Sessions.Me",
                        "input":{"schema":"AuthSessionsMeInput"},
                        "output":{"schema":"AuthSessionsMeOutput"}
                    }
                },
                "events": {
                    "Auth.Connections.Opened": {
                        "version":"v1",
                        "subject":"events.v1.Auth.Connections.Opened",
                        "event":{"schema":"AuthConnectionsOpenedEvent"}
                    }
                }
            }),
        );

        let owned_sdk_dir = out_dir.join("owned-sdk");
        fs::create_dir_all(&owned_sdk_dir).unwrap();

        generate_rust_participant_facade(&GenerateRustParticipantFacadeOpts {
            manifest_path: local_manifest,
            out_dir: out_dir.join("facade"),
            crate_name: "audit-participant".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Local,
                version: "0.1.0".to_string(),
                repo_root: Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")),
            },
            owned_sdk_crate_name: Some("audit-sdk".to_string()),
            owned_sdk_path: Some(owned_sdk_dir),
            alias_mappings: vec![
                ParticipantAliasMapping {
                    alias: "core".to_string(),
                    crate_name: "trellis-sdk-core".to_string(),
                    manifest_path: core_manifest,
                    crate_path: None,
                },
                ParticipantAliasMapping {
                    alias: "auth".to_string(),
                    crate_name: "trellis-sdk-auth".to_string(),
                    manifest_path: auth_manifest,
                    crate_path: None,
                },
            ],
        })
        .unwrap();

        let cargo_toml = fs::read_to_string(out_dir.join("facade/Cargo.toml")).unwrap();
        let build_rs = fs::read_to_string(out_dir.join("facade/build.rs")).unwrap();
        let lib_rs = fs::read_to_string(out_dir.join("facade/src/lib.rs")).unwrap();
        let connect_rs = fs::read_to_string(out_dir.join("facade/src/connect.rs")).unwrap();
        let contract_rs = fs::read_to_string(out_dir.join("facade/src/contract.rs")).unwrap();

        assert!(cargo_toml.contains("build = \"build.rs\""));
        assert!(cargo_toml.contains("serde = { version = \"1.0\", features = [\"derive\"] }"));
        assert!(cargo_toml.contains("trellis-client = { path = "));
        assert!(cargo_toml.contains("trellis-contracts = { path = "));
        assert!(cargo_toml.contains("trellis-service = { path = "));
        assert!(cargo_toml.contains("futures-util = \"0.3\""));
        assert!(build_rs.contains("generate_rust_participant_generated_sources"));
        assert!(
            lib_rs.contains("include!(concat!(env!(\"OUT_DIR\"), \"/generated/src/facade.rs\"));")
        );
        assert!(connect_rs.contains("connect_service"));
        assert!(connect_rs.contains("connect_user"));
        assert!(
            contract_rs.contains("participant.contract.json")
                || contract_rs.contains("audit@v1.json")
        );
        assert!(contract_rs.contains("pub const CONTRACT_DIGEST: &str = "));
        assert!(out_dir.join("facade/contracts/core.json").exists());
        assert!(out_dir.join("facade/contracts/auth.json").exists());

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_participant_facade_exposes_typed_state_helpers() {
        let out_dir = unique_temp_dir("participant-state");
        fs::create_dir_all(&out_dir).unwrap();

        let local_manifest = write_remote_manifest(
            &out_dir,
            "device@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "device@v1",
                "displayName": "Device",
                "description": "Device.",
                "kind": "device",
                "schemas": {
                    "SelectedSite": {
                        "type": "object",
                        "properties": { "siteId": { "type": "string" } },
                        "required": ["siteId"]
                    },
                    "DraftInspection": {
                        "type": "object",
                        "properties": { "title": { "type": "string" } },
                        "required": ["title"]
                    },
                    "State": {
                        "type": "object",
                        "properties": { "flag": { "type": "boolean" } },
                        "required": ["flag"]
                    },
                    "StateValue": {
                        "type": "object",
                        "properties": { "name": { "type": "string" } },
                        "required": ["name"]
                    },
                    "Foo": {
                        "type": "object",
                        "properties": { "one": { "type": "string" } },
                        "required": ["one"]
                    },
                    "FooState": {
                        "type": "object",
                        "properties": { "two": { "type": "string" } },
                        "required": ["two"]
                    }
                },
                "state": {
                    "selectedSite": {
                        "kind": "value",
                        "schema": { "schema": "SelectedSite" }
                    },
                    "draftInspections": {
                        "kind": "map",
                        "schema": { "schema": "DraftInspection" }
                    },
                    "currentState": {
                        "kind": "value",
                        "schema": { "schema": "State" }
                    },
                    "stateValue": {
                        "kind": "value",
                        "schema": { "schema": "StateValue" }
                    },
                    "foo": {
                        "kind": "value",
                        "schema": { "schema": "Foo" }
                    },
                    "fooState": {
                        "kind": "value",
                        "schema": { "schema": "FooState" }
                    }
                }
            }),
        );

        generate_rust_participant_generated_sources(&GenerateRustParticipantFacadeOpts {
            manifest_path: local_manifest,
            out_dir: out_dir.join("generated"),
            crate_name: "device-participant".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Registry,
                version: "0.1.0".to_string(),
                repo_root: None,
            },
            owned_sdk_crate_name: None,
            owned_sdk_path: None,
            alias_mappings: vec![],
        })
        .unwrap();

        let facade_rs = fs::read_to_string(out_dir.join("generated/src/facade.rs")).unwrap();
        let state_rs = fs::read_to_string(out_dir.join("generated/src/state.rs")).unwrap();

        assert!(facade_rs.contains("pub mod state"));
        assert!(facade_rs.contains("pub fn state(&self) -> state::State<'a>"));
        assert!(state_rs.contains("pub struct SelectedSiteState {"));
        assert!(state_rs.contains("pub site_id: String,"));
        assert!(state_rs.contains("pub struct DraftInspectionState {"));
        assert!(state_rs.contains("pub struct StateValue {"));
        assert!(state_rs.contains("pub struct StateValueState {"));
        assert!(state_rs.contains("pub struct FooState {"));
        assert!(state_rs.contains("pub struct FooState2 {"));
        assert!(state_rs.contains("pub fn selected_site("));
        assert!(state_rs.contains("trellis_client::ValueStateStore<"));
        assert!(state_rs.contains("SelectedSiteState"));
        assert!(
            state_rs.contains("trellis_client::ValueStateStore::new(self.inner, \"selectedSite\")")
        );
        assert!(state_rs.contains("pub fn draft_inspections("));
        assert!(state_rs.contains("trellis_client::MapStateStore<"));
        assert!(state_rs.contains("DraftInspectionState"));
        assert!(state_rs
            .contains("trellis_client::MapStateStore::new(self.inner, \"draftInspections\")"));
        assert!(state_rs.contains("pub fn current_state("));
        assert!(state_rs.contains("StateValue"));
        assert!(state_rs.contains("pub fn state_value("));
        assert!(state_rs.contains("StateValueState"));
        assert!(state_rs.contains("pub fn foo("));
        assert!(state_rs.contains("FooState"));
        assert!(state_rs.contains("pub fn foo_state("));
        assert!(state_rs.contains("FooState2"));

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_participant_alias_forwards_selected_operation_calls() {
        let out_dir = unique_temp_dir("participant-operation-alias");
        fs::create_dir_all(&out_dir).unwrap();

        let local_manifest = write_remote_manifest(
            &out_dir,
            "participant@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "participant@v1",
                "displayName": "Participant",
                "description": "Participant.",
                "kind": "service",
                "schemas": {},
                "uses": {
                    "required": {
                        "evidence": {
                            "contract": "evidence@v1",
                            "operations": { "call": ["Evidence.Upload"] },
                            "events": { "subscribe": ["Evidence.Uploaded"] },
                            "feeds": { "subscribe": ["Evidence.Stream"] }
                        }
                    }
                }
            }),
        );
        let evidence_manifest = write_remote_manifest(
            &out_dir,
            "evidence@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "evidence@v1",
                "displayName": "Evidence",
                "description": "Evidence.",
                "kind": "service",
                "schemas": {
                    "UploadInput": {"type":"object","properties":{"path":{"type":"string"}},"required":["path"]},
                    "UploadProgress": {"type":"object","properties":{"bytes":{"type":"number"}},"required":["bytes"]},
                    "UploadOutput": {"type":"object","properties":{"id":{"type":"string"}},"required":["id"]},
                    "DeleteInput": {"type":"object","properties":{"id":{"type":"string"}},"required":["id"]},
                    "DeleteProgress": {"type":"object","properties":{},"required":[]},
                    "DeleteOutput": {"type":"object","properties":{},"required":[]},
                    "EvidenceUploadedEvent": {"type":"object","properties":{"id":{"type":"string"}},"required":["id"]},
                    "EvidenceStreamInput": {"type":"object","properties":{},"required":[]},
                    "EvidenceStreamEvent": {"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}
                },
                "operations": {
                    "Evidence.Upload": {
                        "version":"v1",
                        "subject":"operations.v1.Evidence.Upload",
                        "input":{"schema":"UploadInput"},
                        "progress":{"schema":"UploadProgress"},
                        "output":{"schema":"UploadOutput"}
                    },
                    "Evidence.Delete": {
                        "version":"v1",
                        "subject":"operations.v1.Evidence.Delete",
                        "input":{"schema":"DeleteInput"},
                        "progress":{"schema":"DeleteProgress"},
                        "output":{"schema":"DeleteOutput"}
                    }
                },
                "events": {
                    "Evidence.Uploaded": {
                        "version":"v1",
                        "subject":"events.v1.Evidence.Uploaded",
                        "event":{"schema":"EvidenceUploadedEvent"}
                    }
                },
                "feeds": {
                    "Evidence.Stream": {
                        "version":"v1",
                        "subject":"feeds.v1.Evidence.Stream",
                        "input":{"schema":"EvidenceStreamInput"},
                        "event":{"schema":"EvidenceStreamEvent"}
                    }
                }
            }),
        );

        generate_rust_participant_generated_sources(&GenerateRustParticipantFacadeOpts {
            manifest_path: local_manifest,
            out_dir: out_dir.join("generated"),
            crate_name: "participant".to_string(),
            crate_version: "0.1.0".to_string(),
            runtime_deps: RustRuntimeDeps {
                source: RustRuntimeSource::Registry,
                version: "0.1.0".to_string(),
                repo_root: None,
            },
            owned_sdk_crate_name: None,
            owned_sdk_path: None,
            alias_mappings: vec![ParticipantAliasMapping {
                alias: "evidence".to_string(),
                crate_name: "evidence-sdk".to_string(),
                manifest_path: evidence_manifest,
                crate_path: None,
            }],
        })
        .unwrap();

        let evidence_rs =
            fs::read_to_string(out_dir.join("generated/src/uses/evidence.rs")).unwrap();
        assert!(evidence_rs.contains("pub fn evidence_upload("));
        assert!(evidence_rs.contains("trellis_client::OperationInvoker<"));
        assert!(evidence_rs.contains("sdk::operations::EvidenceUploadOperation"));
        assert!(evidence_rs.contains("self.inner.evidence_upload()"));
        assert!(evidence_rs.contains("pub async fn subscribe_evidence_uploaded("));
        assert!(evidence_rs.contains(
            "self.transport.subscribe::<sdk::events::EvidenceUploadedEventDescriptor>().await"
        ));
        assert!(evidence_rs.contains("pub async fn evidence_stream("));
        assert!(evidence_rs.contains(".feed::<sdk::feeds::EvidenceStreamFeedDescriptor>"));
        assert!(evidence_rs.contains("&sdk::rpc::Empty {}"));
        assert!(!evidence_rs.contains("evidence_delete"));

        fs::remove_dir_all(out_dir).unwrap();
    }

    #[test]
    fn generated_participant_facade_rejects_missing_mapped_feed() {
        let out_dir = unique_temp_dir("participant-missing-feed");
        fs::create_dir_all(&out_dir).unwrap();

        let local_manifest = write_remote_manifest(
            &out_dir,
            "participant@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "participant@v1",
                "displayName": "Participant",
                "description": "Participant.",
                "kind": "service",
                "uses": {
                    "required": {
                        "evidence": {
                            "contract": "evidence@v1",
                            "feeds": { "subscribe": ["Evidence.Stream"] }
                        }
                    }
                }
            }),
        );
        let evidence_manifest = write_remote_manifest(
            &out_dir,
            "evidence@v1.json",
            json!({
                "format": "trellis.contract.v1",
                "id": "evidence@v1",
                "displayName": "Evidence",
                "description": "Evidence.",
                "kind": "service",
                "feeds": {}
            }),
        );

        let error =
            generate_rust_participant_generated_sources(&GenerateRustParticipantFacadeOpts {
                manifest_path: local_manifest,
                out_dir: out_dir.join("generated"),
                crate_name: "participant".to_string(),
                crate_version: "0.1.0".to_string(),
                runtime_deps: RustRuntimeDeps {
                    source: RustRuntimeSource::Registry,
                    version: "0.1.0".to_string(),
                    repo_root: None,
                },
                owned_sdk_crate_name: None,
                owned_sdk_path: None,
                alias_mappings: vec![ParticipantAliasMapping {
                    alias: "evidence".to_string(),
                    crate_name: "evidence-sdk".to_string(),
                    manifest_path: evidence_manifest,
                    crate_path: None,
                }],
            })
            .unwrap_err();

        assert!(matches!(
            error,
            CodegenRustError::MissingMappedFeed { alias, key }
                if alias == "evidence" && key == "Evidence.Stream"
        ));

        fs::remove_dir_all(out_dir).unwrap();
    }
}
