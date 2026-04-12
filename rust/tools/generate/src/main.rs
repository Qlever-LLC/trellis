use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, Parser, Subcommand, ValueEnum};
use miette::IntoDiagnostic;
use serde::{Deserialize, Serialize};
use trellis_codegen_rust::{
    default_sdk_stem, GenerateRustSdkOpts, RustRuntimeDeps,
    RustRuntimeSource as CodegenRustRuntimeSource,
};
use trellis_codegen_ts::{
    GenerateTsSdkOpts, TsRuntimeDeps, TsRuntimeSource as CodegenTsRuntimeSource,
};
use trellis_contracts::ContractKind;

mod contract_input;
mod discovery;
mod output;

use discovery::{discover_contracts, discover_local_contracts, DiscoveredContractSource};

#[derive(Debug, Parser)]
#[command(
    name = "trellis-generate",
    version,
    about = "Generate and verify Trellis contract artifacts"
)]
struct Cli {
    #[arg(short = 'f', long, global = true)]
    force: bool,

    #[command(subcommand)]
    command: Option<TopLevelCommand>,
}

#[derive(Debug, Subcommand)]
enum TopLevelCommand {
    Prepare(PrepareArgs),
    Discover(DiscoverArgs),
    Generate(GenerateCommand),
}

#[derive(Debug, Args)]
struct PrepareArgs {
    #[arg(default_value = ".")]
    root: PathBuf,
}

#[derive(Debug, Args)]
struct DiscoverArgs {
    root: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
enum RuntimeSource {
    Registry,
    Local,
}

#[derive(Debug, Args, Clone)]
#[group(required = true, multiple = false)]
struct ContractInputArgs {
    #[arg(long, value_name = "CONTRACT_JSON")]
    manifest: Option<PathBuf>,

    #[arg(long, value_name = "CONTRACT_SOURCE")]
    source: Option<PathBuf>,

    #[arg(long, value_name = "OCI_IMAGE")]
    image: Option<String>,

    #[arg(long, default_value = "CONTRACT")]
    source_export: String,

    #[arg(long, default_value = "/trellis/contract.json")]
    image_contract_path: String,
}

#[derive(Debug, Args)]
struct GenerateCommand {
    #[command(subcommand)]
    command: GenerateSubcommand,
}

#[derive(Debug, Subcommand)]
enum GenerateSubcommand {
    Manifest(GenerateManifestArgs),
    Ts(GenerateTsSdkArgs),
    Rust(GenerateRustSdkArgs),
    All(GenerateAllArgs),
}

#[derive(Debug, Args)]
struct GenerateManifestArgs {
    #[command(flatten)]
    contract: ContractInputArgs,

    #[arg(long)]
    out: PathBuf,
}

#[derive(Debug, Args)]
struct GenerateTsSdkArgs {
    #[command(flatten)]
    contract: ContractInputArgs,

    #[arg(long)]
    out: PathBuf,

    #[arg(long)]
    artifact_version: Option<String>,

    #[arg(long)]
    package_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    runtime_source: RuntimeSource,

