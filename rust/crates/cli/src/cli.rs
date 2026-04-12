use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};
use clap_complete::Shell;

mod auth;
mod bootstrap;
mod contracts;
mod devices;
mod portals;
mod self_cmd;
mod service;

pub use auth::*;
pub use bootstrap::*;
pub use contracts::*;
pub use devices::*;
pub use portals::*;
pub use self_cmd::*;
pub use service::*;

#[derive(Debug, Parser)]
#[command(name = "trellis", version, about = "Trellis CLI")]
/// Top-level Trellis CLI arguments shared by all subcommands.
pub struct Cli {
    #[arg(long, global = true)]
    pub nats_servers: Option<String>,

    #[arg(long, global = true)]
    pub creds: Option<PathBuf>,

    #[arg(long, global = true, default_value = "text")]
    pub format: OutputFormat,

    #[arg(short, long, global = true, action = clap::ArgAction::Count)]
    pub verbose: u8,

    #[command(subcommand)]
    pub command: TopLevelCommand,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
/// Output encoder used for human-facing commands.
pub enum OutputFormat {
    Text,
    Json,
}

#[derive(Debug, Subcommand)]
/// Root command tree for Trellis development and auth administration tasks.
pub enum TopLevelCommand {
    Completion {
        shell: Shell,
    },
    Auth(AuthCommand),
    Bootstrap(BootstrapCommand),
    Keygen(KeygenArgs),
    Portals(PortalsCommand),
    Service(ServiceCommand),
    Devices(DevicesCommand),
    Contracts(ContractsCommand),
    #[command(name = "self")]
    Self_(SelfCommand),
    Version,
}

#[derive(Debug, clap::Args)]
/// Generate a Trellis keypair, optionally from a fixed seed.
pub struct KeygenArgs {
    #[arg(long)]
    pub seed: Option<String>,

    #[arg(long)]
    pub out: Option<PathBuf>,

    #[arg(long)]
    pub pubout: Option<PathBuf>,
}

#[cfg(test)]
mod tests;
