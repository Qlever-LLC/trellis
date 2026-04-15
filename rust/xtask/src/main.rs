use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

#[derive(Debug, Clone, Eq, PartialEq)]
enum XtaskCommand {
    Prepare,
    Build(Vec<String>),
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<(), String> {
    match parse_command(env::args().skip(1))? {
        XtaskCommand::Prepare => run_prepare(),
        XtaskCommand::Build(args) => run_build(&args),
    }
}

fn parse_command<I>(mut args: I) -> Result<XtaskCommand, String>
where
    I: Iterator<Item = String>,
{
    match args.next().as_deref() {
        Some("prepare") => {
            if let Some(extra) = args.next() {
                Err(format!("unexpected argument `{extra}`\n{}", usage_text()))
            } else {
                Ok(XtaskCommand::Prepare)
            }
        }
        Some("build") => Ok(XtaskCommand::Build(args.collect())),
        Some(command) => Err(format!(
            "unsupported xtask command `{command}`\n{}",
            usage_text()
        )),
        None => Err(usage_text().to_owned()),
    }
}

fn usage_text() -> &'static str {
    "usage: cargo xtask prepare | cargo xtask build [cargo-build-args...]"
}

fn run_prepare() -> Result<(), String> {
    let repo_root = repo_root()?;
    let bootstrap_manifest = repo_root.join("rust/tools/generate/Cargo.toml");
    let status = Command::new("cargo")
        .current_dir(&repo_root)
        .arg("run")
        .arg("--manifest-path")
        .arg(&bootstrap_manifest)
        .arg("--bin")
        .arg("trellis-generate")
        .arg("--")
        .arg("prepare")
        .arg(".")
        .status()
        .map_err(|error| format!("failed to run cargo for prepare workflow: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("prepare workflow failed with status {status}"))
    }
}

fn run_build(args: &[String]) -> Result<(), String> {
    run_prepare()?;
    let workspace_root = repo_root()?.join("rust");
    let status = Command::new("cargo")
        .current_dir(&workspace_root)
        .arg("build")
        .args(args)
        .status()
        .map_err(|error| format!("failed to run cargo for build workflow: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("build workflow failed with status {status}"))
    }
}

fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest_dir.ancestors() {
        if ancestor.join("rust/tools/generate/Cargo.toml").exists()
            && ancestor.join("js/deno.json").exists()
        {
            return Ok(ancestor.to_path_buf());
        }
    }
    Err("failed to resolve repository root from xtask manifest".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{parse_command, XtaskCommand};

    #[test]
    fn parse_prepare_command() {
        let command = parse_command(["prepare".to_string()].into_iter()).expect("parse prepare");
        assert_eq!(command, XtaskCommand::Prepare);
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
    fn prepare_rejects_extra_args() {
        let error = parse_command(["prepare", "--workspace"].into_iter().map(str::to_string))
            .expect_err("prepare should reject extra args");
        assert!(error.contains("unexpected argument `--workspace`"));
    }
}
