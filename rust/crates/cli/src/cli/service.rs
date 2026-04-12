use std::path::PathBuf;

use clap::{Args, Subcommand};

#[derive(Debug, Args)]
/// Namespace for service installation and upgrade commands.
pub struct ServiceCommand {
    #[command(subcommand)]
    pub command: ServiceSubcommand,
}

#[derive(Debug, Subcommand)]
/// Service lifecycle operations.
pub enum ServiceSubcommand {
    List,
    Install(ServiceInstallArgs),
    Upgrade(ServiceUpgradeArgs),
}

#[derive(Debug, Args, Clone)]
#[group(required = true, multiple = false)]
/// One concrete way to load a contract before generation or verification.
///
/// Exactly one input source must be supplied so downstream commands operate on a
/// single canonical manifest shape.
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
/// Install a service contract through auth/admin RPCs.
pub struct ServiceInstallArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub display_name: Option<String>,

    #[arg(long)]
    pub description: Option<String>,

    #[arg(long = "namespace", value_delimiter = ',')]
    pub extra_namespaces: Vec<String>,

    #[arg(short = 'f', long)]
    pub force: bool,

    #[arg(long)]
    pub inactive: bool,
}

#[derive(Debug, Args)]
/// Upgrade one installed service contract.
pub struct ServiceUpgradeArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub service_key: Option<String>,

    #[arg(long)]
    pub seed: Option<String>,

    #[arg(short = 'f', long)]
    pub force: bool,
}
