use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use miette::IntoDiagnostic;
use serde_json::Value;
use tempfile::TempDir;
use trellis_contracts::{load_manifest, LoadedManifest};

const DEFAULT_IMAGE_CONTRACT_PATH: &str = "/trellis/contract.json";
const OCI_CONTRACT_PATH_LABELS: &[&str] = &["io.trellis.contract.path"];

pub struct ResolvedContractInput {
    pub loaded: LoadedManifest,
    pub manifest_path: PathBuf,
    pub owner_version: Option<String>,
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
            owner_version: infer_owner_version(path),
            _temp_dir: None,
        });
    }

    if let Some(path) = source {
        return resolve_source_contract(path, source_export);
    }

    resolve_image_contract(image.expect("validated image input"), image_contract_path)
}

fn resolve_source_contract(
    source_path: &Path,
    source_export: &str,
) -> miette::Result<ResolvedContractInput> {
    let source_path = source_path.canonicalize().into_diagnostic()?;
    if source_path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
    {
        return resolve_rust_source_contract(&source_path, source_export);
    }

    let temp_dir = TempDir::new().into_diagnostic()?;
    let manifest_path = temp_dir.path().join("contract.json");
    let deno_config = find_deno_config(&source_path);

    let script = r#"
const [sourcePath, exportName] = Deno.args;
const mod = await import(new URL(sourcePath, "file:///").href);
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
        owner_version: infer_owner_version(&source_path),
        _temp_dir: Some(temp_dir),
    })
}

fn resolve_rust_source_contract(
    source_path: &Path,
    source_export: &str,
) -> miette::Result<ResolvedContractInput> {
    let temp_dir = TempDir::new().into_diagnostic()?;
    let manifest_path = temp_dir.path().join("contract.json");
    let source = fs::read_to_string(source_path).into_diagnostic()?;
    let contract_json = extract_rust_contract_json(&source, source_export, source_path)?;

    fs::write(&manifest_path, contract_json).into_diagnostic()?;
    let loaded = load_manifest(&manifest_path).into_diagnostic()?;
    Ok(ResolvedContractInput {
        loaded,
        manifest_path,
        owner_version: infer_owner_version(source_path),
        _temp_dir: Some(temp_dir),
    })
}

fn extract_rust_contract_json(
    source: &str,
    source_export: &str,
    source_path: &Path,
) -> miette::Result<String> {
    let mut names = vec![source_export.to_string()];
    if !source_export.ends_with("_JSON") {
        names.push(format!("{source_export}_JSON"));
    }

    for name in names {
        if let Some(include_path) = extract_rust_const_include_path(source, &name) {
            let include_path = source_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(include_path);
            let contract_json = fs::read_to_string(&include_path).into_diagnostic()?;
            return Ok(contract_json);
        }
    }

    Err(miette::miette!(
        "failed to resolve Rust contract source: expected `const {source_export}` or `const {source_export}_JSON` as include_str!(...)"
    ))
}

fn extract_rust_const_include_path(source: &str, const_name: &str) -> Option<String> {
    let rhs = extract_rust_const_rhs(source, const_name)?;
    parse_rust_include_str(rhs)
}

fn extract_rust_const_rhs<'a>(source: &'a str, const_name: &str) -> Option<&'a str> {
    let needle = format!("const {const_name}");
    let mut offset = 0;
    while let Some(found) = source[offset..].find(&needle) {
        let start = offset + found;
        let after = &source[start + needle.len()..];
        if after
            .chars()
            .next()
            .is_some_and(|ch| ch == '_' || ch.is_ascii_alphanumeric())
        {
            offset = start + needle.len();
            continue;
        }
        let equals = after.find('=')?;
        return Some(after[equals + 1..].trim_start());
    }
    None
}

fn parse_rust_include_str(value: &str) -> Option<String> {
    let trimmed = value.trim_start();
    let after_macro = trimmed.strip_prefix("include_str!")?.trim_start();
    let inner = after_macro.strip_prefix('(')?;
    let close = inner.find(')')?;
    let arg = inner[..close].trim();
    parse_rust_string_literal(arg)
}

fn parse_rust_string_literal(value: &str) -> Option<String> {
    if value.starts_with('r') {
        return parse_rust_raw_string_literal(value);
    }
    if !value.starts_with('"') {
        return None;
    }

    let mut escaped = false;
    let mut content = String::new();
    for ch in value[1..].chars() {
        if escaped {
            content.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '"' => return Some(content),
            _ => content.push(ch),
        }
    }
    None
}

fn parse_rust_raw_string_literal(value: &str) -> Option<String> {
    if !value.starts_with('r') {
        return None;
    }
    let after_r = &value[1..];
    let hashes = after_r.chars().take_while(|ch| *ch == '#').count();
    let after_hashes = &after_r[hashes..];
    if !after_hashes.starts_with('"') {
        return None;
    }
    let content = &after_hashes[1..];
    let closing = format!("\"{}", "#".repeat(hashes));
    let end = content.find(&closing)?;
    Some(content[..end].to_string())
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
        owner_version: None,
        _temp_dir: Some(temp_dir),
    })
}

fn infer_owner_version(path: &Path) -> Option<String> {
    let path = path
        .canonicalize()
        .ok()
        .unwrap_or_else(|| path.to_path_buf());
    for manifest in find_version_manifests(&path) {
        if let Some(version) = read_version_from_manifest(&manifest) {
            return Some(version);
        }
    }
    None
}

fn find_version_manifests(path: &Path) -> Vec<PathBuf> {
    let mut manifests = Vec::new();
    let mut current = path.parent();
    while let Some(dir) = current {
        for candidate in ["deno.json", "deno.jsonc", "package.json", "Cargo.toml"] {
            let manifest = dir.join(candidate);
            if manifest.exists() {
                manifests.push(manifest);
            }
        }
        current = dir.parent();
    }
    manifests
}

fn read_version_from_manifest(path: &Path) -> Option<String> {
    match path.file_name()?.to_str()? {
        "deno.json" | "deno.jsonc" | "package.json" => read_json_version(path),
        "Cargo.toml" => read_cargo_version(path),
        _ => None,
    }
}

fn read_json_version(path: &Path) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    let manifest: Value = serde_json::from_str(&contents).ok()?;
    manifest
        .get("version")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn read_cargo_version(path: &Path) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    let mut in_package = false;
    let mut uses_workspace_version = false;
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_package = trimmed == "[package]";
            continue;
        }
        if !in_package {
            continue;
        }
        if trimmed.starts_with("version.workspace") {
            let value = trimmed.split_once('=')?.1.trim();
            if value == "true" {
                uses_workspace_version = true;
            }
            continue;
        }
        if !trimmed.starts_with("version =") {
            continue;
        }
        let value = trimmed.split_once('=')?.1.trim().trim_matches('"');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    if uses_workspace_version {
        return read_workspace_cargo_version(path);
    }
    None
}

fn read_workspace_cargo_version(path: &Path) -> Option<String> {
    let mut current = path.parent()?.parent();
    while let Some(dir) = current {
        let manifest = dir.join("Cargo.toml");
        if manifest.exists() {
            let Ok(contents) = fs::read_to_string(&manifest) else {
                current = dir.parent();
                continue;
            };
            let mut in_workspace_package = false;
            for line in contents.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('[') {
                    in_workspace_package = trimmed == "[workspace.package]";
                    continue;
                }
                if !in_workspace_package || !trimmed.starts_with("version =") {
                    continue;
                }
                let value = trimmed.split_once('=')?.1.trim().trim_matches('"');
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
        current = dir.parent();
    }
    None
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
