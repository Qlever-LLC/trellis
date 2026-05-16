//! Version-pinned launcher for the Trellis contract generator.

use std::env;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, ExitStatus};

use self_update::{get_target, Download, Extract};
use sha2::{Digest, Sha256};

const REPO_OWNER: &str = "qlever-llc";
const REPO_NAME: &str = "trellis";
const BIN_NAME: &str = "trellis-generate";
const SUPPORTED_TARGETS: &[&str] = &[
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
];

/// Error returned when the generator runner cannot resolve or execute the binary.
#[derive(Debug)]
pub struct GenerateRunnerError {
    message: String,
}

impl GenerateRunnerError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for GenerateRunnerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for GenerateRunnerError {}

/// Run the version of `trellis-generate` that matches this crate version.
pub fn run<I, S>(args: I) -> ExitCode
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    match run_status(args) {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(status) => ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

/// Run `trellis-generate` with the provided arguments and return its exit status.
pub fn run_status<I, S>(args: I) -> Result<ExitStatus, GenerateRunnerError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let args = args
        .into_iter()
        .map(|arg| arg.as_ref().to_os_string())
        .collect::<Vec<_>>();
    if let Some(repo_root) = find_local_trellis_repo_root() {
        return run_local_generator(&repo_root, &args);
    }

    let binary = match env::var_os("TRELLIS_GENERATE_BIN") {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => ensure_cached_release_binary(env!("CARGO_PKG_VERSION"))?,
    };
    verify_binary_version(&binary, env!("CARGO_PKG_VERSION"))?;
    Command::new(&binary).args(args).status().map_err(|error| {
        GenerateRunnerError::new(format!("failed to run {}: {error}", binary.display()))
    })
}

fn find_local_trellis_repo_root() -> Option<PathBuf> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest_dir.ancestors() {
        if ancestor.join("rust/tools/generate/Cargo.toml").exists()
            && ancestor.join("js/deno.json").exists()
        {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

fn run_local_generator(
    repo_root: &Path,
    args: &[OsString],
) -> Result<ExitStatus, GenerateRunnerError> {
    Command::new("cargo")
        .current_dir(repo_root)
        .arg("run")
        .arg("--manifest-path")
        .arg(repo_root.join("rust/tools/generate/Cargo.toml"))
        .arg("--bin")
        .arg(BIN_NAME)
        .arg("--")
        .args(args)
        .status()
        .map_err(|error| {
            GenerateRunnerError::new(format!(
                "failed to run local {BIN_NAME} from {}: {error}",
                repo_root.display()
            ))
        })
}

fn ensure_cached_release_binary(version: &str) -> Result<PathBuf, GenerateRunnerError> {
    let target = release_target()?;
    let cache_dir = cache_root()?.join(version).join(target);
    let binary = cache_dir.join(BIN_NAME);
    if binary.exists() {
        return Ok(binary);
    }

    fs::create_dir_all(&cache_dir).map_err(|error| {
        GenerateRunnerError::new(format!("failed to create {}: {error}", cache_dir.display()))
    })?;
    let tag = format!("v{version}");
    let archive_name = format!("{BIN_NAME}-{tag}-{target}.tar.gz");
    let archive_url = format!(
        "https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/download/{tag}/{archive_name}"
    );
    let checksum_name = format!("checksum-{tag}-{target}-{BIN_NAME}.sha256");
    let checksum_url = format!(
        "https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/download/{tag}/{checksum_name}"
    );

    let archive = download(&archive_url)?;
    let checksum_text = String::from_utf8(download(&checksum_url)?).map_err(|error| {
        GenerateRunnerError::new(format!("checksum asset was not valid UTF-8: {error}"))
    })?;
    verify_checksum(&archive, &checksum_text, &archive_url)?;

    let archive_path = cache_dir.join(archive_name);
    let mut archive_file = fs::File::create(&archive_path).map_err(|error| {
        GenerateRunnerError::new(format!(
            "failed to create {}: {error}",
            archive_path.display()
        ))
    })?;
    archive_file.write_all(&archive).map_err(|error| {
        GenerateRunnerError::new(format!(
            "failed to write {}: {error}",
            archive_path.display()
        ))
    })?;

    Extract::from_source(&archive_path)
        .extract_file(&cache_dir, BIN_NAME)
        .map_err(|error| {
            GenerateRunnerError::new(format!(
                "failed to extract {}: {error}",
                archive_path.display()
            ))
        })?;

    make_executable(&binary)?;
    Ok(binary)
}

fn release_target() -> Result<&'static str, GenerateRunnerError> {
    let target = get_target();
    SUPPORTED_TARGETS
        .iter()
        .copied()
        .find(|candidate| *candidate == target)
        .ok_or_else(|| {
            GenerateRunnerError::new(format!(
                "no {BIN_NAME} release binary is available for {target}"
            ))
        })
}

fn cache_root() -> Result<PathBuf, GenerateRunnerError> {
    if let Some(path) = env::var_os("TRELLIS_GENERATE_CACHE") {
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }
    if let Some(path) = env::var_os("XDG_CACHE_HOME") {
        if !path.is_empty() {
            return Ok(PathBuf::from(path).join("trellis").join(BIN_NAME));
        }
    }
    env::var_os("HOME")
        .filter(|path| !path.is_empty())
        .map(|home| {
            PathBuf::from(home)
                .join(".cache")
                .join("trellis")
                .join(BIN_NAME)
        })
        .ok_or_else(|| {
            GenerateRunnerError::new(
                "HOME or TRELLIS_GENERATE_CACHE must be set to cache trellis-generate",
            )
        })
}

fn download(url: &str) -> Result<Vec<u8>, GenerateRunnerError> {
    let mut bytes = Vec::new();
    let mut download = Download::from_url(url);
    download
        .show_progress(true)
        .download_to(&mut bytes)
        .map_err(|error| GenerateRunnerError::new(format!("failed to download {url}: {error}")))?;
    Ok(bytes)
}

fn verify_checksum(
    bytes: &[u8],
    checksum_text: &str,
    label: &str,
) -> Result<(), GenerateRunnerError> {
    let expected = checksum_text
        .split_whitespace()
        .next()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| {
            GenerateRunnerError::new("release checksum asset did not contain a SHA-256 digest")
        })?;
    if expected.len() != 64 || !expected.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(GenerateRunnerError::new(
            "release checksum asset did not contain a SHA-256 digest",
        ));
    }

    let actual = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual != expected {
        return Err(GenerateRunnerError::new(format!(
            "checksum mismatch for {label}: expected {expected}, got {actual}"
        )));
    }
    Ok(())
}