    #[arg(long)]
    runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct GenerateRustSdkArgs {
    #[command(flatten)]
    contract: ContractInputArgs,

    #[arg(long)]
    out: PathBuf,

    #[arg(long)]
    artifact_version: Option<String>,

    #[arg(long)]
    crate_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    runtime_source: RuntimeSource,

    #[arg(long)]
    runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct GenerateAllArgs {
    #[command(flatten)]
    contract: ContractInputArgs,

    #[arg(long)]
    out_manifest: PathBuf,

    #[arg(long)]
    artifact_version: Option<String>,

    #[arg(long)]
    ts_out: Option<PathBuf>,

    #[arg(long)]
    rust_out: Option<PathBuf>,

    #[arg(long)]
    package_name: Option<String>,

    #[arg(long)]
    crate_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    runtime_source: RuntimeSource,

    #[arg(long)]
    runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutoAction {
    Generate,
    Verify,
}

#[derive(Debug)]
struct AutoPlanEntry {
    discovered: DiscoveredContractSource,
    contract_id: String,
    contract_kind: ContractKind,
    action: AutoAction,
    out_manifest: Option<PathBuf>,
    ts_out: Option<PathBuf>,
    rust_out: Option<PathBuf>,
    runtime_source: RuntimeSource,
    runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Default, Clone, Copy)]
struct AutoExecutionSummary {
    generated: usize,
    verified: usize,
    skipped: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct GeneratedArtifactsMetadata {
    schema_version: u8,
    contract_id: String,
    contract_digest: String,
    artifact_version: String,
    runtime_source: RuntimeSource,
    has_ts_sdk: bool,
    has_rust_sdk: bool,
    package_name: String,
    crate_name: String,
    generator_fingerprint: String,
}

impl GeneratedArtifactsMetadata {
    const SCHEMA_VERSION: u8 = 1;
}

fn main() -> miette::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Some(TopLevelCommand::Prepare(args)) => prepare_command(&args, cli.force),
        Some(TopLevelCommand::Discover(args)) => discover_command(&args, cli.force),
        Some(TopLevelCommand::Generate(command)) => match command.command {
            GenerateSubcommand::Manifest(args) => generate_manifest_command(&args),
            GenerateSubcommand::Ts(args) => generate_ts_sdk_command(&args),
            GenerateSubcommand::Rust(args) => generate_rust_sdk_command(&args),
            GenerateSubcommand::All(args) => generate_all_command(&args, cli.force),
        },
        None => local_generate_command(cli.force),
    }
}

fn generate_manifest_command(args: &GenerateManifestArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    if let Some(parent) = args.out.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    fs::write(&args.out, format!("{}\n", resolved.loaded.canonical)).into_diagnostic()?;
    output::print_success(&format!(
        "generated canonical manifest for {}",
        resolved.loaded.manifest.id
    ));
    output::print_detail("manifest", args.out.display().to_string());
    output::print_detail("digest", &resolved.loaded.digest);
    Ok(())
}

fn generate_ts_sdk_command(args: &GenerateTsSdkArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    let package_name = args
        .package_name
        .clone()
        .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id));
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate a TypeScript SDK",
    )?;
    trellis_codegen_ts::generate_ts_sdk(&GenerateTsSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        package_name,
        package_version: artifact_version.clone(),
        runtime_deps: ts_runtime_deps(
            args.runtime_source,
            artifact_version,
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
    let resolved = resolve_contract(&args.contract)?;
    let crate_name = args
        .crate_name
        .clone()
        .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id));
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate a Rust SDK",
    )?;
    trellis_codegen_rust::generate_rust_sdk(&GenerateRustSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        crate_name,
        crate_version: artifact_version.clone(),
        runtime_deps: rust_runtime_deps(
            args.runtime_source,
            artifact_version,
            args.runtime_repo_root.clone(),
        ),
    })
    .into_diagnostic()?;
    output::print_success(&format!("generated Rust SDK at {}", args.out.display()));
    Ok(())
}

fn generate_all_command(args: &GenerateAllArgs, force: bool) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate all artifacts",
    )?;
    let package_name = args
        .package_name
        .clone()
        .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id));
    let crate_name = args
        .crate_name
        .clone()
        .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id));
    let generator_fingerprint = current_generator_fingerprint();
    let metadata = generated_artifacts_metadata(
        &resolved,
        &artifact_version,
        args.runtime_source,
        args.ts_out.is_some(),
        args.rust_out.is_some(),
        &package_name,
        &crate_name,
        &generator_fingerprint,
    );
    if !force
        && generated_artifacts_are_fresh(
            &metadata,
            &args.out_manifest,
            args.ts_out.as_deref(),
            args.rust_out.as_deref(),
        )
    {
        output::print_success(&format!(
            "artifacts already up to date for {}",
            resolved.loaded.manifest.id
        ));
        return Ok(());
    }
    write_contract_outputs(
        &resolved,
        artifact_version,
        &args.out_manifest,
        args.ts_out.as_deref(),
        args.rust_out.as_deref(),
        &package_name,
        &crate_name,
        args.runtime_source,
        args.runtime_repo_root.clone(),
        &generator_fingerprint,
        "generated contract artifacts",
    )
}

fn prepare_command(args: &PrepareArgs, force: bool) -> miette::Result<()> {
    let canonical_root = args.root.canonicalize().into_diagnostic()?;
    let shared_output_root = detect_output_root(&canonical_root);
    let plan = build_auto_plan(discover_contracts(&args.root)?, Some(&shared_output_root))?;
    if plan.is_empty() {
        output::print_title("Trellis Prepare");
        output::print_detail("root", args.root.display().to_string());
        output::print_info("No contracts found.");
        return Ok(());
    }
    execute_auto_plan(&plan, Some("Trellis Prepare"), false, force).map(|_| ())
}

