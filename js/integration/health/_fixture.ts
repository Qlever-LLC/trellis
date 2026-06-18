import {
  defineAppContract,
  defineServiceContract,
  type EventListenerContext,
  Result,
} from "@qlever-llc/trellis";
import {
  type HealthHeartbeatEvent,
  sdk as health,
} from "@qlever-llc/trellis/sdk/health";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  integrationSlug,
} from "../_support/names.ts";

export type ObservedHeartbeat = {
  readonly event: HealthHeartbeatEvent;
  readonly context: EventListenerContext;
};

export type HeartbeatCheck = HealthHeartbeatEvent["checks"][number];

export function createHealthFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const serviceContract = defineServiceContract({}, () => ({
    id: caseScopedContractId("trellis.integration.health-service", caseId),
    displayName: `Trellis Integration Health Service (${slug})`,
    description:
      "Service participant that emits baseline Trellis health events.",
  }));

  const observerContract = defineAppContract(() => ({
    id: caseScopedContractId("trellis.integration.health-observer", caseId),
    displayName: `Trellis Integration Health Observer (${slug})`,
    description: "App/client participant that observes service heartbeats.",
    uses: {
      required: {
        health: health.use({
          events: { subscribe: ["Health.Heartbeat"] },
        }),
      },
    },
  }));

  const serviceName = caseScopedName("health-fixture-service", caseId);
  const version = `0.0.0-health-${slug}`;
  const info = { fixture: "health", caseId };

  async function setupObserver(runtime: LiveTrellisRuntime) {
    const observed: ObservedHeartbeat[] = [];
    const listenerController = new AbortController();
    const client = await runtime.connectClient({
      name: caseScopedName("health-fixture-observer", caseId),
      contract: observerContract,
    });

    await client.event.health.heartbeat.listen(
      (event: HealthHeartbeatEvent, context: EventListenerContext) => {
        observed.push({ event, context });
        return Result.ok(undefined);
      },
      {},
      { mode: "ephemeral", signal: listenerController.signal },
    ).orThrow();

    return { observed, listenerController, client };
  }

  async function setupService(runtime: LiveTrellisRuntime) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { health: { publishIntervalMs: 50 } },
    }).orThrow();

    service.health.setInfo({ version, info });
    service.health.add("fixture", () => ({
      status: "ok",
      summary: "fixture ready",
      info: { source: "health-integration", caseId },
    }));

    return service;
  }

  return {
    slug,
    serviceContract,
    observerContract,
    serviceName,
    version,
    info,
    fixtureCheckInfo: { source: "health-integration", caseId },
    setupObserver,
    setupService,
  };
}
