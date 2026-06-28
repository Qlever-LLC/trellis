use std::collections::BTreeSet;

use super::matrix::{
    load_client_test_matrix, load_service_test_matrix, matrix_case_ids, repo_root,
    ClientTestMatrix, CompletionStatus, ServiceTestMatrix,
};

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
        "rpc.invalid-annotated-input-schema-validation",
        "rpc",
        "rpc_invalid_annotated_input_schema_validation",
    ),
    IntegrationCase::live(
        "rpc.invalid-mixed-input-validation",
        "rpc",
        "rpc_invalid_mixed_input_validation",
    ),
    IntegrationCase::live(
        "rpc.auth-validation-retries-transient-session-not-found",
        "rpc",
        "rpc_auth_validation_retries_transient_session_not_found",
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
        "operations.watch-callbacks-deliver-accepted-first-in-order",
        "operations",
        "operations_watch_callbacks_deliver_accepted_first_in_order",
    ),
    IntegrationCase::live(
        "operations.client-cancels-operation",
        "operations",
        "operations_client_cancels_operation",
    ),
    IntegrationCase::live(
        "operations.cancel-uses-cancel-capability",
        "operations",
        "operations_cancel_uses_cancel_capability",
    ),
    IntegrationCase::live(
        "operations.rejects-cancel-for-noncancelable-operation",
        "operations",
        "operations_rejects_cancel_for_noncancelable_operation",
    ),
    IntegrationCase::live(
        "operations.client-signals-running-operation",
        "operations",
        "operations_client_signals_running_operation",
    ),
    IntegrationCase::live(
        "operations.signals-persist-and-consume-in-acceptance-order",
        "operations",
        "operations_signals_persist_and_consume_in_acceptance_order",
    ),
    IntegrationCase::live(
        "operations.queued-signal-delivered-before-live-signal",
        "operations",
        "operations_queued_signal_delivered_before_live_signal",
    ),
    IntegrationCase::live(
        "operations.rejects-invalid-signal-payload",
        "operations",
        "operations_rejects_invalid_signal_payload",
    ),
    IntegrationCase::live(
        "operations.rejects-signal-after-terminal-state",
        "operations",
        "operations_rejects_signal_after_terminal_state",
    ),
    IntegrationCase::live(
        "operations.service-attach-job-waits-for-completion",
        "operations",
        "operations_service_attach_job_waits_for_completion",
    ),
    IntegrationCase::live(
        "operations.service-handler-receives-client-context",
        "operations",
        "operations_service_handler_receives_client_context",
    ),
    IntegrationCase::live(
        "operations.service-defer-keeps-operation-running",
        "operations",
        "operations_service_defer_keeps_operation_running",
    ),
    IntegrationCase::live(
        "operations.service-control-resumes-deferred-operation",
        "operations",
        "operations_service_control_resumes_deferred_operation",
    ),
    IntegrationCase::live(
        "operations.service-control-loads-durable-record-after-restart",
        "operations",
        "operations_service_control_loads_durable_record_after_restart",
    ),
    IntegrationCase::live(
        "operations.service-accept-resume-completes-durable-operation",
        "operations",
        "operations_service_accept_resume_completes_durable_operation",
    ),
    IntegrationCase::live(
        "operations.service-control-rejects-invalid-mismatch-payload-terminal",
        "operations",
        "operations_service_control_rejects_invalid_mismatch_payload_terminal",
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
        "state.admin-inspect-and-delete-state",
        "state",
        "state_admin_inspect_and_delete_state",
    ),
    IntegrationCase::live(
        "transfer.client-uploads-file-via-operation",
        "transfer",
        "transfer_client_uploads_file_via_operation",
    ),
    IntegrationCase::live(
        "transfer.upload-rejects-over-max-bytes",
        "transfer",
        "transfer_upload_rejects_over_max_bytes",
    ),
    IntegrationCase::live(
        "transfer.upload-stores-object-before-completion",
        "transfer",
        "transfer_upload_stores_object_before_completion",
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
        "jobs.keyed-jobs-serialize-same-key",
        "jobs",
        "jobs_keyed_jobs_serialize_same_key",
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
        "authority-plan.preapproved-contract-connects",
        "authority_plan",
        "authority_plan_preapproved_contract_connects",
    ),
    IntegrationCase::live(
        "authority-plan.presented-update-is-pending-at-connect",
        "authority_plan",
        "authority_plan_presented_update_is_pending_at_connect",
    ),
    IntegrationCase::live(
        "authority-plan.presented-update-approved-then-connects",
        "authority_plan",
        "authority_plan_presented_update_approved_then_connects",
    ),
    IntegrationCase::live(
        "authority-plan.presented-update-rejected-stays-blocked",
        "authority_plan",
        "authority_plan_presented_update_rejected_stays_blocked",
    ),
    IntegrationCase::live(
        "authority-plan.incompatible-migration-approved-replaces-contract",
        "authority_plan",
        "authority_plan_incompatible_migration_approved_replaces_contract",
    ),
    IntegrationCase::live(
        "authority-plan.incompatible-migration-rejected-keeps-old-contract",
        "authority_plan",
        "authority_plan_incompatible_migration_rejected_keeps_old_contract",
    ),
    IntegrationCase::live(
        "authority-plan.compatible-replacement-auto-allowed-strict",
        "authority_plan",
        "authority_plan_compatible_replacement_auto_allowed_strict",
    ),
    IntegrationCase::live(
        "authority-plan.mutable-dev-auto-accepts-incompatible-migration",
        "authority_plan",
        "authority_plan_mutable_dev_auto_accepts_incompatible_migration",
    ),
    IntegrationCase::live(
        "authority-plan.mutable-dev-rejected-explicit-update-still-blocks",
        "authority_plan",
        "authority_plan_mutable_dev_rejected_explicit_update_still_blocks",
    ),
    IntegrationCase::live(
        "authority-plan.resource-change-migration-approved-and-bound",
        "authority_plan",
        "authority_plan_resource_change_migration_approved_and_bound",
    ),
    IntegrationCase::live(
        "outbox.commits-event-through-sql-outbox",
        "outbox",
        "outbox_commits_event_through_sql_outbox",
    ),
    IntegrationCase::live(
        "outbox.rollback-does-not-publish",
        "outbox",
        "outbox_rollback_does_not_publish",
    ),
    IntegrationCase::live(
        "outbox.multiple-events-in-one-transaction",
        "outbox",
        "outbox_multiple_events_in_one_transaction",
    ),
    IntegrationCase::live(
        "outbox.listener-derives-event",
        "outbox",
        "outbox_listener_derives_event",
    ),
    IntegrationCase::live(
        "outbox.sql-row-state-is-dispatched",
        "outbox",
        "outbox_sql_row_state_is_dispatched",
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
        "auth.local-login-binds-approved-client",
        "app_identity_approval",
        "auth_local_login_binds_approved_client",
    ),
    IntegrationCase::live(
        "auth.local-login-rebinds-existing-session-with-updated-authority",
        "app_identity_approval",
        "auth_local_login_rebinds_existing_session_with_updated_authority",
    ),
    IntegrationCase::live(
        "auth.local-login-replaces-session-when-identity-changes",
        "app_identity_approval",
        "auth_local_login_replaces_session_when_identity_changes",
    ),
    IntegrationCase::live(
        "auth.session-revoke-denies-reconnect",
        "app_identity_approval",
        "auth_session_revoke_denies_reconnect",
    ),
    IntegrationCase::live(
        "auth.session-revoke-cleans-runtime-connection-presence",
        "app_identity_approval",
        "auth_session_revoke_cleans_runtime_connection_presence",
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
        "device-activation.review-reject-denies-connect",
        "device_activation",
        "device_activation_review_reject_denies_connect",
    ),
    IntegrationCase::live(
        "device-activation.revoked-device-cannot-reconnect",
        "device_activation",
        "device_activation_revoked_device_cannot_reconnect",
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

pub(crate) const RUST_SERVICE_INTEGRATION_CASES: &[IntegrationCase] = &[
    IntegrationCase::live(
        "control-plane.admin-bootstrap-creates-first-local-admin",
        "control_plane",
        "control_plane_admin_bootstrap_creates_first_local_admin",
    ),
    IntegrationCase::live(
        "control-plane.password-reset-change-invalidates-old-password",
        "control_plane",
        "control_plane_password_reset_change_invalidates_old_password",
    ),
    IntegrationCase::live(
        "control-plane.http-route-security-requires-admin-session",
        "control_plane",
        "control_plane_http_route_security_requires_admin_session",
    ),
    IntegrationCase::live(
        "control-plane.bootstrap-requires-auth-for-unbound-client",
        "control_plane",
        "control_plane_bootstrap_requires_auth_for_unbound_client",
    ),
    IntegrationCase::live(
        "control-plane.bootstrap-rejects-unknown-contract-digest",
        "control_plane",
        "control_plane_bootstrap_rejects_unknown_contract_digest",
    ),
    IntegrationCase::live(
        "control-plane.bootstrap-rejects-non-client-contract",
        "control_plane",
        "control_plane_bootstrap_rejects_non_client_contract",
    ),
    IntegrationCase::live(
        "control-plane.session-logout-deletes-session-and-denies-reuse",
        "control_plane",
        "control_plane_session_logout_deletes_session_and_denies_reuse",
    ),
    IntegrationCase::live(
        "control-plane.session-logout-kicks-runtime-access",
        "control_plane",
        "control_plane_session_logout_kicks_runtime_access",
    ),
    IntegrationCase::live(
        "control-plane.session-logout-validates-return-to",
        "control_plane",
        "control_plane_session_logout_validates_return_to",
    ),
    IntegrationCase::live(
        "control-plane.session-logout-uses-provider-logout-redirect",
        "control_plane",
        "control_plane_session_logout_uses_provider_logout_redirect",
    ),
    IntegrationCase::live(
        "control-plane.catalog-active-contracts-survive-restart",
        "control_plane",
        "control_plane_catalog_active_contracts_survive_restart",
    ),
    IntegrationCase::live(
        "control-plane.catalog-dependency-issue-resolved-by-provider",
        "control_plane",
        "control_plane_catalog_dependency_issue_resolved_by_provider",
    ),
    IntegrationCase::live(
        "control-plane.catalog-force-replace-resolves-catalog-issue",
        "control_plane",
        "control_plane_catalog_force_replace_resolves_catalog_issue",
    ),
    IntegrationCase::live(
        "control-plane.catalog-surface-status-reports-provider-runtime",
        "control_plane",
        "control_plane_catalog_surface_status_reports_provider_runtime",
    ),
    IntegrationCase::live(
        "control-plane.admin-service-deployment-rollback-fault",
        "control_plane",
        "control_plane_admin_service_deployment_rollback_fault",
    ),
    IntegrationCase::live(
        "control-plane.admin-device-deployment-rollback-fault",
        "control_plane",
        "control_plane_admin_device_deployment_rollback_fault",
    ),
    IntegrationCase::live(
        "control-plane.admin-service-deployment-validate-before-persist-kick",
        "control_plane",
        "control_plane_admin_service_deployment_validate_before_persist_kick",
    ),
    IntegrationCase::live(
        "control-plane.admin-service-deployment-disable-refresh-rollback",
        "control_plane",
        "control_plane_admin_service_deployment_disable_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-service-deployment-enable-refresh-rollback",
        "control_plane",
        "control_plane_admin_service_deployment_enable_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-service-instance-disable-refresh-rollback",
        "control_plane",
        "control_plane_admin_service_instance_disable_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-service-instance-enable-refresh-rollback",
        "control_plane",
        "control_plane_admin_service_instance_enable_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-service-instance-remove-refresh-rollback",
        "control_plane",
        "control_plane_admin_service_instance_remove_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-device-deployment-disable-refresh-rollback",
        "control_plane",
        "control_plane_admin_device_deployment_disable_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-device-deployment-enable-refresh-rollback",
        "control_plane",
        "control_plane_admin_device_deployment_enable_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-device-instance-disable-refresh-rollback",
        "control_plane",
        "control_plane_admin_device_instance_disable_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-device-instance-enable-refresh-rollback",
        "control_plane",
        "control_plane_admin_device_instance_enable_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-device-instance-remove-refresh-rollback",
        "control_plane",
        "control_plane_admin_device_instance_remove_refresh_rollback",
    ),
    IntegrationCase::live(
        "control-plane.admin-service-deployment-lifecycle",
        "control_plane",
        "control_plane_admin_service_deployment_lifecycle",
    ),
    IntegrationCase::live(
        "control-plane.sessions-survive-control-plane-restart",
        "control_plane",
        "control_plane_sessions_survive_control_plane_restart",
    ),
    IntegrationCase::live(
        "control-plane.state-persists-across-control-plane-restart",
        "control_plane",
        "control_plane_state_persists_across_control_plane_restart",
    ),
    IntegrationCase::live(
        "control-plane.resources-survive-control-plane-restart",
        "control_plane",
        "control_plane_resources_survive_control_plane_restart",
    ),
    IntegrationCase::live(
        "control-plane.outbox-dispatches-after-control-plane-restart",
        "control_plane",
        "control_plane_outbox_dispatches_after_control_plane_restart",
    ),
    IntegrationCase::live(
        "control-plane.jobs-admin-lists-and-cancels-job",
        "control_plane_jobs_admin",
        "control_plane_jobs_admin_lists_and_cancels_job",
    ),
    IntegrationCase::live(
        "event-consumers.durable-listen-without-declared-group-returns-err",
        "event_consumers",
        "event_consumers_durable_listen_without_declared_group_returns_err",
    ),
    IntegrationCase::live(
        "event-consumers.ambiguous-group-without-opts-group-returns-err-and-specifying-group-works",
        "event_consumers",
        "event_consumers_ambiguous_group_without_opts_group_returns_err_and_specifying_group_works",
    ),
    IntegrationCase::live(
        "event-consumers.caller-provided-durable-name-returns-err",
        "event_consumers",
        "event_consumers_caller_provided_durable_name_returns_err",
    ),
    IntegrationCase::live(
        "event-consumers.bound-dependency-consumer-uses-trellis-provisioned-consumer-only",
        "event_consumers",
        "event_consumers_bound_dependency_consumer_uses_trellis_provisioned_consumer_only",
    ),
    IntegrationCase::live(
        "event-consumers.ephemeral-listener-avoids-durable-metadata-and-jetstream-consumer",
        "event_consumers",
        "event_consumers_ephemeral_listener_avoids_durable_metadata_and_jetstream_consumer",
    ),
    IntegrationCase::live(
        "event-consumers.duplicate-handlers-share-single-group-waiter",
        "event_consumers",
        "event_consumers_duplicate_handlers_share_single_group_waiter",
    ),
    IntegrationCase::live(
        "event-consumers.self-owned-durable-consumer-receives-self-published-event",
        "event_consumers",
        "event_consumers_self_owned_durable_consumer_receives_self_published_event",
    ),
    IntegrationCase::live(
        "event-consumers.grouped-consumer-waits-for-all-handlers-before-consuming-queued-event",
        "event_consumers",
        "event_consumers_grouped_consumer_waits_for_all_handlers_before_consuming_queued_event",
    ),
    IntegrationCase::live(
        "event-consumers.self-owned-grouped-consumer-waits-for-all-handlers-before-consuming-queued-event",
        "event_consumers",
        "event_consumers_self_owned_grouped_consumer_waits_for_all_handlers_before_consuming_queued_event",
    ),
    IntegrationCase::live(
        "event-consumers.abort-re-register-restarts-delivery",
        "event_consumers",
        "event_consumers_abort_re_register_restarts_delivery",
    ),
    IntegrationCase::live(
        "event-consumers.stop-teardown-stops-durable-delivery",
        "event_consumers",
        "event_consumers_stop_teardown_stops_durable_delivery",
    ),
    IntegrationCase::live(
        "event-consumers.transient-missing-consumer-retries-after-reconcile",
        "event_consumers",
        "event_consumers_transient_missing_consumer_retries_after_reconcile",
    ),
    IntegrationCase::live(
        "event-consumers.readiness-lost-does-not-nak-delivered-group-message",
        "event_consumers",
        "event_consumers_readiness_lost_does_not_nak_delivered_group_message",
    ),
    IntegrationCase::live(
        "prepared-events.prepared-publish-preserves-custom-headers-and-annotates-handler-error",
        "prepared_events",
        "prepared_events_prepared_publish_preserves_custom_headers_and_annotates_handler_error",
    ),
];

pub(crate) fn rust_case_by_id(id: &str) -> Option<&'static IntegrationCase> {
    RUST_INTEGRATION_CASES
        .iter()
        .find(|case_entry| case_entry.id == id)
}

