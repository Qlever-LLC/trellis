use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct SelfCommand {
    #[command(subcommand)]
    pub command: SelfSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum SelfSubcommand {
    Check(SelfCheckArgs),
    Update(SelfUpdateArgs),
}

#[derive(Debug, Args)]
pub struct SelfCheckArgs {
    #[arg(long)]
    pub prerelease: bool,
}

#[derive(Debug, Args)]
pub struct SelfUpdateArgs {
    #[arg(long)]
    pub prerelease: bool,
}
