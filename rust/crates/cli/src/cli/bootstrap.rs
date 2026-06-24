use std::path::PathBuf;

use clap::{Args, Subcommand};

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
    /// Trellis HTTP port written to trellis/config.toml.
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
/// Apply or check shared infrastructure.
pub struct InfraCommand {
    #[command(subcommand)]
    pub command: InfraSubcommand,
}

#[derive(Debug, Subcommand)]
/// Infrastructure bootstrap operations.
pub enum InfraSubcommand {
    /// Bootstrap the NATS stream and KV buckets required by Trellis services.
    Apply(InfraApplyArgs),
    /// Check shared infrastructure readiness.
    Check(InfraCheckArgs),
}

#[derive(Debug, Args)]
/// Bootstrap the NATS stream and KV buckets required by Trellis services.
pub struct InfraApplyArgs {
    #[arg(long)]
    /// Trellis service credentials file used to create the shared event stream.
    pub trellis_creds: PathBuf,

    #[arg(long)]
    /// Auth service credentials file used to create auth-owned KV buckets.
    pub auth_creds: PathBuf,

    #[arg(long)]
    /// Direct server list used only for bootstrap-time transport setup.
    pub servers: Option<String>,

    #[arg(long)]
    /// JetStream replica count for Trellis-created streams and KV buckets.
    pub jetstream_replicas: Option<usize>,
}

#[derive(Debug, Args)]
/// Check the NATS stream and KV buckets required by Trellis services.
pub struct InfraCheckArgs {
    #[arg(long)]
    /// Trellis service credentials file used to inspect the shared event stream.
    pub trellis_creds: PathBuf,

    #[arg(long)]
    /// Auth service credentials file used to inspect auth-owned KV buckets.
    pub auth_creds: PathBuf,

    #[arg(long)]
    /// Direct server list used only for bootstrap-time transport setup.
    pub servers: Option<String>,
}

#[derive(Debug, Args)]
/// Run one-time initialization workflows.
pub struct InitCommand {
    #[command(subcommand)]
    pub command: InitSubcommand,
}

#[derive(Debug, Subcommand)]
/// Initialization operations.
pub enum InitSubcommand {
    /// Generate Trellis runtime config and NATS bootstrap material.
    Config(InitConfigArgs),
    /// Seed an initial admin account and linked identity.
    Admin(InitAdminArgs),
}

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
