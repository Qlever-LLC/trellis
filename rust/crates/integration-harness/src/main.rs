use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use clap::Parser;
use miette::{IntoDiagnostic, Result, WrapErr};
use trellis_integration_harness::IntegrationArgs;

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
    trellis_integration_harness::run(IntegrationArgs::parse(), run_prepare)
}

fn run_prepare() -> Result<()> {
    let repo_root = repo_root()?;
    let status = Command::new("cargo")
        .current_dir(&repo_root)
        .arg("run")
        .arg("--manifest-path")
        .arg(repo_root.join("rust/tools/generate/Cargo.toml"))
        .arg("--bin")
        .arg("trellis-generate")
        .arg("--")
        .arg("prepare")
        .arg(OsString::from(repo_root.as_os_str()))
        .status()
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
        "failed to resolve repository root from integration harness manifest"
    ))
}
