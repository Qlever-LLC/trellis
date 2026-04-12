use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use clap_complete::Shell;

#[derive(Debug, Parser)]
#[command(name = "trellis", version, about = "Trellis CLI")]
/// Top-level Trellis CLI arguments shared by all subcommands.
pub struct Cli {
    #[arg(long, global = true)]
    pub nats_servers: Option<String>,

    #[arg(long, global = true)]
    pub creds: Option<PathBuf>,

    #[arg(long, global = true, default_value = "text")]
    pub format: OutputFormat,

    #[arg(short, long, global = true, action = clap::ArgAction::Count)]
    pub verbose: u8,

    #[command(subcommand)]
    pub command: TopLevelCommand,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
/// Output encoder used for human-facing commands.
pub enum OutputFormat {
    Text,
    Json,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
/// Source used when generated Rust artifacts need Trellis runtime crates.
pub enum RustRuntimeSource {
    Registry,
    Local,
}

#[derive(Debug, Subcommand)]
/// Root command tree for Trellis development and auth administration tasks.
pub enum TopLevelCommand {
    Completions { shell: Shell },
    Auth(AuthCommand),
    Bootstrap(BootstrapCommand),
    Keygen(KeygenArgs),
    Portals(PortalsCommand),
    Service(ServiceCommand),
    Devices(DevicesCommand),
    Contracts(ContractsCommand),
}

#[derive(Debug, Args)]
/// Namespace for auth login and auth-admin commands.
pub struct AuthCommand {
    #[command(subcommand)]
    pub command: AuthSubcommand,
}

#[derive(Debug, Args)]
pub struct PortalsCommand {
    #[command(subcommand)]
    pub command: PortalsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PortalsSubcommand {
    List,
    Create(PortalsCreateArgs),
    Disable(PortalsDisableArgs),
    Logins(PortalsLoginsCommand),
    Devices(PortalsDevicesCommand),
}

#[derive(Debug, Args)]
pub struct PortalsLoginsCommand {
    #[command(subcommand)]
    pub command: PortalsLoginsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PortalsLoginsSubcommand {
    Default(PortalsDefaultCommand),
    List,
    Set(PortalsLoginsSetArgs),
    Clear(PortalsLoginsClearArgs),
}

#[derive(Debug, Args)]
pub struct PortalsDevicesCommand {
    #[command(subcommand)]
    pub command: PortalsDevicesSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PortalsDevicesSubcommand {
    Default(PortalsDefaultCommand),
    List,
    Set(PortalsDevicesSetArgs),
    Clear(PortalsDevicesClearArgs),
}

#[derive(Debug, Args)]
pub struct PortalsDefaultCommand {
    #[command(subcommand)]
    pub command: PortalsDefaultSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PortalsDefaultSubcommand {
    Show,
    Set(PortalsDefaultSetArgs),
}

#[derive(Debug, Args, Clone)]
#[group(required = true, multiple = false)]
pub struct PortalTargetArgs {
    #[arg(long)]
    pub builtin: bool,

    #[arg(long = "portal")]
    pub portal_id: Option<String>,
}

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
    Decide(DevicesReviewsDecideArgs),
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

#[derive(Debug, Args)]
pub struct PortalsCreateArgs {
    #[arg(long = "portal-id")]
    pub portal_id: String,

    #[arg(long = "app-contract-id")]
    pub app_contract_id: Option<String>,

    #[arg(long = "entry-url")]
    pub entry_url: String,
}

#[derive(Debug, Args)]
pub struct PortalsDisableArgs {
    #[arg(long = "portal-id")]
    pub portal_id: String,
}

#[derive(Debug, Args)]
pub struct PortalsDefaultSetArgs {
    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
pub struct PortalsLoginsSetArgs {
    #[arg(long = "contract-id")]
    pub contract_id: String,

    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
pub struct PortalsLoginsClearArgs {
    #[arg(long = "contract-id")]
    pub contract_id: String,
}

#[derive(Debug, Args)]
pub struct PortalsDevicesSetArgs {
    #[arg(long = "profile")]
    pub profile: String,

    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
pub struct PortalsDevicesClearArgs {
    #[arg(long = "profile")]
    pub profile: String,
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
    #[arg(long = "profile")]
    pub profile: String,

