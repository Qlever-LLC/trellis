use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::{
    canonicalize_json, load_manifest, manifest_paths_in_dir, schema::walk_schemas_by_id,
    validate_catalog, Catalog, CatalogEntry, CatalogPack, ContractManifest, ContractsError,
    LoadedManifest, CATALOG_FORMAT_V1,
};

/// Pack manifest files into one validated catalog.
pub fn pack_manifest_paths(paths: &[PathBuf]) -> Result<CatalogPack, ContractsError> {
    let mut loaded = Vec::with_capacity(paths.len());
    for path in paths {
        loaded.push(load_manifest(path)?);
    }
    pack_loaded_manifests(loaded)
}

/// Pack already-loaded manifests into one validated catalog.
pub fn pack_loaded_manifests(
    mut contracts: Vec<LoadedManifest>,
) -> Result<CatalogPack, ContractsError> {
    let mut schema_by_id = HashMap::<String, String>::new();
    let mut digest_by_id = HashMap::<String, String>::new();
    let mut contract_by_subject = HashMap::<String, String>::new();

    for loaded in &contracts {
        for (schema_id, schema) in walk_schemas_by_id(&loaded.value) {
            let canonical = canonicalize_json(schema)?;
            if let Some(previous) = schema_by_id.get(schema_id) {
                if previous != &canonical {
                    return Err(ContractsError::DuplicateSchemaId {
                        schema_id: schema_id.clone(),
                        path: loaded.path.clone(),
                    });
                }
            }
            schema_by_id.insert(schema_id.clone(), canonical);
        }

        if let Some(existing_digest) = digest_by_id.get(&loaded.manifest.id) {
            if existing_digest != &loaded.digest {
                return Err(ContractsError::DuplicateContractId {
                    id: loaded.manifest.id.clone(),
                    existing_digest: existing_digest.clone(),
                    new_digest: loaded.digest.clone(),
                });
            }
        }
        digest_by_id.insert(loaded.manifest.id.clone(), loaded.digest.clone());

        let contract_label = manifest_label(&loaded.manifest);
        for subject in loaded_subjects(&loaded.manifest) {
            if let Some(previous_contract) = contract_by_subject.get(&subject) {
                if previous_contract != &contract_label {
                    return Err(ContractsError::SubjectCollision {
                        subject,
                        first_contract: previous_contract.clone(),
                        second_contract: contract_label.clone(),
                    });
                }
            }
            contract_by_subject.insert(subject.clone(), contract_label.clone());
        }
    }

    contracts.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));

    let catalog = Catalog {
        format: CATALOG_FORMAT_V1.to_string(),
        contracts: contracts
            .iter()
            .map(|loaded| CatalogEntry {
                id: loaded.manifest.id.clone(),
                digest: loaded.digest.clone(),
                display_name: loaded.manifest.display_name.clone(),
                description: loaded.manifest.description.clone(),
                kind: loaded.manifest.kind.clone(),
            })
            .collect(),
    };

    validate_catalog(&serde_json::to_value(&catalog)?)?;

    Ok(CatalogPack { catalog, contracts })
}

/// Scan one directory and pack every manifest candidate it contains.
pub fn pack_manifest_dir(dir: impl AsRef<Path>) -> Result<CatalogPack, ContractsError> {
    let paths = manifest_paths_in_dir(dir)?;
    pack_manifest_paths(&paths)
}

/// Render a catalog into canonical JSON.
pub fn catalog_canonical_json(catalog: &Catalog) -> Result<String, ContractsError> {
    canonicalize_json(&serde_json::to_value(catalog)?)
}

/// Write a catalog and optional digest-addressed contract copies to disk.
pub fn write_catalog_pack(
    pack: &CatalogPack,
    output_path: impl AsRef<Path>,
    contracts_out_dir: Option<impl AsRef<Path>>,
) -> Result<(), ContractsError> {
    let output_path = output_path.as_ref();
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        output_path,
        format!("{}\n", catalog_canonical_json(&pack.catalog)?),
    )?;

    if let Some(contracts_out_dir) = contracts_out_dir {
        let contracts_out_dir = contracts_out_dir.as_ref();
        if contracts_out_dir.exists() {
            fs::remove_dir_all(contracts_out_dir)?;
        }
        fs::create_dir_all(contracts_out_dir)?;

        for contract in &pack.contracts {
            let out_path = contracts_out_dir.join(format!("{}.json", contract.digest));
            fs::write(out_path, format!("{}\n", contract.canonical))?;
        }
    }

    Ok(())
}

fn loaded_subjects(manifest: &ContractManifest) -> Vec<String> {
    let mut subjects = Vec::new();
    subjects.extend(manifest.rpc.values().map(|rpc| rpc.subject.clone()));
    subjects.extend(manifest.events.values().map(|event| event.subject.clone()));
    subjects.extend(
        manifest
            .subjects
            .values()
            .map(|subject| subject.subject.clone()),
    );
    subjects
}

fn manifest_label(manifest: &ContractManifest) -> String {
    format!("{} ({})", manifest.id, manifest.display_name)
}
