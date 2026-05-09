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
    /// Revoke one stored approval decision by identity envelope ID.
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
/// Revoke a stored approval decision by identity envelope ID.
pub struct AuthApprovalRevokeArgs {
    #[arg(value_name = "IDENTITY_ENVELOPE_ID")]
    /// The identity envelope ID whose stored approval should be removed.
    pub identity_envelope_id: String,

    #[arg(long)]
    /// Limit revocation to one `origin.id` user.
    pub user: Option<String>,
}

#[derive(Debug, Args)]
/// Start a detached portal login against an auth service.
pub struct AuthLoginArgs {
    #[arg(value_name = "TRELLIS_URL")]
    /// Base URL for the Trellis deployment.
    pub trellis_url: String,
}
