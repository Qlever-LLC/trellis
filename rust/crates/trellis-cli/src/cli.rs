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
    Workloads(WorkloadsCommand),
    Generate(GenerateCommand),
    Contracts(ContractsCommand),
    Sdk(SdkCommand),
}

#[derive(Debug, Args)]
/// Namespace for manifest and SDK generation commands.
pub struct GenerateCommand {
    #[command(subcommand)]
    pub command: GenerateSubcommand,
}

#[derive(Debug, Subcommand)]
/// Code generation targets that can be emitted from one contract source.
pub enum GenerateSubcommand {
    Manifest(GenerateManifestArgs),
    Ts(GenerateTsSdkArgs),
    Rust(GenerateRustSdkArgs),
    All(GenerateAllArgs),
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
    Workloads(PortalsWorkloadsCommand),
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
pub struct PortalsWorkloadsCommand {
    #[command(subcommand)]
    pub command: PortalsWorkloadsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PortalsWorkloadsSubcommand {
    Default(PortalsDefaultCommand),
    List,
    Set(PortalsWorkloadsSetArgs),
    Clear(PortalsWorkloadsClearArgs),
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
pub struct WorkloadsCommand {
    #[command(subcommand)]
    pub command: WorkloadsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum WorkloadsSubcommand {
    Provision(WorkloadsProvisionArgs),
    Profiles(WorkloadsProfilesCommand),
    Instances(WorkloadsInstancesCommand),
    Activations(WorkloadsActivationsCommand),
    Reviews(WorkloadsReviewsCommand),
}

#[derive(Debug, Args)]
pub struct WorkloadsProfilesCommand {
    #[command(subcommand)]
    pub command: WorkloadsProfilesSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum WorkloadsProfilesSubcommand {
    List(WorkloadsProfilesListArgs),
    Create(WorkloadsProfilesCreateArgs),
    Disable(WorkloadsProfilesDisableArgs),
}

#[derive(Debug, Args)]
pub struct WorkloadsInstancesCommand {
    #[command(subcommand)]
    pub command: WorkloadsInstancesSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum WorkloadsInstancesSubcommand {
    List(WorkloadsInstancesListArgs),
    Disable(WorkloadsInstancesDisableArgs),
}

#[derive(Debug, Args)]
pub struct WorkloadsActivationsCommand {
    #[command(subcommand)]
    pub command: WorkloadsActivationsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum WorkloadsActivationsSubcommand {
    List(WorkloadsActivationsListArgs),
    Revoke(WorkloadsActivationsRevokeArgs),
}

#[derive(Debug, Args)]
pub struct WorkloadsReviewsCommand {
    #[command(subcommand)]
    pub command: WorkloadsReviewsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum WorkloadsReviewsSubcommand {
    List(WorkloadsReviewsListArgs),
    Decide(WorkloadsReviewsDecideArgs),
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
pub struct PortalsWorkloadsSetArgs {
    #[arg(long = "profile")]
    pub profile: String,

    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
pub struct PortalsWorkloadsClearArgs {
    #[arg(long = "profile")]
    pub profile: String,
}

#[derive(Debug, Args)]
pub struct WorkloadsProfilesListArgs {
    #[arg(long = "contract")]
    pub contract: Option<String>,

    #[arg(long)]
    pub disabled: bool,
}

#[derive(Debug, Args)]
pub struct WorkloadsProfilesCreateArgs {
    #[arg(long = "profile")]
    pub profile: String,

    #[arg(long = "contract")]
    pub contract: String,

    #[arg(long = "review-mode")]
    pub review_mode: Option<String>,
}

#[derive(Debug, Args)]
pub struct WorkloadsProfilesDisableArgs {
    #[arg(long = "profile")]
    pub profile: String,
}

#[derive(Debug, Args)]
pub struct WorkloadsProvisionArgs {
    #[arg(long = "profile")]
    pub profile: String,
}

#[derive(Debug, Args)]
pub struct WorkloadsInstancesListArgs {
    #[arg(long = "profile")]
    pub profile: Option<String>,

    #[arg(long)]
    pub state: Option<String>,
}

#[derive(Debug, Args)]
pub struct WorkloadsInstancesDisableArgs {
    #[arg(long = "instance")]
    pub instance: String,
}

#[derive(Debug, Args)]
pub struct WorkloadsActivationsListArgs {
    #[arg(long = "instance")]
    pub instance: Option<String>,

    #[arg(long = "profile")]
    pub profile: Option<String>,

    #[arg(long)]
    pub state: Option<String>,
}

#[derive(Debug, Args)]
pub struct WorkloadsActivationsRevokeArgs {
    #[arg(long = "instance")]
    pub instance: String,
}

#[derive(Debug, Args)]
pub struct WorkloadsReviewsListArgs {
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
pub struct WorkloadsReviewsDecideArgs {
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
/// Contract build, pack, and verification operations.
pub enum ContractsSubcommand {
    Build(BuildContractArgs),
    Verify(VerifyManifestArgs),
    Pack(PackContractsArgs),
    VerifyLive(VerifyLiveArgs),
}

#[derive(Debug, Args)]
/// Build manifest and optional SDK outputs from a contract source module.
pub struct BuildContractArgs {
    #[arg(long)]
    pub source: PathBuf,

    #[arg(long, default_value = "CONTRACT")]
    pub source_export: String,

    #[arg(long)]
    pub out_manifest: PathBuf,

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
/// Verify that one manifest or source resolves to a valid contract.
pub struct VerifyManifestArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,
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

#[derive(Debug, Args)]
/// Namespace for SDK generation commands.
pub struct SdkCommand {
    #[command(subcommand)]
    pub command: SdkSubcommand,
}

#[derive(Debug, Subcommand)]
/// SDK command tree.
pub enum SdkSubcommand {
    Generate(GenerateSdkCommand),
}

#[derive(Debug, Args)]
/// Select an SDK generation target.
pub struct GenerateSdkCommand {
    #[command(subcommand)]
    pub target: GenerateSdkTarget,
}

#[derive(Debug, Subcommand)]
/// SDK artifact families supported by the CLI.
pub enum GenerateSdkTarget {
    Ts(GenerateTsSdkArgs),
    Rust(GenerateRustSdkArgs),
    #[command(hide = true)]
    Facade(GenerateRustParticipantFacadeArgs),
    All(GenerateAllSdkArgs),
}

#[derive(Debug, Args)]
/// Generate a TypeScript SDK from one contract input.
pub struct GenerateTsSdkArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
/// Generate a Rust SDK crate from one contract input.
pub struct GenerateRustSdkArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
/// Generate a local Rust participant facade crate.
///
/// The hidden command is used by generated participant crates during their
/// build step, so the options favor explicit paths over CLI ergonomics.
pub struct GenerateRustParticipantFacadeArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long)]
    pub owned_sdk_path: Option<PathBuf>,

    #[arg(long)]
    pub owned_sdk_crate_name: Option<String>,

    #[arg(long = "use-sdk", value_name = "ALIAS=CRATE=MANIFEST[=CRATE_PATH]")]
    pub use_sdks: Vec<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
/// Generate both TypeScript and Rust SDK outputs from one contract input.
pub struct GenerateAllSdkArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub ts_out: PathBuf,

    #[arg(long)]
    pub rust_out: PathBuf,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,

    #[arg(long)]
    pub crate_name: Option<String>,
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
    fn parses_portals_workloads_default_set_builtin_command() {
        let cli = Cli::parse_from([
            "trellis",
            "portals",
            "workloads",
            "default",
            "set",
            "--builtin",
        ]);
        match cli.command {
            TopLevelCommand::Portals(command) => match command.command {
                PortalsSubcommand::Workloads(workloads) => match workloads.command {
                    PortalsWorkloadsSubcommand::Default(defaults) => match defaults.command {
                        PortalsDefaultSubcommand::Set(args) => {
                            assert!(args.target.builtin);
                            assert!(args.target.portal_id.is_none());
                        }
                        other => panic!("unexpected workloads default command: {other:?}"),
                    },
                    other => panic!("unexpected portal workloads command: {other:?}"),
                },
                other => panic!("unexpected portals command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }

    #[test]
    fn parses_workloads_profiles_create_command() {
        let cli = Cli::parse_from([
            "trellis",
            "workloads",
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
            TopLevelCommand::Workloads(command) => match command.command {
                WorkloadsSubcommand::Profiles(profiles) => match profiles.command {
                    WorkloadsProfilesSubcommand::Create(args) => {
                        assert_eq!(args.profile, "reader.standard");
                        assert_eq!(args.contract, "acme.reader@v1");
                        assert_eq!(args.review_mode.as_deref(), Some("required"));
                    }
                    other => panic!("unexpected workloads profiles command: {other:?}"),
                },
                other => panic!("unexpected workloads command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }

    #[test]
    fn parses_workloads_provision_command() {
        let cli = Cli::parse_from([
            "trellis",
            "workloads",
            "provision",
            "--profile",
            "reader.standard",
        ]);
        match cli.command {
            TopLevelCommand::Workloads(command) => match command.command {
                WorkloadsSubcommand::Provision(args) => {
                    assert_eq!(args.profile, "reader.standard");
                }
                other => panic!("unexpected workloads command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }

    #[test]
    fn parses_workloads_reviews_decide_command() {
        let cli = Cli::parse_from([
            "trellis",
            "workloads",
            "reviews",
            "decide",
            "--review",
            "war_123",
            "--approve",
            "--reason",
            "approved_by_policy",
        ]);
        match cli.command {
            TopLevelCommand::Workloads(command) => match command.command {
                WorkloadsSubcommand::Reviews(reviews) => match reviews.command {
                    WorkloadsReviewsSubcommand::Decide(args) => {
                        assert_eq!(args.review, "war_123");
                        assert!(args.decision.approve);
                        assert!(!args.decision.reject);
                        assert_eq!(args.reason.as_deref(), Some("approved_by_policy"));
                    }
                    other => panic!("unexpected workloads reviews command: {other:?}"),
                },
                other => panic!("unexpected workloads command: {other:?}"),
            },
            other => panic!("unexpected top-level command: {other:?}"),
        }
    }
}
