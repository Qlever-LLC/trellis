use std::path::PathBuf;

use clap::{ArgGroup, Args, Subcommand};

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
#[command(group(
    ArgGroup::new("contract-source")
        .args(["manifest", "source", "image"])
        .required(true)
        .multiple(false)
))]
/// One concrete way to load a contract before generation or verification.
///
/// Exactly one input source must be supplied so downstream commands operate on a
/// single canonical manifest shape.
pub struct ContractInputArgs {
    #[arg(long, value_name = "CONTRACT_JSON", group = "contract-source")]
    /// Load the contract from a canonical JSON manifest file.
    pub manifest: Option<PathBuf>,

    #[arg(long, value_name = "CONTRACT_SOURCE", group = "contract-source")]
    /// Load the contract from a TypeScript or Rust source file.
    pub source: Option<PathBuf>,

    #[arg(long, value_name = "OCI_IMAGE", group = "contract-source")]
    /// Load the contract from an OCI image that embeds contract metadata.
    pub image: Option<String>,

    #[arg(long, default_value = "CONTRACT")]
    /// Export name to read when resolving a contract from source code.
    pub source_export: String,

    #[arg(long, default_value = "/trellis/contract.json")]
    /// Path to the contract manifest inside an OCI image.
    pub image_contract_path: String,
}

#[derive(Debug, Args)]
#[command(
    after_help = "Examples:\n  trellis service install --source ./contracts/graph.ts\n  trellis service install --manifest ./generated/contracts/manifests/acme.graph@v1.json --display-name Graph"
)]
/// Install a service contract through auth/admin RPCs.
pub struct ServiceInstallArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    /// Override the display name shown for the installed service.
    pub display_name: Option<String>,

    #[arg(long)]
    /// Override the human-readable service description.
    pub description: Option<String>,

    #[arg(long = "namespace", value_delimiter = ',')]
    /// Additional namespaces to bind to the installed service.
    pub extra_namespaces: Vec<String>,

    #[arg(short = 'f', long)]
    /// Skip the interactive install review prompt.
    pub force: bool,

    #[arg(long)]
    /// Install the service in an inactive state.
    pub inactive: bool,
}

#[derive(Debug, Args)]
#[command(
    after_help = "Examples:\n  trellis service upgrade --source ./contracts/graph.ts --service-key <session-key>\n  trellis service upgrade --image ghcr.io/acme/graph:1.2.0 --seed <seed>"
)]
/// Upgrade one installed service contract.
pub struct ServiceUpgradeArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    /// Existing public service key to upgrade.
    pub service_key: Option<String>,

    #[arg(long)]
    /// Existing service seed whose public key identifies the target service.
    pub seed: Option<String>,

    #[arg(short = 'f', long)]
    /// Skip the interactive upgrade review prompt.
    pub force: bool,
}
