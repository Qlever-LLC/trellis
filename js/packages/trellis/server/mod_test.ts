/**
 * Tests for the Trellis server package entry point.
 * @module
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { Type } from "typebox";
import { AsyncResult, type BaseError, Result } from "@qlever-llc/result";
import { defineServiceContract } from "../contract.ts";
import { CONTRACT_KV_METADATA } from "../contract_support/mod.ts";
import type {
  EventHandler,
  EventName,
  EventPayload,
  RpcArgs,
  RpcHandlerFn,
  RpcOutputOf,
  RpcResult,
  StoreError,
  TrellisFor,
  TypedKV,
  TypedStore,
} from "@qlever-llc/trellis";

// Import the module under test
import {
  type EventContext,
  type HealthCheckFn,
  type HealthCheckResult,
  type HealthResponse,
  type JobArgs,
  type JobHandler,
  type JobResult,
  type OperationHandler,
  type OrderingGroup,
  type RpcHandler,
  type ServiceContract,
  StoreHandle,
  type SubscribeOpts,
  type Trellis as ServiceTrellisHandler,
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
    request: AsyncResult<{ ok: boolean }, BaseError>;
    kv: TypedKV<typeof typeTestSchemas.KVValue>;
    storeOpen: AsyncResult<TypedStore, StoreError>;
  } {
    return {
      request: service.request("Test.Ping", { value: "ping" }),
      kv: service.kv.items,
      storeOpen: storeHandle.open(),
    };
  }

  assertExists(expectTypedSurface);

  assertEquals(true, true);
});

Deno.test("service wrapper mount handlers stay method-typed", () => {
  function expectTypedMount(
    service: TrellisService<
      typeof typeTestContract.API.owned,
      typeof typeTestContract.API.trellis,
      {},
      TypeTestKv
    >,
  ) {
    void service.trellis.mount(
      "Test.Ping",
      async ({ input, context, trellis }) => {
        const value: string = input.value;
        const sessionKey: string = context.sessionKey;
        const ping = trellis.request("Test.Ping", { value });
        const kv: TypedKV<typeof typeTestSchemas.KVValue> = trellis.kv.items;
        const store = trellis.store.uploads.open();
        assertExists(ping);
        assertExists(kv);
        assertExists(store);
        assertExists(sessionKey);
        return Result.ok({ ok: value.length > 0 && sessionKey.length >= 0 });
      },
    );

    void service.trellis.mount("Test.Ping", ({ input, context, trellis }) => {
      const value: string = input.value;
      const sessionKey: string = context.sessionKey;
      const ping = trellis.request("Test.Ping", { value });
      const kv: TypedKV<typeof typeTestSchemas.KVValue> = trellis.kv.items;
      const store = trellis.store.uploads.open();
      assertExists(ping);
      assertExists(kv);
      assertExists(store);
      assertExists(sessionKey);
      return Result.ok({ ok: value.length > 0 && sessionKey.length >= 0 });
    });
  }

  assertExists(expectTypedMount);
});

Deno.test("optional KV aliases stay optional in the service type", () => {
  function expectOptionalKv(
    service: TrellisService<
      typeof optionalKvTypeTestContract.API.owned,
      typeof optionalKvTypeTestContract.API.trellis,
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
    JobsContract["API"]["trellis"],
    JobsContract extends ServiceContract<
      infer _TOwned,
      infer _TTrellis,
      infer TJobs,
      infer _TKv
    > ? TJobs
      : never
  >;

  function expectTypedJobs(service: JobsService) {
    const created = service.jobs.refreshSummaries.create({ siteId: "site-1" });
    const registered = service.jobs.refreshSummaries.handle(
      async ({ job, trellis }) => {
        const siteId: string = job.payload.siteId;
        assertEquals(siteId, job.payload.siteId);
        assertExists(trellis.kv);
        assertExists(trellis.store);
        assertExists(trellis.jobs.refreshSummaries.create({ siteId }));
        return Result.ok({ refreshId: `refresh-${siteId}` });
      },
    );

    assertExists(created);
    assertEquals(registered, undefined);
  }

  assertExists(expectTypedJobs);
});

Deno.test("server RPC helper types support extracted handlers", () => {
  type PingHandler = RpcHandler<typeof typeTestContract, "Test.Ping">;

  const pingHandler: PingHandler = ({ input, context, trellis }) => {
    const value: string = input.value;
    const sessionKey: string = context.sessionKey;
    const ping = trellis.request("Test.Ping", { value });
    const kv: TypedKV<typeof typeTestSchemas.KVValue> = trellis.kv.items;
    const store = trellis.store.uploads.open();
    assertExists(ping);
    assertExists(kv);
    assertExists(store);
    assertExists(sessionKey);
    return Result.ok({ ok: value.length > 0 && sessionKey.length >= 0 });
  };

  assertExists(pingHandler);
});

Deno.test("lower-level API RPC helper types support extracted handlers", () => {
  type OwnedApi = typeof typeTestContract.API.owned;
  type PingArgs = Parameters<RpcHandlerFn<OwnedApi, "Test.Ping">>[0];
  type PingResult = RpcOutputOf<OwnedApi, "Test.Ping">;

  const pingHandler = ({
    input,
    context,
  }: PingArgs): Result<PingResult, BaseError> => {
    const value: PingArgs["input"]["value"] = input.value;
    const sessionKey: string = context.sessionKey;
    const output: PingResult = {
      ok: value.length > 0 && sessionKey.length >= 0,
    };
    return Result.ok(output);
  };

  assertExists(pingHandler);
});

Deno.test("contract-oriented helper types support local Args and Return aliases", () => {
  type Args = RpcArgs<typeof typeTestContract, "Test.Ping">;
  type Return = RpcResult<typeof typeTestContract, "Test.Ping">;
  type TypeTestEvent<T extends EventName<typeof typeTestContract>> =
    EventHandler<typeof typeTestContract, T>;
  type TypeTestEventPayload<T extends EventName<typeof typeTestContract>> =
    EventPayload<typeof typeTestContract, T>;
  type TypeTestTrellis = TrellisFor<typeof typeTestContract>;
  const argsTypeCheck: Args | undefined = undefined;

  const ping = ({
    input,
    context,
    trellis,
  }: Args): Return => {
    const value: string = input.value;
    const sessionKey: string = context.sessionKey;
    const outbound: TypeTestTrellis = trellis;
    assertExists(outbound.request("Test.Ping", { value }));
    const kv: TypedKV<typeof typeTestSchemas.KVValue> = trellis.kv.items;
    const store = trellis.store.uploads.open();
    assertExists(kv);
    assertExists(store);
    assertExists(trellis.jobs);
    const output = {
      ok: value.length > 0 && sessionKey.length >= 0,
    };
    return Result.ok(output);
  };

  const onPinged: TypeTestEvent<"Test.Pinged"> = async (
    event: Parameters<TypeTestEvent<"Test.Pinged">>[0],
  ) => {
    const value: TypeTestEventPayload<"Test.Pinged">["value"] = event.value;
    assertEquals(value, event.value);
    return Result.ok(undefined);
  };

  assertExists(ping);
  assertExists(onPinged);
  assertEquals(argsTypeCheck, undefined);
});

Deno.test("job helper types support local Args and Return aliases", () => {
  type Args = JobArgs<typeof jobsTypeTestContract, "refreshSummaries">;
  type Return = JobResult<typeof jobsTypeTestContract, "refreshSummaries">;
  const argsTypeCheck: Args | undefined = undefined;

  const refresh = async ({ job, trellis }: Args): Promise<Return> => {
    const siteId: string = job.payload.siteId;
    const kv: TypedKV<typeof jobsTypeTestSchemas.KVValue> = trellis.kv.items;
    const created = trellis.jobs.refreshSummaries.create({ siteId });
    const store = trellis.store.uploads.open();
    assertExists(kv);
    assertExists(created);
    assertExists(store);
    return Result.ok({ refreshId: siteId });
  };

  assertExists(refresh);
  assertEquals(argsTypeCheck, undefined);
});

Deno.test("service handler aliases expose narrow trellis object args", () => {
  type ServiceRuntime = ServiceTrellisHandler<
    typeof typeTestContract.API.trellis,
    TypeTestKv
  >;
  type PingRpcHandler = RpcHandler<typeof typeTestContract, "Test.Ping">;
  type RefreshJobHandler = JobHandler<
    typeof jobsTypeTestContract,
    "refreshSummaries"
  >;
  type PingOperationHandler = OperationHandler<
    typeof operationsTypeTestContract,
    "Test.Run"
  >;

  const expectRuntime = (trellis: ServiceRuntime) => {
    assertExists(trellis.request("Test.Ping", { value: "ok" }));
    assertExists(trellis.kv.items);
    assertExists(trellis.store.uploads.open());
  };

  const rpcHandler: PingRpcHandler = ({ input, context, trellis }) => {
    expectRuntime(trellis);
    return Result.ok({
      ok: input.value.length >
        context.sessionKey.length - context.sessionKey.length,
    });
  };

  const jobHandler: RefreshJobHandler = async ({ job, trellis }) => {
    expectRuntime(trellis);
    return Result.ok({ refreshId: job.payload.siteId });
  };

  const operationHandler: PingOperationHandler = async (
    { input, op, trellis },
  ) => {
    assertEquals(input.value, "run");
    assertExists(op.started());
    expectRuntime(trellis);
    return Result.ok(undefined);
  };

  assertExists(rpcHandler);
  assertExists(jobHandler);
  assertExists(operationHandler);
});
