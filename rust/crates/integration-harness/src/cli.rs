use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Clone, Eq, Parser, PartialEq)]
#[command(name = "integration", about = "Run the Trellis integration harness")]
/// CLI arguments for the Trellis integration harness.
pub struct IntegrationArgs {
    #[command(subcommand)]
    /// Optional integration harness command. Defaults to running the suite.
    pub command: Option<IntegrationCommand>,

    #[command(flatten)]
    /// Run options accepted without the explicit `run` subcommand.
    pub run: RunArgs,
}

impl Default for IntegrationArgs {
    fn default() -> Self {
        Self {
            command: None,
            run: RunArgs::default(),
        }
    }
}

impl IntegrationArgs {
    /// Return the run options for the default command or explicit run subcommand.
    pub(crate) fn run_args(&self) -> Option<&RunArgs> {
        match &self.command {
            Some(IntegrationCommand::List(_)) => None,
            Some(IntegrationCommand::Run(args)) => Some(args),
            None => Some(&self.run),
        }
    }

    /// Return the selected list target, when the CLI requested inventory output.
    pub(crate) fn list_target(&self) -> Option<ListCommand> {
        match &self.command {
            Some(IntegrationCommand::List(target)) => Some(*target),
            Some(IntegrationCommand::Run(_)) | None => None,
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Subcommand)]
/// Integration harness command.
pub enum IntegrationCommand {
    /// Run the integration suite.
    Run(RunArgs),

    /// List integration harness inventory.
    #[command(subcommand)]
    List(ListCommand),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Subcommand)]
/// Integration harness inventory to print.
pub enum ListCommand {
    /// Print required integration coverage areas.
    Coverage,

    /// Print registered integration fixtures.
    Fixtures,

    /// Print known failing integration cases.
    KnownFailures,
}

#[derive(Debug, Clone, Default, Eq, Args, PartialEq)]
/// Options for running the Trellis integration harness.
pub struct RunArgs {
    #[arg(long)]
    /// Fail when any known failing integration cases are still registered.
    pub strict_known_failures: bool,

    #[arg(long)]
    /// Preserve the temporary integration workdir after the command exits.
    pub keep_workdir: bool,

    #[arg(long)]
    /// Skip the prepare workflow before bootstrapping integration dependencies.
    pub skip_prepare: bool,

    #[arg(long = "fixture")]
    /// Fixture id to include. May be repeated.
    pub fixtures: Vec<String>,

    #[arg(long = "coverage")]
    /// Required coverage id to include. May be repeated.
    pub coverage: Vec<String>,

    #[arg(long, value_enum, default_value_t = ReportFormat::Human)]
    /// Fixture result output format.
    pub format: ReportFormat,

    #[arg(long)]
    /// Write successful fixture results as JUnit XML.
    pub junit: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, Default, Eq, PartialEq, ValueEnum)]
/// Fixture result output format.
pub enum ReportFormat {
    /// Human-readable stderr output.
    #[default]
    Human,

    /// JSON stdout output.
    Json,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use clap::Parser;

    use super::{IntegrationArgs, IntegrationCommand, ListCommand, ReportFormat};

    #[test]
    fn parses_default_run_options_without_subcommand() {
        let args = IntegrationArgs::try_parse_from([
            "integration",
            "--skip-prepare",
            "--keep-workdir",
            "--strict-known-failures",
            "--fixture",
            "rpc",
            "--coverage",
            "cross-runtime-rpc",
        ])
        .expect("default run args should parse");

        assert!(args.command.is_none());
        assert!(args.run.skip_prepare);
        assert!(args.run.keep_workdir);
        assert!(args.run.strict_known_failures);
        assert_eq!(args.run.fixtures, vec!["rpc".to_string()]);
        assert_eq!(args.run.coverage, vec!["cross-runtime-rpc".to_string()]);
    }

    #[test]
    fn parses_explicit_run_subcommand_options() {
        let args = IntegrationArgs::try_parse_from([
            "integration",
            "run",
            "--skip-prepare",
            "--fixture",
            "jobs",
            "--fixture",
            "resources",
            "--coverage",
            "jobs-public-api",
        ])
        .expect("run subcommand should parse");

        let Some(IntegrationCommand::Run(run)) = args.command else {
            panic!("expected run subcommand");
        };
        assert!(run.skip_prepare);
        assert_eq!(
            run.fixtures,
            vec!["jobs".to_string(), "resources".to_string()]
        );
        assert_eq!(run.coverage, vec!["jobs-public-api".to_string()]);
    }

    #[test]
    fn parses_run_report_options() {
        let args = IntegrationArgs::try_parse_from([
            "integration",
            "run",
            "--format",
            "json",
            "--junit",
            "target/integration.xml",
        ])
        .expect("run report options should parse");

        let Some(IntegrationCommand::Run(run)) = args.command else {
            panic!("expected run subcommand");
        };
        assert_eq!(run.format, ReportFormat::Json);
        assert_eq!(run.junit, Some(PathBuf::from("target/integration.xml")));
    }

    #[test]
    fn parses_list_subcommands() {
        let args = IntegrationArgs::try_parse_from(["integration", "list", "coverage"])
            .expect("coverage list should parse");
        assert_eq!(args.list_target(), Some(ListCommand::Coverage));

        let args = IntegrationArgs::try_parse_from(["integration", "list", "fixtures"])
            .expect("fixture list should parse");
        assert_eq!(args.list_target(), Some(ListCommand::Fixtures));

        let args = IntegrationArgs::try_parse_from(["integration", "list", "known-failures"])
            .expect("known failure list should parse");
        assert_eq!(args.list_target(), Some(ListCommand::KnownFailures));
    }
}
