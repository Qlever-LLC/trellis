use std::path::PathBuf;

use clap::{ArgGroup, Args, Subcommand};

#[derive(Debug, Args)]
/// Manage service profiles and instances.
pub struct ServiceCommand {
    #[command(subcommand)]
    pub command: ServiceSubcommand,
}

#[derive(Debug, Subcommand)]
/// Service lifecycle operations.
pub enum ServiceSubcommand {
    /// Manage service profiles.
    Profile(ServiceProfileCommand),
    /// Manage service instances.
    Instance(ServiceInstanceCommand),
}

#[derive(Debug, Args, Clone)]
#[command(group(
    ArgGroup::new("contract-source")
        .args(["manifest", "source", "image"])
        .required(true)
        .multiple(false)
))]
/// One concrete way to load a contract before generation or verification.
pub struct ContractInputArgs {
    #[arg(long, value_name = "CONTRACT_JSON", group = "contract-source")]
    pub manifest: Option<PathBuf>,

    #[arg(long, value_name = "CONTRACT_SOURCE", group = "contract-source")]
    pub source: Option<PathBuf>,

    #[arg(long, value_name = "OCI_IMAGE", group = "contract-source")]
    pub image: Option<String>,

    #[arg(long, default_value = "CONTRACT")]
    pub source_export: String,

    #[arg(long, default_value = "/trellis/contract.json")]
    pub image_contract_path: String,
}

#[derive(Debug, Args)]
pub struct ServiceProfileCommand {
    #[command(subcommand)]
    pub command: ServiceProfileSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum ServiceProfileSubcommand {
    List(ServiceProfileListArgs),
    Create(ServiceProfileCreateArgs),
    Apply(ServiceProfileApplyArgs),
    Unapply(ServiceProfileUnapplyArgs),
    Disable(ServiceProfileToggleArgs),
    Enable(ServiceProfileToggleArgs),
    Remove(ServiceProfileRemoveArgs),
}

#[derive(Debug, Args)]
pub struct ServiceInstanceCommand {
    #[command(subcommand)]
    pub command: ServiceInstanceSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum ServiceInstanceSubcommand {
    List(ServiceInstanceListArgs),
    Provision(ServiceInstanceProvisionArgs),
    Disable(ServiceInstanceToggleArgs),
    Enable(ServiceInstanceToggleArgs),
    Remove(ServiceInstanceRemoveArgs),
}

#[derive(Debug, Args)]
pub struct ServiceProfileListArgs {
    #[arg(long)]
    pub disabled: bool,
}

#[derive(Debug, Args)]
pub struct ServiceProfileCreateArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,

    #[arg(long = "namespace", value_delimiter = ',')]
    pub namespaces: Vec<String>,
}

#[derive(Debug, Args)]
pub struct ServiceProfileApplyArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,

    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(short = 'f', long)]
    pub force: bool,
}

#[derive(Debug, Args)]
pub struct ServiceProfileUnapplyArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,

    #[arg(value_name = "CONTRACT")]
    pub contract_id: String,

    #[arg(long = "digest", value_delimiter = ',')]
    pub digests: Vec<String>,
}

#[derive(Debug, Args)]
pub struct ServiceProfileToggleArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,
}

#[derive(Debug, Args)]
pub struct ServiceProfileRemoveArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,

    #[arg(short = 'f', long)]
    pub force: bool,
}

#[derive(Debug, Args)]
pub struct ServiceInstanceListArgs {
    #[arg(long = "profile")]
    pub profile: Option<String>,

    #[arg(long)]
    pub disabled: bool,
}

#[derive(Debug, Args)]
pub struct ServiceInstanceProvisionArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,

    #[arg(long = "instance-seed")]
    pub instance_seed: Option<String>,
}

#[derive(Debug, Args)]
pub struct ServiceInstanceToggleArgs {
    #[arg(value_name = "INSTANCE")]
    pub instance: String,
}

#[derive(Debug, Args)]
pub struct ServiceInstanceRemoveArgs {
    #[arg(value_name = "INSTANCE")]
    pub instance: String,

    #[arg(short = 'f', long)]
    pub force: bool,
}
