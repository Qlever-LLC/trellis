use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use miette::{IntoDiagnostic, Result, WrapErr};

mod release;

#[derive(Debug, Clone, Default, Eq, PartialEq)]
struct IntegrationArgs {
    forwarded_args: Vec<String>,
}

impl IntegrationArgs {
    fn requires_prepare(&self) -> bool {
        !self.has_skip_prepare() && !self.is_list_command() && !self.is_metadata_command()
    }

    fn has_skip_prepare(&self) -> bool {
        self.forwarded_args
            .iter()
            .any(|arg| arg == "--skip-prepare")
    }

    fn is_list_command(&self) -> bool {
        self.forwarded_args.first().is_some_and(|arg| arg == "list")
    }

    fn is_metadata_command(&self) -> bool {
        self.forwarded_args.first().is_some_and(|arg| arg == "help")
            || self
                .forwarded_args
                .iter()
                .any(|arg| matches!(arg.as_str(), "--help" | "-h" | "--version" | "-V"))
    }

    fn should_append_skip_prepare(&self) -> bool {
        self.requires_prepare()
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum XtaskCommand {
    Prepare,
    PrepareWatch,
    Build(Vec<String>),
    Integration(IntegrationArgs),
    Release(release::ReleaseCommand),
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error:?}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<()> {
    match parse_command(env::args().skip(1))? {
        XtaskCommand::Prepare => run_prepare(),
        XtaskCommand::PrepareWatch => run_prepare_watch(),
        XtaskCommand::Build(args) => run_build(&args),
        XtaskCommand::Integration(args) => run_integration(&args),
        XtaskCommand::Release(command) => release::run_release(&repo_root()?, command),
    }
}

fn parse_command<I>(mut args: I) -> Result<XtaskCommand>
where
    I: Iterator<Item = String>,
{
    match args.next().as_deref() {
        Some("prepare") => {
            if let Some(extra) = args.next() {
                Err(miette::miette!(
                    "unexpected argument `{extra}`\n{}",
                    usage_text()
                ))
            } else {
                Ok(XtaskCommand::Prepare)
            }
        }
        Some("prepare-watch") => {
            if let Some(extra) = args.next() {
                Err(miette::miette!(
                    "unexpected argument `{extra}`\n{}",
                    usage_text()
                ))
            } else {
                Ok(XtaskCommand::PrepareWatch)
            }
        }
        Some("build") => Ok(XtaskCommand::Build(args.collect())),
        Some("integration") => Ok(XtaskCommand::Integration(IntegrationArgs {
            forwarded_args: args.collect(),
        })),
        Some("release") => release::parse_release_command(args).map(XtaskCommand::Release),
        Some(command) => Err(miette::miette!(
            "unsupported xtask command `{command}`\n{}",
            usage_text()
        )),
        None => Err(miette::miette!(usage_text())),
    }
}

fn usage_text() -> &'static str {
    "usage: cargo xtask prepare | cargo xtask prepare-watch | cargo xtask build [cargo-build-args...] | cargo xtask integration [integration-harness-args...] | cargo xtask release <command>"
}

fn run_prepare() -> Result<()> {
    run_generate_prepare(&[])
}

fn run_prepare_watch() -> Result<()> {
    run_generate_prepare(&["--watch"])
}

fn run_generate_prepare(extra_args: &[&str]) -> Result<()> {
    let repo_root = repo_root()?;
    let mut args = vec![OsString::from("prepare")];
    args.extend(extra_args.iter().map(OsString::from));
    args.push(repo_root.into_os_string());
    let status = trellis_generate_runner::run_status(args)
        .into_diagnostic()
        .wrap_err("failed to run prepare workflow")?;

    if status.success() {
        Ok(())
    } else {
        Err(miette::miette!(
            "prepare workflow failed with status {status}"
        ))
    }
}

fn run_build(args: &[String]) -> Result<()> {
    run_prepare()?;
    let workspace_root = repo_root()?.join("rust");
    let mut spec = Command::new("cargo");
    spec.current_dir(&workspace_root).arg("build");
    for arg in args {
        spec.arg(arg);
    }
    let status = spec
        .status()
        .into_diagnostic()
        .wrap_err("failed to run cargo for build workflow")?;

    if status.success() {
        Ok(())
    } else {
        Err(miette::miette!(
            "build workflow failed with status {status}"
        ))
    }
}

fn run_integration(args: &IntegrationArgs) -> Result<()> {
    if args.requires_prepare() {
        run_prepare()?;
    }

    let repo_root = repo_root()?;
    let mut spec = Command::new("cargo");
    spec.current_dir(&repo_root)
        .arg("run")
        .arg("--manifest-path")
        .arg(repo_root.join("rust/crates/integration-harness/Cargo.toml"))
        .arg("--bin")
        .arg("trellis-integration-harness")
        .arg("--");
    for arg in &args.forwarded_args {
        spec.arg(arg);
    }
    if args.should_append_skip_prepare() {
        spec.arg("--skip-prepare");
    }
    let status = spec
        .status()
        .into_diagnostic()
        .wrap_err("failed to run integration harness")?;

    if status.success() {
        Ok(())
    } else {
        Err(miette::miette!(
            "integration harness failed with status {status}"
        ))
    }
}

fn repo_root() -> Result<PathBuf> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest_dir.ancestors() {
        if ancestor.join("rust/tools/generate/Cargo.toml").exists()
            && ancestor.join("js/deno.json").exists()
        {
            return Ok(ancestor.to_path_buf());
        }
    }
    Err(miette::miette!(
        "failed to resolve repository root from xtask manifest"
    ))
}

