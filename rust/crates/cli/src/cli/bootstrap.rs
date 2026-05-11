use std::path::PathBuf;

use clap::{Args, Subcommand, ValueEnum};

#[derive(Debug, Args)]
/// Namespace for bootstrap commands.
pub struct BootstrapCommand {
    #[command(subcommand)]
    pub command: BootstrapSubcommand,
}

#[derive(Debug, Subcommand)]
/// Bootstrap targets for a fresh deployment.
pub enum BootstrapSubcommand {
    Nats(NatsBootstrapArgs),
    #[command(name = "local-nats")]
    LocalNats(LocalNatsBootstrapArgs),
    Admin(BootstrapAdminArgs),
}

#[derive(Debug, Args)]
/// Generate local NATS operator, accounts, config, credentials, and auth callout material.
pub struct LocalNatsBootstrapArgs {
    #[arg(long)]
    /// Output directory for generated local NATS bootstrap files.
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
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
/// Container runtime choices for local NATS bootstrap generation.
pub enum LocalNatsContainerRuntimeArg {
    Auto,
    Podman,
    Docker,
}

#[derive(Debug, Args)]
/// Bootstrap the NATS stream and KV buckets required by Trellis services.
///
/// This command is expected to stay aligned with the runtime KV bucket set so a
/// fresh install can start without creating missing KV state on first request.
pub struct NatsBootstrapArgs {
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
/// Seed an initial admin account and linked identity in Trellis service storage.
pub struct BootstrapAdminArgs {
    #[arg(long)]
    /// Identity provider namespace for the first admin account.
    pub provider: String,

    #[arg(long)]
    /// Identity subject within the chosen provider.
    pub subject: String,

    #[arg(
        long,
        value_delimiter = ',',
        help = "Capabilities to seed (defaults to admin, trellis.core::trellis.catalog.read, trellis.core::trellis.contract.read)"
    )]
    pub capabilities: Vec<String>,

    #[arg(long, default_value = "/var/lib/trellis/trellis.sqlite")]
    /// Trellis service SQLite database path.
    pub db_path: PathBuf,
}
