use std::fs;

use miette::IntoDiagnostic;
use trellis_contracts::ContractKind;

use crate::contract_input;

use super::{DiscoveredContractSource, SourceLanguage};

pub fn discover_contract_metadata(
    contract: &DiscoveredContractSource,
) -> miette::Result<(String, ContractKind)> {
    match contract.language {
        SourceLanguage::TypeScript => discover_typescript_contract_metadata(&contract.source_path),
        SourceLanguage::Rust => discover_rust_contract_metadata(&contract.source_path),
    }
}

fn discover_typescript_contract_metadata(
    path: &std::path::Path,
) -> miette::Result<(String, ContractKind)> {
    match resolve_contract_metadata(path) {
        Ok(metadata) => Ok(metadata),
        Err(resolve_error) => {
            let source = fs::read_to_string(path).into_diagnostic()?;
            let contract_id = extract_quoted_source_field(&source, "id").ok_or(resolve_error)?;
            let kind = if let Some(kind) = extract_quoted_source_field(&source, "kind") {
                parse_contract_kind(&kind)?
            } else {
                infer_contract_kind_from_typescript_source(&source).ok_or_else(|| {
                    miette::miette!("failed to infer contract kind from {}", path.display())
                })?
            };
            Ok((contract_id, kind))
        }
    }
}

fn discover_rust_contract_metadata(
    path: &std::path::Path,
) -> miette::Result<(String, ContractKind)> {
    resolve_contract_metadata(path)
}

fn resolve_contract_metadata(path: &std::path::Path) -> miette::Result<(String, ContractKind)> {
    let resolved = contract_input::resolve_contract_input(
        None,
        Some(path),
        None,
        "CONTRACT",
        contract_input::default_image_contract_path(),
    )?;
    Ok((resolved.loaded.manifest.id, resolved.loaded.manifest.kind))
}

fn extract_quoted_source_field(source: &str, field: &str) -> Option<String> {
    let needle = format!("{field}:");
    let mut offset = 0;
    while let Some(found) = source[offset..].find(&needle) {
        let start = offset + found;
        let before = source[..start].chars().next_back();
        if before.is_some_and(|ch| ch == '_' || ch.is_ascii_alphanumeric()) {
            offset = start + needle.len();
            continue;
        }
        let after = source[start + needle.len()..].trim_start();
        let value = after.strip_prefix('"')?;
        let end = value.find('"')?;
        return Some(value[..end].to_string());
    }
    None
}

pub fn parse_contract_kind(value: &str) -> miette::Result<ContractKind> {
    match value {
        "service" => Ok(ContractKind::Service),
        "app" => Ok(ContractKind::App),
        "portal" => Ok(ContractKind::Portal),
        "device" => Ok(ContractKind::Device),
        "cli" => Ok(ContractKind::Cli),
        _ => Err(miette::miette!("unsupported contract kind '{value}'")),
    }
}

fn infer_contract_kind_from_typescript_source(source: &str) -> Option<ContractKind> {
    const HELPER_KINDS: [(&str, ContractKind); 5] = [
        ("defineServiceContract(", ContractKind::Service),
        ("defineAppContract(", ContractKind::App),
        ("definePortalContract(", ContractKind::Portal),
        ("defineDeviceContract(", ContractKind::Device),
        ("defineCliContract(", ContractKind::Cli),
    ];

    HELPER_KINDS
        .into_iter()
        .find_map(|(needle, kind)| source.contains(needle).then_some(kind))
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn discovers_typescript_metadata_via_deno_resolution() {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join("node-service");
        let contracts = project.join("contracts");
        fs::create_dir_all(&contracts).unwrap();
        fs::write(
            project.join("package.json"),
            "{\n  \"name\": \"node-service\",\n  \"version\": \"0.4.0\",\n  \"type\": \"module\"\n}\n",
        )
        .unwrap();
        fs::write(
            contracts.join("orders.ts"),
            concat!(
                "const CONTRACT_ID = ['trellis', 'node-orders@v1'].join('.');\n",
                "const CONTRACT_KIND = ['ser', 'vice'].join('');\n",
                "export const CONTRACT = {\n",
                "  format: 'trellis.contract.v1',\n",
                "  id: CONTRACT_ID,\n",
                "  displayName: 'Orders',\n",
                "  description: 'Orders',\n",
                "  kind: CONTRACT_KIND,\n",
                "};\n",
            ),
        )
        .unwrap();

        let discovered = DiscoveredContractSource {
            project_root: project.clone(),
            manifest_path: project.join("package.json"),
            source_path: contracts.join("orders.ts"),
            language: SourceLanguage::TypeScript,
        };

        let (id, kind) = discover_contract_metadata(&discovered).unwrap();
        assert_eq!(id, "trellis.node-orders@v1");
        assert_eq!(kind, ContractKind::Service);
    }

    #[test]
    fn falls_back_to_static_typescript_metadata_when_runtime_resolution_fails() {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join("activity-app");
        let contracts = project.join("contracts");
        fs::create_dir_all(&contracts).unwrap();
        fs::write(
            project.join("package.json"),
            "{\n  \"name\": \"activity-app\",\n  \"version\": \"0.4.0\",\n  \"type\": \"module\"\n}\n",
        )
        .unwrap();
        fs::write(
            contracts.join("activity_app.ts"),
            concat!(
                "import { defineAppContract } from '@qlever-llc/trellis/contracts';\n",
                "import { activity } from '@qlever-llc/trellis-sdk/activity';\n",
                "export const activityApp = defineAppContract(() => ({\n",
                "  id: \"trellis.activity-app@v1\",\n",
                "  displayName: \"Activity App\",\n",
                "  description: \"Activity UI\",\n",
                "  uses: { activity },\n",
                "}));\n",
                "export default activityApp;\n",
            ),
        )
        .unwrap();

        let discovered = DiscoveredContractSource {
            project_root: project.clone(),
            manifest_path: project.join("package.json"),
            source_path: contracts.join("activity_app.ts"),
            language: SourceLanguage::TypeScript,
        };

        let (id, kind) = discover_contract_metadata(&discovered).unwrap();
        assert_eq!(id, "trellis.activity-app@v1");
        assert_eq!(kind, ContractKind::App);
    }
}