fn local_generate_command(force: bool) -> miette::Result<()> {
    let cwd = std::env::current_dir().into_diagnostic()?;
    let discovered = discover_local_contracts(&cwd)?;
    let plan = build_auto_plan(discovered, None)?;
    execute_auto_plan(&plan, Some("Trellis Generate"), false, force).map(|_| ())
}

fn discover_command(args: &DiscoverArgs, force: bool) -> miette::Result<()> {
    let canonical_root = args.root.canonicalize().into_diagnostic()?;
    let shared_output_root = detect_output_root(&canonical_root);
    let plan = build_auto_plan(discover_contracts(&args.root)?, Some(&shared_output_root))?;
    output::print_title("Trellis Generate Discover");
    output::print_detail("root", args.root.display().to_string());
    if plan.is_empty() {
        output::print_info("No contracts found.");
        return Ok(());
    }
    output::print_section("Plan");
    output::print_discover_summary(&discover_summary_lines(&plan));
    let summary = execute_auto_plan(&plan, None, true, force)?;
    output::print_section("Result");
    output::print_info(&output::summary_line("generated", summary.generated));
    output::print_info(&output::summary_line("verified", summary.verified));
    output::print_info(&output::summary_line("skipped", summary.skipped));
    Ok(())
}

fn build_auto_plan(
    discovered: Vec<DiscoveredContractSource>,
    shared_output_root: Option<&Path>,
) -> miette::Result<Vec<AutoPlanEntry>> {
    let mut plan = Vec::new();
    for contract in discovered {
        let (contract_id, contract_kind) = discover_contract_metadata(&contract)?;
        let action = action_for_kind(&contract_kind);
        let output_root = shared_output_root
            .map(Path::to_path_buf)
            .unwrap_or_else(|| detect_output_root(&contract.project_root));
        let runtime_source = detect_runtime_source(&output_root);
        let runtime_repo_root =
            matches!(runtime_source, RuntimeSource::Local).then_some(output_root.clone());
        let (out_manifest, ts_out, rust_out) = match action {
            AutoAction::Generate => {
                let sdk_stem = sdk_output_stem(&contract_id);
                (
                    Some(
                        output_root
                            .join("generated/contracts/manifests")
                            .join(format!("{}.json", contract_id)),
                    ),
                    Some(output_root.join("generated/js/sdks").join(&sdk_stem)),
                    Some(output_root.join("generated/rust/sdks").join(&sdk_stem)),
                )
            }
            AutoAction::Verify => (None, None, None),
        };
        plan.push(AutoPlanEntry {
            discovered: contract,
            contract_id,
            contract_kind,
            action,
            out_manifest,
            ts_out,
            rust_out,
            runtime_source,
            runtime_repo_root,
        });
    }
    plan.sort_by(|left, right| {
        auto_action_rank(left.action)
            .cmp(&auto_action_rank(right.action))
            .then_with(|| {
                left.discovered
                    .source_path
                    .cmp(&right.discovered.source_path)
            })
    });
    Ok(plan)
}

