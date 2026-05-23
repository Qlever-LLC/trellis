use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use miette::{IntoDiagnostic, Result, WrapErr};
use tempfile::TempDir;

use crate::workspace::repo_root;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ContainerBackend {
    program: &'static str,
}

impl ContainerBackend {
    pub(crate) fn new(program: &'static str) -> Self {
        Self { program }
    }

    pub(crate) fn program(&self) -> &'static str {
        self.program
    }

    pub(crate) fn is_docker(&self) -> bool {
        self.program == "docker"
    }

    pub(crate) fn is_podman(&self) -> bool {
        self.program == "podman"
    }
}

#[derive(Debug)]
pub(crate) struct IntegrationWorkdir {
    temp_dir: Option<TempDir>,
    path: PathBuf,
    keep: bool,
}

impl IntegrationWorkdir {
    pub(crate) fn create(keep: bool) -> Result<Self> {
        let repo_name = repo_root()?
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("trellis")
            .to_owned();
        let temp_dir = tempfile::Builder::new()
            .prefix(&format!("{repo_name}-integration-"))
            .tempdir()
            .into_diagnostic()
            .wrap_err("failed to create integration workdir")?;
        let path = temp_dir.path().to_path_buf();
        Ok(Self {
            temp_dir: Some(temp_dir),
            path,
            keep,
        })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn keep(&self) -> bool {
        self.keep
    }
}

impl Drop for IntegrationWorkdir {
    fn drop(&mut self) {
        if let Some(temp_dir) = self.temp_dir.take() {
            if self.keep {
                let path = temp_dir.keep();
                eprintln!("preserving integration workdir {}", path.display());
            }
        }
    }
}

pub(crate) fn unique_container_name(prefix: &str) -> Result<String> {
    let process_id = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .into_diagnostic()
        .wrap_err("system clock is before UNIX epoch")?
        .as_nanos();

    Ok(format!("trellis-integration-{prefix}-{process_id}-{nanos}"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{ContainerBackend, IntegrationWorkdir};

    #[test]
    fn container_backend_exposes_runtime_kind() {
        let docker = ContainerBackend::new("docker");
        assert!(docker.is_docker());
        assert!(!docker.is_podman());

        let podman = ContainerBackend::new("podman");
        assert!(podman.is_podman());
        assert!(!podman.is_docker());
    }

    #[test]
    fn integration_workdir_removes_temp_directory_by_default() {
        let path = {
            let workdir = IntegrationWorkdir::create(false).expect("create workdir");
            let path = workdir.path().to_path_buf();
            assert!(path.exists());
            path
        };

        assert!(!path.exists());
    }

    #[test]
    fn integration_workdir_can_be_preserved() {
        let workdir = IntegrationWorkdir::create(true).expect("create workdir");
        let path = workdir.path().to_path_buf();
        drop(workdir);

        assert!(path.exists());
        fs::remove_dir_all(path).expect("remove preserved workdir");
    }
}