#[cfg(test)]
mod tests {
    use crate::release::ReleaseCommand;

    use super::{parse_command, IntegrationArgs, XtaskCommand};

    #[test]
    fn parse_prepare_command() {
        let command = parse_command(["prepare".to_string()].into_iter()).expect("parse prepare");
        assert_eq!(command, XtaskCommand::Prepare);
    }

    #[test]
    fn parse_prepare_watch_command() {
        let command =
            parse_command(["prepare-watch".to_string()].into_iter()).expect("parse prepare-watch");
        assert_eq!(command, XtaskCommand::PrepareWatch);
    }

    #[test]
    fn parse_build_command_preserves_passthrough_args() {
        let command = parse_command(
            ["build", "--workspace", "--release"]
                .into_iter()
                .map(str::to_string),
        )
        .expect("parse build");
        assert_eq!(
            command,
            XtaskCommand::Build(vec!["--workspace".to_string(), "--release".to_string()])
        );
    }

    #[test]
    fn parse_integration_command_with_defaults() {
        let command = parse_command(["integration"].into_iter().map(str::to_string))
            .expect("parse integration");
        assert_eq!(
            command,
            XtaskCommand::Integration(IntegrationArgs::default())
        );
    }

    #[test]
    fn parse_integration_command_with_options() {
        let command = parse_command(
            [
                "integration",
                "run",
                "--strict-known-failures",
                "--keep-workdir",
                "--fixture",
                "rpc",
            ]
            .into_iter()
            .map(str::to_string),
        )
        .expect("parse integration options");
        assert_eq!(
            command,
            XtaskCommand::Integration(IntegrationArgs {
                forwarded_args: vec![
                    "run".to_string(),
                    "--strict-known-failures".to_string(),
                    "--keep-workdir".to_string(),
                    "--fixture".to_string(),
                    "rpc".to_string(),
                ],
            })
        );
    }

    #[test]
    fn parse_integration_command_with_skip_prepare() {
        let command = parse_command(
            ["integration", "--skip-prepare"]
                .into_iter()
                .map(str::to_string),
        )
        .expect("parse integration skip prepare");
        assert_eq!(
            command,
            XtaskCommand::Integration(IntegrationArgs {
                forwarded_args: vec!["--skip-prepare".to_string()],
            })
        );
    }

    #[test]
    fn integration_defaults_prepare_and_append_skip_prepare() {
        let args = IntegrationArgs::default();
        assert!(args.requires_prepare());
        assert!(args.should_append_skip_prepare());
    }

    #[test]
    fn integration_run_prepares_unless_skip_prepare_is_forwarded() {
        let args = IntegrationArgs {
            forwarded_args: vec![
                "run".to_string(),
                "--fixture".to_string(),
                "rpc".to_string(),
            ],
        };
        assert!(args.requires_prepare());
        assert!(args.should_append_skip_prepare());

        let args = IntegrationArgs {
            forwarded_args: vec!["run".to_string(), "--skip-prepare".to_string()],
        };
        assert!(!args.requires_prepare());
        assert!(!args.should_append_skip_prepare());
    }

    #[test]
    fn integration_list_does_not_prepare_or_append_skip_prepare() {
        let args = IntegrationArgs {
            forwarded_args: vec!["list".to_string(), "coverage".to_string()],
        };
        assert!(!args.requires_prepare());
        assert!(!args.should_append_skip_prepare());
    }

    #[test]
    fn integration_help_and_version_do_not_prepare_or_append_skip_prepare() {
        for forwarded_args in [
            vec!["--help".to_string()],
            vec!["-h".to_string()],
            vec!["help".to_string(), "run".to_string()],
            vec!["run".to_string(), "--help".to_string()],
            vec!["--version".to_string()],
            vec!["-V".to_string()],
        ] {
            let args = IntegrationArgs { forwarded_args };
            assert!(!args.requires_prepare());
            assert!(!args.should_append_skip_prepare());
        }
    }

    #[test]
    fn parse_release_command() {
        let command = parse_command(
            ["release", "check-versions"]
                .into_iter()
                .map(str::to_string),
        )
        .expect("parse release command");
        assert_eq!(
            command,
            XtaskCommand::Release(ReleaseCommand::CheckVersions)
        );
    }

    #[test]
    fn integration_preserves_unknown_args_for_harness() {
        let command = parse_command(
            ["integration", "--nats-server"]
                .into_iter()
                .map(str::to_string),
        )
        .expect("parse integration passthrough");
        assert_eq!(
            command,
            XtaskCommand::Integration(IntegrationArgs {
                forwarded_args: vec!["--nats-server".to_string()],
            })
        );
    }

    #[test]
    fn prepare_rejects_extra_args() {
        let error = parse_command(["prepare", "--workspace"].into_iter().map(str::to_string))
            .expect_err("prepare should reject extra args");
        assert!(error
            .to_string()
            .contains("unexpected argument `--workspace`"));
    }

    #[test]
    fn prepare_watch_rejects_extra_args() {
        let error = parse_command(
            ["prepare-watch", "--workspace"]
                .into_iter()
                .map(str::to_string),
        )
        .expect_err("prepare-watch should reject extra args");
        assert!(error
            .to_string()
            .contains("unexpected argument `--workspace`"));
    }
}