fn execute_auto_plan(
    plan: &[AutoPlanEntry],
    title: Option<&str>,
    show_title: bool,
    force: bool,
) -> miette::Result<AutoExecutionSummary> {
    if show_title {
        output::print_section("Run");
    } else if let Some(title) = title {
        output::print_title(title);
    }

    let generator_fingerprint = current_generator_fingerprint();
    let mut summary = AutoExecutionSummary::default();
    for entry in plan {
        let resolved = contract_input::resolve_contract_input(
            None,
            Some(entry.discovered.source_path.as_path()),
            None,
            "CONTRACT",
            contract_input::default_image_contract_path(),
        )?;
        match entry.action {
            AutoAction::Generate => {
                let artifact_version = required_owner_version(
                    &resolved,
                    "generate service artifacts from local discovery",
                )?;
                let package_name = default_ts_package_name_from_id(&resolved.loaded.manifest.id);
                let crate_name = default_rust_crate_name_from_id(&resolved.loaded.manifest.id);
                let out_manifest = entry.out_manifest.as_ref().ok_or_else(|| {
                    miette::miette!("missing manifest output for generated contract")
                })?;
                let metadata = generated_artifacts_metadata(
                    &resolved,
                    &artifact_version,
                    entry.runtime_source,
                    entry.ts_out.is_some(),
                    entry.rust_out.is_some(),
                    &package_name,
                    &crate_name,
                    &generator_fingerprint,
                );
                if !force
                    && generated_artifacts_are_fresh(
                        &metadata,
                        out_manifest,
                        entry.ts_out.as_deref(),
                        entry.rust_out.as_deref(),
                    )
                {
                    output::print_success(&format!(
                        "artifacts already up to date for {}",
                        resolved.loaded.manifest.id
                    ));
                    summary.skipped += 1;
                    continue;
                }
                print_auto_entry(entry);
                write_contract_outputs(
                    &resolved,
                    artifact_version,
                    out_manifest,
                    entry.ts_out.as_deref(),
                    entry.rust_out.as_deref(),
                    &package_name,
                    &crate_name,
                    entry.runtime_source,
                    entry.runtime_repo_root.clone(),
                    &generator_fingerprint,
                    "generated contract artifacts",
                )?;
                summary.generated += 1;
            }
            AutoAction::Verify => {
                if show_title {
                    print_auto_entry(entry);
                }
                output::print_success(&format!("verified {}", resolved.loaded.manifest.id));
                summary.verified += 1;
            }
        }
    }
    Ok(summary)
}

fn discover_summary_lines(plan: &[AutoPlanEntry]) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current_project_root: Option<&Path> = None;
    for entry in plan {
        let project_root = entry.discovered.project_root.as_path();
        if current_project_root != Some(project_root) {
            current_project_root = Some(project_root);
            lines.push(project_root.display().to_string());
        }
        lines.push(format!(
            "  {}  {}  {}",
            entry.contract_id,
            contract_kind_label(&entry.contract_kind),
            action_label(entry.action)
        ));
    }
    lines
}

fn print_auto_entry(entry: &AutoPlanEntry) {
    output::print_section(&format!(
        "{} {}",
        action_label(entry.action),
        entry.contract_id
    ));
    output::print_detail("kind", contract_kind_label(&entry.contract_kind));
    output::print_detail("source", entry.discovered.source_path.display().to_string());
    if let Some(out_manifest) = &entry.out_manifest {
        output::print_detail("manifest", out_manifest.display().to_string());
    }
    if let Some(ts_out) = &entry.ts_out {
        output::print_detail("ts sdk", ts_out.display().to_string());
    }
    if let Some(rust_out) = &entry.rust_out {
        output::print_detail("rust sdk", rust_out.display().to_string());
    }
}

fn action_for_kind(kind: &ContractKind) -> AutoAction {
    match kind {
        ContractKind::Service => AutoAction::Generate,
        ContractKind::App | ContractKind::Portal | ContractKind::Workload | ContractKind::Cli => {
            AutoAction::Verify
        }
    }
}

fn contract_kind_label(kind: &ContractKind) -> &'static str {
    match kind {
        ContractKind::Service => "service",
        ContractKind::App => "app",
        ContractKind::Portal => "portal",
        ContractKind::Workload => "workload",
        ContractKind::Cli => "cli",
    }
}

fn action_label(action: AutoAction) -> &'static str {
    match action {
        AutoAction::Generate => "generate",
        AutoAction::Verify => "verify",
    }
}

fn auto_action_rank(action: AutoAction) -> u8 {
    match action {
        AutoAction::Generate => 0,
        AutoAction::Verify => 1,
    }
}

fn discover_contract_metadata(
    contract: &DiscoveredContractSource,
) -> miette::Result<(String, ContractKind)> {
    match contract.language {
        discovery::SourceLanguage::TypeScript => {
            discover_typescript_contract_metadata(&contract.source_path)
        }
        discovery::SourceLanguage::Rust => discover_rust_contract_metadata(&contract.source_path),
    }
}

fn discover_typescript_contract_metadata(path: &Path) -> miette::Result<(String, ContractKind)> {
    let source = fs::read_to_string(path).into_diagnostic()?;
    let contract_id = extract_quoted_source_field(&source, "id")
        .ok_or_else(|| miette::miette!("failed to infer contract id from {}", path.display()))?;
    let kind = parse_contract_kind(&extract_quoted_source_field(&source, "kind").ok_or_else(
        || miette::miette!("failed to infer contract kind from {}", path.display()),
    )?)?;
    Ok((contract_id, kind))
}

