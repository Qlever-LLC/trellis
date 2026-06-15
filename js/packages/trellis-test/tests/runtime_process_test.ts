import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis/health";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { TrellisTestRuntime } from "../index.ts";
import { Type } from "typebox";

const RUN_RUNTIME_PROCESS_TEST =
  Deno.env.get("TRELLIS_TEST_RUNTIME_PROCESS") ===
    "1";
const SERVICE_NAME = "runtime-process";
const trellisMainPath = fromFileUrl(
  new URL("../../../services/trellis/main.ts", import.meta.url),
);

Deno.test("TrellisTestRuntime.start requires explicit trellis command", async () => {
  await assertRejects(
    // @ts-expect-error Runtime validation must reject invalid JavaScript callers.
    () => TrellisTestRuntime.start({}),
    Error,
    "TrellisTestRuntime.start requires trellis.command",
  );
});

const runtimeProcessContract = defineServiceContract(
  {
    schemas: {
      HealthRequest: HealthRpcSchema,
      HealthResponse: HealthResponseSchema,
    },
  },
  (ref) => ({
    id: "trellis.test.runtime-process@v1",
    displayName: "Trellis Test Runtime Process Service",
    description: "Verifies public service bootstrap against a spawned runtime.",
    rpc: {
      "RuntimeProcess.Health": {
        version: "v1",
        input: ref.schema("HealthRequest"),
        output: ref.schema("HealthResponse"),
        errors: [],
      },
    },
  }),
);

const entitySchemas = {
  Empty: Type.Object({}),
  EntityGetInput: Type.Object({ id: Type.String() }),
  EntityGetOutput: Type.Object({ id: Type.String(), found: Type.Boolean() }),
  EntityChanged: Type.Object({ id: Type.String(), value: Type.String() }),
} as const;

const entityContract = defineServiceContract(
  { schemas: entitySchemas },
  (ref) => ({
    id: "trellis.test.entity-live@v1",
    displayName: "Trellis Test Entity Live Service",
    description: "Service-repo style entity contract for live runtime tests.",
    capabilities: {
      read: {
        displayName: "Read entities",
        description: "Read entity records in live integration tests.",
      },
      publishRecords: {
        displayName: "Publish entity records",
        description: "Publish entity change records in live integration tests.",
      },
    },
    rpc: {
      "Entity.Get": {
        version: "v1",
        input: ref.schema("EntityGetInput"),
        output: ref.schema("EntityGetOutput"),
        capabilities: { call: ["read"] },
        errors: [],
      },
    },
    events: {
      "Entity.Changed": {
        version: "v1",
        event: ref.schema("EntityChanged"),
        capabilities: { publish: ["publishRecords"], subscribe: ["read"] },
      },
    },
  }),
);

const entityClientContract = defineAppContract(() => ({
  id: "trellis.test.entity-live-client@v1",
  displayName: "Trellis Test Entity Live Client",
  description: "App/client participant for live runtime tests.",
  uses: {
    required: {
      entity: entityContract.use({
        rpc: { call: ["Entity.Get"] },
        events: { publish: ["Entity.Changed"] },
      }),
    },
  },
}));

const entitySubscriberContract = defineServiceContract(
  { schemas: entitySchemas },
  () => ({
    id: "trellis.test.entity-live-subscriber@v1",
    displayName: "Trellis Test Entity Live Subscriber",
    description: "Dependent durable event consumer for live runtime tests.",
    uses: {
      required: {
        entity: entityContract.use({
          events: { subscribe: ["Entity.Changed"] },
        }),
      },
    },
    eventConsumers: {
      ingest: {
        uses: { entity: ["Entity.Changed"] },
        ackWaitMs: 1_000,
        maxDeliver: 2,
      },
    },
  }),
);

const migrationContractV1 = defineServiceContract(
  { schemas: entitySchemas },
  (ref) => ({
    id: "trellis.test.mutable-resource@v1",
    displayName: "Trellis Test Mutable Resource",
    description: "Exercises explicit migration-plan approval in tests.",
    resources: {
      kv: {
        cache: {
          purpose: "Store cached entity values.",
          schema: ref.schema("EntityChanged"),
          history: 1,
        },
      },
    },
  }),
);

const migrationContractV2 = defineServiceContract(
  { schemas: entitySchemas },
  (ref) => ({
    id: "trellis.test.mutable-resource@v1",
    displayName: "Trellis Test Mutable Resource",
    description: "Exercises explicit migration-plan approval in tests.",
    resources: {
      kv: {
        cache: {
          purpose: "Store cached entity values.",
          schema: ref.schema("EntityChanged"),
          history: 2,
        },
      },
    },
  }),
);

