use std::fs;
use std::path::{Path, PathBuf};

use miette::{miette, IntoDiagnostic, Result, WrapErr};

use crate::container::IntegrationWorkdir;
use crate::process::{CommandSpec, ProcessRunner};
use crate::workspace::repo_root;

const PORTAL_BUILD_DIR_ENV: &str = "TRELLIS_LOGIN_PORTAL_BUILD_DIR";
const PORTAL_SVELTE_KIT_DIR_ENV: &str = "TRELLIS_LOGIN_PORTAL_SVELTE_KIT_DIR";

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
    let (workdir_build_dir, workdir_svelte_kit_dir) = login_portal_build_paths(workdir.path());

    remove_existing_dir(&workdir_build_dir)?;
    remove_existing_dir(&workdir_svelte_kit_dir)?;

    let spec = login_portal_build_command(
        &portal_root,
        &workdir_build_dir,
        &workdir_svelte_kit_dir,
        public_trellis_url,
    );
    let output = process_runner.output(&spec)?;
    if !output.status.success() {
        return Err(miette!(
            "failed to build login portal with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(PortalBuild {
        build_dir: workdir_build_dir,
    })
}

fn login_portal_build_paths(workdir: &Path) -> (PathBuf, PathBuf) {
    (
        workdir.join("portal-login-build"),
        workdir.join("portal-login-svelte-kit"),
    )
}

fn login_portal_build_command(
    portal_root: &Path,
    build_dir: &Path,
    svelte_kit_dir: &Path,
    public_trellis_url: &str,
) -> CommandSpec {
    CommandSpec::new("deno")
        .arg("task")
        .arg("build:static:prebuilt")
        .current_dir(portal_root)
        .env("PUBLIC_TRELLIS_URL", public_trellis_url)
        .env(PORTAL_BUILD_DIR_ENV, build_dir)
        .env(PORTAL_SVELTE_KIT_DIR_ENV, svelte_kit_dir)
}

fn remove_existing_dir(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    fs::remove_dir_all(path)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to remove previous portal output {}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::path::Path;

    use super::{login_portal_build_command, login_portal_build_paths};

    #[test]
    fn login_portal_build_command_uses_workdir_output_paths() {
        let temp = tempfile::tempdir().expect("temp dir");
        let repo_portal_root = Path::new("/repo/js/portals/login");
        let repo_build_dir = repo_portal_root.join("build");
        let (build_dir, svelte_kit_dir) = login_portal_build_paths(temp.path());

        let spec = login_portal_build_command(
            repo_portal_root,
            &build_dir,
            &svelte_kit_dir,
            "http://host.containers.internal:3000",
        );

        let env = |name: &str| {
            spec.envs()
                .iter()
                .find(|(key, _)| key == OsStr::new(name))
                .map(|(_, value)| value)
                .expect("env var set")
        };
        assert_eq!(
            env("PUBLIC_TRELLIS_URL"),
            "http://host.containers.internal:3000"
        );
        assert_eq!(env("TRELLIS_LOGIN_PORTAL_BUILD_DIR"), build_dir.as_os_str());
        assert_eq!(
            env("TRELLIS_LOGIN_PORTAL_SVELTE_KIT_DIR"),
            svelte_kit_dir.as_os_str()
        );
        assert_ne!(
            env("TRELLIS_LOGIN_PORTAL_BUILD_DIR"),
            repo_build_dir.as_os_str()
        );
        assert!(build_dir.starts_with(temp.path()));
        assert!(svelte_kit_dir.starts_with(temp.path()));
    }
}
