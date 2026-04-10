use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, Parser, Subcommand, ValueEnum};
use miette::IntoDiagnostic;
use trellis_codegen_rust::{
    GenerateRustSdkOpts, RustRuntimeDeps, RustRuntimeSource as CodegenRustRuntimeSource,
};
use trellis_codegen_ts::{
    GenerateTsSdkOpts, TsRuntimeDeps, TsRuntimeSource as CodegenTsRuntimeSource,
};

mod contract_input;

#[derive(Debug, Parser)]
#[command(name = "trellis", version, about = "Trellis bootstrap CLI")]
struct Cli {
    #[command(subcommand)]
    command: TopLevelCommand,
}

#[derive(Debug, Subcommand)]
enum TopLevelCommand {
    Generate(GenerateCommand),
    Contracts(ContractsCommand),
}

#[derive(Debug, Clone, Copy, ValueEnum)]
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

#[derive(Debug, Args)]
struct ContractsCommand {
    #[command(subcommand)]
    command: ContractsSubcommand,
}

#[derive(Debug, Subcommand)]
enum ContractsSubcommand {
    Build(BuildContractArgs),
    Verify(VerifyManifestArgs),
}

#[derive(Debug, Args)]
struct BuildContractArgs {
    #[arg(long)]
    source: PathBuf,

    #[arg(long, default_value = "CONTRACT")]
    source_export: String,

    #[arg(long)]
    out_manifest: PathBuf,

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

#[derive(Debug, Args)]
struct VerifyManifestArgs {
    #[command(flatten)]
    contract: ContractInputArgs,
}

fn main() -> miette::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        TopLevelCommand::Generate(command) => match command.command {
            GenerateSubcommand::Manifest(args) => generate_manifest_command(&args),
            GenerateSubcommand::Ts(args) => generate_ts_sdk_command(&args),
            GenerateSubcommand::Rust(args) => generate_rust_sdk_command(&args),
            GenerateSubcommand::All(args) => generate_all_command(&args),
        },
        TopLevelCommand::Contracts(command) => match command.command {
            ContractsSubcommand::Build(args) => build_contract_command(&args),
            ContractsSubcommand::Verify(args) => verify_manifest_command(&args),
        },
    }
}

fn generate_manifest_command(args: &GenerateManifestArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    if let Some(parent) = args.out.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    fs::write(&args.out, format!("{}\n", resolved.loaded.canonical)).into_diagnostic()?;
    print_success(&format!(
        "generated canonical manifest for {}",
        resolved.loaded.manifest.id
    ));
    print_info(&format!("manifest={}", args.out.display()));
    print_info(&format!("digest={}", resolved.loaded.digest));
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
    print_success(&format!(
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
    print_success(&format!("generated Rust SDK at {}", args.out.display()));
    Ok(())
}

fn generate_all_command(args: &GenerateAllArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate all artifacts",
    )?;
    write_contract_outputs(
        &resolved,
        artifact_version,
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

fn build_contract_command(args: &BuildContractArgs) -> miette::Result<()> {
    let resolved = contract_input::resolve_contract_input(
        None,
        Some(args.source.as_path()),
        None,
        &args.source_export,
        contract_input::default_image_contract_path(),
    )?;
    let artifact_version = required_owner_version(&resolved, "build SDKs from contract source")?;
    write_contract_outputs(
        &resolved,
        artifact_version,
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

fn verify_manifest_command(args: &VerifyManifestArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    print_success(&format!(
        "verified contract {}",
        resolved.loaded.manifest.id
    ));
    print_info(&format!("manifest={}", resolved.manifest_path.display()));
    print_info(&format!("digest={}", resolved.loaded.digest));
    Ok(())
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
    package_name: Option<&String>,
    crate_name: Option<&String>,
    runtime_source: RuntimeSource,
    runtime_repo_root: Option<PathBuf>,
    success_message: &str,
) -> miette::Result<()> {
    if let Some(parent) = out_manifest.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    fs::write(out_manifest, format!("{}\n", resolved.loaded.canonical)).into_diagnostic()?;

    if let Some(ts_out) = ts_out {
        trellis_codegen_ts::generate_ts_sdk(&GenerateTsSdkOpts {
            manifest_path: out_manifest.to_path_buf(),
            out_dir: ts_out.to_path_buf(),
            package_name: package_name
                .cloned()
                .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id)),
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
            crate_name: crate_name
                .cloned()
                .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id)),
            crate_version: artifact_version.clone(),
            runtime_deps: rust_runtime_deps(
                runtime_source,
                artifact_version.clone(),
                runtime_repo_root,
            ),
        })
        .into_diagnostic()?;
    }

    print_success(&format!(
        "{} for {}",
        success_message, resolved.loaded.manifest.id
    ));
    print_info(&format!("manifest={}", out_manifest.display()));
    print_info(&format!("digest={}", resolved.loaded.digest));
    Ok(())
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

fn print_success(message: &str) {
    println!("ok {message}");
}

fn print_info(message: &str) {
    println!("{message}");
}
