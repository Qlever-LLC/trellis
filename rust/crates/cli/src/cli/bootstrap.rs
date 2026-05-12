use std::path::PathBuf;

use clap::{Args, Subcommand, ValueEnum};

#[derive(Debug, Args)]
/// Generate local Trellis development files.
pub struct LocalCommand {
    #[command(subcommand)]
    pub command: LocalSubcommand,
}

#[derive(Debug, Subcommand)]
/// Local development bootstrap operations.
pub enum LocalSubcommand {
    /// Generate a complete local Trellis bundle with NATS and service config.
    Init(LocalInitArgs),
}

#[derive(Debug, Args)]
/// Generate a complete local Trellis bundle with NATS and service config.
pub struct LocalInitArgs {
    #[arg(long)]
    /// Output directory for generated local Trellis bootstrap files.
    pub out: PathBuf,

    #[arg(long)]
    /// Replace an existing non-empty output directory.
    pub force: bool,

    #[arg(long, value_enum, default_value_t = LocalNatsContainerRuntimeArg::Auto)]
    /// Container runtime used to run nats-box and nsc.
    pub container_runtime: LocalNatsContainerRuntimeArg,

    #[arg(long, default_value = "docker.io/natsio/nats-box:latest")]
    /// nats-box image containing nsc.
    pub nats_box_image: String,

    #[arg(long, default_value = "Qlever")]
    /// NATS operator name.
    pub operator_name: String,

    #[arg(long, default_value = "SYS")]
    /// NATS system account name.
    pub system_account: String,

    #[arg(long, default_value = "AUTH")]
    /// Trellis auth account name.
    pub auth_account: String,

    #[arg(long, default_value = "TRELLIS")]
    /// Trellis runtime account name.
    pub trellis_account: String,

    #[arg(long, default_value = "trellis-local")]
    /// Local NATS server name written to nats.conf.
    pub server_name: String,

    #[arg(long, default_value_t = 3000)]
    /// Trellis HTTP port written to trellis/config.jsonc.
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
/// Container runtime choices for local NATS bootstrap generation.
pub enum LocalNatsContainerRuntimeArg {
    Auto,
    Podman,
    Docker,
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
