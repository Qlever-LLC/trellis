use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};

#[derive(Debug, Parser)]
#[command(
    name = "trellis-generate",
    version,
    about = "Generate and verify Trellis contract artifacts"
)]
pub struct Cli {
    #[arg(short = 'f', long, global = true)]
    pub force: bool,

    #[command(subcommand)]
    pub command: Option<TopLevelCommand>,
}

#[derive(Debug, Subcommand)]
pub enum TopLevelCommand {
    Prepare(PrepareArgs),
    Discover(DiscoverArgs),
    Generate(GenerateCommand),
}

#[derive(Debug, Args)]
pub struct PrepareArgs {
    #[arg(default_value = ".")]
    pub root: PathBuf,
}

#[derive(Debug, Args)]
pub struct DiscoverArgs {
    pub root: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeSource {
    Registry,
    Local,
}

#[derive(Debug, Args, Clone)]
#[group(required = true, multiple = false)]
pub struct ContractInputArgs {
    #[arg(long, value_name = "CONTRACT_JSON")]
    pub manifest: Option<PathBuf>,

    #[arg(long, value_name = "CONTRACT_SOURCE")]
    pub source: Option<PathBuf>,

    #[arg(long, value_name = "OCI_IMAGE")]
    pub image: Option<String>,

    #[arg(long, default_value = "CONTRACT")]
    pub source_export: String,

    #[arg(long, default_value = "/trellis/contract.json")]
    pub image_contract_path: String,
}

#[derive(Debug, Args)]
pub struct GenerateCommand {
    #[command(subcommand)]
    pub command: GenerateSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum GenerateSubcommand {
    Manifest(GenerateManifestArgs),
    Ts(GenerateTsSdkArgs),
    Rust(GenerateRustSdkArgs),
    All(GenerateAllArgs),
}

#[derive(Debug, Args)]
pub struct GenerateManifestArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,
}

#[derive(Debug, Args)]
pub struct GenerateTsSdkArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct GenerateRustSdkArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct GenerateAllArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out_manifest: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub ts_out: Option<PathBuf>,

    #[arg(long)]
    pub rust_out: Option<PathBuf>,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}