    #[arg(long = "contract")]
    pub contract: String,

    #[arg(long = "review-mode")]
    pub review_mode: Option<String>,
}

#[derive(Debug, Args)]
pub struct DevicesProfilesDisableArgs {
    #[arg(long = "profile")]
    pub profile: String,
}

#[derive(Debug, Args)]
pub struct DevicesProvisionArgs {
    #[arg(long = "profile")]
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
    #[arg(long = "instance")]
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
    #[arg(long = "instance")]
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
#[group(required = true, multiple = false)]
pub struct ReviewDecisionArgs {
    #[arg(long)]
    pub approve: bool,

    #[arg(long)]
    pub reject: bool,
}

#[derive(Debug, Args)]
pub struct DevicesReviewsDecideArgs {
    #[arg(long = "review")]
    pub review: String,

    #[command(flatten)]
    pub decision: ReviewDecisionArgs,

    #[arg(long)]
    pub reason: Option<String>,
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
    #[arg(long)]
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

#[derive(Debug, Args)]
/// Generate a Trellis keypair, optionally from a fixed seed.
pub struct KeygenArgs {
    #[arg(long)]
    pub seed: Option<String>,

    #[arg(long)]
    pub out: Option<PathBuf>,

    #[arg(long)]
    pub pubout: Option<PathBuf>,
}

#[derive(Debug, Args)]
/// Namespace for bootstrap commands.
pub struct BootstrapCommand {
    #[command(subcommand)]
    pub command: BootstrapSubcommand,
}

#[derive(Debug, Args)]
/// Bootstrap the NATS buckets and subjects required by Trellis services.
///
/// This command is expected to stay aligned with the auth/runtime bucket set so
/// a fresh install can start without creating missing state on first request.
pub struct NatsBootstrapArgs {
    #[arg(long)]
    pub trellis_creds: PathBuf,

    #[arg(long)]
    pub auth_creds: PathBuf,

    #[arg(long)]
    pub servers: Option<String>,
}

#[derive(Debug, Subcommand)]
/// Bootstrap targets for a fresh deployment.
pub enum BootstrapSubcommand {
    Nats(NatsBootstrapArgs),
    Admin(BootstrapAdminArgs),
}

#[derive(Debug, Args)]
/// Namespace for service installation and upgrade commands.
pub struct ServiceCommand {
    #[command(subcommand)]
    pub command: ServiceSubcommand,
}

#[derive(Debug, Subcommand)]
/// Service lifecycle operations.
pub enum ServiceSubcommand {
    List,
    Install(ServiceInstallArgs),
    Upgrade(ServiceUpgradeArgs),
}

#[derive(Debug, Args, Clone)]
#[group(required = true, multiple = false)]
/// One concrete way to load a contract before generation or verification.
///
/// Exactly one input source must be supplied so downstream commands operate on a
/// single canonical manifest shape.
pub struct ContractInputArgs {
    #[arg(long, value_name = "CONTRACT_JSON")]
    pub manifest: Option<PathBuf>,

    #[arg(long, value_name = "CONTRACT_SOURCE")]
    pub source: Option<PathBuf>,

    #[arg(long, value_name = "OCI_IMAGE")]
    pub image: Option<String>,

    #[arg(long, default_value = "CONTRACT")]
    pub source_export: String,

    #[arg(long, default_value = "/trellis/contract.json")]
    pub image_contract_path: String,
}

#[derive(Debug, Args)]
/// Generate a canonical JSON manifest from one contract input.
pub struct GenerateManifestArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,
}

#[derive(Debug, Args)]
/// Emit manifest and SDK artifacts together from one contract input.
pub struct GenerateAllArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out_manifest: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub ts_out: Option<PathBuf>,

