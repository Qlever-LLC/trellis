export type JsIntegrationCase = {
  readonly id: string;
  readonly file: string;
};

/** Local JS integration cases implemented by this suite. */
export const jsIntegrationCases: readonly JsIntegrationCase[] = [
  {
    id: "rpc.client-calls-service",
    file: "rpc/rpc.integration_test.ts",
  },
  {
    id: "events.client-publishes-and-subscribes",
    file: "events/events.integration_test.ts",
  },
  {
    id: "events.denied-publish",
    file: "events/events.integration_test.ts",
  },
  {
    id: "operations.client-starts-and-watches-operation",
    file: "operations/operations.integration_test.ts",
  },
  {
    id: "feeds.client-consumes-service-feed",
    file: "feeds/feeds.integration_test.ts",
  },
  {
    id: "state.client-reads-and-updates-shared-state",
    file: "state/state.integration_test.ts",
  },
  {
    id: "transfer.client-uploads-and-downloads-file",
    file: "transfer/transfer.integration_test.ts",
  },
  {
    id: "resources.service-uses-bound-resources-for-client-call",
    file: "resources/resources.integration_test.ts",
  },
  {
    id: "jobs.service-runs-local-job-for-client-visible-workflow",
    file: "jobs/jobs.integration_test.ts",
  },
  {
    id: "health.client-observes-service-heartbeat",
    file: "health/health.integration_test.ts",
  },
  {
    id: "service-approval.service-startup-awaits-approval",
    file: "service-approval/service_approval.integration_test.ts",
  },
  {
    id: "app-identity-approval.client-obtains-approved-grant",
    file: "app-identity-approval/app_identity_approval.integration_test.ts",
  },
  {
    id: "device-activation.device-client-activates-and-connects",
    file: "device-activation/device_activation.integration_test.ts",
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
