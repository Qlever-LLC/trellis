use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use miette::{IntoDiagnostic, Result, WrapErr};

mod release;

#[derive(Debug, Clone, Eq, PartialEq)]
enum XtaskCommand {
    Prepare,
    PrepareWatch,
    Build(Vec<String>),
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
        Some("release") => release::parse_release_command(args).map(XtaskCommand::Release),
        Some(command) => Err(miette::miette!(
            "unsupported xtask command `{command}`\n{}",
            usage_text()
        )),
        None => Err(miette::miette!(usage_text())),
    }
}

fn usage_text() -> &'static str {
    "usage: cargo xtask prepare | cargo xtask prepare-watch | cargo xtask build [cargo-build-args...] | cargo xtask release <command>"
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

    use super::{parse_command, XtaskCommand};

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
