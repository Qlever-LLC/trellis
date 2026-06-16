use std::collections::BTreeSet;

use super::matrix::{load_client_test_matrix, matrix_case_ids, repo_root, ClientTestMatrix};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct IntegrationCase {
    pub(crate) id: &'static str,
    pub(crate) module: &'static str,
    pub(crate) function: &'static str,
    pub(crate) runtime: IntegrationRuntime,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum IntegrationRuntime {
    LiveTrellis,
}

impl IntegrationCase {
    pub(crate) const fn live(
        id: &'static str,
        module: &'static str,
        function: &'static str,
    ) -> Self {
        Self {
            id,
            module,
            function,
            runtime: IntegrationRuntime::LiveTrellis,
        }
    }
}

pub(crate) const RUST_INTEGRATION_CASES: &[IntegrationCase] = &[
    IntegrationCase::live(
        "rpc.client-calls-service-success",
        "rpc",
        "rpc_client_calls_service_success",
    ),
    IntegrationCase::live(
        "rpc.service-receives-caller-context",
        "rpc",
        "rpc_service_receives_caller_context",
    ),
    IntegrationCase::live(
        "rpc.client-receives-declared-error",
        "rpc",
        "rpc_client_receives_declared_error",
    ),
    IntegrationCase::live(
        "rpc.denies-client-without-call-authority",
        "rpc",
        "rpc_denies_client_without_call_authority",
    ),
    IntegrationCase::live(
        "events.client-publishes-and-subscriber-receives",
        "events",
        "events_client_publishes_and_subscriber_receives",
    ),
    IntegrationCase::live(
        "events.denies-publish-without-authority",
        "events",
        "events_denies_publish_without_authority",
    ),
    IntegrationCase::live(
        "events.denies-subscribe-without-authority",
        "events",
        "events_denies_subscribe_without_authority",
    ),
    IntegrationCase::live(
        "operations.client-starts-operation",
        "operations",
        "operations_client_starts_operation",
    ),
    IntegrationCase::live(
        "operations.client-watches-progress",
        "operations",
        "operations_client_watches_progress",
    ),
    IntegrationCase::live(
        "operations.client-waits-for-completion",
        "operations",
        "operations_client_waits_for_completion",
    ),
    IntegrationCase::live(
        "operations.denies-start-without-call-authority",
        "operations",
        "operations_denies_start_without_call_authority",
    ),
    IntegrationCase::live(
        "feeds.client-receives-first-frame",
        "feeds",
        "feeds_client_receives_first_frame",
    ),
    IntegrationCase::live(
        "feeds.client-receives-ordered-frames",
        "feeds",
        "feeds_client_receives_ordered_frames",
    ),
    IntegrationCase::live(
        "feeds.abort-stops-client-subscription",
        "feeds",
        "feeds_abort_stops_client_subscription",
    ),
    IntegrationCase::live(
        "feeds.denies-subscribe-without-authority",
        "feeds",
        "feeds_denies_subscribe_without_authority",
    ),
    IntegrationCase::live(
        "state.value-store-missing-read",
        "state",
        "state_value_store_missing_read",
    ),
    IntegrationCase::live(
        "state.value-store-create-read-delete",
        "state",
        "state_value_store_create_read_delete",
    ),
    IntegrationCase::live(
        "state.value-store-stale-revision-rejected",
        "state",
        "state_value_store_stale_revision_rejected",
    ),
    IntegrationCase::live(
        "state.map-store-prefix-put-get-list-delete",
        "state",
        "state_map_store_prefix_put_get_list_delete",
    ),
    IntegrationCase::live(
        "state.map-store-list-limit",
        "state",
        "state_map_store_list_limit",
    ),
    IntegrationCase::live(
        "transfer.client-uploads-file-via-operation",
        "transfer",
        "transfer_client_uploads_file_via_operation",
    ),
    IntegrationCase::live(
        "transfer.client-downloads-file-via-receive-grant",
        "transfer",
        "transfer_client_downloads_file_via_receive_grant",
    ),
    IntegrationCase::live(
        "transfer.download-grant-is-session-bound",
        "transfer",
        "transfer_download_grant_is_session_bound",
    ),
    IntegrationCase::live(
        "resources.service-receives-required-bindings",
        "resources",
        "resources_service_receives_required_bindings",
    ),
    IntegrationCase::live(
        "resources.service-receives-optional-bindings",
        "resources",
        "resources_service_receives_optional_bindings",
    ),
    IntegrationCase::live(
        "resources.service-store-create-read-list-delete",
        "resources",
        "resources_service_store_create_read_list_delete",
    ),
    IntegrationCase::live(
        "resources.service-kv-create-put-get-delete",
        "resources",
        "resources_service_kv_create_put_get_delete",
    ),
    IntegrationCase::live(
        "resources.service-kv-stale-revision-rejected",
        "resources",
        "resources_service_kv_stale_revision_rejected",
    ),
    IntegrationCase::live(
        "jobs.service-creates-local-job-from-client-rpc",
        "jobs",
        "jobs_service_creates_local_job_from_client_rpc",
    ),
    IntegrationCase::live(
        "jobs.job-progress-and-log-are-published",
        "jobs",
        "jobs_job_progress_and_log_are_published",
    ),
    IntegrationCase::live(
        "jobs.job-wait-returns-typed-result",
        "jobs",
        "jobs_job_wait_returns_typed_result",
    ),
    IntegrationCase::live(
        "jobs.job-context-propagates-request-and-trace",
        "jobs",
        "jobs_job_context_propagates_request_and_trace",
    ),
    IntegrationCase::live(
        "health.client-subscribes-to-heartbeats",
        "health",
        "health_client_subscribes_to_heartbeats",
    ),
    IntegrationCase::live(
        "health.heartbeat-includes-service-metadata",
        "health",
        "health_heartbeat_includes_service_metadata",
    ),
    IntegrationCase::live(
        "health.heartbeat-includes-custom-checks",
        "health",
        "health_heartbeat_includes_custom_checks",
    ),
    IntegrationCase::live(
        "health.heartbeat-event-context-is-populated",
        "health",
        "health_heartbeat_event_context_is_populated",
    ),
    IntegrationCase::live(
        "service-approval.startup-blocks-before-authority-approval",
        "service_approval",
        "service_approval_startup_blocks_before_authority_approval",
    ),
    IntegrationCase::live(
        "service-approval.startup-completes-after-authority-approval",
        "service_approval",
        "service_approval_startup_completes_after_authority_approval",
    ),
    IntegrationCase::live(
        "service-approval.approved-service-handles-client-rpc",
        "service_approval",
        "service_approval_approved_service_handles_client_rpc",
    ),
    IntegrationCase::live(
        "app-identity-approval.connect-requires-auth-flow",
        "app_identity_approval",
        "app_identity_approval_connect_requires_auth_flow",
    ),
    IntegrationCase::live(
        "app-identity-approval.approved-client-connects",
        "app_identity_approval",
        "app_identity_approval_approved_client_connects",
    ),
    IntegrationCase::live(
        "app-identity-approval.approved-client-calls-service",
        "app_identity_approval",
        "app_identity_approval_approved_client_calls_service",
    ),
    IntegrationCase::live(
        "device-activation.admin-provisions-known-device",
        "device_activation",
        "device_activation_admin_provisions_known_device",
    ),
    IntegrationCase::live(
        "device-activation.device-starts-activation-request",
        "device_activation",
        "device_activation_device_starts_activation_request",
    ),
    IntegrationCase::live(
        "device-activation.admin-resolves-activation-operation",
        "device_activation",
        "device_activation_admin_resolves_activation_operation",
    ),
    IntegrationCase::live(
        "device-activation.device-receives-connect-info",
        "device_activation",
        "device_activation_device_receives_connect_info",
    ),
    IntegrationCase::live(
        "device-activation.activated-device-connects-and-authenticates",
        "device_activation",
        "device_activation_activated_device_connects_and_authenticates",
    ),
    IntegrationCase::live(
        "device-activation.activated-device-authority-is-listed",
        "device_activation",
        "device_activation_activated_device_authority_is_listed",
    ),
];

pub(crate) fn rust_case_by_id(id: &str) -> Option<&'static IntegrationCase> {
    RUST_INTEGRATION_CASES
        .iter()
        .find(|case_entry| case_entry.id == id)
}