Deno.test({
  name:
    "TrellisTestRuntime starts a local Trellis process and connects a service",
  ignore: !RUN_RUNTIME_PROCESS_TEST,
  fn: async () => {
    const runtime = await TrellisTestRuntime.start({
      trellis: {
        command: {
          cmd: Deno.execPath(),
          args: ["run", "-A", trellisMainPath],
        },
      },
      timeouts: {
        startupMs: 60_000,
        reconciliationMs: 15_000,
        shutdownMs: 10_000,
      },
    });

    try {
      assertStringIncludes(runtime.trellisUrl, "http://127.0.0.1:");
      assertStringIncludes(runtime.natsUrl, "127.0.0.1:");

      const serviceKey = await runtime.registerService({
        name: SERVICE_NAME,
        contract: runtimeProcessContract,
      });
      const service = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: runtimeProcessContract,
        name: SERVICE_NAME,
        sessionKeySeed: serviceKey.seed,
        telemetry: false,
        server: {},
      }).orThrow();

      try {
        assertEquals(service.name, SERVICE_NAME);
        assertEquals(service.auth.sessionKey, serviceKey.sessionKey);
      } finally {
        await service.stop();
      }
    } finally {
      await runtime.stop();
    }
  },
});

Deno.test({
  name:
    "TrellisTestRuntime connects a generated app client for RPC and event publish",
  ignore: !RUN_RUNTIME_PROCESS_TEST,
  fn: async () => {
    const runtime = await TrellisTestRuntime.start({
      trellis: {
        command: {
          cmd: Deno.execPath(),
          args: ["run", "-A", trellisMainPath],
        },
      },
      timeouts: {
        startupMs: 60_000,
        reconciliationMs: 15_000,
        shutdownMs: 10_000,
      },
    });

    try {
      const serviceKey = await runtime.registerService({
        name: "entity-live",
        contract: entityContract,
      });
      const service = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: entityContract,
        name: "entity-live",
        sessionKeySeed: serviceKey.seed,
        telemetry: false,
        server: {},
      }).orThrow();

      const eventController = new AbortController();
      let observedEvent: string | undefined;
      try {
        await service.handle.rpc.entity.get(({ input }) =>
          Result.ok({ id: input.id, found: true })
        );
        await service.event.entity.changed.listen(
          (event) => {
            observedEvent = event.value;
            return Result.ok(undefined);
          },
          {},
          { mode: "ephemeral", signal: eventController.signal },
        ).orThrow();

        const client = await runtime.connectClient({
          name: "entity-test-client",
          contract: entityClientContract,
        });

        const got = await client.rpc.entity.get({ id: "entity-1" }).orThrow();
        assertEquals(got, { id: "entity-1", found: true });

        await client.event.entity.changed.publish({
          id: "entity-1",
          value: "updated",
        }).orThrow();
        await runtime.waitFor(() => observedEvent === "updated");
      } finally {
        eventController.abort();
        await service.stop();
      }
    } finally {
      await runtime.stop();
    }
  },
});

Deno.test({
  name: "TrellisTestRuntime can approve explicit migration plans",
  ignore: !RUN_RUNTIME_PROCESS_TEST,
  fn: async () => {
    const runtime = await TrellisTestRuntime.start({
      trellis: {
        command: {
          cmd: Deno.execPath(),
          args: ["run", "-A", trellisMainPath],
        },
      },
      authority: { autoAccept: ["update", "migration"] },
      timeouts: {
        startupMs: 60_000,
        reconciliationMs: 15_000,
        shutdownMs: 10_000,
      },
    });

    try {
      const first = await runtime.contracts.approve({
        contract: migrationContractV1,
      });
      const second = await runtime.contracts.approve({
        contract: migrationContractV2,
        allowPlanClassifications: ["update", "migration"],
      });

      assertEquals(first.classification, "update");
      assertEquals(second.classification, "migration");
    } finally {
      await runtime.stop();
    }
  },
});

Deno.test({
  name:
    "TrellisTestRuntime stops dependent services with durable listeners cleanly",
  ignore: !RUN_RUNTIME_PROCESS_TEST,
  fn: async () => {
    const runtime = await TrellisTestRuntime.start({
      trellis: {
        command: {
          cmd: Deno.execPath(),
          args: ["run", "-A", trellisMainPath],
        },
      },
      authority: { autoAccept: ["update", "migration"] },
      timeouts: {
        startupMs: 60_000,
        reconciliationMs: 15_000,
        shutdownMs: 10_000,
      },
    });

    try {
      const entityKey = await runtime.registerService({
        name: "entity-live-source",
        contract: entityContract,
      });
      const entity = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: entityContract,
        name: "entity-live-source",
        sessionKeySeed: entityKey.seed,
        telemetry: false,
        server: {},
      }).orThrow();
      const subscriberKey = await runtime.registerService({
        name: "entity-live-subscriber",
        contract: entitySubscriberContract,
      });
      const subscriber = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: entitySubscriberContract,
        name: "entity-live-subscriber",
        sessionKeySeed: subscriberKey.seed,
        telemetry: false,
        server: {},
      }).orThrow();
      const controller = new AbortController();
      let observedId: string | undefined;

      try {
        await subscriber.event.entity.changed.listen(
          (event) => {
            observedId = event.id;
            return Result.ok(undefined);
          },
          {},
          { group: "ingest", signal: controller.signal },
        ).orThrow();
        await entity.event.entity.changed.publish({
          id: "entity-durable-1",
          value: "changed",
        }).orThrow();
        await runtime.waitFor(() => observedId === "entity-durable-1");
      } finally {
        controller.abort();
        await subscriber.stop();
        await entity.stop();
      }
    } finally {
      await runtime.stop();
    }
  },
});
