use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct DevicesCommand {
    #[command(subcommand)]
    pub command: DevicesSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum DevicesSubcommand {
    Provision(DevicesProvisionArgs),
    Profiles(DevicesProfilesCommand),
    Instances(DevicesInstancesCommand),
    Activations(DevicesActivationsCommand),
    Reviews(DevicesReviewsCommand),
}

#[derive(Debug, Args)]
pub struct DevicesProfilesCommand {
    #[command(subcommand)]
    pub command: DevicesProfilesSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum DevicesProfilesSubcommand {
    List(DevicesProfilesListArgs),
    Create(DevicesProfilesCreateArgs),
    Disable(DevicesProfilesDisableArgs),
}

#[derive(Debug, Args)]
pub struct DevicesInstancesCommand {
    #[command(subcommand)]
    pub command: DevicesInstancesSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum DevicesInstancesSubcommand {
    List(DevicesInstancesListArgs),
    Disable(DevicesInstancesDisableArgs),
}

#[derive(Debug, Args)]
pub struct DevicesActivationsCommand {
    #[command(subcommand)]
    pub command: DevicesActivationsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum DevicesActivationsSubcommand {
    List(DevicesActivationsListArgs),
    Revoke(DevicesActivationsRevokeArgs),
}

#[derive(Debug, Args)]
pub struct DevicesReviewsCommand {
    #[command(subcommand)]
    pub command: DevicesReviewsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum DevicesReviewsSubcommand {
    List(DevicesReviewsListArgs),
    Approve(DevicesReviewDecisionArgs),
    Reject(DevicesReviewDecisionArgs),
}

#[derive(Debug, Args)]
pub struct DevicesProfilesListArgs {
    #[arg(long = "contract")]
    pub contract: Option<String>,

    #[arg(long)]
    pub disabled: bool,
}

#[derive(Debug, Args)]
pub struct DevicesProfilesCreateArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,

    #[arg(value_name = "CONTRACT")]
    pub contract: String,

    #[arg(long = "review-mode")]
    pub review_mode: Option<String>,
}

#[derive(Debug, Args)]
pub struct DevicesProfilesDisableArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,
}

#[derive(Debug, Args)]
pub struct DevicesProvisionArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,
}

#[derive(Debug, Args)]
pub struct DevicesInstancesListArgs {
    #[arg(long = "profile")]
    pub profile: Option<String>,

    #[arg(long)]
    pub state: Option<String>,
}

#[derive(Debug, Args)]
pub struct DevicesInstancesDisableArgs {
    #[arg(value_name = "INSTANCE")]
    pub instance: String,
}

#[derive(Debug, Args)]
pub struct DevicesActivationsListArgs {
    #[arg(long = "instance")]
    pub instance: Option<String>,

    #[arg(long = "profile")]
    pub profile: Option<String>,

    #[arg(long)]
    pub state: Option<String>,
}

#[derive(Debug, Args)]
pub struct DevicesActivationsRevokeArgs {
    #[arg(value_name = "INSTANCE")]
    pub instance: String,
}

#[derive(Debug, Args)]
pub struct DevicesReviewsListArgs {
    #[arg(long = "instance")]
    pub instance: Option<String>,

    #[arg(long = "profile")]
    pub profile: Option<String>,

    #[arg(long)]
    pub state: Option<String>,
}

#[derive(Debug, Args)]
pub struct DevicesReviewDecisionArgs {
    #[arg(value_name = "REVIEW")]
    pub review: String,

    #[arg(long)]
    pub reason: Option<String>,
}
