use trellis_contracts::ContractKind;

use crate::contract_input;

use super::{DiscoveredContractSource, SourceLanguage};

pub fn discover_contract_metadata(
    contract: &DiscoveredContractSource,
) -> miette::Result<(String, ContractKind)> {
    let export_name = match contract.language {
        SourceLanguage::TypeScript | SourceLanguage::Rust => "CONTRACT",
    };
    let resolved = contract_input::resolve_contract_input(
        None,
        Some(&contract.source_path),
        None,
        export_name,
        contract_input::default_image_contract_path(),
    )?;
    Ok((resolved.loaded.manifest.id, resolved.loaded.manifest.kind))
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

#[cfg(test)]
mod tests {
    use std::fs;

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
}
