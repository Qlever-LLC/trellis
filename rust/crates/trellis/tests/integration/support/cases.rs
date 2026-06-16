use std::collections::BTreeSet;

use super::matrix::{load_client_test_matrix, matrix_case_ids, repo_root, ClientTestMatrix};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct IntegrationCase {
    pub(crate) id: &'static str,
    pub(crate) module: &'static str,
}

impl IntegrationCase {
    pub(crate) const fn new(id: &'static str, module: &'static str) -> Self {
        Self { id, module }
    }
}

pub(crate) const RUST_INTEGRATION_CASES: &[IntegrationCase] = &[
    IntegrationCase::new("rpc.client-calls-service", "rpc"),
    IntegrationCase::new("events.client-publishes-and-subscribes", "events"),
    IntegrationCase::new("events.denied-publish", "events"),
    IntegrationCase::new(
        "operations.client-starts-and-watches-operation",
        "operations",
    ),
    IntegrationCase::new("feeds.client-consumes-service-feed", "feeds"),
    IntegrationCase::new("state.client-reads-and-updates-shared-state", "state"),
    IntegrationCase::new("transfer.client-uploads-and-downloads-file", "transfer"),
    IntegrationCase::new(
        "resources.service-uses-bound-resources-for-client-call",
        "resources",
    ),
    IntegrationCase::new(
        "jobs.service-runs-local-job-for-client-visible-workflow",
        "jobs",
    ),
    IntegrationCase::new("health.client-observes-service-heartbeat", "health"),
    IntegrationCase::new(
        "service-approval.service-startup-awaits-approval",
        "service_approval",
    ),
    IntegrationCase::new(
        "app-identity-approval.client-obtains-approved-grant",
        "app_identity_approval",
    ),
    IntegrationCase::new(
        "device-activation.device-client-activates-and-connects",
        "device_activation",
    ),
];

pub(crate) fn rust_case_by_id(id: &str) -> Option<&'static IntegrationCase> {
    RUST_INTEGRATION_CASES
        .iter()
        .find(|case_entry| case_entry.id == id)
}

pub(crate) fn assert_rust_manifest_conforms_to_matrix() {
    let matrix = load_client_test_matrix().expect("load shared client integration matrix");
    assert_eq!(matrix.schema_version, 1);

    let report = build_conformance_report(&matrix, RUST_INTEGRATION_CASES)
        .expect("build Rust integration conformance report");
    if !report.is_empty() {
        panic!("{report}");
    }
}

fn build_conformance_report(
    matrix: &ClientTestMatrix,
    local_cases: &[IntegrationCase],
) -> Result<String, String> {
    let matrix_ids = matrix_case_ids(matrix);
    let mut local_ids = local_cases
        .iter()
        .map(|case_entry| case_entry.id.to_string())
        .collect::<Vec<_>>();
    local_ids.sort();

    let missing = matrix_ids
        .iter()
        .filter(|id| !local_ids.contains(id))
        .cloned()
        .collect::<Vec<_>>();
    let extra = local_ids
        .iter()
        .filter(|id| !matrix_ids.contains(id))
        .cloned()
        .collect::<Vec<_>>();
    let local_duplicates = duplicates(local_ids.iter().map(String::as_str));
    let fixture_prefix_mismatches = fixture_prefix_errors(matrix, local_cases);
    let missing_modules = missing_module_files(local_cases)?;
    let mut messages = Vec::new();

    if !missing.is_empty() {
        messages.push(format!(
            "missing Rust integration cases: {}",
            missing.join(", ")
        ));
    }
    if !extra.is_empty() {
        messages.push(format!(
            "extra Rust integration cases not in matrix: {}",
            extra.join(", ")
        ));
    }
    if !local_duplicates.is_empty() {
        messages.push(format!(
            "duplicate Rust integration case ids: {}",
            local_duplicates.join(", ")
        ));
    }
    if !fixture_prefix_mismatches.is_empty() {
        messages.push(format!(
            "Rust integration case ids with wrong fixture prefix: {}",
            fixture_prefix_mismatches.join(", ")
        ));
    }
    if !missing_modules.is_empty() {
        messages.push(format!(
            "Rust integration case modules without test files: {}",
            missing_modules.join(", ")
        ));
    }

    Ok(messages.join("\n"))
}

fn duplicates<'a>(values: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut duplicates = BTreeSet::new();
    for value in values {
        if !seen.insert(value) {
            duplicates.insert(value.to_string());
        }
    }
    duplicates.into_iter().collect()
}

fn fixture_prefix_errors(
    matrix: &ClientTestMatrix,
    local_cases: &[IntegrationCase],
) -> Vec<String> {
    let mut errors = Vec::new();
    for case_entry in local_cases {
        let Some(matrix_case) = matrix.case_by_id(case_entry.id) else {
            continue;
        };
        let expected_prefix = format!("{}.", matrix_case.fixture);
        if !case_entry.id.starts_with(&expected_prefix) {
            errors.push(format!(
                "{} expected prefix {expected_prefix}",
                case_entry.id
            ));
        }
    }
    errors
}

fn missing_module_files(local_cases: &[IntegrationCase]) -> Result<Vec<String>, String> {
    let integration_dir = repo_root()?.join("rust/crates/trellis/tests/integration");
    let mut missing = Vec::new();
    for case_entry in local_cases {
        let module_file = integration_dir.join(format!("{}.rs", case_entry.module));
        if !module_file.is_file() {
            missing.push(format!("{} -> {}", case_entry.id, module_file.display()));
        }
    }
    Ok(missing)
}