fn verify_binary_version(binary: &Path, expected_version: &str) -> Result<(), GenerateRunnerError> {
    let output = Command::new(binary)
        .arg("--version")
        .output()
        .map_err(|error| {
            GenerateRunnerError::new(format!(
                "failed to run {} --version: {error}",
                binary.display()
            ))
        })?;
    if !output.status.success() {
        return Err(GenerateRunnerError::new(format!(
            "failed to run {} --version",
            binary.display()
        )));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let actual = text
        .split_whitespace()
        .find(|part| looks_like_version(part))
        .map(normalize_version)
        .ok_or_else(|| {
            GenerateRunnerError::new(format!(
                "{} did not report a version; expected {BIN_NAME} {expected_version}",
                binary.display()
            ))
        })?;
    let expected = normalize_version(expected_version);
    if actual != expected {
        return Err(GenerateRunnerError::new(format!(
            "{} is {}; expected {BIN_NAME} {expected_version}",
            binary.display(),
            text.trim()
        )));
    }
    Ok(())
}

fn looks_like_version(value: &str) -> bool {
    value
        .trim_start_matches('v')
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_digit())
}

fn normalize_version(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('v')
        .split_once('+')
        .map_or_else(|| value.trim().trim_start_matches('v'), |(base, _)| base)
        .to_string()
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), GenerateRunnerError> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|error| {
            GenerateRunnerError::new(format!("failed to stat {}: {error}", path.display()))
        })?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).map_err(|error| {
        GenerateRunnerError::new(format!(
            "failed to make {} executable: {error}",
            path.display()
        ))
    })
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), GenerateRunnerError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{looks_like_version, normalize_version, verify_checksum};

    #[test]
    fn normalizes_versions_without_build_metadata() {
        assert_eq!(normalize_version("v0.8.2+local.deadbeef"), "0.8.2");
        assert_eq!(normalize_version("0.8.3-rc.1"), "0.8.3-rc.1");
    }

    #[test]
    fn detects_version_tokens() {
        assert!(looks_like_version("0.8.2"));
        assert!(looks_like_version("v0.8.2"));
        assert!(!looks_like_version("trellis-generate"));
    }

    #[test]
    fn verifies_release_checksum_text() {
        verify_checksum(
            b"trellis",
            "3a4ad37e305ff3bb775fb38a93345aa1f29961fcf88e9415a093d9e6eec8c65a  archive.tar.gz",
            "archive.tar.gz",
        )
        .unwrap();
    }
}