fn discover_rust_contract_metadata(path: &Path) -> miette::Result<(String, ContractKind)> {
    let resolved = contract_input::resolve_contract_input(
        None,
        Some(path),
        None,
        "CONTRACT",
        contract_input::default_image_contract_path(),
    )?;
    Ok((resolved.loaded.manifest.id, resolved.loaded.manifest.kind))
}

fn extract_quoted_source_field(source: &str, field: &str) -> Option<String> {
    let needle = format!("{field}:");
    let mut offset = 0;
    while let Some(found) = source[offset..].find(&needle) {
        let start = offset + found;
        let before = source[..start].chars().next_back();
        if before.is_some_and(|ch| ch == '_' || ch.is_ascii_alphanumeric()) {
            offset = start + needle.len();
            continue;
        }
        let after = source[start + needle.len()..].trim_start();
        let value = after.strip_prefix('"')?;
        let end = value.find('"')?;
        return Some(value[..end].to_string());
    }
    None
}

fn parse_contract_kind(value: &str) -> miette::Result<ContractKind> {
    match value {
        "service" => Ok(ContractKind::Service),
        "app" => Ok(ContractKind::App),
        "portal" => Ok(ContractKind::Portal),
        "workload" => Ok(ContractKind::Workload),
        "cli" => Ok(ContractKind::Cli),
        _ => Err(miette::miette!("unsupported contract kind '{value}'")),
    }
}

fn detect_output_root(project_root: &Path) -> PathBuf {
    let mut current = Some(project_root);
    while let Some(dir) = current {
        if dir.join(".git").exists() {
            return dir.to_path_buf();
        }
        current = dir.parent();
    }
    project_root.to_path_buf()
}

fn detect_runtime_source(output_root: &Path) -> RuntimeSource {
    if output_root.join("rust/Cargo.toml").exists()
        && output_root.join("js/packages/trellis").exists()
    {
        RuntimeSource::Local
    } else {
        RuntimeSource::Registry
    }
}

fn sdk_output_stem(contract_id: &str) -> String {
    match contract_id {
        "trellis.core@v1" => "trellis-core".to_string(),
        _ => default_sdk_stem(contract_id),
    }
}

fn resolve_contract(
    args: &ContractInputArgs,
) -> miette::Result<contract_input::ResolvedContractInput> {
    contract_input::resolve_contract_input(
        args.manifest.as_deref(),
        args.source.as_deref(),
        args.image.as_deref(),
        &args.source_export,
        &args.image_contract_path,
    )
}

fn write_contract_outputs(
    resolved: &contract_input::ResolvedContractInput,
    artifact_version: String,
    out_manifest: &Path,
    ts_out: Option<&Path>,
    rust_out: Option<&Path>,
    package_name: &str,
    crate_name: &str,
    runtime_source: RuntimeSource,
    runtime_repo_root: Option<PathBuf>,
    generator_fingerprint: &str,
    success_message: &str,
) -> miette::Result<()> {
    let metadata = generated_artifacts_metadata(
        resolved,
        &artifact_version,
        runtime_source,
        ts_out.is_some(),
        rust_out.is_some(),
        package_name,
        crate_name,
        generator_fingerprint,
    );
    if let Some(parent) = out_manifest.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    write_if_changed(out_manifest, &format!("{}\n", resolved.loaded.canonical))?;

    if let Some(ts_out) = ts_out {
        trellis_codegen_ts::generate_ts_sdk(&GenerateTsSdkOpts {
            manifest_path: out_manifest.to_path_buf(),
            out_dir: ts_out.to_path_buf(),
            package_name: package_name.to_string(),
            package_version: artifact_version.clone(),
            runtime_deps: ts_runtime_deps(
                runtime_source,
                artifact_version.clone(),
                runtime_repo_root.clone(),
            ),
        })
        .into_diagnostic()?;
    }

    if let Some(rust_out) = rust_out {
        trellis_codegen_rust::generate_rust_sdk(&GenerateRustSdkOpts {
            manifest_path: out_manifest.to_path_buf(),
            out_dir: rust_out.to_path_buf(),
            crate_name: crate_name.to_string(),
            crate_version: artifact_version.clone(),
            runtime_deps: rust_runtime_deps(
                runtime_source,
                artifact_version.clone(),
                runtime_repo_root,
            ),
        })
        .into_diagnostic()?;
    }

    write_generated_artifacts_metadata(out_manifest, &metadata)?;

    output::print_success(&format!(
        "{} for {}",
        success_message, resolved.loaded.manifest.id
    ));
    output::print_detail("manifest", out_manifest.display().to_string());
    output::print_detail("digest", &resolved.loaded.digest);
    Ok(())
}

