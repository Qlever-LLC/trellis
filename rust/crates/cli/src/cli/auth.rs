use clap::{Args, Subcommand};

#[derive(Debug, Args)]
/// Manage Trellis CLI login state and approval records.
pub struct AuthCommand {
    #[command(subcommand)]
    pub command: AuthSubcommand,
}

#[derive(Debug, Subcommand)]
/// Authenticate the CLI or inspect stored app approvals.
pub enum AuthSubcommand {
    /// Start a detached portal login against a Trellis auth service.
    Login(AuthLoginArgs),
    /// Revoke the current admin session and clear local session state.
    Logout,
    /// Show the currently logged-in Trellis admin session.
    Status,
    /// List or revoke stored approval decisions.
    Approval(AuthApprovalCommand),
    /// Manage deployment-wide instance grant policies.
    Grant(AuthGrantCommand),
}

#[derive(Debug, Args)]
/// Manage deployment-wide instance grant policies.
pub struct AuthGrantCommand {
    #[command(subcommand)]
    pub command: AuthGrantSubcommand,
}

#[derive(Debug, Subcommand)]
/// List, create, and disable deployment-wide instance grant policies.
pub enum AuthGrantSubcommand {
    /// List configured instance grant policies.
    List,
    /// Create or replace one instance grant policy.
    Set(AuthGrantSetArgs),
    /// Disable one instance grant policy.
    Disable(AuthGrantDisableArgs),
}

#[derive(Debug, Args)]
#[command(
    after_help = "Examples:\n  trellis auth grant set trellis.console@v1 --capability admin\n  trellis auth grant set ./js/apps/console/contracts/trellis_app.ts --capability admin --allow-origin https://console.example.com"
)]
/// Create or replace one instance grant policy.
pub struct AuthGrantSetArgs {
    #[arg(value_name = "CONTRACT")]
    /// Contract identifier, source path, manifest path, or embedded contract reference.
    pub contract: String,

    #[arg(long = "capability", value_name = "CAPABILITY")]
    /// Capability implied while this policy is active. Repeat to set multiple values.
    pub capabilities: Vec<String>,

    #[arg(long = "allow-origin", value_name = "ORIGIN")]
    /// Optional browser origin restriction. Repeat to set multiple origins.
    pub allowed_origins: Vec<String>,
}

#[derive(Debug, Args)]
/// Disable one deployment-wide instance grant policy.
pub struct AuthGrantDisableArgs {
    #[arg(value_name = "CONTRACT_ID")]
    /// Contract lineage whose instance grant policy should be disabled.
    pub contract_id: String,
}

#[derive(Debug, Args)]
/// Manage stored approval decisions for contract-bearing clients.
pub struct AuthApprovalCommand {
    #[command(subcommand)]
    pub command: AuthApprovalSubcommand,
}

#[derive(Debug, Subcommand)]
/// Approval list and revoke operations.
pub enum AuthApprovalSubcommand {
    /// Filter approval entries by user or contract digest.
    List(AuthApprovalListArgs),
    /// Revoke one stored approval decision.
    Revoke(AuthApprovalRevokeArgs),
}

#[derive(Debug, Args)]
/// Filter approval entries by user or contract digest.
pub struct AuthApprovalListArgs {
    #[arg(long)]
    /// Restrict results to approvals stored for one `origin.id` user.
    pub user: Option<String>,

    #[arg(long, value_name = "CONTRACT_DIGEST")]
    /// Restrict results to one approved contract digest.
    pub digest: Option<String>,
}

#[derive(Debug, Args)]
/// Revoke a stored approval decision.
pub struct AuthApprovalRevokeArgs {
    #[arg(value_name = "CONTRACT_DIGEST")]
    /// The contract digest whose stored approval should be removed.
    pub digest: String,

    #[arg(long)]
    /// Limit revocation to one `origin.id` user.
    pub user: Option<String>,
}

#[derive(Debug, Args)]
/// Start a detached portal login against an auth service.
pub struct AuthLoginArgs {
    #[arg(long, default_value = "http://localhost:3000")]
    /// Base URL for the Trellis auth service.
    pub auth_url: String,
}
