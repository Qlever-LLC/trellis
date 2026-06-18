export type JsIntegrationCase = {
  readonly id: string;
  readonly file: string;
  readonly testName: string;
  readonly runtime: "live-trellis";
};

/** Local JS integration cases implemented by this suite. */
export const jsIntegrationCases: readonly JsIntegrationCase[] = [
  {
    id: "rpc.client-calls-service-success",
    file: "rpc/client_calls_service_success.integration_test.ts",
    testName:
      "rpc.client-calls-service-success reaches a service RPC through generated surfaces",
    runtime: "live-trellis",
  },
  {
    id: "rpc.service-receives-caller-context",
    file: "rpc/service_receives_caller_context.integration_test.ts",
    testName:
      "rpc.service-receives-caller-context observes caller metadata in the service handler",
    runtime: "live-trellis",
  },
  {
    id: "rpc.client-receives-declared-error",
    file: "rpc/client_receives_declared_error.integration_test.ts",
    testName: "rpc.client-receives-declared-error from a service RPC handler",
    runtime: "live-trellis",
  },
  {
    id: "rpc.denies-client-without-call-authority",
    file: "rpc/denies_client_without_call_authority.integration_test.ts",
    testName:
      "rpc.denies-client-without-call-authority rejects an unauthorized client RPC",
    runtime: "live-trellis",
  },
  {
    id: "events.client-publishes-and-subscriber-receives",
    file: "events/client_publishes_and_subscriber_receives.integration_test.ts",
    testName:
      "events.client-publishes-and-subscriber-receives publishes and captures a generated event",
    runtime: "live-trellis",
  },
  {
    id: "events.denies-publish-without-authority",
    file: "events/denies_publish_without_authority.integration_test.ts",
    testName:
      "events.denies-publish-without-authority rejects a subscribe-only client publish",
    runtime: "live-trellis",
  },
  {
    id: "events.denies-subscribe-without-authority",
    file: "events/denies_subscribe_without_authority.integration_test.ts",
    testName:
      "events.denies-subscribe-without-authority does not deliver events to a publish-only client",
    runtime: "live-trellis",
  },
  {
    id: "operations.client-starts-operation",
    file: "operations/client_starts_operation.integration_test.ts",
    testName:
      "operations.client-starts-operation starts an operation and receives an operation ref",
    runtime: "live-trellis",
  },
  {
    id: "operations.client-watches-progress",
    file: "operations/client_watches_progress.integration_test.ts",
    testName:
      "operations.client-watches-progress observes progress events on an operation stream",
    runtime: "live-trellis",
  },
  {
    id: "operations.client-waits-for-completion",
    file: "operations/client_waits_for_completion.integration_test.ts",
    testName:
      "operations.client-waits-for-completion observes completion on an operation watch",
    runtime: "live-trellis",
  },
  {
    id: "operations.denies-start-without-call-authority",
    file: "operations/denies_start_without_call_authority.integration_test.ts",
    testName:
      "operations.denies-start-without-call-authority rejects an unauthorized operation start",
    runtime: "live-trellis",
  },
  {
    id: "feeds.client-receives-first-frame",
    file: "feeds/client_receives_first_frame.integration_test.ts",
    testName:
      "feeds.client-receives-first-frame receives the first generated feed frame",
    runtime: "live-trellis",
  },
  {
    id: "feeds.client-receives-ordered-frames",
    file: "feeds/client_receives_ordered_frames.integration_test.ts",
    testName:
      "feeds.client-receives-ordered-frames receives two frames in sequence order",
    runtime: "live-trellis",
  },
  {
    id: "feeds.abort-stops-client-subscription",
    file: "feeds/abort_stops_client_subscription.integration_test.ts",
    testName:
      "feeds.abort-stops-client-subscription stops the feed stream on abort",
    runtime: "live-trellis",
  },
  {
    id: "feeds.denies-subscribe-without-authority",
    file: "feeds/denies_subscribe_without_authority.integration_test.ts",
    testName:
      "feeds.denies-subscribe-without-authority rejects an unauthorized feed subscribe",
    runtime: "live-trellis",
  },
  {
    id: "state.value-store-missing-read",
    file: "state/value_store_missing_read.integration_test.ts",
    testName:
      "state.value-store-missing-read returns found false for empty store",
    runtime: "live-trellis",
  },
  {
    id: "state.value-store-create-read-delete",
    file: "state/value_store_create_read_delete.integration_test.ts",
    testName:
      "state.value-store-create-read-delete creates, reads, and deletes a value state entry",
    runtime: "live-trellis",
  },
  {
    id: "state.value-store-stale-revision-rejected",
    file: "state/value_store_stale_revision_rejected.integration_test.ts",
    testName:
      "state.value-store-stale-revision-rejected rejects write with stale revision",
    runtime: "live-trellis",
  },
  {
    id: "state.map-store-prefix-put-get-list-delete",
    file: "state/map_store_prefix_put_get_list_delete.integration_test.ts",
    testName:
      "state.map-store-prefix-put-get-list-delete writes, reads, lists, and deletes prefixed map entries",
    runtime: "live-trellis",
  },
  {
    id: "state.map-store-list-limit",
    file: "state/map_store_list_limit.integration_test.ts",
    testName:
      "state.map-store-list-limit returns no more than the requested limit",
    runtime: "live-trellis",
  },
  {
    id: "transfer.client-uploads-file-via-operation",
    file: "transfer/client_uploads_file_via_operation.integration_test.ts",
    testName:
      "transfer.client-uploads-file-via-operation uploads bytes through a transfer operation",
    runtime: "live-trellis",
  },
  {
    id: "transfer.client-downloads-file-via-receive-grant",
    file:
      "transfer/client_downloads_file_via_receive_grant.integration_test.ts",
    testName:
      "transfer.client-downloads-file-via-receive-grant downloads bytes through a receive grant",
    runtime: "live-trellis",
  },
  {
    id: "transfer.download-grant-is-session-bound",
    file: "transfer/download_grant_is_session_bound.integration_test.ts",
    testName:
      "transfer.download-grant-is-session-bound rejects cross-session grant usage",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-receives-required-bindings",
    file: "resources/service_receives_required_bindings.integration_test.ts",
    testName:
      "resources.service-receives-required-bindings has required KV and store handles materialized",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-receives-optional-bindings",
    file: "resources/service_receives_optional_bindings.integration_test.ts",
    testName:
      "resources.service-receives-optional-bindings has optional KV and store handles when declared",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-store-create-read-list-delete",
    file: "resources/service_store_create_read_list_delete.integration_test.ts",
    testName:
      "resources.service-store-create-read-list-delete uses store resources during a client RPC",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-kv-create-put-get-delete",
    file: "resources/service_kv_create_put_get_delete.integration_test.ts",
    testName:
      "resources.service-kv-create-put-get-delete uses KV resources during a client RPC",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-kv-stale-revision-rejected",
    file: "resources/service_kv_stale_revision_rejected.integration_test.ts",
    testName:
      "resources.service-kv-stale-revision-rejected fails on stale revision KV operations",
    runtime: "live-trellis",
  },
  {
    id: "jobs.service-creates-local-job-from-client-rpc",
    file: "jobs/service_creates_local_job_from_client_rpc.integration_test.ts",
    testName:
      "jobs.service-creates-local-job-from-client-rpc creates a job with non-empty id",
    runtime: "live-trellis",
  },
  {
    id: "jobs.job-progress-and-log-are-published",
    file: "jobs/job_progress_and_log_are_published.integration_test.ts",
    testName:
      "jobs.job-progress-and-log-are-published publishes progress and log from job handler",
    runtime: "live-trellis",
  },
  {
    id: "jobs.job-wait-returns-typed-result",
    file: "jobs/job_wait_returns_typed_result.integration_test.ts",
    testName:
      "jobs.job-wait-returns-typed-result returns typed result on completion",
    runtime: "live-trellis",
  },
  {
    id: "jobs.job-context-propagates-request-and-trace",
    file: "jobs/job_context_propagates_request_and_trace.integration_test.ts",
    testName:
      "jobs.job-context-propagates-request-and-trace propagates requestId and traceId",
    runtime: "live-trellis",
  },
  {
    id: "health.client-subscribes-to-heartbeats",
    file: "health/client_subscribes_to_heartbeats.integration_test.ts",
    testName:
      "health.client-subscribes-to-heartbeats subscribes and receives a service heartbeat",
    runtime: "live-trellis",
  },
  {
    id: "health.heartbeat-includes-service-metadata",
    file: "health/heartbeat_includes_service_metadata.integration_test.ts",
    testName:
      "health.heartbeat-includes-service-metadata includes service metadata in heartbeat",
    runtime: "live-trellis",
  },
  {
    id: "health.heartbeat-includes-custom-checks",
    file: "health/heartbeat_includes_custom_checks.integration_test.ts",
    testName:
      "health.heartbeat-includes-custom-checks includes built-in and custom checks",
    runtime: "live-trellis",
  },
  {
    id: "health.heartbeat-event-context-is-populated",
    file: "health/heartbeat_event_context_is_populated.integration_test.ts",
    testName:
      "health.heartbeat-event-context-is-populated has populated event context",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.preapproved-contract-connects",
    file: "authority-plan/preapproved_contract_connects.integration_test.ts",
    testName:
      "authority-plan.preapproved-contract-connects connects pre-approved contract without pending plan",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.presented-update-is-pending-at-connect",
    file:
      "authority-plan/presented_update_is_pending_at_connect.integration_test.ts",
    testName:
      "authority-plan.presented-update-is-pending-at-connect creates pending update and blocks connect",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.presented-update-approved-then-connects",
    file:
      "authority-plan/presented_update_approved_then_connects.integration_test.ts",
    testName:
      "authority-plan.presented-update-approved-then-connects accepts update and unblocks service",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.presented-update-rejected-stays-blocked",
    file:
      "authority-plan/presented_update_rejected_stays_blocked.integration_test.ts",
    testName:
      "authority-plan.presented-update-rejected-stays-blocked rejects update and preserves old authority",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.incompatible-migration-approved-replaces-contract",
    file:
      "authority-plan/incompatible_migration_approved_replaces_contract.integration_test.ts",
    testName:
      "authority-plan.incompatible-migration-approved-replaces-contract accepts migration and enables replacement",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.incompatible-migration-rejected-keeps-old-contract",
    file:
      "authority-plan/incompatible_migration_rejected_keeps_old_contract.integration_test.ts",
    testName:
      "authority-plan.incompatible-migration-rejected-keeps-old-contract rejects migration and keeps old contract usable",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.compatible-replacement-auto-allowed-strict",
    file:
      "authority-plan/compatible_replacement_auto_allowed_strict.integration_test.ts",
    testName:
      "authority-plan.compatible-replacement-auto-allowed-strict connects compatible replacement without manual approval",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.mutable-dev-auto-accepts-incompatible-migration",
    file:
      "authority-plan/mutable_dev_auto_accepts_incompatible_migration.integration_test.ts",
    testName:
      "authority-plan.mutable-dev-auto-accepts-incompatible-migration auto-accepts migration in mutable dev",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.mutable-dev-rejected-explicit-update-still-blocks",
    file:
      "authority-plan/mutable_dev_rejected_explicit_update_still_blocks.integration_test.ts",
    testName:
      "authority-plan.mutable-dev-rejected-explicit-update-still-blocks keeps rejected update blocked in mutable dev",
    runtime: "live-trellis",
  },
  {
    id: "authority-plan.resource-change-migration-approved-and-bound",
    file:
      "authority-plan/resource_change_migration_approved_and_bound.integration_test.ts",
    testName:
      "authority-plan.resource-change-migration-approved-and-bound accepts resource migration and binds resource",
    runtime: "live-trellis",
  },
  {
    id: "service-approval.startup-blocks-before-authority-approval",
    file:
      "service-approval/startup_blocks_before_authority_approval.integration_test.ts",
    testName:
      "service-approval.startup-blocks-before-authority-approval blocks service startup before approval",
    runtime: "live-trellis",
  },
  {
    id: "service-approval.startup-completes-after-authority-approval",
    file:
      "service-approval/startup_completes_after_authority_approval.integration_test.ts",
    testName:
      "service-approval.startup-completes-after-authority-approval connects after authority approval",
    runtime: "live-trellis",
  },
  {
    id: "service-approval.approved-service-handles-client-rpc",
    file:
      "service-approval/approved_service_handles_client_rpc.integration_test.ts",
    testName:
      "service-approval.approved-service-handles-client-rpc handles a client RPC after approval",
    runtime: "live-trellis",
  },
  {
    id: "app-identity-approval.connect-requires-auth-flow",
    file:
      "app-identity-approval/connect_requires_auth_flow.integration_test.ts",
    testName:
      "app-identity-approval.connect-requires-auth-flow invokes auth-required callback",
    runtime: "live-trellis",
  },
  {
    id: "app-identity-approval.approved-client-connects",
    file: "app-identity-approval/approved_client_connects.integration_test.ts",
    testName:
      "app-identity-approval.approved-client-connects produces a connected public client",
    runtime: "live-trellis",
  },
  {
    id: "app-identity-approval.approved-client-calls-service",
    file:
      "app-identity-approval/approved_client_calls_service.integration_test.ts",
    testName:
      "app-identity-approval.approved-client-calls-service calls service RPC after approval",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.admin-provisions-known-device",
    file: "device-activation/admin_provisions_known_device.integration_test.ts",
    testName:
      "device-activation.admin-provisions-known-device creates deployment and provisions device",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.device-starts-activation-request",
    file:
      "device-activation/device_starts_activation_request.integration_test.ts",
    testName:
      "device-activation.device-starts-activation-request builds payload and receives flow URL",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.admin-resolves-activation-operation",
    file:
      "device-activation/admin_resolves_activation_operation.integration_test.ts",
    testName:
      "device-activation.admin-resolves-activation-operation completes resolve with activated status",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.device-receives-connect-info",
    file: "device-activation/device_receives_connect_info.integration_test.ts",
    testName:
      "device-activation.device-receives-connect-info waits for and receives connect info",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.activated-device-connects-and-authenticates",
    file:
      "device-activation/activated_device_connects_and_authenticates.integration_test.ts",
    testName:
      "device-activation.activated-device-connects-and-authenticates connects and authenticates as device",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.activated-device-authority-is-listed",
    file:
      "device-activation/activated_device_authority_is_listed.integration_test.ts",
    testName:
      "device-activation.activated-device-authority-is-listed appears in authority list",
    runtime: "live-trellis",
  },
  {
    id: "outbox.commits-event-through-sql-outbox",
    file: "outbox/commits_event_through_sql_outbox.integration_test.ts",
    testName:
      "outbox.commits-event-through-sql-outbox publishes event after SQL commit",
    runtime: "live-trellis",
  },
  {
    id: "outbox.rollback-does-not-publish",
    file: "outbox/rollback_does_not_publish.integration_test.ts",
    testName:
      "outbox.rollback-does-not-publish suppresses event on transaction rollback",
    runtime: "live-trellis",
  },
  {
    id: "outbox.multiple-events-in-one-transaction",
    file: "outbox/multiple_events_in_one_transaction.integration_test.ts",
    testName:
      "outbox.multiple-events-in-one-transaction publishes all after commit",
    runtime: "live-trellis",
  },
  {
    id: "outbox.listener-derives-event",
    file: "outbox/listener_derives_event.integration_test.ts",
    testName:
      "outbox.listener-derives-event through SQL outbox and publishes to NATS",
    runtime: "live-trellis",
  },
  {
    id: "outbox.sql-row-state-is-dispatched",
    file: "outbox/sql_row_state_is_dispatched.integration_test.ts",
    testName: "outbox.sql-row-state-is-dispatched after successful commit",
    runtime: "live-trellis",
  },
];

/** Returns local JS integration case IDs selected by fixture prefix. */
export function jsCasesForFixture(
  fixture: string,
): readonly JsIntegrationCase[] {
  const prefix = `${fixture}.`;
  return jsIntegrationCases.filter((caseEntry) =>
    caseEntry.id.startsWith(prefix)
  );
}

/** Returns the local JS integration case registered for a matrix case id. */
export function jsCaseById(id: string): JsIntegrationCase | undefined {
  return jsIntegrationCases.find((caseEntry) => caseEntry.id === id);
}
