use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ClientTestMatrix {
    pub(crate) schema_version: u8,
    pub(crate) cases: Vec<MatrixCase>,
}

impl ClientTestMatrix {
    pub(crate) fn case_by_id(&self, id: &str) -> Option<&MatrixCase> {
        self.cases.iter().find(|case_entry| case_entry.id == id)
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct MatrixCase {
    pub(crate) id: String,
    pub(crate) fixture: String,
    pub(crate) title: String,
    pub(crate) coverage: Vec<String>,
    pub(crate) description: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawClientTestMatrix {
    schema_version: u8,
    cases: Vec<RawMatrixCase>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMatrixCase {
    id: String,
    fixture: String,
    title: String,
    coverage: Vec<String>,
    description: String,
}

pub(crate) fn load_client_test_matrix() -> Result<ClientTestMatrix, String> {
    let path = client_test_matrix_path()?;
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let raw: RawClientTestMatrix = serde_json::from_str(&contents)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;
    validate_matrix(raw)
}

pub(crate) fn matrix_case_ids(matrix: &ClientTestMatrix) -> Vec<String> {
    let mut ids = matrix
        .cases
        .iter()
        .map(|case_entry| case_entry.id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

pub(crate) fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest_dir.ancestors() {
        if ancestor
            .join("integration/client-test-matrix.json")
            .exists()
            && ancestor.join("rust/Cargo.toml").exists()
            && ancestor.join("js/deno.json").exists()
        {
            return Ok(ancestor.to_path_buf());
        }
    }
    Err(format!(
        "failed to resolve repository root from {}",
        manifest_dir.display()
    ))
}

fn client_test_matrix_path() -> Result<PathBuf, String> {
    Ok(repo_root()?.join("integration/client-test-matrix.json"))
}

fn validate_matrix(raw: RawClientTestMatrix) -> Result<ClientTestMatrix, String> {
    if raw.schema_version != 1 {
        return Err("client integration matrix schemaVersion must be 1".to_string());
    }

    let mut seen_ids = BTreeSet::new();
    let mut duplicate_ids = BTreeSet::new();
    let mut cases = Vec::with_capacity(raw.cases.len());
    let mut errors = Vec::new();

    for (index, raw_case) in raw.cases.into_iter().enumerate() {
        let context = format!("matrix case {}", index + 1);
        if !seen_ids.insert(raw_case.id.clone()) {
            duplicate_ids.insert(raw_case.id.clone());
        }
        validate_non_empty(&raw_case.id, &format!("{context} id"), &mut errors);
        validate_non_empty(
            &raw_case.fixture,
            &format!("{context} fixture"),
            &mut errors,
        );
        validate_non_empty(&raw_case.title, &format!("{context} title"), &mut errors);
        validate_non_empty(
            &raw_case.description,
            &format!("{context} description"),
            &mut errors,
        );
        for (coverage_index, coverage) in raw_case.coverage.iter().enumerate() {
            validate_non_empty(
                coverage,
                &format!("{context} coverage {}", coverage_index + 1),
                &mut errors,
            );
        }
        let expected_prefix = format!("{}.", raw_case.fixture);
        if !raw_case.id.starts_with(&expected_prefix) {
            errors.push(format!(
                "{context} id {} must start with fixture prefix {expected_prefix}",
                raw_case.id
            ));
        }
        cases.push(MatrixCase {
            id: raw_case.id,
            fixture: raw_case.fixture,
            title: raw_case.title,
            coverage: raw_case.coverage,
            description: raw_case.description,
        });
    }

    if !duplicate_ids.is_empty() {
        errors.push(format!(
            "client integration matrix has duplicate case ids: {}",
            duplicate_ids.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    Ok(ClientTestMatrix {
        schema_version: raw.schema_version,
        cases,
    })
}

fn validate_non_empty(value: &str, context: &str, errors: &mut Vec<String>) {
    if value.trim().is_empty() {
        errors.push(format!("{context} must be a non-empty string"));
    }
}
