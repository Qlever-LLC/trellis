import { assert, assertEquals } from "@std/assert";
import { Type } from "typebox";

import {
  defineAppContract,
  defineAgentContract,
  defineDeviceContract,
  defineError,
  definePortalContract,
  defineServiceContract,
  err,
  FileInfoSchema,
  HealthCheckResultSchema,
  HealthResponseSchema,
  HealthRpcSchema,
  isErr,
  isOk,
  ok,
  Result,
  schema,
  StoreError,
  TransferError,
  TrellisClient,
  TrellisDevice,
  TrellisError,
  TypedStore,
  TypedStoreEntry,
} from "../index.ts";
import * as trellis from "../index.ts";

Deno.test("root public API includes core runtime, contracts, and result helpers", () => {
  assertEquals("defineContract" in trellis, false);
  assertEquals(typeof defineAppContract, "function");
  assertEquals(typeof definePortalContract, "function");
  assertEquals(typeof defineAgentContract, "function");
  assertEquals(typeof defineDeviceContract, "function");
  assertEquals(typeof defineServiceContract, "function");
  assertEquals(typeof defineError, "function");
  assertEquals(typeof schema, "function");
  assertEquals(typeof TrellisClient.connect, "function");
  assertEquals(typeof TrellisDevice.connect, "function");
  assertEquals(typeof TypedStore, "function");
  assertEquals(typeof TypedStoreEntry, "function");
  assertEquals(typeof StoreError, "function");
  assertEquals(typeof TransferError, "function");
  assertEquals(typeof FileInfoSchema, "object");
  assertEquals(typeof HealthCheckResultSchema, "object");
  assertEquals(typeof HealthResponseSchema, "object");
  assertEquals(typeof HealthRpcSchema, "object");
  assertEquals(typeof ok, "function");
  assertEquals(typeof err, "function");
  assertEquals(typeof isOk, "function");
  assertEquals(typeof isErr, "function");
  assert(Result);
  assert(
    "schema" in schema<{ ok: true }>(Type.Object({ ok: Type.Literal(true) })),
  );

  const contract = defineServiceContract(
    {
      schemas: {
        Ping: Type.Object({ ok: Type.Literal(true) }),
      },
    },
    (ref) => ({
      id: "example.app@v1",
      displayName: "Example App",
      description: "Example app contract.",
      rpc: {
        "Example.Ping": {
          version: "v1",
          input: ref.schema("Ping"),
          output: ref.schema("Ping"),
        },
      },
    }),
  );

  assertEquals(contract.CONTRACT_ID, "example.app@v1");

  const ExampleNotFoundError = defineError({
    type: "ExampleNotFoundError",
    fields: {
      resource: Type.String(),
    },
    message: ({ resource }) => `${resource} not found`,
  });

  assertEquals(ExampleNotFoundError.type, "ExampleNotFoundError");
});

Deno.test("defineError creates a typed runtime class", () => {
  const ExampleWorkspaceMissingError = defineError({
    type: "ExampleWorkspaceMissingError",
    fields: {
      resource: Type.String(),
      resourceId: Type.String(),
    },
    message: ({ resource, resourceId }) => `${resource} ${resourceId} not found`,
  });

  const error = new ExampleWorkspaceMissingError({
    resource: "Workspace",
    resourceId: "ws_123",
    context: { source: "test" },
  });
  const serialized = error.toSerializable();
  const revived = ExampleWorkspaceMissingError.fromSerializable(serialized);

  assert(error instanceof TrellisError);
  assert(revived instanceof ExampleWorkspaceMissingError);
  assertEquals(ExampleWorkspaceMissingError.type, "ExampleWorkspaceMissingError");
  assertEquals(ExampleWorkspaceMissingError.schema.type, "object");
  assertEquals(serialized.type, "ExampleWorkspaceMissingError");
  assertEquals(serialized.resource, "Workspace");
  assertEquals(serialized.resourceId, "ws_123");
  assertEquals(revived.resource, "Workspace");
  assertEquals(revived.resourceId, "ws_123");
  assertEquals(revived.message, "Workspace ws_123 not found");
});

Deno.test("root public API stays browser-safe and excludes server runtime exports", () => {
  assert(!("TrellisServer" in trellis));
  assertEquals("runAllHealthChecks" in trellis, true);
  assertEquals("buildLoginUrl" in trellis, false);
  assertEquals("fetchPortalFlowState" in trellis, false);
  assertEquals("portalFlowIdFromUrl" in trellis, false);
  assertEquals("portalProviderLoginUrl" in trellis, false);
  assertEquals("portalRedirectLocation" in trellis, false);
  assertEquals("submitPortalApproval" in trellis, false);
});
