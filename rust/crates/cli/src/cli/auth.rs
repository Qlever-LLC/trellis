use clap::{Args, Subcommand};

#[derive(Debug, Args)]
/// Namespace for auth login and auth-admin commands.
pub struct AuthCommand {
    #[command(subcommand)]
    pub command: AuthSubcommand,
}

#[derive(Debug, Subcommand)]
/// Auth flows exposed by the CLI.
pub enum AuthSubcommand {
    Login(AuthLoginArgs),
    Logout,
    Approvals(AuthApprovalsCommand),
    Status,
}

#[derive(Debug, Args)]
/// Namespace for approval listing and revocation commands.
pub struct AuthApprovalsCommand {
    #[command(subcommand)]
    pub command: AuthApprovalsSubcommand,
}

#[derive(Debug, Subcommand)]
/// Approval list and revoke operations.
pub enum AuthApprovalsSubcommand {
    List(AuthApprovalsListArgs),
    Revoke(AuthApprovalsRevokeArgs),
}

#[derive(Debug, Args)]
/// Filter approval entries by user or contract digest.
pub struct AuthApprovalsListArgs {
    #[arg(long)]
    pub user: Option<String>,

    #[arg(long)]
    pub digest: Option<String>,
}

#[derive(Debug, Args)]
/// Revoke a stored approval decision.
pub struct AuthApprovalsRevokeArgs {
    #[arg(value_name = "DIGEST")]
    pub digest: String,

    #[arg(long)]
    pub user: Option<String>,
}

#[derive(Debug, Args)]
/// Start an interactive browser login against an auth service.
pub struct AuthLoginArgs {
    #[arg(long, default_value = "http://localhost:3000")]
    pub auth_url: String,

    #[arg(long, default_value = "127.0.0.1:0")]
    pub listen: String,
}
