use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use clap_complete::Shell;

#[derive(Debug, Parser)]
#[command(name = "trellis", version, about = "Trellis CLI")]
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
pub enum OutputFormat {
    Text,
    Json,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum RustRuntimeSource {
    Registry,
    Local,
}

#[derive(Debug, Subcommand)]
pub enum TopLevelCommand {
    Completions { shell: Shell },
    Auth(AuthCommand),
    Bootstrap(BootstrapCommand),
    Keygen(KeygenArgs),
    Service(ServiceCommand),
    Contracts(ContractsCommand),
    Sdk(SdkCommand),
}

#[derive(Debug, Args)]
pub struct AuthCommand {
    #[command(subcommand)]
    pub command: AuthSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum AuthSubcommand {
    Login(AuthLoginArgs),
    Logout,
    Approvals(AuthApprovalsCommand),
    Status,
}

#[derive(Debug, Args)]
pub struct AuthApprovalsCommand {
    #[command(subcommand)]
    pub command: AuthApprovalsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum AuthApprovalsSubcommand {
    List(AuthApprovalsListArgs),
    Revoke(AuthApprovalsRevokeArgs),
}

#[derive(Debug, Args)]
pub struct AuthApprovalsListArgs {
    #[arg(long)]
    pub user: Option<String>,

    #[arg(long)]
    pub digest: Option<String>,
}

#[derive(Debug, Args)]
pub struct AuthApprovalsRevokeArgs {
    #[arg(long)]
    pub digest: String,

    #[arg(long)]
    pub user: Option<String>,
}

#[derive(Debug, Args)]
pub struct AuthLoginArgs {
    #[arg(long, default_value = "http://localhost:3000")]
    pub auth_url: String,

    #[arg(long, default_value = "github")]
    pub provider: String,

    #[arg(long, default_value = "127.0.0.1:0")]
    pub listen: String,
}

#[derive(Debug, Args)]
pub struct KeygenArgs {
    #[arg(long)]
    pub seed: Option<String>,

    #[arg(long)]
    pub out: Option<PathBuf>,

    #[arg(long)]
    pub pubout: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct BootstrapCommand {
    #[command(subcommand)]
    pub command: BootstrapSubcommand,
}

#[derive(Debug, Args)]
pub struct NatsBootstrapArgs {
    #[arg(long)]
    pub trellis_creds: PathBuf,

    #[arg(long)]
    pub auth_creds: PathBuf,

    #[arg(long)]
    pub servers: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum BootstrapSubcommand {
    Nats(NatsBootstrapArgs),
    Admin(BootstrapAdminArgs),
}

#[derive(Debug, Args)]
pub struct ServiceCommand {
    #[command(subcommand)]
    pub command: ServiceSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum ServiceSubcommand {
    List,
    Install(ServiceInstallArgs),
    Upgrade(ServiceUpgradeArgs),
}

#[derive(Debug, Args, Clone)]
#[group(required = true, multiple = false)]
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
pub struct BootstrapAdminArgs {
    #[arg(long)]
    pub origin: String,

    #[arg(long)]
    pub id: String,

    #[arg(long, value_delimiter = ',')]
    pub capabilities: Vec<String>,

    #[arg(long)]
    pub creds: Option<PathBuf>,

    #[arg(long)]
    pub servers: Option<String>,
}

#[derive(Debug, Args)]
pub struct ContractsCommand {
    #[command(subcommand)]
    pub command: ContractsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum ContractsSubcommand {
    Build(BuildContractArgs),
    Verify(VerifyManifestArgs),
    Pack(PackContractsArgs),
    VerifyLive(VerifyLiveArgs),
}

#[derive(Debug, Args)]
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

    #[arg(long, default_value = "0.1.0")]
    pub package_version: String,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, default_value = "0.1.0")]
    pub crate_version: String,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long, default_value = "0.1.0")]
    pub runtime_version: String,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct VerifyManifestArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,
}

#[derive(Debug, Args)]
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
pub struct SdkCommand {
    #[command(subcommand)]
    pub command: SdkSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum SdkSubcommand {
    Generate(GenerateSdkCommand),
}

#[derive(Debug, Args)]
pub struct GenerateSdkCommand {
    #[command(subcommand)]
    pub target: GenerateSdkTarget,
}

#[derive(Debug, Subcommand)]
pub enum GenerateSdkTarget {
    Ts(GenerateTsSdkArgs),
    Rust(GenerateRustSdkArgs),
    Facade(GenerateRustParticipantFacadeArgs),
    All(GenerateAllSdkArgs),
}

#[derive(Debug, Args)]
pub struct GenerateTsSdkArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long, default_value = "0.1.0")]
    pub package_version: String,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long, default_value = "0.1.0")]
    pub runtime_version: String,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct GenerateRustSdkArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, default_value = "0.1.0")]
    pub crate_version: String,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long, default_value = "0.1.0")]
    pub runtime_version: String,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct GenerateRustParticipantFacadeArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, default_value = "0.1.0")]
    pub crate_version: String,

    #[arg(long)]
    pub owned_sdk_path: Option<PathBuf>,

    #[arg(long)]
    pub owned_sdk_crate_name: Option<String>,

    #[arg(long = "use-sdk", value_name = "ALIAS=CRATE=MANIFEST")]
    pub use_sdks: Vec<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long, default_value = "0.1.0")]
    pub runtime_version: String,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct GenerateAllSdkArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub ts_out: PathBuf,

    #[arg(long)]
    pub rust_out: PathBuf,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long, default_value = "0.1.0")]
    pub package_version: String,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RustRuntimeSource,

    #[arg(long, default_value = "0.1.0")]
    pub runtime_version: String,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, default_value = "0.1.0")]
    pub crate_version: String,
}
