use std::path::PathBuf;

use clap::{Args, Subcommand};

#[derive(Debug, Args)]
/// Namespace for bootstrap commands.
pub struct BootstrapCommand {
    #[command(subcommand)]
    pub command: BootstrapSubcommand,
}

#[derive(Debug, Subcommand)]
/// Bootstrap targets for a fresh deployment.
pub enum BootstrapSubcommand {
    Nats(NatsBootstrapArgs),
    Admin(BootstrapAdminArgs),
}

#[derive(Debug, Args)]
/// Bootstrap the NATS buckets and subjects required by Trellis services.
///
/// This command is expected to stay aligned with the auth/runtime bucket set so
/// a fresh install can start without creating missing state on first request.
pub struct NatsBootstrapArgs {
    #[arg(long)]
    pub trellis_creds: PathBuf,

    #[arg(long)]
    pub auth_creds: PathBuf,

    #[arg(long)]
    pub servers: Option<String>,
}

#[derive(Debug, Args)]
/// Seed an initial admin identity and bootstrap connection settings.
pub struct BootstrapAdminArgs {
    #[arg(long)]
    pub origin: String,

    #[arg(long)]
    pub id: String,

    #[arg(
        long,
        value_delimiter = ',',
        help = "Capabilities to seed (defaults to admin, trellis.catalog.read, trellis.contract.read)"
    )]
    pub capabilities: Vec<String>,

    #[arg(long)]
    pub creds: Option<PathBuf>,

    #[arg(long)]
    pub servers: Option<String>,
}
