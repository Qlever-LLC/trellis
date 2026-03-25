use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use miette::IntoDiagnostic;
use tempfile::TempDir;
use trellis_contracts::{load_manifest, LoadedManifest};

const DEFAULT_IMAGE_CONTRACT_PATH: &str = "/trellis/contract.json";
const OCI_CONTRACT_PATH_LABELS: &[&str] = &["io.trellis.contract.path"];

pub struct ResolvedContractInput {
    pub loaded: LoadedManifest,
    pub manifest_path: PathBuf,
    _temp_dir: Option<TempDir>,
}

pub fn default_image_contract_path() -> &'static str {
    DEFAULT_IMAGE_CONTRACT_PATH
}

pub fn resolve_contract_input(
    manifest: Option<&Path>,
    source: Option<&Path>,
    image: Option<&str>,
    source_export: &str,
    image_contract_path: &str,
) -> miette::Result<ResolvedContractInput> {
    let selected = manifest.is_some() as u8 + source.is_some() as u8 + image.is_some() as u8;
    miette::ensure!(
        selected == 1,
        "pass exactly one of --manifest, --source, or --image"
    );

    if let Some(path) = manifest {
        let loaded = load_manifest(path).into_diagnostic()?;
        return Ok(ResolvedContractInput {
            manifest_path: path.to_path_buf(),
            loaded,
            _temp_dir: None,
        });
    }

    if let Some(path) = source {
        return resolve_source_contract(path, source_export);
    }

    resolve_image_contract(image.expect("validated image input"), image_contract_path)
}

pub fn resolve_contract_inputs(
    manifests: &[PathBuf],
    sources: &[PathBuf],
    images: &[String],
    source_export: &str,
    image_contract_path: &str,
) -> miette::Result<Vec<ResolvedContractInput>> {
    let total = manifests.len() + sources.len() + images.len();
    miette::ensure!(
        total > 0,
        "pass at least one of --manifest, --source, or --image"
    );

    let mut resolved = Vec::with_capacity(total);
    for manifest in manifests {
        resolved.push(resolve_contract_input(
            Some(manifest.as_path()),
            None,
            None,
            source_export,
            image_contract_path,
        )?);
    }
    for source in sources {
        resolved.push(resolve_contract_input(
            None,
            Some(source.as_path()),
            None,
            source_export,
            image_contract_path,
        )?);
    }
    for image in images {
        resolved.push(resolve_contract_input(
            None,
            None,
            Some(image.as_str()),
            source_export,
            image_contract_path,
        )?);
    }
    Ok(resolved)
}

fn resolve_source_contract(
    source_path: &Path,
    source_export: &str,
) -> miette::Result<ResolvedContractInput> {
    let source_path = source_path.canonicalize().into_diagnostic()?;
    let temp_dir = TempDir::new().into_diagnostic()?;
    let manifest_path = temp_dir.path().join("contract.json");
    let deno_config = find_deno_config(&source_path);

    let script = r#"
import { resolve, toFileUrl } from "@std/path";
const [sourcePath, exportName] = Deno.args;
const mod = await import(toFileUrl(resolve(sourcePath)).href);
const exported = mod[exportName];
const contract = exported?.CONTRACT ?? exported;
if (!contract || contract.format !== "trellis.contract.v1") {
  throw new Error(`source module '${sourcePath}' must export ${exportName} as a Trellis contract or contract module`);
}
await Deno.stdout.write(new TextEncoder().encode(JSON.stringify(contract)));
"#;

    let mut command = Command::new("deno");
    command.arg("eval").arg("--quiet");
    if let Some(config) = deno_config.as_ref() {
        command.arg("-c").arg(config);
    }
    command
        .arg(script)
        .arg(source_path.as_os_str())
        .arg(source_export);

    let output = command.output().into_diagnostic()?;
    miette::ensure!(
        output.status.success(),
        "failed to resolve contract source {}: {}",
        source_path.display(),
        String::from_utf8_lossy(&output.stderr).trim()
    );

    fs::write(&manifest_path, output.stdout).into_diagnostic()?;
    let loaded = load_manifest(&manifest_path).into_diagnostic()?;
    Ok(ResolvedContractInput {
        loaded,
        manifest_path,
        _temp_dir: Some(temp_dir),
    })
}

