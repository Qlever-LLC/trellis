use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::{
    canonicalize_json, sha256_base64url, validate_manifest, ContractManifest, ContractsError,
    LoadedManifest, CONTRACT_FORMAT_V1,
};

/// Load an arbitrary JSON value from disk.
pub fn load_json_value(path: impl AsRef<Path>) -> Result<Value, ContractsError> {
    let path = path.as_ref();
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

/// Parse and validate one contract manifest JSON value.
pub fn parse_manifest(value: Value) -> Result<ContractManifest, ContractsError> {
    validate_manifest(&value)?;
    Ok(serde_json::from_value(value)?)
}

/// Load, validate, canonicalize, and digest one manifest file.
pub fn load_manifest(path: impl AsRef<Path>) -> Result<LoadedManifest, ContractsError> {
    let path = path.as_ref();
    let value = load_json_value(path)?;
    let manifest = parse_manifest(value.clone())?;
    let canonical = canonicalize_json(&value)?;
    let digest = sha256_base64url(&canonical);

    Ok(LoadedManifest {
        path: path.to_path_buf(),
        value,
        manifest,
        canonical,
        digest,
    })
}

/// Collect contract manifest candidates from one directory.
pub fn manifest_paths_in_dir(dir: impl AsRef<Path>) -> Result<Vec<PathBuf>, ContractsError> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !(entry.file_type()?.is_file() && is_manifest_candidate_path(&path)) {
            continue;
        }

        let value = load_json_value(&path)?;
        if value
            .get("format")
            .and_then(Value::as_str)
            .is_some_and(|format| format == CONTRACT_FORMAT_V1)
        {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

fn is_manifest_candidate_path(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "json")
        && path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem.contains('@'))
}
