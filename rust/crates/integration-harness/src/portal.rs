use std::fs;
use std::path::{Path, PathBuf};

use miette::{miette, IntoDiagnostic, Result, WrapErr};

use crate::container::IntegrationWorkdir;
use crate::process::{CommandSpec, ProcessRunner};
use crate::workspace::repo_root;

#[derive(Debug, Clone)]
pub(crate) struct PortalBuild {
    build_dir: PathBuf,
}

impl PortalBuild {
    pub(crate) fn build_dir(&self) -> &Path {
        &self.build_dir
    }
}

pub(crate) fn build_login_portal(
    process_runner: &ProcessRunner,
    workdir: &IntegrationWorkdir,
    public_trellis_url: &str,
) -> Result<PortalBuild> {
    let repo_root = repo_root()?;
    let portal_root = repo_root.join("js/portals/login");
    let repo_build_dir = portal_root.join("build");
    let workdir_build_dir = workdir.path().join("portal-login-build");

    let spec = CommandSpec::new("deno")
        .arg("task")
        .arg("build:static:prebuilt")
        .current_dir(&portal_root)
        .env("PUBLIC_TRELLIS_URL", public_trellis_url);
    let output = process_runner.output(&spec)?;
    if !output.status.success() {
        return Err(miette!(
            "failed to build login portal with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    if workdir_build_dir.exists() {
        fs::remove_dir_all(&workdir_build_dir)
            .into_diagnostic()
            .wrap_err_with(|| {
                format!(
                    "failed to remove previous portal build {}",
                    workdir_build_dir.display()
                )
            })?;
    }
    // The current SvelteKit static adapter configuration pins output to the
    // project-local `build` directory. Copy it into the integration workdir so
    // Trellis serves a disposable build and generated files are not left there.
    copy_dir(&repo_build_dir, &workdir_build_dir)?;

    Ok(PortalBuild {
        build_dir: workdir_build_dir,
    })
}

fn copy_dir(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to create directory {}", destination.display()))?;
    for entry in fs::read_dir(source)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to read directory {}", source.display()))?
    {
        let entry = entry.into_diagnostic()?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().into_diagnostic()?;
        if file_type.is_dir() {
            copy_dir(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path)
                .into_diagnostic()
                .wrap_err_with(|| {
                    format!(
                        "failed to copy {} to {}",
                        source_path.display(),
                        destination_path.display()
                    )
                })?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::copy_dir;

    #[test]
    fn copy_dir_copies_nested_files() {
        let temp = tempfile::tempdir().expect("temp dir");
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        fs::create_dir_all(source.join("nested")).expect("create source");
        fs::write(source.join("nested/file.txt"), "portal").expect("write source file");

        copy_dir(&source, &destination).expect("copy dir");

        assert_eq!(
            fs::read_to_string(destination.join("nested/file.txt")).expect("read copied file"),
            "portal"
        );
    }
}
