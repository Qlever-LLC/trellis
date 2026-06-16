/**
 * Tests for the Trellis server package entry point.
 * @module
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { Type } from "typebox";
import { AsyncResult, Result } from "@qlever-llc/result";
import { defineServiceContract } from "../contract.ts";
import {
  CONTRACT_JOBS_METADATA,
  CONTRACT_KV_METADATA,
} from "../contract_support/mod.ts";
import type { StoreError } from "@qlever-llc/trellis";
import type { TypedKV } from "../kv.ts";
import type { TypedStore } from "../store.ts";

// Import the module under test
import {
  type EventContext,
  type HealthCheckFn,
  type HealthCheckHandler,
  type HealthCheckResult,
  type HealthInfoHandler,
  type HealthResponse,
  type OperationHandler,
  type OrderingGroup,
  type RpcHandler,
  type ServiceContract,
  type ServiceEventHandler,
  StoreHandle,
  type SubscribeOpts,
  type TrellisService,
  TrellisService as TrellisServiceClass,
  TrellisServiceRuntime,
} from "./mod.ts";

const typeTestSchemas = {
  PingInput: Type.Object({ value: Type.String() }),
  PingOutput: Type.Object({ ok: Type.Boolean() }),
  PingedEvent: Type.Object({ value: Type.String() }),
  KVValue: Type.Object({ value: Type.String() }),
} as const;

const typeTestContract = defineServiceContract(
  { schemas: typeTestSchemas },
  (ref) => ({
    id: "trellis.server.type-test@v1",
    displayName: "Server Type Test",
    description: "Verify typed service surface.",
    rpc: {
      "Test.Ping": {
        version: "v1",
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        errors: [ref.error("UnexpectedError")],
      },
    },
    events: {
      "Test.Pinged": {
        version: "v1",
        event: ref.schema("PingedEvent"),
      },
    },
    resources: {
      kv: {
        items: {
          purpose: "Store typed items",
          schema: ref.schema("KVValue"),
        },
      },
      store: {
        uploads: {
          purpose: "Store staged uploads",
        },
      },
    },
  }),
);

type TypeTestKv = NonNullable<
  typeof typeTestContract[typeof CONTRACT_KV_METADATA]
>;

const jobsTypeTestSchemas = {
  RefreshPayload: Type.Object({ siteId: Type.String() }),
  RefreshResult: Type.Object({ refreshId: Type.String() }),
  KVValue: Type.Object({ value: Type.String() }),
} as const;

const jobsTypeTestContract = defineServiceContract(
  { schemas: jobsTypeTestSchemas },
  (ref) => ({
    id: "trellis.server.jobs-type-test@v1",
    displayName: "Jobs Type Test",
    description: "Verify typed service.jobs surface.",
    jobs: {
      refreshSummaries: {
        payload: ref.schema("RefreshPayload"),
        result: ref.schema("RefreshResult"),
      },
    },
    resources: {
      kv: {
        items: {
          purpose: "Store typed items",
          schema: ref.schema("KVValue"),
        },
      },
      store: {
        uploads: {
          purpose: "Store staged uploads",
        },
      },
    },
  }),
);

const optionalKvTypeTestContract = defineServiceContract(
  { schemas: typeTestSchemas },
  (ref) => ({
    id: "trellis.server.optional-kv-type-test@v1",
    displayName: "Optional KV Type Test",
    description:
      "Verify optional KV aliases stay optional in the service type.",
    resources: {
      kv: {
        items: {
          purpose: "Optionally store typed items",
          schema: ref.schema("KVValue"),
          required: false,
        },
      },
    },
  }),
);

type OptionalKvTypeTest = NonNullable<
  typeof optionalKvTypeTestContract[typeof CONTRACT_KV_METADATA]
>;

const operationsTypeTestSchemas = {
  RunInput: Type.Object({ value: Type.String() }),
  RunProgress: Type.Object({ value: Type.String() }),
  RunOutput: Type.Object({ ok: Type.Boolean() }),
  KVValue: Type.Object({ value: Type.String() }),
} as const;

const operationsTypeTestContract = defineServiceContract(
  { schemas: operationsTypeTestSchemas },
  (ref) => ({
    id: "trellis.server.operations-type-test@v1",
    displayName: "Operations Type Test",
    description: "Verify typed service.operation surface.",
    operations: {
      "Test.Run": {
        version: "v1",
        input: ref.schema("RunInput"),
        progress: ref.schema("RunProgress"),
        output: ref.schema("RunOutput"),
      },
    },
    resources: {
      kv: {
        items: {
          purpose: "Store typed items",
          schema: ref.schema("KVValue"),
        },
      },
      store: {
        uploads: {
          purpose: "Store staged uploads",
        },
      },
    },
  }),
);

const depsTypeTestSchemas = {
  Input: Type.Object({ value: Type.String() }),
  Output: Type.Object({ ok: Type.Boolean() }),
  Event: Type.Object({ value: Type.String() }),
  Progress: Type.Object({ value: Type.String() }),
  JobPayload: Type.Object({ value: Type.String() }),
  JobResult: Type.Object({ value: Type.String() }),
  KVValue: Type.Object({ value: Type.String() }),
} as const;

const depsTypeTestContract = defineServiceContract(
  { schemas: depsTypeTestSchemas },
  (ref) => ({
    id: "trellis.server.deps-type-test@v1",
    displayName: "Deps Type Test",
    description: "Verify bound service dependency injection types.",
    rpc: {
      "Test.Ping": {
        version: "v1",
        input: ref.schema("Input"),
        output: ref.schema("Output"),
        errors: [ref.error("UnexpectedError")],
      },
    },
    events: {
      "Test.Changed": {
        version: "v1",
        event: ref.schema("Event"),
      },
    },
    feeds: {
      "Test.Stream": {
        version: "v1",
        input: ref.schema("Input"),
        event: ref.schema("Event"),
      },
    },
    operations: {
      "Test.Run": {
        version: "v1",
        input: ref.schema("Input"),
        progress: ref.schema("Progress"),
        output: ref.schema("Output"),
      },
    },
    jobs: {
      refresh: {
        payload: ref.schema("JobPayload"),
        result: ref.schema("JobResult"),
      },
    },
    resources: {
      kv: {
        items: {
          purpose: "Store typed items",
          schema: ref.schema("KVValue"),
        },
      },
    },
  }),
);

Deno.test("TrellisServiceRuntime export exists", () => {
  assertExists(TrellisServiceRuntime);
  assertEquals(typeof TrellisServiceRuntime, "function");
  assertEquals(typeof TrellisServiceClass, "function");
  assertEquals(
    Reflect.has(TrellisServiceClass as object, "connectInternal"),
    false,
  );
  assertEquals(typeof StoreHandle, "function");
});

Deno.test("Health types are re-exported", () => {
  // Verify type exports by creating typed variables
  // If these compile, the types are properly exported
  const healthCheck: HealthCheckFn = async () => {
    const { Result } = await import("@qlever-llc/result");
    return Result.ok(true);
  };
  assertExists(healthCheck);

  const healthResponse: HealthResponse = {
    status: "healthy",
    service: "test",
    timestamp: new Date().toISOString(),
    checks: [],
  };
  assertEquals(healthResponse.status, "healthy");

  const healthCheckResult: HealthCheckResult = {
    name: "test-check",
    status: "ok",
    latencyMs: 10,
  };
  assertEquals(healthCheckResult.status, "ok");
});

Deno.test("Subscription types are re-exported", () => {
  // Verify EventContext type
  const context: EventContext = {
    id: "test-id",
    time: new Date(),
    seq: 1,
    ack: () => {},
    nak: () => {},
    term: () => {},
  };
  assertExists(context.id);
  assertExists(context.ack);

  // Verify SubscribeOpts type
  const subscribeOpts: SubscribeOpts = {
    filter: { origin: "github" },
    startSeq: 1,
    consumerName: "test-consumer",
  };
  assertExists(subscribeOpts.filter);

  // Verify OrderingGroup type
  const orderingGroup: OrderingGroup = {
    name: "test-group",
    events: [],
    mode: "strict",
  };
  assertEquals(orderingGroup.mode, "strict");
});

Deno.test("service wrapper type surface stays specific", () => {
  function expectTypedSurface(
    service: TrellisService<
      typeof typeTestContract.API.owned,
      typeof typeTestContract.API.owned,
      {},
      TypeTestKv
    >,
    storeHandle: StoreHandle,
  ): {
    kv: TypedKV<typeof typeTestSchemas.KVValue>;
    storeOpen: AsyncResult<TypedStore, StoreError>;
  } {
    return {
      kv: service.kv.items,
      storeOpen: storeHandle.open(),
    };
  }

  assertExists(expectTypedSurface);

  assertEquals(true, true);
});

Deno.test("optional KV aliases stay optional in the service type", () => {
  function expectOptionalKv(
    service: TrellisService<
      typeof optionalKvTypeTestContract.API.owned,
      typeof optionalKvTypeTestContract.API.owned,
      {},
      OptionalKvTypeTest
    >,
  ): TypedKV<typeof typeTestSchemas.KVValue> | undefined {
    return service.kv.items;
  }

  assertExists(expectOptionalKv);
});

Deno.test("service wrapper exposes typed jobs facade", () => {
  type JobsContract = typeof jobsTypeTestContract;
  type JobsService = TrellisService<
    JobsContract["API"]["owned"],
    JobsContract["API"]["owned"],
    NonNullable<JobsContract[typeof CONTRACT_JOBS_METADATA]>
  >;

  function expectTypedJobs(service: JobsService) {
    const created = service.jobs.refreshSummaries.create({ siteId: "site-1" });
    const registered = service.jobs.refreshSummaries.handle(
      async ({ job, client }) => {
        const siteId: string = job.payload.siteId;
        assertEquals(siteId, job.payload.siteId);
        assertExists(client.kv);
        assertExists(client.store);
        assertExists(client.jobs.refreshSummaries.create({ siteId }));
        return Result.ok({ refreshId: `refresh-${siteId}` });
      },
    );

    assertExists(created);
    assertEquals(registered, undefined);
  }

  assertExists(expectTypedJobs);
});

Deno.test("bound service wrapper injects deps across handler surfaces", () => {
  type DepsContract = typeof depsTypeTestContract;
  type DepsJobs = NonNullable<DepsContract[typeof CONTRACT_JOBS_METADATA]>;
  type DepsKv = NonNullable<DepsContract[typeof CONTRACT_KV_METADATA]>;
  type DepsService = TrellisService<
    DepsContract["API"]["owned"],
    DepsContract["API"]["trellis"],
    DepsJobs,
    DepsKv
  >;
  type Deps = { prefix: string };

  function expectBoundService(service: DepsService) {
    const bound = service.with({ prefix: "dep" });

    void bound.handle.rpc.test.ping(({ input, context, client, deps }) => {
      const value: string = input.value;
      const sessionKey: string = context.sessionKey;
      const prefix: string = deps.prefix;
      assertExists(client.kv.items);
      assertExists(value);
      assertExists(sessionKey);
      return Result.ok({ ok: prefix.length > 0 });
    });

    void bound.handle.feed.test.stream(
      ({ input, emit, client, deps }) => {
        assertExists(client.kv.items);
        assertExists(emit({ value: `${deps.prefix}:${input.value}` }));
      },
    );

    void bound.handle.operation.test.run(({ input, op, client, deps }) => {
      assertExists(op.started());
      assertExists(client.kv.items);
      assertEquals(`${deps.prefix}:${input.value}`.length > 0, true);
    });

    void bound.jobs.refresh.handle(async ({ job, client, deps }) => {
      assertExists(client.kv.items);
      return Result.ok({ value: `${deps.prefix}:${job.payload.value}` });
    });

    void bound.event.test.changed.listen(
      ({ event, context, client, deps }) => {
        const value: string = event.value;
        const subject: string = context.subject;
        assertExists(client.kv.items);
        assertExists(`${deps.prefix}:${value}:${subject}`);
        return Result.ok(undefined);
      },
      {},
      { mode: "ephemeral" },
    );

    return bound.name;
  }

  assertExists(expectBoundService);
});

Deno.test("server RPC helper types support extracted handlers", () => {
  type PingHandler = RpcHandler<typeof typeTestContract, "Test.Ping">;

  const pingHandler: PingHandler = ({ input, context, client }) => {
    const value: string = input.value;
    const sessionKey: string = context.sessionKey;
    const ping = client.rpc.test.ping({ value });
    const kv: TypedKV<typeof typeTestSchemas.KVValue> = client.kv.items;
    const store = client.store.uploads.open();
    assertExists(ping);
    assertExists(kv);
    assertExists(store);
    assertExists(sessionKey);
    return Result.ok({ ok: value.length > 0 && sessionKey.length >= 0 });
  };

  assertExists(pingHandler);
});

Deno.test("service handler aliases expose narrow client object args", () => {
  type PingRpcHandler = RpcHandler<typeof typeTestContract, "Test.Ping">;
  type Deps = { readonly prefix: string };
  type BoundPingRpcHandler = RpcHandler<
    typeof depsTypeTestContract,
    "Test.Ping",
    Deps
  >;
  type BoundEventHandler = ServiceEventHandler<
    typeof depsTypeTestContract,
    "Test.Changed",
    Deps
  >;
  type BoundOperationHandler = OperationHandler<
    typeof depsTypeTestContract,
    "Test.Run",
    Deps
  >;
  type BoundHealthInfoHandler = HealthInfoHandler<Deps>;
  type BoundHealthCheckHandler = HealthCheckHandler<Deps>;
  type PingOperationHandler = OperationHandler<
    typeof operationsTypeTestContract,
    "Test.Run"
  >;

  const expectRuntime = (
    client: Parameters<PingRpcHandler>[0]["client"],
  ) => {
    assertExists(client.rpc.test.ping({ value: "ok" }));
    assertExists(client.kv.items);
    assertExists(client.store.uploads.open());
  };

  const rpcHandler: PingRpcHandler = ({ input, context, client }) => {
    expectRuntime(client);
    return Result.ok({
      ok: input.value.length >
        context.sessionKey.length - context.sessionKey.length,
    });
  };

  const boundRpcHandler: BoundPingRpcHandler = ({ input, deps }) => {
    const prefix: string = deps.prefix;
    return Result.ok({ ok: input.value.startsWith(prefix) });
  };

  const boundEventHandler: BoundEventHandler = (
    { event, context, client, deps },
  ) => {
    const value: string = event.value;
    const subject: string = context.subject;
    const prefix: string = deps.prefix;
    assertExists(client.kv.items);
    assertExists(`${prefix}:${value}:${subject}`);
    return Result.ok(undefined);
  };

  const boundOperationHandler: BoundOperationHandler = async (
    { input, op, client, deps },
  ) => {
    assertEquals(input.value.startsWith(deps.prefix), false);
    assertExists(op.started());
    assertExists(client.kv.items);
    return Result.ok(undefined);
  };

  const boundHealthInfoHandler: BoundHealthInfoHandler = ({ deps }) => ({
    version: deps.prefix,
  });

  const boundHealthCheckHandler: BoundHealthCheckHandler = ({ deps }) => ({
    status: deps.prefix.length > 0 ? "ok" : "failed",
  });

  const operationHandler: PingOperationHandler = async (
    { input, op, client },
  ) => {
    assertEquals(input.value, "run");
    assertExists(op.started());
    assertExists(client.kv.items);
    return Result.ok(undefined);
  };

  assertExists(rpcHandler);
  assertExists(boundRpcHandler);
  assertExists(boundEventHandler);
  assertExists(boundOperationHandler);
  assertExists(boundHealthInfoHandler);
  assertExists(boundHealthCheckHandler);
  assertExists(operationHandler);
});
