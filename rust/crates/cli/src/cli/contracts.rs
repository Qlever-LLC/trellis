use std::path::PathBuf;

use clap::{Args, Subcommand};

#[derive(Debug, Args)]
/// Namespace for contract build and verification commands.
pub struct ContractsCommand {
    #[command(subcommand)]
    pub command: ContractsSubcommand,
}

#[derive(Debug, Subcommand)]
/// Contract pack and live verification operations.
pub enum ContractsSubcommand {
    Pack(PackContractsArgs),
    VerifyLive(VerifyLiveArgs),
}

#[derive(Debug, Args)]
/// Bundle multiple contracts into one pack artifact.
pub struct PackContractsArgs {
    #[arg(long = "manifest")]
    pub manifests: Vec<PathBuf>,

    #[arg(long = "source")]
    pub sources: Vec<PathBuf>,

    #[arg(long = "image")]
    pub images: Vec<String>,

    #[arg(long, default_value = "CONTRACT")]
    pub source_export: String,

    #[arg(long, default_value = "/trellis/contract.json")]
    pub image_contract_path: String,

    #[arg(long)]
    pub output: PathBuf,

    #[arg(long)]
    pub contracts_out: Option<PathBuf>,
}

#[derive(Debug, Args)]
/// Verify live subjects against a running NATS deployment.
pub struct VerifyLiveArgs {
    #[arg(long)]
    pub servers: String,

    #[arg(long)]
    pub creds: PathBuf,

    #[arg(long)]
    pub session_seed: String,

    #[arg(long)]
    pub limit: Option<usize>,
}