fn resolve_image_contract(
    image_ref: &str,
    image_contract_path: &str,
) -> miette::Result<ResolvedContractInput> {
    let image_ref = image_ref.strip_prefix("oci://").unwrap_or(image_ref);
    let oci_tool = find_oci_tool()?;
    let temp_dir = TempDir::new().into_diagnostic()?;
    let manifest_path = temp_dir.path().join("contract.json");
    let resolved_contract_path = inspect_image_contract_path(&oci_tool, image_ref)
        .unwrap_or_else(|| image_contract_path.to_string());

    let create = Command::new(&oci_tool)
        .arg("create")
        .arg(image_ref)
        .output()
        .into_diagnostic()?;
    miette::ensure!(
        create.status.success(),
        "failed to create container from image {image_ref}: {}",
        String::from_utf8_lossy(&create.stderr).trim()
    );
    let container_id = String::from_utf8_lossy(&create.stdout).trim().to_string();

    let copy = Command::new(&oci_tool)
        .arg("cp")
        .arg(format!("{container_id}:{resolved_contract_path}"))
        .arg(&manifest_path)
        .output()
        .into_diagnostic()?;
    let _ = Command::new(&oci_tool)
        .arg("rm")
        .arg("-f")
        .arg(&container_id)
        .output();
    miette::ensure!(
        copy.status.success(),
        "failed to extract {resolved_contract_path} from image {image_ref}: {}",
        String::from_utf8_lossy(&copy.stderr).trim()
    );

    let loaded = load_manifest(&manifest_path).into_diagnostic()?;
    Ok(ResolvedContractInput {
        loaded,
        manifest_path,
        _temp_dir: Some(temp_dir),
    })
}

fn inspect_image_contract_path(oci_tool: &str, image_ref: &str) -> Option<String> {
    let output = Command::new(oci_tool)
        .arg("inspect")
        .arg(image_ref)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let inspected: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    image_contract_path_from_inspect(&inspected)
}

fn image_contract_path_from_inspect(inspected: &serde_json::Value) -> Option<String> {
    let labels = inspected
        .as_array()?
        .first()?
        .get("Config")?
        .get("Labels")?
        .as_object()?;
    for key in OCI_CONTRACT_PATH_LABELS {
        if let Some(path) = labels.get(*key).and_then(serde_json::Value::as_str) {
            if !path.trim().is_empty() {
                return Some(path.to_string());
            }
        }
    }
    None
}

fn find_oci_tool() -> miette::Result<String> {
    for candidate in ["podman", "docker"] {
        if Command::new(candidate).arg("--version").output().is_ok() {
            return Ok(candidate.to_string());
        }
    }
    Err(miette::miette!(
        "install requires either podman or docker for --image resolution"
    ))
}

fn find_deno_config(path: &Path) -> Option<PathBuf> {
    let mut current = path.parent();
    while let Some(dir) = current {
        for candidate in ["deno.json", "deno.jsonc"] {
            let config = dir.join(candidate);
            if config.exists() {
                return Some(config);
            }
        }
        current = dir.parent();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_nearest_deno_config() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("repo");
        let nested = root.join("services/activity/contracts");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("deno.json"), "{}\n").unwrap();
        fs::write(nested.join("service.ts"), "export const CONTRACT = {};\n").unwrap();

        let found = find_deno_config(&nested.join("service.ts")).unwrap();
        assert_eq!(found, root.join("deno.json"));
    }

    #[test]
    fn prefers_trellis_contract_path_label_when_present() {
        let inspected = serde_json::json!([
            {
                "Config": {
                    "Labels": {
                        "io.trellis.contract.path": "/custom/contract.json"
                    }
                }
            }
        ]);

        let path = image_contract_path_from_inspect(&inspected).unwrap();
        assert_eq!(path, "/custom/contract.json");
    }
}
