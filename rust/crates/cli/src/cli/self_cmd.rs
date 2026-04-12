use clap::{Args, Subcommand};

#[derive(Debug, Args)]
/// Check for or install newer Trellis CLI releases.
pub struct SelfCommand {
    #[command(subcommand)]
    pub command: SelfSubcommand,
}

#[derive(Debug, Subcommand)]
/// Trellis CLI self-management commands.
pub enum SelfSubcommand {
    /// Check GitHub releases and report whether an update is available.
    Check(SelfCheckArgs),
    /// Download and install the latest Trellis CLI release for this platform.
    Update(SelfUpdateArgs),
}

#[derive(Debug, Args)]
/// Check whether a newer Trellis CLI release exists.
pub struct SelfCheckArgs {
    #[arg(long)]
    /// Include prerelease versions such as release candidates.
    pub prerelease: bool,
}

#[derive(Debug, Args)]
/// Install the newest Trellis CLI release for this platform.
pub struct SelfUpdateArgs {
    #[arg(long)]
    /// Allow prerelease versions such as release candidates.
    pub prerelease: bool,
}
