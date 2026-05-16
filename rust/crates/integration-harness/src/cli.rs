use clap::Parser;

#[derive(Debug, Clone, Default, Eq, Parser, PartialEq)]
#[command(name = "integration", about = "Run the Trellis integration harness")]
/// CLI arguments for the Trellis integration harness.
pub struct IntegrationArgs {
    #[arg(long)]
    /// Print known failing integration cases and exit.
    pub list_known_failures: bool,

    #[arg(long)]
    /// Print required integration coverage areas and exit.
    pub list_required_coverage: bool,

    #[arg(long)]
    /// Fail when any known failing integration cases are still registered.
    pub strict_known_failures: bool,

    #[arg(long)]
    /// Preserve the temporary integration workdir after the command exits.
    pub keep_workdir: bool,

    #[arg(long)]
    /// Skip the prepare workflow before bootstrapping integration dependencies.
    pub skip_prepare: bool,
}
