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
    let manifest: ContractManifest = serde_json::from_value(value)?;
    validate_schema_refs(&manifest)?;
    validate_stream_sources(&manifest)?;
    Ok(manifest)
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

fn validate_schema_refs(manifest: &ContractManifest) -> Result<(), ContractsError> {
    for (name, rpc) in &manifest.rpc {
        assert_schema_ref_exists(manifest, &rpc.input.schema, &format!("rpc '{name}' input"))?;
        assert_schema_ref_exists(
            manifest,
            &rpc.output.schema,
            &format!("rpc '{name}' output"),
        )?;
    }

    for (name, operation) in &manifest.operations {
        assert_schema_ref_exists(
            manifest,
            &operation.input.schema,
            &format!("operation '{name}' input"),
        )?;
        if let Some(progress) = &operation.progress {
            assert_schema_ref_exists(
                manifest,
                &progress.schema,
                &format!("operation '{name}' progress"),
            )?;
        }
        if let Some(output) = &operation.output {
            assert_schema_ref_exists(
                manifest,
                &output.schema,
                &format!("operation '{name}' output"),
            )?;
        }
    }

    for (name, event) in &manifest.events {
        assert_schema_ref_exists(manifest, &event.event.schema, &format!("event '{name}'"))?;
    }

    for (name, subject) in &manifest.subjects {
        if let Some(message) = &subject.message {
            assert_schema_ref_exists(manifest, &message.schema, &format!("subject '{name}'"))?;
        }
    }

    for (name, error) in &manifest.errors {
        if let Some(schema) = &error.schema {
            assert_schema_ref_exists(manifest, &schema.schema, &format!("error '{name}'"))?;
        }
    }

    for (queue_type, queue) in &manifest.jobs {
        assert_schema_ref_exists(
            manifest,
            &queue.payload.schema,
            &format!("jobs queue '{queue_type}' payload"),
        )?;
        if let Some(result) = &queue.result {
            assert_schema_ref_exists(
                manifest,
                &result.schema,
                &format!("jobs queue '{queue_type}' result"),
            )?;
        }
    }

    for (alias, kv) in &manifest.resources.kv {
        assert_schema_ref_exists(
            manifest,
            &kv.schema.schema,
            &format!("resources.kv.{alias}"),
        )?;
    }

    Ok(())
}

fn validate_stream_sources(manifest: &ContractManifest) -> Result<(), ContractsError> {
    for (stream_alias, stream) in &manifest.resources.streams {
        let Some(sources) = &stream.sources else {
            continue;
        };
        for (index, source) in sources.iter().enumerate() {
            if manifest.resources.streams.contains_key(&source.from_alias) {
                continue;
            }
            return Err(ContractsError::SchemaValidation {
                kind: "contract",
                details: format!(
                    "resources.streams.{stream_alias}.sources[{index}].fromAlias: unknown stream alias '{}'",
                    source.from_alias
                ),
            });
        }
    }

    Ok(())
}

fn assert_schema_ref_exists(
    manifest: &ContractManifest,
    schema_name: &str,
    context: &str,
) -> Result<(), ContractsError> {
    if manifest.schemas.contains_key(schema_name) {
        Ok(())
    } else {
        Err(ContractsError::SchemaValidation {
            kind: "contract",
            details: format!("{context}: unknown schema '{schema_name}'"),
        })
    }
}