fn generated_artifacts_metadata(
    resolved: &contract_input::ResolvedContractInput,
    artifact_version: &str,
    runtime_source: RuntimeSource,
    has_ts_sdk: bool,
    has_rust_sdk: bool,
    package_name: &str,
    crate_name: &str,
    generator_fingerprint: &str,
) -> GeneratedArtifactsMetadata {
    GeneratedArtifactsMetadata {
        schema_version: GeneratedArtifactsMetadata::SCHEMA_VERSION,
        contract_id: resolved.loaded.manifest.id.clone(),
        contract_digest: resolved.loaded.digest.clone(),
        artifact_version: artifact_version.to_string(),
        runtime_source,
        has_ts_sdk,
        has_rust_sdk,
        package_name: package_name.to_string(),
        crate_name: crate_name.to_string(),
        generator_fingerprint: generator_fingerprint.to_string(),
    }
}

fn generated_artifacts_are_fresh(
    expected: &GeneratedArtifactsMetadata,
    out_manifest: &Path,
    ts_out: Option<&Path>,
    rust_out: Option<&Path>,
) -> bool {
    let Some(existing) = read_generated_artifacts_metadata(out_manifest) else {
        return false;
    };
    existing == *expected
        && out_manifest.exists()
        && ts_key_outputs_exist(ts_out)
        && rust_key_outputs_exist(rust_out)
}

fn read_generated_artifacts_metadata(out_manifest: &Path) -> Option<GeneratedArtifactsMetadata> {
    let contents = fs::read_to_string(generated_artifacts_metadata_path(out_manifest)).ok()?;
    serde_json::from_str(&contents).ok()
}

fn write_generated_artifacts_metadata(
    out_manifest: &Path,
    metadata: &GeneratedArtifactsMetadata,
) -> miette::Result<()> {
    write_if_changed(
        &generated_artifacts_metadata_path(out_manifest),
        &format!(
            "{}\n",
            serde_json::to_string_pretty(metadata).into_diagnostic()?
        ),
    )
}

fn generated_artifacts_metadata_path(out_manifest: &Path) -> PathBuf {
    out_manifest.with_extension("trellis-generate.json")
}

fn ts_key_outputs_exist(ts_out: Option<&Path>) -> bool {
    let Some(ts_out) = ts_out else {
        return true;
    };
    ts_out.join("mod.ts").exists() && ts_out.join("contract.ts").exists()
}

fn rust_key_outputs_exist(rust_out: Option<&Path>) -> bool {
    let Some(rust_out) = rust_out else {
        return true;
    };
    rust_out.join("Cargo.toml").exists() && rust_out.join("src/contract.rs").exists()
}

fn write_if_changed(path: &Path, contents: &str) -> miette::Result<()> {
    if fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    fs::write(path, contents).into_diagnostic()?;
    Ok(())
}

fn current_generator_fingerprint() -> &'static str {
    env!("TRELLIS_GENERATE_FINGERPRINT")
}

fn infer_artifact_version(
    resolved: &contract_input::ResolvedContractInput,
    explicit: Option<String>,
    action: &str,
) -> miette::Result<String> {
    explicit.or(resolved.owner_version.clone()).ok_or_else(|| {
        miette::miette!(
            "cannot {action}: no version could be inferred; pass --artifact-version when using --manifest or --image"
        )
    })
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

fn rust_runtime_deps(
    source: RuntimeSource,
    version: String,
    repo_root: Option<PathBuf>,
) -> RustRuntimeDeps {
    RustRuntimeDeps {
        source: match source {
            RuntimeSource::Registry => CodegenRustRuntimeSource::Registry,
            RuntimeSource::Local => CodegenRustRuntimeSource::Local,
        },
        version,
        repo_root,
    }
}

fn ts_runtime_deps(
    source: RuntimeSource,
    version: String,
    repo_root: Option<PathBuf>,
) -> TsRuntimeDeps {
    TsRuntimeDeps {
        source: match source {
            RuntimeSource::Registry => CodegenTsRuntimeSource::Registry,
            RuntimeSource::Local => CodegenTsRuntimeSource::Local,
        },
        version,
        repo_root,
    }
}
