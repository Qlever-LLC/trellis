use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};
use clap_complete::Shell;

mod auth;
mod bootstrap;
mod deploy;
mod self_cmd;

pub use auth::*;
pub use bootstrap::*;
pub use deploy::*;
pub use self_cmd::*;

#[derive(Debug, Parser)]
#[command(name = "trellis", version = env!("TRELLIS_BUILD_VERSION"), about = "Trellis CLI")]
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
/// Root command tree for Trellis operator, admin, and local development tasks.
pub enum TopLevelCommand {
    /// Start a detached portal login against a Trellis auth service.
    Login(LoginArgs),
    /// Revoke the current admin session and clear local session state.
    Logout,
    /// Show the currently logged-in Trellis admin session.
    Whoami,
    /// List or revoke stored approval decisions.
    Approvals(ApprovalsCommand),
    /// Manage Trellis users.
    Users(UsersCommand),
    /// Manage service deployments.
    Svc(SvcCommand),
    /// Manage device deployments.
    Dev(DevCommand),
    /// Generate local Trellis development files.
    Local(LocalCommand),
    /// Apply or check shared infrastructure.
    Infra(InfraCommand),
    /// Run one-time initialization workflows.
    Init(InitCommand),
    /// Generate or derive Trellis keys.
    Keys(KeysCommand),
    /// Check for or install CLI updates.
    Upgrade(UpgradeCommand),
    /// Print the current CLI version.
    Version,
    /// Generate shell completion scripts for Trellis.
    Completion { shell: Shell },
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
