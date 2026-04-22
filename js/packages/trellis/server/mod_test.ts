/**
 * Tests for the Trellis server package entry point.
 * @module
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { Type } from "typebox";
import { AsyncResult, type BaseError, Result } from "@qlever-llc/result";
import { defineServiceContract } from "../contract.ts";
import type {
  EventHandler,
  EventName,
  EventPayload,
  KVError,
  RpcHandler as ContractRpcHandler,
  RpcHandlerFn,
  RpcInput,
  RpcInputOf,
  RpcName,
  RpcOutput,
  RpcOutputOf,
  StoreError,
  TrellisAPI,
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
  type JobHandler,
  KVHandle,
  type OperationHandler,
  type OrderingGroup,
  type RpcHandler,
  type ServiceContract,
  StoreHandle,
  type Trellis as ServiceTrellisHandler,
  type SubscribeOpts,
  TrellisServer,
  type TrellisService,
  TrellisService as TrellisServiceClass,
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
  }),
);

const jobsTypeTestSchemas = {
  RefreshPayload: Type.Object({ siteId: Type.String() }),
  RefreshResult: Type.Object({ refreshId: Type.String() }),
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
  }),
);

const operationsTypeTestSchemas = {
  RunInput: Type.Object({ value: Type.String() }),
  RunProgress: Type.Object({ value: Type.String() }),
  RunOutput: Type.Object({ ok: Type.Boolean() }),
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
  }),
);

Deno.test("TrellisServer export exists", () => {
  assertExists(TrellisServer);
  assertEquals(typeof TrellisServer, "function");
  assertEquals(typeof TrellisServiceClass, "function");
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
  const schema = Type.Object({ value: Type.String() });
  function expectTypedSurface(
    service:
      & TrellisService<
        typeof typeTestContract.API.owned,
        typeof typeTestContract.API.owned
      >
      & { store: Record<string, StoreHandle> },
    kvHandle: KVHandle,
    storeHandle: StoreHandle,
  ): {
    request: AsyncResult<{ ok: boolean }, BaseError>;
    kvOpen: AsyncResult<TypedKV<typeof schema>, KVError>;
    storeOpen: AsyncResult<TypedStore, StoreError>;
  } {
    return {
      request: service.request("Test.Ping", { value: "ping" }),
      kvOpen: kvHandle.open(schema),
      storeOpen: storeHandle.open(),
    };
  }

  assertExists(expectTypedSurface);

  assertEquals(true, true);
});

Deno.test("service wrapper mount handlers stay method-typed", () => {
  const schema = Type.Object({ value: Type.String() });

  function expectTypedMount(
    service: TrellisService<
      typeof typeTestContract.API.owned,
      typeof typeTestContract.API.trellis
    >,
  ) {
    void service.trellis.mount(
      "Test.Ping",
      async ({ input, context, trellis }) => {
        const value: string = input.value;
        const sessionKey: string = context.sessionKey;
        const ping = trellis.request("Test.Ping", { value });
        const kv = trellis.kv.items.open(schema);
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
      const kv = trellis.kv.items.open(schema);
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

Deno.test("service wrapper exposes typed jobs facade", () => {
  type JobsContract = typeof jobsTypeTestContract;
  type JobsService = TrellisService<
    JobsContract["API"]["owned"],
    JobsContract["API"]["trellis"],
    JobsContract extends ServiceContract<
      infer _TOwned,
      infer _TTrellis,
      infer TJobs
    > ? TJobs : never
  >;

  function expectTypedJobs(service: JobsService) {
    const created = service.jobs.refreshSummaries.create({ siteId: "site-1" });
    const registered = service.jobs.refreshSummaries.handle(async ({ job, trellis }) => {
      const siteId: string = job.payload.siteId;
      assertEquals(siteId, job.payload.siteId);
      assertExists(trellis.kv);
      assertExists(trellis.store);
      return Result.ok({ refreshId: `refresh-${siteId}` });
    });
    const workers = service.jobs.startWorkers({
      queues: ["refreshSummaries"],
      instanceId: "worker-a",
      version: "1.0.0",
    });

    assertExists(created);
    assertExists(registered);
    assertExists(workers);
  }

  assertExists(expectTypedJobs);
});

Deno.test("server RPC helper types support extracted handlers", () => {
  type PingHandler = RpcHandler<typeof typeTestContract, "Test.Ping">;
  const schema = Type.Object({ value: Type.String() });

  const pingHandler: PingHandler = ({ input, context, trellis }) => {
    const value: string = input.value;
    const sessionKey: string = context.sessionKey;
    const ping = trellis.request("Test.Ping", { value });
    const kv = trellis.kv.items.open(schema);
    const store = trellis.store.uploads.open();
    assertExists(ping);
    assertExists(kv);
    assertExists(store);
    assertExists(sessionKey);
    return Result.ok({ ok: value.length > 0 && sessionKey.length >= 0 });
  };

  assertExists(pingHandler);
});

Deno.test("public RPC helper types support extracted handlers", () => {
  type OwnedApi = typeof typeTestContract.API.owned;
  type PingInput = RpcInputOf<OwnedApi, "Test.Ping">;
  type PingOutput = RpcOutputOf<OwnedApi, "Test.Ping">;

  const pingHandler: RpcHandlerFn<OwnedApi, "Test.Ping"> = ({
    input,
    context,
  }) => {
    const value: PingInput["value"] = input.value;
    const sessionKey: string = context.sessionKey;
    const output: PingOutput = {
      ok: value.length > 0 && sessionKey.length >= 0,
    };
    return Result.ok(output);
  };

  assertExists(pingHandler);
});

Deno.test("contract-oriented helper types support local Rpc<T> and Event<T> aliases", () => {
  type TypeTestRpc<T extends RpcName<typeof typeTestContract>> = ContractRpcHandler<
    typeof typeTestContract,
    T
  >;
  type TypeTestRpcIn<T extends RpcName<typeof typeTestContract>> = RpcInput<
    typeof typeTestContract,
    T
  >;
  type TypeTestRpcOut<T extends RpcName<typeof typeTestContract>> = RpcOutput<
    typeof typeTestContract,
    T
  >;
  type TypeTestEvent<T extends EventName<typeof typeTestContract>> =
    EventHandler<typeof typeTestContract, T>;
  type TypeTestEventPayload<T extends EventName<typeof typeTestContract>> =
    EventPayload<typeof typeTestContract, T>;
  type TypeTestTrellis = TrellisFor<typeof typeTestContract>;

  const ping: TypeTestRpc<"Test.Ping"> = ({ input, context, trellis }) => {
    const value: TypeTestRpcIn<"Test.Ping">["value"] = input.value;
    const sessionKey: string = context.sessionKey;
    const outbound: TypeTestTrellis = trellis;
    assertExists(outbound.request("Test.Ping", { value }));
    const output: TypeTestRpcOut<"Test.Ping"> = {
      ok: value.length > 0 && sessionKey.length >= 0,
    };
    return Result.ok(output);
  };

  const onPinged: TypeTestEvent<"Test.Pinged"> = async (event) => {
    const value: TypeTestEventPayload<"Test.Pinged">["value"] = event.value;
    assertEquals(value, event.value);
    return Result.ok(undefined);
  };

  assertExists(ping);
  assertExists(onPinged);
});

Deno.test("service handler aliases expose narrow trellis object args", () => {
  const schema = Type.Object({ value: Type.String() });

  type ServiceRuntime = ServiceTrellisHandler<typeof typeTestContract.API.trellis>;
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
    assertExists(trellis.kv.items.open(schema));
    assertExists(trellis.store.uploads.open());
  };

  const rpcHandler: PingRpcHandler = ({ input, context, trellis }) => {
    expectRuntime(trellis);
    return Result.ok({ ok: input.value.length > context.sessionKey.length - context.sessionKey.length });
  };

  const jobHandler: RefreshJobHandler = async ({ job, trellis }) => {
    expectRuntime(trellis);
    return Result.ok({ refreshId: job.payload.siteId });
  };

  const operationHandler: PingOperationHandler = async ({ input, op, trellis }) => {
    assertEquals(input.value, "run");
    assertExists(op.started());
    expectRuntime(trellis);
    return Result.ok(undefined);
  };

  assertExists(rpcHandler);
  assertExists(jobHandler);
  assertExists(operationHandler);
});
