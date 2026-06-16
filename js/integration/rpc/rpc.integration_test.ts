import { assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";

const rpcSchemas = {
  EntityGetInput: Type.Object({ id: Type.String() }),
  EntityGetOutput: Type.Object({ id: Type.String(), found: Type.Boolean() }),
} as const;

const rpcServiceContract = defineServiceContract(
  { schemas: rpcSchemas },
  (ref) => ({
    id: "trellis.integration.rpc-service@v1",
    displayName: "Trellis Integration RPC Service",
    description: "Exercises client-to-service RPC through generated surfaces.",
    capabilities: {
      read: {
        displayName: "Read entities",
        description: "Read entity records in the RPC integration fixture.",
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
  }),
);

const rpcClientContract = defineAppContract(() => ({
  id: "trellis.integration.rpc-client@v1",
  displayName: "Trellis Integration RPC Client",
  description: "App/client participant for the RPC integration fixture.",
  uses: {
    required: {
      rpcService: rpcServiceContract.use({
        rpc: { call: ["Entity.Get"] },
      }),
    },
  },
}));

Deno.test("rpc.client-calls-service reaches a service RPC through generated surfaces", async () => {
  await withTrellisRuntime(async (runtime) => {
    const serviceKey = await runtime.registerService({
      name: "rpc-fixture-service",
      contract: rpcServiceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: rpcServiceContract,
      name: "rpc-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

    try {
      await service.handle.rpc.entity.get(({ input }) =>
        Result.ok({ id: input.id, found: true })
      );

      const client = await runtime.connectClient({
        name: "rpc-fixture-client",
        contract: rpcClientContract,
      });

      const result = await client.rpc.entity.get({ id: "entity-1" }).orThrow();
      assertEquals(result, { id: "entity-1", found: true });
    } finally {
      await service.stop();
    }
  });
});
