use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use miette::{IntoDiagnostic, Result, WrapErr};

use crate::workspace::repo_root;

#[derive(Debug)]
pub(crate) struct IntegrationWorkdir {
    path: PathBuf,
    keep: bool,
}

impl IntegrationWorkdir {
    pub(crate) fn create(keep: bool) -> Result<Self> {
        let path = unique_workdir_path()?;
        fs::create_dir_all(&path)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to create integration workdir {}", path.display()))?;
        Ok(Self { path, keep })
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
        if self.keep {
            return;
        }
        if let Err(error) = fs::remove_dir_all(&self.path) {
            eprintln!(
                "warning: failed to remove integration workdir {}: {error}",
                self.path.display()
            );
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

fn unique_workdir_path() -> Result<PathBuf> {
    let repo_name = repo_root()?
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("trellis")
        .to_owned();
    let process_id = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .into_diagnostic()
        .wrap_err("system clock is before UNIX epoch")?
        .as_nanos();

    Ok(env::temp_dir().join(format!("{repo_name}-integration-{process_id}-{nanos}")))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::IntegrationWorkdir;

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
