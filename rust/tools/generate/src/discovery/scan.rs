use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use miette::IntoDiagnostic;

const TS_MANIFEST_FILES: &[&str] = &["deno.json", "deno.jsonc", "package.json"];
const TOP_LEVEL_TS_CONTRACT_FILES: &[&str] = &["contract.ts", "contract.js"];
const RUST_MANIFEST_FILE: &str = "Cargo.toml";
const SKIPPED_DISCOVERY_DIRS: &[&str] = &[
    ".git",
    ".svelte-kit",
    "build",
    "demos",
    "dist",
    "generated",
    "node_modules",
    "npm",
    "target",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SourceLanguage {
    TypeScript,
    Rust,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct DiscoveredContractSource {
    pub project_root: PathBuf,
    pub manifest_path: PathBuf,
    pub language: SourceLanguage,
    pub source_path: PathBuf,
}

pub fn discover_local_contracts(start: &Path) -> miette::Result<Vec<DiscoveredContractSource>> {
    let start = start.canonicalize().into_diagnostic()?;
    let mut current = if start.is_dir() {
        Some(start)
    } else {
        start.parent().map(Path::to_path_buf)
    };

    while let Some(dir) = current {
        let discovered = discover_contracts_in_dir(&dir)?;
        if !discovered.is_empty() {
            return Ok(discovered);
        }
        current = dir.parent().map(Path::to_path_buf);
    }

    Err(miette::miette!(
        "could not find a local project root with discoverable contract sources"
    ))
}

pub fn discover_contracts(root: &Path) -> miette::Result<Vec<DiscoveredContractSource>> {
    let root = root.canonicalize().into_diagnostic()?;
    let mut pending = vec![root];
    let mut discovered = BTreeMap::new();

    while let Some(dir) = pending.pop() {
        for contract in discover_contracts_in_dir(&dir)? {
            discovered.insert(contract.source_path.clone(), contract);
        }

        for entry in fs::read_dir(&dir).into_diagnostic()? {
            let entry = entry.into_diagnostic()?;
            if entry.file_type().into_diagnostic()?.is_dir() {
                let path = entry.path();
                if should_skip_dir(&path) {
                    continue;
                }
                pending.push(path);
            }
        }
    }

    Ok(discovered.into_values().collect())
}

fn discover_contracts_in_dir(dir: &Path) -> miette::Result<Vec<DiscoveredContractSource>> {
    let mut discovered = BTreeMap::new();

    for manifest_name in TS_MANIFEST_FILES {
        let manifest_path = dir.join(manifest_name);
        if !manifest_path.exists() {
            continue;
        }
        for contract in collect_project_contracts(&manifest_path, SourceLanguage::TypeScript)? {
            discovered.insert(contract.source_path.clone(), contract);
        }
    }

    let cargo_manifest = dir.join(RUST_MANIFEST_FILE);
    if cargo_manifest.exists() {
        for contract in collect_project_contracts(&cargo_manifest, SourceLanguage::Rust)? {
            discovered.insert(contract.source_path.clone(), contract);
        }
    }

    Ok(discovered.into_values().collect())
}

fn collect_project_contracts(
    manifest_path: &Path,
    language: SourceLanguage,
) -> miette::Result<Vec<DiscoveredContractSource>> {
    let project_root = manifest_path
        .parent()
        .ok_or_else(|| miette::miette!("manifest has no parent: {}", manifest_path.display()))?
        .to_path_buf();
    if language == SourceLanguage::TypeScript {
        return collect_typescript_project_contracts(&project_root, manifest_path);
    }

    collect_contracts_dir_sources(&project_root, manifest_path, language)
}

fn collect_typescript_project_contracts(
    project_root: &Path,
    manifest_path: &Path,
) -> miette::Result<Vec<DiscoveredContractSource>> {
    let contracts_dir = project_root.join("contracts");
    let contracts_dir_sources =
        collect_contracts_dir_sources(project_root, manifest_path, SourceLanguage::TypeScript)?;
    let top_level_sources = collect_top_level_ts_contract_sources(project_root, manifest_path)?;

    if top_level_sources.len() > 1 {
        return Err(miette::miette!(
            "project root {} has multiple top-level contract sources; choose exactly one of contract.ts or contract.js",
            project_root.display()
        ));
    }

    if contracts_dir.exists() && contracts_dir.is_dir() {
        if !contracts_dir_sources.is_empty() && !top_level_sources.is_empty() {
            return Err(miette::miette!(
                "project root {} has both contracts/ and a top-level contract.ts or contract.js; choose one layout",
                project_root.display()
            ));
        }

        if !contracts_dir_sources.is_empty() {
            return Ok(contracts_dir_sources);
        }
    }

    Ok(top_level_sources)
}

fn collect_top_level_ts_contract_sources(
    project_root: &Path,
    manifest_path: &Path,
) -> miette::Result<Vec<DiscoveredContractSource>> {
    let mut discovered = Vec::new();

    for file_name in TOP_LEVEL_TS_CONTRACT_FILES {
        let source_path = project_root.join(file_name);
        if !source_path.exists() || !source_path.is_file() {
            continue;
        }
        if !source_has_default_export(&source_path) {
            continue;
        }

        discovered.push(DiscoveredContractSource {
            project_root: project_root.to_path_buf(),
            manifest_path: manifest_path.to_path_buf(),
            language: SourceLanguage::TypeScript,
            source_path: source_path.canonicalize().into_diagnostic()?,
        });
    }

    discovered.sort();
    Ok(discovered)
}

fn source_has_default_export(path: &Path) -> bool {
    fs::read_to_string(path)
        .ok()
        .is_some_and(|source| source.contains("export default"))
}

fn collect_contracts_dir_sources(
    project_root: &Path,
    manifest_path: &Path,
    language: SourceLanguage,
) -> miette::Result<Vec<DiscoveredContractSource>> {
    let contracts_dir = project_root.join("contracts");
    if !contracts_dir.exists() || !contracts_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut discovered = Vec::new();
    for entry in fs::read_dir(&contracts_dir).into_diagnostic()? {
        let entry = entry.into_diagnostic()?;
        if !entry.file_type().into_diagnostic()?.is_file() {
            continue;
        }
        let source_path = entry.path();
        if !matches_contract_source(&source_path, language) {
            continue;
        }
        discovered.push(DiscoveredContractSource {
            project_root: project_root.to_path_buf(),
            manifest_path: manifest_path.to_path_buf(),
            language,
            source_path: source_path.canonicalize().into_diagnostic()?,
        });
    }
    discovered.sort();
    Ok(discovered)
}

fn matches_contract_source(path: &Path, language: SourceLanguage) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if file_name.ends_with(".d.ts")
        || file_name.ends_with(".test.ts")
        || file_name.ends_with(".spec.ts")
    {
        return false;
    }

    match language {
        SourceLanguage::TypeScript => {
            path.extension().and_then(|value| value.to_str()) == Some("ts")
        }
        SourceLanguage::Rust => path.extension().and_then(|value| value.to_str()) == Some("rs"),
    }
}

fn should_skip_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| SKIPPED_DISCOVERY_DIRS.contains(&value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discover_local_contracts_uses_nearest_manifest_root() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path();
        let outer = repo_root.join("outer");
        let inner = outer.join("inner");
        fs::create_dir_all(inner.join("src")).unwrap();
        fs::create_dir_all(outer.join("contracts")).unwrap();
        fs::create_dir_all(inner.join("contracts")).unwrap();
        fs::write(outer.join("deno.json"), "{}\n").unwrap();
        fs::write(inner.join("deno.json"), "{}\n").unwrap();
        fs::write(
            outer.join("contracts/outer.ts"),
            "export const CONTRACT = {};\n",
        )
        .unwrap();
        fs::write(
            inner.join("contracts/inner.ts"),
            "export const CONTRACT = {};\n",
        )
        .unwrap();

        let discovered = discover_local_contracts(&inner.join("src")).unwrap();
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].project_root, inner.canonicalize().unwrap());
        assert!(discovered[0].source_path.ends_with("contracts/inner.ts"));
    }

    #[test]
    fn discover_local_contracts_finds_top_level_contract_ts() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("service");
        fs::create_dir_all(project.join("src/nested")).unwrap();
        fs::write(project.join("package.json"), "{}\n").unwrap();
        fs::write(
            project.join("contract.ts"),
            "const contract = {};\nexport default contract;\n",
        )
        .unwrap();

        let discovered = discover_local_contracts(&project.join("src/nested")).unwrap();
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].project_root, project.canonicalize().unwrap());
        assert!(discovered[0].source_path.ends_with("contract.ts"));
    }

    #[test]
    fn discover_contracts_finds_ts_and_rust_sources_in_contracts_dirs() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path();
        let ts_project = repo_root.join("js/service");
        let rust_project = repo_root.join("rust/service");
        fs::create_dir_all(ts_project.join("contracts")).unwrap();
        fs::create_dir_all(rust_project.join("contracts")).unwrap();
        fs::write(ts_project.join("deno.json"), "{}\n").unwrap();
        fs::write(
            rust_project.join("Cargo.toml"),
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n\n[dependencies]\n",
        )
        .unwrap();
        fs::write(
            ts_project.join("contracts/service.ts"),
            "export const CONTRACT = {};\n",
        )
        .unwrap();
        fs::write(
            ts_project.join("contracts/service.test.ts"),
            "export const CONTRACT = {};\n",
        )
        .unwrap();
        fs::write(
            rust_project.join("contracts/service.rs"),
            "pub const CONTRACT_JSON: &str = include_str!(\"service.json\");\n",
        )
        .unwrap();

        let discovered = discover_contracts(repo_root).unwrap();
        assert_eq!(discovered.len(), 2);
        assert!(discovered.iter().any(|value| {
            value.language == SourceLanguage::TypeScript
                && value.source_path.ends_with("contracts/service.ts")
        }));
        assert!(discovered.iter().any(|value| {
            value.language == SourceLanguage::Rust
                && value.source_path.ends_with("contracts/service.rs")
        }));
    }

    #[test]
    fn discover_contracts_finds_top_level_contract_js() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path();
        let project = repo_root.join("apps/dashboard");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("package.json"), "{}\n").unwrap();
        fs::write(
            project.join("contract.js"),
            "const contract = {};\nexport default contract;\n",
        )
        .unwrap();

        let discovered = discover_contracts(repo_root).unwrap();
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].project_root, project.canonicalize().unwrap());
        assert_eq!(discovered[0].language, SourceLanguage::TypeScript);
        assert!(discovered[0].source_path.ends_with("contract.js"));
    }

    #[test]
    fn discover_contracts_errors_for_duplicate_typescript_layouts() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path();
        let project = repo_root.join("service");
        fs::create_dir_all(project.join("contracts")).unwrap();
        fs::write(project.join("package.json"), "{}\n").unwrap();
        fs::write(
            project.join("contracts/orders.ts"),
            "export const CONTRACT = {};\n",
        )
        .unwrap();
        fs::write(
            project.join("contract.ts"),
            "const contract = {};\nexport default contract;\n",
        )
        .unwrap();

        let error = discover_contracts(repo_root).unwrap_err();
        assert!(error.to_string().contains("has both contracts/ and a top-level contract.ts or contract.js"));
    }

    #[test]
    fn discover_contracts_errors_for_multiple_top_level_contract_sources() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path();
        let project = repo_root.join("service");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("package.json"), "{}\n").unwrap();
        fs::write(
            project.join("contract.ts"),
            "const contract = {};\nexport default contract;\n",
        )
        .unwrap();
        fs::write(
            project.join("contract.js"),
            "const contract = {};\nexport default contract;\n",
        )
        .unwrap();

        let error = discover_contracts(repo_root).unwrap_err();
        assert!(error
            .to_string()
            .contains("has multiple top-level contract sources"));
    }

    #[test]
    fn discover_contracts_ignores_top_level_contract_helper_without_default_export() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path();
        let project = repo_root.join("package");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("package.json"), "{}\n").unwrap();
        fs::write(
            project.join("contract.ts"),
            "export function defineContract() { return {}; }\n",
        )
        .unwrap();

        let discovered = discover_contracts(repo_root).unwrap();
        assert!(discovered.is_empty());
    }

    #[test]
    fn discover_contracts_allows_top_level_contract_with_empty_contracts_dir() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path();
        let project = repo_root.join("service");
        fs::create_dir_all(project.join("contracts")).unwrap();
        fs::write(project.join("package.json"), "{}\n").unwrap();
        fs::write(
            project.join("contract.ts"),
            "const contract = {};\nexport default contract;\n",
        )
        .unwrap();

        let discovered = discover_contracts(repo_root).unwrap();
        assert_eq!(discovered.len(), 1);
        assert!(discovered[0].source_path.ends_with("contract.ts"));
    }

    #[test]
    fn discover_contracts_allows_top_level_contract_with_only_ignored_contracts_files() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path();
        let project = repo_root.join("service");
        fs::create_dir_all(project.join("contracts")).unwrap();
        fs::write(project.join("package.json"), "{}\n").unwrap();
        fs::write(
            project.join("contract.js"),
            "const contract = {};\nexport default contract;\n",
        )
        .unwrap();
        fs::write(
            project.join("contracts/contract.test.ts"),
            "export const CONTRACT = {};\n",
        )
        .unwrap();

        let discovered = discover_contracts(repo_root).unwrap();
        assert_eq!(discovered.len(), 1);
        assert!(discovered[0].source_path.ends_with("contract.js"));
    }

    #[test]
    fn discover_contracts_skips_nested_demos_dir() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path();
        let service = repo_root.join("js/service");
        let demo_service = repo_root.join("demos/js/service/demo");
        fs::create_dir_all(service.join("contracts")).unwrap();
        fs::create_dir_all(demo_service.join("contracts")).unwrap();
        fs::write(service.join("deno.json"), "{}\n").unwrap();
        fs::write(demo_service.join("deno.json"), "{}\n").unwrap();
        fs::write(
            service.join("contracts/service.ts"),
            "export const CONTRACT = {};\n",
        )
        .unwrap();
        fs::write(
            demo_service.join("contracts/demo.ts"),
            "export const CONTRACT = {};\n",
        )
        .unwrap();

        let discovered = discover_contracts(repo_root).unwrap();

        assert_eq!(discovered.len(), 1);
        assert!(discovered[0]
            .source_path
            .ends_with("js/service/contracts/service.ts"));
    }
}
