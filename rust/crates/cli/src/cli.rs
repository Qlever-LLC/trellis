use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};
use clap_complete::Shell;

mod auth;
mod bootstrap;
mod devices;
mod portals;
mod self_cmd;
mod service;

pub use auth::*;
pub use bootstrap::*;
pub use devices::*;
pub use portals::*;
pub use self_cmd::*;
pub use service::*;

#[derive(Debug, Parser)]
#[command(name = "trellis", version, about = "Trellis CLI")]
/// Top-level Trellis CLI arguments shared by all subcommands.
pub struct Cli {
    #[arg(long, global = true, default_value = "text")]
    /// Render command output as human-readable text or machine-readable JSON.
    pub format: OutputFormat,

    #[arg(short, long, global = true, action = clap::ArgAction::Count)]
    /// Increase log verbosity. Repeat for additional detail.
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
    /// Generate shell completion scripts for Trellis.
    Completion { shell: Shell },
    /// Authenticate the Trellis CLI and manage approval records.
    Auth(AuthCommand),
    /// Run one-time bootstrap workflows for a fresh deployment.
    Bootstrap(BootstrapCommand),
    /// Generate an Ed25519 seed and public session key offline.
    Keygen(KeygenArgs),
    /// Manage custom login and device portals.
    Portal(PortalCommand),
    /// Manage service profiles and instances.
    Service(ServiceCommand),
    /// Manage device profiles, instances, and activations.
    Device(DeviceCommand),
    /// Check for or install CLI updates.
    #[command(name = "self")]
    Self_(SelfCommand),
    /// Print the current CLI version.
    Version,
}

#[derive(Debug, clap::Args)]
/// Generate a Trellis keypair, optionally from a fixed seed.
pub struct KeygenArgs {
    #[arg(long)]
    /// Reuse an existing base64url-encoded 32-byte Ed25519 seed.
    pub seed: Option<String>,

    #[arg(long)]
    /// Write the generated private seed to this file.
    pub out: Option<PathBuf>,

    #[arg(long)]
    /// Write the derived public session key to this file.
    pub pubout: Option<PathBuf>,
}

#[cfg(test)]
mod tests;
