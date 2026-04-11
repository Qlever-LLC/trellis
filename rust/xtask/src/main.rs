use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

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
    match env::args().nth(1).as_deref() {
        Some("prepare") => run_prepare(),
        Some(command) => Err(format!(
            "unsupported xtask command `{command}`\nusage: cargo xtask prepare"
        )),
        None => Err("usage: cargo xtask prepare".to_owned()),
    }
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

fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest_dir.ancestors() {
        if ancestor.join("scripts/trellis-generate.sh").exists()
            && ancestor.join("rust/tools/generate/Cargo.toml").exists()
        {
            return Ok(ancestor.to_path_buf());
        }
    }
    Err("failed to resolve repository root from xtask manifest".to_owned())
}
