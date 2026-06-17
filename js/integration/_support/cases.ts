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
    file: "rpc/rpc.integration_test.ts",
    testName:
      "rpc.client-calls-service-success reaches a service RPC through generated surfaces",
    runtime: "live-trellis",
  },
  {
    id: "rpc.service-receives-caller-context",
    file: "rpc/rpc.integration_test.ts",
    testName:
      "rpc.service-receives-caller-context observes caller metadata in the service handler",
    runtime: "live-trellis",
  },
  {
    id: "rpc.client-receives-declared-error",
    file: "rpc/rpc.integration_test.ts",
    testName: "rpc.client-receives-declared-error from a service RPC handler",
    runtime: "live-trellis",
  },
  {
    id: "rpc.denies-client-without-call-authority",
    file: "rpc/rpc.integration_test.ts",
    testName:
      "rpc.denies-client-without-call-authority rejects an unauthorized client RPC",
    runtime: "live-trellis",
  },
  {
    id: "events.client-publishes-and-subscriber-receives",
    file: "events/events.integration_test.ts",
    testName:
      "events.client-publishes-and-subscriber-receives publishes and captures a generated event",
    runtime: "live-trellis",
  },
  {
    id: "events.denies-publish-without-authority",
    file: "events/events.integration_test.ts",
    testName:
      "events.denies-publish-without-authority rejects a subscribe-only client publish",
    runtime: "live-trellis",
  },
  {
    id: "events.denies-subscribe-without-authority",
    file: "events/events.integration_test.ts",
    testName:
      "events.denies-subscribe-without-authority does not deliver events to a publish-only client",
    runtime: "live-trellis",
  },
  {
    id: "operations.client-starts-operation",
    file: "operations/operations.integration_test.ts",
    testName:
      "operations.client-starts-operation starts an operation and receives an operation ref",
    runtime: "live-trellis",
  },
  {
    id: "operations.client-watches-progress",
    file: "operations/operations.integration_test.ts",
    testName:
      "operations.client-watches-progress observes progress events on an operation stream",
    runtime: "live-trellis",
  },
  {
    id: "operations.client-waits-for-completion",
    file: "operations/operations.integration_test.ts",
    testName:
      "operations.client-waits-for-completion observes completion on an operation watch",
    runtime: "live-trellis",
  },
  {
    id: "operations.denies-start-without-call-authority",
    file: "operations/operations.integration_test.ts",
    testName:
      "operations.denies-start-without-call-authority rejects an unauthorized operation start",
    runtime: "live-trellis",
  },
  {
    id: "feeds.client-receives-first-frame",
    file: "feeds/feeds.integration_test.ts",
    testName:
      "feeds.client-receives-first-frame receives the first generated feed frame",
    runtime: "live-trellis",
  },
  {
    id: "feeds.client-receives-ordered-frames",
    file: "feeds/feeds.integration_test.ts",
    testName:
      "feeds.client-receives-ordered-frames receives two frames in sequence order",
    runtime: "live-trellis",
  },
  {
    id: "feeds.abort-stops-client-subscription",
    file: "feeds/feeds.integration_test.ts",
    testName:
      "feeds.abort-stops-client-subscription stops the feed stream on abort",
    runtime: "live-trellis",
  },
  {
    id: "feeds.denies-subscribe-without-authority",
    file: "feeds/feeds.integration_test.ts",
    testName:
      "feeds.denies-subscribe-without-authority rejects an unauthorized feed subscribe",
    runtime: "live-trellis",
  },
  {
    id: "state.value-store-missing-read",
    file: "state/state.integration_test.ts",
    testName:
      "state.value-store-missing-read returns found false for empty store",
    runtime: "live-trellis",
  },
  {
    id: "state.value-store-create-read-delete",
    file: "state/state.integration_test.ts",
    testName:
      "state.value-store-create-read-delete creates, reads, and deletes a value state entry",
    runtime: "live-trellis",
  },
  {
    id: "state.value-store-stale-revision-rejected",
    file: "state/state.integration_test.ts",
    testName:
      "state.value-store-stale-revision-rejected rejects write with stale revision",
    runtime: "live-trellis",
  },
  {
    id: "state.map-store-prefix-put-get-list-delete",
    file: "state/state.integration_test.ts",
    testName:
      "state.map-store-prefix-put-get-list-delete writes, reads, lists, and deletes prefixed map entries",
    runtime: "live-trellis",
  },
  {
    id: "state.map-store-list-limit",
    file: "state/state.integration_test.ts",
    testName:
      "state.map-store-list-limit returns no more than the requested limit",
    runtime: "live-trellis",
  },
  {
    id: "transfer.client-uploads-file-via-operation",
    file: "transfer/transfer.integration_test.ts",
    testName:
      "transfer.client-uploads-file-via-operation uploads bytes through a transfer operation",
    runtime: "live-trellis",
  },
  {
    id: "transfer.client-downloads-file-via-receive-grant",
    file: "transfer/transfer.integration_test.ts",
    testName:
      "transfer.client-downloads-file-via-receive-grant downloads bytes through a receive grant",
    runtime: "live-trellis",
  },
  {
    id: "transfer.download-grant-is-session-bound",
    file: "transfer/transfer.integration_test.ts",
    testName:
      "transfer.download-grant-is-session-bound rejects cross-session grant usage",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-receives-required-bindings",
    file: "resources/resources.integration_test.ts",
    testName:
      "resources.service-receives-required-bindings has required KV and store handles materialized",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-receives-optional-bindings",
    file: "resources/resources.integration_test.ts",
    testName:
      "resources.service-receives-optional-bindings has optional KV and store handles when declared",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-store-create-read-list-delete",
    file: "resources/resources.integration_test.ts",
    testName:
      "resources.service-store-create-read-list-delete uses store resources during a client RPC",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-kv-create-put-get-delete",
    file: "resources/resources.integration_test.ts",
    testName:
      "resources.service-kv-create-put-get-delete uses KV resources during a client RPC",
    runtime: "live-trellis",
  },
  {
    id: "resources.service-kv-stale-revision-rejected",
    file: "resources/resources.integration_test.ts",
    testName:
      "resources.service-kv-stale-revision-rejected fails on stale revision KV operations",
    runtime: "live-trellis",
  },
  {
    id: "jobs.service-creates-local-job-from-client-rpc",
    file: "jobs/jobs.integration_test.ts",
    testName:
      "jobs.service-creates-local-job-from-client-rpc creates a job with non-empty id",
    runtime: "live-trellis",
  },
  {
    id: "jobs.job-progress-and-log-are-published",
    file: "jobs/jobs.integration_test.ts",
    testName:
      "jobs.job-progress-and-log-are-published publishes progress and log from job handler",
    runtime: "live-trellis",
  },
  {
    id: "jobs.job-wait-returns-typed-result",
    file: "jobs/jobs.integration_test.ts",
    testName:
      "jobs.job-wait-returns-typed-result returns typed result on completion",
    runtime: "live-trellis",
  },
  {
    id: "jobs.job-context-propagates-request-and-trace",
    file: "jobs/jobs.integration_test.ts",
    testName:
      "jobs.job-context-propagates-request-and-trace propagates requestId and traceId",
    runtime: "live-trellis",
  },
  {
    id: "health.client-subscribes-to-heartbeats",
    file: "health/health.integration_test.ts",
    testName:
      "health.client-subscribes-to-heartbeats subscribes and receives a service heartbeat",
    runtime: "live-trellis",
  },
  {
    id: "health.heartbeat-includes-service-metadata",
    file: "health/health.integration_test.ts",
    testName:
      "health.heartbeat-includes-service-metadata includes service metadata in heartbeat",
    runtime: "live-trellis",
  },
  {
    id: "health.heartbeat-includes-custom-checks",
    file: "health/health.integration_test.ts",
    testName:
      "health.heartbeat-includes-custom-checks includes built-in and custom checks",
    runtime: "live-trellis",
  },
  {
    id: "health.heartbeat-event-context-is-populated",
    file: "health/health.integration_test.ts",
    testName:
      "health.heartbeat-event-context-is-populated has populated event context",
    runtime: "live-trellis",
  },
  {
    id: "service-approval.startup-blocks-before-authority-approval",
    file: "service-approval/service_approval.integration_test.ts",
    testName:
      "service-approval.startup-blocks-before-authority-approval blocks service startup before approval",
    runtime: "live-trellis",
  },
  {
    id: "service-approval.startup-completes-after-authority-approval",
    file: "service-approval/service_approval.integration_test.ts",
    testName:
      "service-approval.startup-completes-after-authority-approval connects after authority approval",
    runtime: "live-trellis",
  },
  {
    id: "service-approval.approved-service-handles-client-rpc",
    file: "service-approval/service_approval.integration_test.ts",
    testName:
      "service-approval.approved-service-handles-client-rpc handles a client RPC after approval",
    runtime: "live-trellis",
  },
  {
    id: "app-identity-approval.connect-requires-auth-flow",
    file: "app-identity-approval/app_identity_approval.integration_test.ts",
    testName:
      "app-identity-approval.connect-requires-auth-flow invokes auth-required callback",
    runtime: "live-trellis",
  },
  {
    id: "app-identity-approval.approved-client-connects",
    file: "app-identity-approval/app_identity_approval.integration_test.ts",
    testName:
      "app-identity-approval.approved-client-connects produces a connected public client",
    runtime: "live-trellis",
  },
  {
    id: "app-identity-approval.approved-client-calls-service",
    file: "app-identity-approval/app_identity_approval.integration_test.ts",
    testName:
      "app-identity-approval.approved-client-calls-service calls service RPC after approval",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.admin-provisions-known-device",
    file: "device-activation/device_activation.integration_test.ts",
    testName:
      "device-activation.admin-provisions-known-device creates deployment and provisions device",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.device-starts-activation-request",
    file: "device-activation/device_activation.integration_test.ts",
    testName:
      "device-activation.device-starts-activation-request builds payload and receives flow URL",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.admin-resolves-activation-operation",
    file: "device-activation/device_activation.integration_test.ts",
    testName:
      "device-activation.admin-resolves-activation-operation completes resolve with activated status",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.device-receives-connect-info",
    file: "device-activation/device_activation.integration_test.ts",
    testName:
      "device-activation.device-receives-connect-info waits for and receives connect info",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.activated-device-connects-and-authenticates",
    file: "device-activation/device_activation.integration_test.ts",
    testName:
      "device-activation.activated-device-connects-and-authenticates connects and authenticates as device",
    runtime: "live-trellis",
  },
  {
    id: "device-activation.activated-device-authority-is-listed",
    file: "device-activation/device_activation.integration_test.ts",
    testName:
      "device-activation.activated-device-authority-is-listed appears in authority list",
    runtime: "live-trellis",
  },
  {
    id: "outbox.commits-event-through-sql-outbox",
    file: "outbox/outbox.integration_test.ts",
    testName:
      "outbox.commits-event-through-sql-outbox publishes event after SQL commit",
    runtime: "live-trellis",
  },
  {
    id: "outbox.rollback-does-not-publish",
    file: "outbox/outbox.integration_test.ts",
    testName:
      "outbox.rollback-does-not-publish suppresses event on transaction rollback",
    runtime: "live-trellis",
  },
  {
    id: "outbox.multiple-events-in-one-transaction",
    file: "outbox/outbox.integration_test.ts",
    testName:
      "outbox.multiple-events-in-one-transaction publishes all after commit",
    runtime: "live-trellis",
  },
  {
    id: "outbox.listener-derives-event",
    file: "outbox/outbox.integration_test.ts",
    testName:
      "outbox.listener-derives-event through SQL outbox and publishes to NATS",
    runtime: "live-trellis",
  },
  {
    id: "outbox.sql-row-state-is-dispatched",
    file: "outbox/outbox.integration_test.ts",
    testName:
      "outbox.sql-row-state-is-dispatched after successful commit",
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