    #[arg(long)]
    pub rust_out: Option<PathBuf>,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
/// Install a service contract through auth/admin RPCs.
pub struct ServiceInstallArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub display_name: Option<String>,

    #[arg(long)]
    pub description: Option<String>,

    #[arg(long = "namespace", value_delimiter = ',')]
    pub extra_namespaces: Vec<String>,

    #[arg(short = 'f', long)]
    pub force: bool,

    #[arg(long)]
    pub inactive: bool,
}

#[derive(Debug, Args)]
/// Upgrade one installed service contract.
pub struct ServiceUpgradeArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub service_key: Option<String>,

    #[arg(long)]
    pub seed: Option<String>,

    #[arg(short = 'f', long)]
    pub force: bool,
}

#[derive(Debug, Args)]
/// Seed an initial admin identity and bootstrap connection settings.
pub struct BootstrapAdminArgs {
    #[arg(long)]
    pub origin: String,

    #[arg(long)]
    pub id: String,

    #[arg(
        long,
        value_delimiter = ',',
        help = "Capabilities to seed (defaults to admin, trellis.catalog.read, trellis.contract.read)"
    )]
    pub capabilities: Vec<String>,

    #[arg(long)]
    pub creds: Option<PathBuf>,

    #[arg(long)]
    pub servers: Option<String>,
}

#[derive(Debug, Args)]
/// Namespace for contract build and verification commands.
pub struct ContractsCommand {
    #[command(subcommand)]
    pub command: ContractsSubcommand,
}

#[derive(Debug, Subcommand)]
/// Contract pack and live verification operations.
pub enum ContractsSubcommand {
    Pack(PackContractsArgs),
    VerifyLive(VerifyLiveArgs),
}

#[derive(Debug, Args)]
/// Bundle multiple contracts into one pack artifact.
pub struct PackContractsArgs {
    #[arg(long = "manifest")]
    pub manifests: Vec<PathBuf>,

    #[arg(long = "source")]
    pub sources: Vec<PathBuf>,

    #[arg(long = "image")]
    pub images: Vec<String>,

    #[arg(long, default_value = "CONTRACT")]
    pub source_export: String,

    #[arg(long, default_value = "/trellis/contract.json")]
    pub image_contract_path: String,

    #[arg(long)]
    pub output: PathBuf,

    #[arg(long)]
    pub contracts_out: Option<PathBuf>,
}

#[derive(Debug, Args)]
/// Verify live subjects against a running NATS deployment.
pub struct VerifyLiveArgs {
    #[arg(long)]
    pub servers: String,

    #[arg(long)]
    pub creds: PathBuf,

    #[arg(long)]
    pub session_seed: String,

