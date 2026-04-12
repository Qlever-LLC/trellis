/**
 * Tests for the Trellis server package entry point.
 * @module
 */

import {
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import { Type } from "typebox";
import type { BaseError, Result } from "@qlever-llc/result";
import { defineContract } from "../trellis/contract.ts";
import type { KVError, StoreError, TypedKV, TypedStore } from "@qlever-llc/trellis";

// Import the module under test
import {
  type EventContext,
  type HealthCheckFn,
  type HealthCheckResult,
  type HealthResponse,
  type OrderingGroup,
  ServiceTransfer,
  type SubscribeOpts,
  type TrellisService,
  TrellisService as TrellisServiceClass,
  TrellisServer,
  KVHandle,
  StoreHandle,
} from "./mod.ts";

const typeTestContract = defineContract({
  id: "trellis.server.type-test@v1",
  displayName: "Server Type Test",
  description: "Verify typed service surface.",
  kind: "service",
  schemas: {
    PingInput: Type.Object({}, { additionalProperties: false }),
    PingOutput: Type.Object({ ok: Type.Boolean() }, { additionalProperties: false }),
    KVValue: Type.Object({ value: Type.String() }, { additionalProperties: false }),
  },
  rpc: {
    "Test.Ping": {
      version: "v1",
      input: { schema: "PingInput" },
      output: { schema: "PingOutput" },
      errors: ["UnexpectedError"],
    },
  },
});

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
  const schema = Type.Object({ value: Type.String() }, { additionalProperties: false });
  function expectTypedSurface(
    service: TrellisService<
      typeof typeTestContract.API.owned,
      typeof typeTestContract.API.owned
    > & { store: Record<string, StoreHandle> },
    kvHandle: KVHandle,
    storeHandle: StoreHandle,
  ): {
    request: Promise<Result<{ ok: boolean }, BaseError>>;
    requestOrThrow: Promise<{ ok: boolean }>;
    kvOpen: Promise<Result<TypedKV<typeof schema>, KVError>>;
    storeOpen: Promise<Result<TypedStore, StoreError>>;
  } {
    return {
      request: service.request("Test.Ping", {}),
      requestOrThrow: service.requestOrThrow("Test.Ping", {}),
      kvOpen: kvHandle.open(schema),
      storeOpen: storeHandle.open(),
    };
  }

  assertExists(expectTypedSurface);

  assertEquals(true, true);
});
