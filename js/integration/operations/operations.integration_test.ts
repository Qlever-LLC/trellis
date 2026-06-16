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

Deno.test("operations.client-starts-and-watches-operation starts, watches, and waits for completion", async () => {
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

      let sawProgress = false;
      let sawCompleted = false;
      for await (const event of events) {
        if (event.type === "progress") {
          sawProgress = true;
          assertEquals(event.progress, { message: "operation-1", step: 1 });
        }
        if (event.type === "completed") {
          sawCompleted = true;
          assertEquals(event.snapshot.output, {
            message: "operation-1",
            done: true,
          });
          break;
        }
      }

      assert(sawProgress, "operation watch should observe progress");
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
