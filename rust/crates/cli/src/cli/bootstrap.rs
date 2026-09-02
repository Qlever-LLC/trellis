use std::path::PathBuf;

use clap::{Args, Subcommand};

#[cfg(feature = "runtime")]
#[derive(Debug, Args)]
/// Generate Trellis runtime config and NATS bootstrap material.
pub struct InitConfigArgs {
    #[arg(long)]
    /// Output directory for generated Trellis bootstrap files.
    pub out: PathBuf,

    #[arg(long)]
    /// Replace an existing non-empty output directory.
    pub force: bool,

    #[arg(long, default_value_t = trellis_bootstrap::DEFAULT_TRELLIS_NAME.to_string())]
    /// Human-readable Trellis name used in generated config.
    pub name: String,

    #[arg(long, default_value_t = trellis_bootstrap::DEFAULT_OPERATOR_NAME.to_string())]
    /// NATS operator name.
    pub operator_name: String,

    #[arg(long, default_value_t = trellis_bootstrap::DEFAULT_SYSTEM_ACCOUNT.to_string())]
    /// NATS system account name.
    pub system_account: String,

    #[arg(long, default_value_t = trellis_bootstrap::DEFAULT_AUTH_ACCOUNT.to_string())]
    /// Trellis auth account name.
    pub auth_account: String,

    #[arg(long, default_value_t = trellis_bootstrap::DEFAULT_TRELLIS_ACCOUNT.to_string())]
    /// Trellis runtime account name.
    pub trellis_account: String,

    #[arg(long)]
    /// Override the NATS server name written to nats.conf.
    pub server_name: Option<String>,

    #[arg(long, default_value_t = 3000)]
    /// Trellis HTTP port written to config.toml.
    pub trellis_port: u16,

    #[arg(long, default_value = "nats://127.0.0.1:4222")]
    /// Native NATS server URL for Trellis services.
    pub nats_server_url: String,

    #[arg(long, default_value = "ws://localhost:8080")]
    /// Browser-facing NATS websocket URL for Trellis clients.
    pub nats_websocket_url: String,

    #[arg(long, default_value = "http://localhost:3000")]
    /// Public Trellis HTTP origin for OAuth redirects.
    pub public_origin: String,
}

#[derive(Debug, Args)]
/// Manage offline infrastructure trust material.
pub struct InfraCommand {
    #[command(subcommand)]
    pub command: InfraSubcommand,
}

#[derive(Debug, Subcommand)]
/// Infrastructure bootstrap operations.
pub enum InfraSubcommand {
    /// Generate or rotate file-backed authorization trust material.
    Trust(InfraTrustCommand),
}

#[derive(Debug, Args)]
/// Manage offline authorization root and online issuer artifacts.
pub struct InfraTrustCommand {
    #[command(subcommand)]
    pub command: InfraTrustSubcommand,
}

#[derive(Debug, Subcommand)]
/// Authorization trust artifact operations.
pub enum InfraTrustSubcommand {
    /// Initialize a distinct authorization root and online issuer.
    Init(InfraTrustInitArgs),
    /// Add a new overlapping issuer or revoke one old issuer.
    RotateIssuer(InfraTrustRotateIssuerArgs),
}

#[derive(Debug, Args)]
/// Initialize file-backed authorization trust.
pub struct InfraTrustInitArgs {
    #[arg(long, value_name = "DIR")]
    /// Output directory for trust artifacts.
    pub out: PathBuf,
    #[arg(long)]
    /// Stable installation authorization namespace.
    pub authority: String,
    #[arg(long, default_value_t = 31_536_000)]
    /// Issuer-manifest lifetime in seconds.
    pub manifest_lifetime_seconds: i64,
    #[arg(long)]
    /// Replace existing current files while preserving immutable history files.
    pub force: bool,
}

#[derive(Debug, Args)]
/// Rotate or revoke an authorization context issuer.
pub struct InfraTrustRotateIssuerArgs {
    #[arg(long, value_name = "DIR")]
    /// Directory containing existing trust artifacts.
    pub dir: PathBuf,
    #[arg(long)]
    /// Revoke this existing issuer instead of generating a new overlapping issuer.
    pub revoke: Option<String>,
    #[arg(long, default_value_t = 2_592_000)]
    /// New issuer-manifest lifetime in seconds.
    pub manifest_lifetime_seconds: i64,
}

#[cfg(feature = "runtime")]
#[derive(Debug, Args)]
/// Run one-time initialization workflows.
pub struct InitCommand {
    #[command(subcommand)]
    pub command: InitSubcommand,
}

#[cfg(feature = "runtime")]
#[derive(Debug, Subcommand)]
/// Initialization operations.
pub enum InitSubcommand {
    /// Generate Trellis runtime config and NATS bootstrap material.
    Config(InitConfigArgs),
    /// Seed an initial admin account and linked identity.
    Admin(InitAdminArgs),
}

#[cfg(feature = "runtime")]
#[derive(Debug, Args)]
/// Seed an initial admin account and linked identity in Trellis service storage.
pub struct InitAdminArgs {
    #[arg(long, value_name = "PROVIDER:SUBJECT")]
    /// Provider identity for the first admin account.
    pub identity: String,

    #[arg(long, default_value = "/var/lib/trellis/trellis.sqlite")]
    /// Trellis service SQLite database path.
    pub db_path: PathBuf,
}
