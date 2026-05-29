use clap::{Args, Subcommand};

#[derive(Debug, Args)]
/// Start a detached portal login against an auth service.
pub struct LoginArgs {
    #[arg(value_name = "TRELLIS_URL")]
    /// Base URL for the Trellis deployment.
    pub trellis_url: String,
}

#[derive(Debug, Args)]
/// Manage identity-owned authority and grants.
pub struct IdentityCommand {
    #[command(subcommand)]
    pub command: IdentitySubcommand,
}

#[derive(Debug, Subcommand)]
/// Identity authority and grant operations.
pub enum IdentitySubcommand {
    /// List or revoke delegated identity grants.
    Grants(IdentityGrantsCommand),
}

#[derive(Debug, Args)]
/// Manage delegated identity grants for contract-bearing clients.
pub struct IdentityGrantsCommand {
    #[command(subcommand)]
    pub command: IdentityGrantsSubcommand,
}

#[derive(Debug, Subcommand)]
/// Identity grant list and revoke operations.
pub enum IdentityGrantsSubcommand {
    /// Filter identity grants by user or contract digest.
    List(IdentityGrantsListArgs),
    /// Revoke one identity grant by identity grant ID.
    Revoke(IdentityGrantsRevokeArgs),
}

#[derive(Debug, Args)]
/// Filter identity grants by user or contract digest.
pub struct IdentityGrantsListArgs {
    #[arg(long)]
    /// Restrict results to grants stored for one Trellis user ID.
    pub user: Option<String>,

    #[arg(long, value_name = "CONTRACT_DIGEST")]
    /// Restrict results to one granted contract digest.
    pub digest: Option<String>,
}

#[derive(Debug, Args)]
/// Revoke a delegated identity grant by identity grant ID.
pub struct IdentityGrantsRevokeArgs {
    #[arg(value_name = "IDENTITY_GRANT_ID")]
    /// The identity grant ID to remove.
    pub identity_grant_id: String,

    #[arg(long)]
    /// Limit revocation to one Trellis user ID.
    pub user: Option<String>,
}

#[derive(Debug, Args)]
/// Manage Trellis users.
pub struct UsersCommand {
    #[command(subcommand)]
    pub command: UsersSubcommand,
}

#[derive(Debug, Args)]
/// Inspect and manage login portal admin surfaces.
pub struct PortalsCommand {
    #[command(subcommand)]
    pub command: PortalsSubcommand,
}

#[derive(Debug, Subcommand)]
/// Portal registry and login portal policy operations.
pub enum PortalsSubcommand {
    /// List visible login portals.
    List,
    /// Inspect login portal admin surfaces.
    Login(PortalsLoginCommand),
}

#[derive(Debug, Args)]
/// Inspect built-in login settings and selection routes.
pub struct PortalsLoginCommand {
    #[command(subcommand)]
    pub command: PortalsLoginSubcommand,
}

#[derive(Debug, Subcommand)]
/// Built-in login portal settings and route selection operations.
pub enum PortalsLoginSubcommand {
    /// Show built-in login registration defaults.
    Default,
    /// List login route selection rules.
    Selection,
}

#[derive(Debug, Subcommand)]
/// User administration operations.
pub enum UsersSubcommand {
    /// List users.
    List,
    /// Show one user by Trellis user ID.
    Show(UserRefArgs),
    /// Create one Trellis user.
    Create(UserCreateArgs),
    /// Edit one Trellis user.
    Edit(UserEditArgs),
}

#[derive(Debug, Args)]
/// Reference one user by Trellis user ID.
pub struct UserRefArgs {
    #[arg(value_name = "USER_ID")]
    pub user_id: String,
}

#[derive(Debug, Args)]
/// Create one Trellis user.
pub struct UserCreateArgs {
    #[arg(long)]
    pub name: Option<String>,

    #[arg(long)]
    pub email: Option<String>,

    #[arg(long)]
    pub username: Option<String>,

    #[arg(long)]
    pub inactive: bool,

    #[arg(long = "capability")]
    pub capabilities: Vec<String>,

    #[arg(long = "group")]
    pub groups: Vec<String>,
}

#[derive(Debug, Args)]
#[command(group(
    clap::ArgGroup::new("active_state")
        .args(["active", "inactive"])
        .multiple(false)
))]
/// Edit one Trellis user.
pub struct UserEditArgs {
    #[arg(value_name = "USER_ID")]
    pub user_id: String,

    #[arg(long)]
    pub active: bool,

    #[arg(long)]
    pub inactive: bool,

    #[arg(long)]
    pub name: Option<String>,

    #[arg(long)]
    pub email: Option<String>,

    #[arg(long = "add-capability")]
    pub add_capabilities: Vec<String>,

    #[arg(long = "remove-capability")]
    pub remove_capabilities: Vec<String>,

    #[arg(long = "set-capability")]
    pub set_capabilities: Vec<String>,

    #[arg(long = "clear-capabilities")]
    pub clear_capabilities: bool,

    #[arg(long = "add-group")]
    pub add_groups: Vec<String>,

    #[arg(long = "remove-group")]
    pub remove_groups: Vec<String>,

    #[arg(long = "set-group")]
    pub set_groups: Vec<String>,

    #[arg(long = "clear-groups")]
    pub clear_groups: bool,
}
