use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};

#[derive(Debug, Parser)]
#[command(
    name = "trellis-generate",
    version = env!("TRELLIS_BUILD_VERSION"),
    about = "Generate and verify Trellis contract artifacts"
)]
pub struct Cli {
    #[arg(short = 'f', long, global = true)]
    pub force: bool,

    #[command(subcommand)]
    pub command: Option<TopLevelCommand>,
}

#[derive(Debug, Subcommand)]
pub enum TopLevelCommand {
    Prepare(PrepareArgs),
    Discover(DiscoverArgs),
    Generate(GenerateCommand),
    /// Check for or install generator updates.
    #[command(name = "self")]
    Self_(SelfCommand),
}

#[derive(Debug, Args)]
/// Check for or install newer Trellis generator releases.
pub struct SelfCommand {
    #[command(subcommand)]
    pub command: SelfSubcommand,
}

#[derive(Debug, Subcommand)]
/// Trellis generator self-management commands.
pub enum SelfSubcommand {
    /// Check GitHub releases and report whether an update is available.
    Check(SelfCheckArgs),
    /// Download and install the latest Trellis generator release for this platform.
    Update(SelfUpdateArgs),
}

#[derive(Debug, Args)]
/// Check whether a newer Trellis generator release exists.
pub struct SelfCheckArgs {
    #[arg(long)]
    /// Include prerelease versions such as release candidates.
    pub prerelease: bool,
}

#[derive(Debug, Args)]
/// Install the newest Trellis generator release for this platform.
pub struct SelfUpdateArgs {
    #[arg(long)]
    /// Allow prerelease versions such as release candidates.
    pub prerelease: bool,
}

#[derive(Debug, Args)]
pub struct PrepareArgs {
    #[arg(long)]
    pub watch: bool,

    #[arg(long, requires = "watch")]
    pub changes: bool,

    #[arg(long, default_value = "@trellis-sdk/")]
    pub prefix: String,

    #[arg(long)]
    pub out: Option<PathBuf>,

    #[arg(long, value_delimiter = ',', value_enum)]
    pub targets: Vec<PackageTarget>,

    #[arg(long)]
    pub no_npm: bool,

    #[arg(default_value = ".")]
    pub root: PathBuf,
}

#[derive(Debug, Args)]
pub struct DiscoverArgs {
    pub root: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeSource {
    Registry,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum PackageTarget {
    Manifest,
    Jsr,
    Npm,
    Cargo,
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
pub struct GenerateCommand {
    #[command(subcommand)]
    pub command: GenerateSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum GenerateSubcommand {
    Manifest(GenerateManifestArgs),
    Jsr(GenerateJsrPackageArgs),
    Npm(GenerateNpmPackageArgs),
    Cargo(GenerateCargoPackageArgs),
    All(GenerateAllArgs),
}

#[derive(Debug, Args)]
pub struct GenerateManifestArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,
}

#[derive(Debug, Args)]
pub struct GenerateJsrPackageArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long, default_value = "@trellis-sdk/")]
    pub prefix: String,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct GenerateNpmPackageArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long, default_value = "@trellis-sdk/")]
    pub prefix: String,
}

#[derive(Debug, Args)]
pub struct GenerateCargoPackageArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct GenerateAllArgs {
    #[command(flatten)]
    pub contract: ContractInputArgs,

    #[arg(long)]
    pub out_manifest: PathBuf,

    #[arg(long)]
    pub artifact_version: Option<String>,

    #[arg(long)]
    pub jsr_out: Option<PathBuf>,

    #[arg(long)]
    pub npm_out: Option<PathBuf>,

    #[arg(long)]
    pub cargo_out: Option<PathBuf>,

    #[arg(long)]
    pub package_name: Option<String>,

    #[arg(long, default_value = "@trellis-sdk/")]
    pub prefix: String,

    #[arg(long)]
    pub crate_name: Option<String>,

    #[arg(long, value_enum, default_value = "registry")]
    pub runtime_source: RuntimeSource,

    #[arg(long)]
    pub runtime_repo_root: Option<PathBuf>,
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{Cli, GenerateSubcommand, PackageTarget, SelfSubcommand, TopLevelCommand};

    #[test]
    fn prepare_accepts_watch_flag() {
        let cli = Cli::try_parse_from(["trellis-generate", "prepare", "--watch", "."])
            .expect("prepare --watch should parse");

        let Some(TopLevelCommand::Prepare(args)) = cli.command else {
            panic!("expected prepare command");
        };

        assert!(args.watch, "prepare --watch should set the watch flag");
    }

