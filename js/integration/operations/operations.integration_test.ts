import { assert, assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { assertOperationCompleted } from "@qlever-llc/trellis-test";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";

const operationSchemas = {
  OperationInput: Type.Object({ message: Type.String() }),
  OperationProgress: Type.Object({
    message: Type.String(),
    step: Type.Number(),
  }),
  OperationOutput: Type.Object({
    message: Type.String(),
    done: Type.Boolean(),
  }),
} as const;

const operationsServiceContract = defineServiceContract(
  { schemas: operationSchemas },
  (ref) => ({
    id: "trellis.integration.operations-service@v1",
    displayName: "Trellis Integration Operations Service",
    description: "Exercises generated operation start and watch surfaces.",
    capabilities: {
      process: {
        displayName: "Process entities",
        description: "Start and observe entity processing operations.",
      },
    },
    operations: {
      "Entity.Process": {
        version: "v1",
        subject: "operations.v1.Entity.Process",
        input: ref.schema("OperationInput"),
        progress: ref.schema("OperationProgress"),
        output: ref.schema("OperationOutput"),
        capabilities: { call: ["process"], observe: ["process"] },
        cancel: false,
      },
    },
  }),
);

const operationsClientContract = defineAppContract(() => ({
  id: "trellis.integration.operations-client@v1",
  displayName: "Trellis Integration Operations Client",
  description: "App/client participant for the operations integration fixture.",
  uses: {
    required: {
      operationsService: operationsServiceContract.use({
        operations: { call: ["Entity.Process"] },
      }),
    },
  },
}));

const operationsUnauthorizedClientContract = defineAppContract(() => ({
  id: "trellis.integration.operations-unauthorized-client@v1",
  displayName: "Trellis Integration Unauthorized Operations Client",
  description:
    "App/client without operation call authority for Entity.Process.",
  uses: {
    required: {
      operationsService: operationsServiceContract.use({}),
    },
  },
}));

Deno.test("operations.client-starts-operation starts an operation and receives an operation ref", async () => {
  await withTrellisRuntime(async (runtime) => {
    const serviceKey = await runtime.registerService({
      name: "operations-fixture-service",
      contract: operationsServiceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: operationsServiceContract,
      name: "operations-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

    try {
      let receivedInput: string | undefined;
      await service.handle.operation.entity.process(async ({ input, op }) => {
        receivedInput = input.message;
        await op.started().orThrow();
        return Result.ok({ message: input.message, done: true });
      });

      const client = await runtime.connectClient({
        name: "operations-fixture-client",
        contract: operationsClientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: "operation-1",
      }).start().orThrow();

      assert(ref.id.length > 0, "operation ref id should be non-empty");
      assertEquals(receivedInput, "operation-1");
    } finally {
      await service.stop();
    }
  });
});

Deno.test("operations.client-watches-progress observes progress events on an operation stream", async () => {
  await withTrellisRuntime(async (runtime) => {
    const serviceKey = await runtime.registerService({
      name: "operations-fixture-service",
      contract: operationsServiceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: operationsServiceContract,
      name: "operations-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await op.progress({ message: input.message, step: 1 }).orThrow();
        return Result.ok({ message: input.message, done: true });
      });

      const client = await runtime.connectClient({
        name: "operations-fixture-client",
        contract: operationsClientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: "operation-1",
      }).start().orThrow();
      const events = await ref.watch().orThrow();

      let sawProgress = false;
      for await (const event of events) {
        if (event.type === "progress") {
          assertEquals(event.progress, { message: "operation-1", step: 1 });
          sawProgress = true;
          break;
        }
      }

      assert(sawProgress, "operation watch should observe progress");
    } finally {
      await service.stop();
    }
  });
});

Deno.test("operations.client-waits-for-completion observes completion on an operation watch", async () => {
  await withTrellisRuntime(async (runtime) => {
    const serviceKey = await runtime.registerService({
      name: "operations-fixture-service",
      contract: operationsServiceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: operationsServiceContract,
      name: "operations-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();
        await new Promise((resolve) => setTimeout(resolve, 100));
        return Result.ok({ message: input.message, done: true });
      });

      const client = await runtime.connectClient({
        name: "operations-fixture-client",
        contract: operationsClientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: "operation-1",
      }).start().orThrow();
      const events = await ref.watch().orThrow();

      let sawCompleted = false;
      for await (const event of events) {
        if (event.type === "completed") {
          sawCompleted = true;
          assertEquals(event.snapshot.output, {
            message: "operation-1",
            done: true,
          });
          break;
        }
      }

      assert(sawCompleted, "operation watch should observe completion");
      await assertOperationCompleted(ref, {
        message: "operation-1",
        done: true,
      });
    } finally {
      await service.stop();
    }
  });
});

Deno.test("operations.denies-start-without-call-authority rejects an unauthorized operation start", async () => {
  await withTrellisRuntime(async (runtime) => {
    await runtime.contracts.approve({ contract: operationsServiceContract });

    const client = await runtime.connectClient({
      name: "operations-fixture-unauthorized-client",
      contract: operationsUnauthorizedClientContract,
    });

    assert((client.operation as Record<string, unknown>).entity === undefined);
  });
});
