import { assert, assertEquals } from "@std/assert";
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
  EntityGetOutput: Type.Object({
    id: Type.String(),
    found: Type.Boolean(),
    caller: Type.Optional(Type.Any()),
    sessionKey: Type.Optional(Type.String()),
    requestId: Type.Optional(Type.String()),
    traceId: Type.Optional(Type.String()),
  }),
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
        errors: ["NOT_FOUND"],
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

const rpcUnauthorizedClientContract = defineAppContract(() => ({
  id: "trellis.integration.rpc-unauthorized-client@v1",
  displayName: "Trellis Integration Unauthorized RPC Client",
  description: "App/client without rpc.call authority for Entity.Get.",
  uses: {
    required: {
      rpcService: rpcServiceContract.use({}),
    },
  },
}));

Deno.test("rpc.client-calls-service-success reaches a service RPC through generated surfaces", async () => {
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
      assertEquals(result.id, "entity-1");
      assertEquals(result.found, true);
    } finally {
      await service.stop();
    }
  });
});

Deno.test("rpc.service-receives-caller-context observes caller metadata in the service handler", async () => {
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
      await service.handle.rpc.entity.get(({ input, context }) =>
        Result.ok({
          id: input.id,
          found: true,
          caller: context.caller,
          sessionKey: context.sessionKey,
          requestId: context.requestId,
          traceId: context.traceId,
        })
      );

      const client = await runtime.connectClient({
        name: "rpc-fixture-client",
        contract: rpcClientContract,
      });

      const result = await client.rpc.entity.get({ id: "entity-1" }).orThrow();
      assertEquals(result.id, "entity-1");
      assertEquals(result.found, true);
      assert(result.caller !== undefined);
      assert(
        result.sessionKey !== undefined && result.sessionKey.length > 0,
      );
      assert(
        result.requestId !== undefined && result.requestId.length > 0,
      );
      // traceId is populated when telemetry is active; check only when present
      if (result.traceId !== undefined) {
        assert(result.traceId.length > 0);
      }
    } finally {
      await service.stop();
    }
  });
});

Deno.test("rpc.client-receives-declared-error from a service RPC handler", async () => {
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
      await service.handle.rpc.entity.get(({ input }) => {
        throw Object.assign(new Error("NOT_FOUND"), {
          code: "NOT_FOUND",
          data: { id: input.id },
        });
      });

      const client = await runtime.connectClient({
        name: "rpc-fixture-client",
        contract: rpcClientContract,
      });

      const result = await client.rpc.entity.get({ id: "entity-1" });
      assert(result.isErr());
    } finally {
      await service.stop();
    }
  });
});

Deno.test("rpc.denies-client-without-call-authority rejects an unauthorized client RPC", async () => {
  await withTrellisRuntime(async (runtime) => {
    await runtime.contracts.approve({ contract: rpcServiceContract });

    const client = await runtime.connectClient({
      name: "rpc-fixture-unauthorized-client",
      contract: rpcUnauthorizedClientContract,
    });

    assert((client.rpc as Record<string, unknown>).entity === undefined);
  });
});