    #[test]
    fn prepare_accepts_changes_flag_with_watch() {
        let cli = Cli::try_parse_from(["trellis-generate", "prepare", "--watch", "--changes", "."])
            .expect("prepare --watch --changes should parse");

        let Some(TopLevelCommand::Prepare(args)) = cli.command else {
            panic!("expected prepare command");
        };

        assert!(args.watch, "prepare --watch should set the watch flag");
        assert!(
            args.changes,
            "prepare --changes should set the changes flag"
        );
    }

    #[test]
    fn prepare_rejects_changes_without_watch() {
        Cli::try_parse_from(["trellis-generate", "prepare", "--changes", "."])
            .expect_err("prepare --changes should require --watch");
    }

    #[test]
    fn prepare_accepts_prefix() {
        let cli =
            Cli::try_parse_from(["trellis-generate", "prepare", "--prefix", "@example/", "."])
                .expect("prepare --prefix should parse");

        let Some(TopLevelCommand::Prepare(args)) = cli.command else {
            panic!("expected prepare command");
        };

        assert_eq!(args.prefix, "@example/");
    }

    #[test]
    fn prepare_accepts_out() {
        let cli = Cli::try_parse_from([
            "trellis-generate",
            "prepare",
            "./service",
            "--out",
            "./artifacts",
        ])
        .expect("prepare --out should parse");

        let Some(TopLevelCommand::Prepare(args)) = cli.command else {
            panic!("expected prepare command");
        };

        assert_eq!(args.root, std::path::PathBuf::from("./service"));
        assert_eq!(args.out, Some(std::path::PathBuf::from("./artifacts")));
    }

    #[test]
    fn prepare_defaults_prefix_to_trellis_sdk_scope() {
        let cli = Cli::try_parse_from(["trellis-generate", "prepare", "."])
            .expect("prepare should parse");

        let Some(TopLevelCommand::Prepare(args)) = cli.command else {
            panic!("expected prepare command");
        };

        assert_eq!(args.prefix, "@trellis-sdk/");
    }

    #[test]
    fn prepare_accepts_comma_separated_targets() {
        let cli = Cli::try_parse_from([
            "trellis-generate",
            "prepare",
            "--targets",
            "manifest,jsr,npm,cargo",
            ".",
        ])
        .expect("prepare --targets should parse");

        let Some(TopLevelCommand::Prepare(args)) = cli.command else {
            panic!("expected prepare command");
        };

        assert_eq!(
            args.targets,
            vec![
                PackageTarget::Manifest,
                PackageTarget::Jsr,
                PackageTarget::Npm,
                PackageTarget::Cargo,
            ]
        );
    }

    #[test]
    fn prepare_accepts_no_npm() {
        let cli = Cli::try_parse_from(["trellis-generate", "prepare", "--no-npm", "."])
            .expect("prepare --no-npm should parse");

        let Some(TopLevelCommand::Prepare(args)) = cli.command else {
            panic!("expected prepare command");
        };

        assert!(args.no_npm);
    }

    #[test]
    fn generate_uses_package_target_subcommands() {
        let cli = Cli::try_parse_from([
            "trellis-generate",
            "generate",
            "jsr",
            "--source",
            "contract.ts",
            "--out",
            "generated/packages/jsr/demo",
        ])
        .expect("generate jsr should parse");

        let Some(TopLevelCommand::Generate(command)) = cli.command else {
            panic!("expected generate command");
        };
        assert!(matches!(command.command, GenerateSubcommand::Jsr(_)));
    }

    #[test]
    fn self_check_accepts_prerelease_flag() {
        let cli = Cli::try_parse_from(["trellis-generate", "self", "check", "--prerelease"])
            .expect("self check --prerelease should parse");

        let Some(TopLevelCommand::Self_(command)) = cli.command else {
            panic!("expected self command");
        };
        let SelfSubcommand::Check(args) = command.command else {
            panic!("expected self check command");
        };

        assert!(args.prerelease);
    }

    #[test]
    fn self_update_accepts_prerelease_flag() {
        let cli = Cli::try_parse_from(["trellis-generate", "self", "update", "--prerelease"])
            .expect("self update --prerelease should parse");

        let Some(TopLevelCommand::Self_(command)) = cli.command else {
            panic!("expected self command");
        };
        let SelfSubcommand::Update(args) = command.command else {
            panic!("expected self update command");
        };

        assert!(args.prerelease);
    }
}
