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
    /// Start an interactive browser login against a Trellis auth service.
    Login(AuthLoginArgs),
    /// Revoke the current admin session and clear local session state.
    Logout,
    /// Show the currently logged-in Trellis admin session.
    Status,
    /// List or revoke stored approval decisions.
    Approval(AuthApprovalCommand),
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
/// Start an interactive browser login against an auth service.
pub struct AuthLoginArgs {
    #[arg(long, default_value = "http://localhost:3000")]
    /// Base URL for the Trellis auth service.
    pub auth_url: String,

    #[arg(long, default_value = "127.0.0.1:0")]
    /// Local callback address to bind while waiting for the browser redirect.
    pub listen: String,
}