pub(crate) fn assert_rust_manifest_conforms_to_matrix() {
    let matrix = load_client_test_matrix().expect("load shared client integration matrix");

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

    let integration_dir = repo_root()?.join("rust/crates/trellis/tests/integration");
    for case_entry in local_cases {
        if case_entry.runtime != IntegrationRuntime::LiveTrellis {
            messages.push(format!(
                "case {} has unexpected runtime {:?}",
                case_entry.id, case_entry.runtime
            ));
        }

        let module_path = integration_dir.join(format!("{}.rs", case_entry.module));
        let content = std::fs::read_to_string(&module_path)
            .map_err(|e| format!("failed to read {}: {}", module_path.display(), e))?;
        let fn_pattern = format!("async fn {}(", case_entry.function);
        if !content.contains("#[tokio::test]") || !content.contains(&fn_pattern) {
            messages.push(format!(
                "case {}: missing #[tokio::test] async fn {}() in {}",
                case_entry.id, case_entry.function, case_entry.module
            ));
        }

        let fn_decl = format!("fn {}(", case_entry.function);
        let fn_count = content.matches(&fn_decl).count();
        if fn_count != 1 {
            messages.push(format!(
                "case {}: function {} appears {} times in module {} (expected 1)",
                case_entry.id, case_entry.function, fn_count, case_entry.module
            ));
        }
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