    #[arg(long)]
    pub limit: Option<usize>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn parses_portals_create_command() {
        let cli = Cli::parse_from([
            "trellis",
            "portals",
            "create",
            "--portal-id",
            "main",
            "--app-contract-id",
            "trellis.portal@v1",
            "--entry-url",
            "https://portal.example.com/auth",
        ]);
        match cli.command {
            TopLevelCommand::Portals(command) => match command.command {
                PortalsSubcommand::Create(args) => {
                    assert_eq!(args.portal_id, "main");
                    assert_eq!(args.app_contract_id.as_deref(), Some("trellis.portal@v1"));
                }
                other => panic!("unexpected portals command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }

    #[test]
    fn parses_portals_logins_set_command() {
        let cli = Cli::parse_from([
            "trellis",
            "portals",
            "logins",
            "set",
            "--contract-id",
            "trellis.console@v1",
            "--portal",
            "main",
        ]);
        match cli.command {
            TopLevelCommand::Portals(command) => match command.command {
                PortalsSubcommand::Logins(logins) => match logins.command {
                    PortalsLoginsSubcommand::Set(args) => {
                        assert_eq!(args.contract_id, "trellis.console@v1");
                        assert_eq!(args.target.portal_id.as_deref(), Some("main"));
                        assert!(!args.target.builtin);
                    }
                    other => panic!("unexpected portal logins command: {other:?}"),
                },
                other => panic!("unexpected portals command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }

    #[test]
    fn parses_portals_devices_default_set_builtin_command() {
        let cli = Cli::parse_from([
            "trellis",
            "portals",
            "devices",
            "default",
            "set",
            "--builtin",
        ]);
        match cli.command {
            TopLevelCommand::Portals(command) => match command.command {
                PortalsSubcommand::Devices(devices) => match devices.command {
                    PortalsDevicesSubcommand::Default(defaults) => match defaults.command {
                        PortalsDefaultSubcommand::Set(args) => {
                            assert!(args.target.builtin);
                            assert!(args.target.portal_id.is_none());
                        }
                        other => panic!("unexpected devices default command: {other:?}"),
                    },
                    other => panic!("unexpected portal devices command: {other:?}"),
                },
                other => panic!("unexpected portals command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }

    #[test]
    fn parses_devices_profiles_create_command() {
        let cli = Cli::parse_from([
            "trellis",
            "devices",
            "profiles",
            "create",
            "--profile",
            "reader.standard",
            "--contract",
            "acme.reader@v1",
            "--review-mode",
            "required",
        ]);
        match cli.command {
            TopLevelCommand::Devices(command) => match command.command {
                DevicesSubcommand::Profiles(profiles) => match profiles.command {
                    DevicesProfilesSubcommand::Create(args) => {
                        assert_eq!(args.profile, "reader.standard");
                        assert_eq!(args.contract, "acme.reader@v1");
                        assert_eq!(args.review_mode.as_deref(), Some("required"));
                    }
                    other => panic!("unexpected devices profiles command: {other:?}"),
                },
                other => panic!("unexpected devices command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }

    #[test]
    fn parses_devices_provision_command() {
        let cli = Cli::parse_from([
            "trellis",
            "devices",
            "provision",
            "--profile",
            "reader.standard",
        ]);
        match cli.command {
            TopLevelCommand::Devices(command) => match command.command {
                DevicesSubcommand::Provision(args) => {
                    assert_eq!(args.profile, "reader.standard");
                }
                other => panic!("unexpected devices command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }

    #[test]
    fn parses_devices_reviews_decide_command() {
        let cli = Cli::parse_from([
            "trellis",
            "devices",
            "reviews",
            "decide",
            "--review",
            "dar_123",
            "--approve",
            "--reason",
            "approved_by_policy",
        ]);
        match cli.command {
            TopLevelCommand::Devices(command) => match command.command {
                DevicesSubcommand::Reviews(reviews) => match reviews.command {
                    DevicesReviewsSubcommand::Decide(args) => {
                        assert_eq!(args.review, "dar_123");
                        assert!(args.decision.approve);
                        assert!(!args.decision.reject);
                        assert_eq!(args.reason.as_deref(), Some("approved_by_policy"));
                    }
                    other => panic!("unexpected devices reviews command: {other:?}"),
                },
                other => panic!("unexpected devices command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }

    #[test]
    fn rejects_generate_command_tree() {
        let error = Cli::try_parse_from(["trellis", "generate"]).expect_err("generate should fail");
        assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
    }

    #[test]
    fn rejects_contracts_build_command() {
        let error = Cli::try_parse_from(["trellis", "contracts", "build"])
            .expect_err("contracts build should fail");
        assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
    }

    #[test]
    fn rejects_contracts_verify_command() {
        let error = Cli::try_parse_from(["trellis", "contracts", "verify"])
            .expect_err("contracts verify should fail");
        assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
    }

    #[test]
    fn rejects_sdk_generate_command() {
        let error = Cli::try_parse_from(["trellis", "sdk", "generate", "rust"])
            .expect_err("sdk generate should fail");
        assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
        assert!(error.to_string().contains("sdk"));
    }
}
