/**
 * Tests for the Trellis server package entry point.
 * @module
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { Type } from "typebox";
import { type BaseError, Result } from "@qlever-llc/result";
import { defineServiceContract } from "../trellis/contract.ts";
import type {
  EventHandler,
  EventName,
  EventPayload,
  KVError,
  RpcHandler,
  RpcHandlerFn,
  RpcInput,
  RpcInputOf,
  RpcName,
  RpcOutput,
  RpcOutputOf,
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
  KVHandle,
  type OrderingGroup,
  type ServiceRpcHandler,
  ServiceTransfer,
  StoreHandle,
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

Deno.test("TrellisServer export exists", () => {
  assertExists(TrellisServer);
  assertEquals(typeof TrellisServer, "function");
  assertEquals(typeof TrellisServiceClass, "function");
  assertEquals(typeof ServiceTransfer, "function");
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
    request: Promise<Result<{ ok: boolean }, BaseError>>;
    requestOrThrow: Promise<{ ok: boolean }>;
    kvOpen: Promise<Result<TypedKV<typeof schema>, KVError>>;
    storeOpen: Promise<Result<TypedStore, StoreError>>;
  } {
    return {
      request: service.request("Test.Ping", { value: "ping" }),
      requestOrThrow: service.requestOrThrow("Test.Ping", { value: "ping" }),
      kvOpen: kvHandle.open(schema),
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
      typeof typeTestContract.API.trellis
    >,
  ) {
    void service.trellis.mount(
      "Test.Ping",
      async (payload, context, trellis) => {
        const value: string = payload.value;
        const sessionKey: string = context.sessionKey;
        const ping = trellis.request("Test.Ping", { value });
        const upload = trellis.transfer.initiateUpload({
          sessionKey,
          store: "uploads",
          key: value,
          expiresInMs: 60_000,
        });
        assertExists(ping);
        assertExists(upload);
        return Result.ok({ ok: value.length > 0 && sessionKey.length >= 0 });
      },
    );

    void service.trellis.mount("Test.Ping", (payload, context, trellis) => {
      const value: string = payload.value;
      const sessionKey: string = context.sessionKey;
      const ping = trellis.request("Test.Ping", { value });
      const download = trellis.transfer.initiateDownload({
        sessionKey,
        store: "uploads",
        key: value,
        expiresInMs: 60_000,
      });
      assertExists(ping);
      assertExists(download);
      return Result.ok({ ok: value.length > 0 && sessionKey.length >= 0 });
    });
  }

  assertExists(expectTypedMount);
});

Deno.test("server RPC helper types support extracted handlers with transfer", () => {
  type PingHandler = ServiceRpcHandler<typeof typeTestContract, "Test.Ping">;

  const pingHandler: PingHandler = (payload, context, service) => {
    const value: string = payload.value;
    const sessionKey: string = context.sessionKey;
    const ping = service.request("Test.Ping", { value });
    const upload = service.transfer.initiateUpload({
      sessionKey,
      store: "uploads",
      key: value,
      expiresInMs: 60_000,
    });
    assertExists(ping);
    assertExists(upload);
    return Result.ok({ ok: value.length > 0 && sessionKey.length >= 0 });
  };

  assertExists(pingHandler);
});

Deno.test("public RPC helper types support extracted handlers", () => {
  type OwnedApi = typeof typeTestContract.API.owned;
  type PingInput = RpcInputOf<OwnedApi, "Test.Ping">;
  type PingOutput = RpcOutputOf<OwnedApi, "Test.Ping">;

  const pingHandler: RpcHandlerFn<OwnedApi, "Test.Ping"> = (
    payload,
    context,
  ) => {
    const value: PingInput["value"] = payload.value;
    const sessionKey: string = context.sessionKey;
    const output: PingOutput = {
      ok: value.length > 0 && sessionKey.length >= 0,
    };
    return Result.ok(output);
  };

  assertExists(pingHandler);
});

Deno.test("contract-oriented helper types support local Rpc<T> and Event<T> aliases", () => {
  type TypeTestRpc<T extends RpcName<typeof typeTestContract>> = RpcHandler<
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

  const ping: TypeTestRpc<"Test.Ping"> = (payload, context, trellis) => {
    const value: TypeTestRpcIn<"Test.Ping">["value"] = payload.value;
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