pub(crate) fn rust_service_case_by_id(id: &str) -> Option<&'static IntegrationCase> {
    RUST_SERVICE_INTEGRATION_CASES
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

pub(crate) fn assert_rust_service_manifest_conforms_to_matrix() {
    let matrix = load_service_test_matrix().expect("load shared service integration matrix");

    let report = build_service_conformance_report(&matrix, RUST_SERVICE_INTEGRATION_CASES)
        .expect("build Rust service integration conformance report");
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
        if !has_tokio_test_async_fn(&content, case_entry.function) {
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

fn build_service_conformance_report(
    matrix: &ServiceTestMatrix,
    local_cases: &[IntegrationCase],
) -> Result<String, String> {
    let mut implemented_matrix_ids = matrix
        .cases
        .iter()
        .filter(|case_entry| case_entry.completion.rust == CompletionStatus::Implemented)
        .map(|case_entry| case_entry.id.clone())
        .collect::<Vec<_>>();
    implemented_matrix_ids.sort();
    let mut local_ids = local_cases
        .iter()
        .map(|case_entry| case_entry.id.to_string())
        .collect::<Vec<_>>();
    local_ids.sort();

    let missing = implemented_matrix_ids
        .iter()
        .filter(|id| !local_ids.contains(id))
        .cloned()
        .collect::<Vec<_>>();
    let extra = local_ids
        .iter()
        .filter(|id| !implemented_matrix_ids.contains(id))
        .cloned()
        .collect::<Vec<_>>();
    let local_duplicates = duplicates(local_ids.iter().map(String::as_str));
    let fixture_prefix_mismatches = service_fixture_prefix_errors(matrix, local_cases);
    let implementation_mismatches = service_implementation_mismatches(matrix, local_cases);
    let missing_modules = missing_module_files(local_cases)?;
    let mut messages = Vec::new();

    if !missing.is_empty() {
        messages.push(format!(
            "missing Rust service integration cases marked implemented: {}",
            missing.join(", ")
        ));
    }
    if !extra.is_empty() {
        messages.push(format!(
            "extra Rust service integration cases not marked implemented in matrix: {}",
            extra.join(", ")
        ));
    }
    if !local_duplicates.is_empty() {
        messages.push(format!(
            "duplicate Rust service integration case ids: {}",
            local_duplicates.join(", ")
        ));
    }
    if !fixture_prefix_mismatches.is_empty() {
        messages.push(format!(
            "Rust service integration case ids with wrong fixture prefix: {}",
            fixture_prefix_mismatches.join(", ")
        ));
    }
    if !implementation_mismatches.is_empty() {
        messages.push(format!(
            "Rust service integration cases with mismatched matrix implementation: {}",
            implementation_mismatches.join(", ")
        ));
    }
    if !missing_modules.is_empty() {
        messages.push(format!(
            "Rust service integration case modules without test files: {}",
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
        if !has_tokio_test_async_fn(&content, case_entry.function) {
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

fn has_tokio_test_async_fn(content: &str, function: &str) -> bool {
    let lines = content.lines().collect::<Vec<_>>();
    let fn_pattern = format!("async fn {function}(");

    for (line_index, line) in lines.iter().enumerate() {
        if !line.contains(&fn_pattern) {
            continue;
        }

        let mut attr_index = line_index;
        while attr_index > 0 {
            attr_index -= 1;
            let previous = lines[attr_index].trim();
            if previous.is_empty() {
                continue;
            }
            if !previous.starts_with("#[") {
                break;
            }
            if previous.starts_with("#[tokio::test") {
                return true;
            }
        }
    }

    false
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

fn service_fixture_prefix_errors(
    matrix: &ServiceTestMatrix,
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

fn service_implementation_mismatches(
    matrix: &ServiceTestMatrix,
    local_cases: &[IntegrationCase],
) -> Vec<String> {
    let mut errors = Vec::new();
    for case_entry in local_cases {
        let Some(matrix_case) = matrix.case_by_id(case_entry.id) else {
            continue;
        };
        let Some(rust) = &matrix_case.implementations.rust else {
            errors.push(format!("{} missing implementations.rust", case_entry.id));
            continue;
        };
        if rust.module != case_entry.module || rust.function != case_entry.function {
            errors.push(format!(
                "{} expected {}::{}, registry has {}::{}",
                case_entry.id, rust.module, rust.function, case_entry.module, case_entry.function
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
