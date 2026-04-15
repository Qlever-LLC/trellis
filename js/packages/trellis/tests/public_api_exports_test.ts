import { assert, assertEquals } from "@std/assert";
import { type Static, Type } from "typebox";

import {
  defineAppContract,
  defineCliContract,
  defineDeviceContract,
  defineError,
  definePortalContract,
  defineServiceContract,
  DownloadTransferGrantSchema,
  err,
  isErr,
  isOk,
  ok,
  Result,
  schema,
  StoreError,
  TransferError,
  TransferGrantSchema,
  TrellisClient,
  TrellisDevice,
  TrellisError,
  TypedStore,
  TypedStoreEntry,
  UploadTransferGrantSchema,
} from "../index.ts";
import * as trellis from "../index.ts";

Deno.test("root public API includes core runtime, contracts, and result helpers", () => {
  assertEquals("defineContract" in trellis, false);
  assertEquals(typeof defineAppContract, "function");
  assertEquals(typeof definePortalContract, "function");
  assertEquals(typeof defineCliContract, "function");
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
  assertEquals(typeof TransferGrantSchema, "object");
  assertEquals(typeof UploadTransferGrantSchema, "object");
  assertEquals(typeof DownloadTransferGrantSchema, "object");
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

  class ExampleNotFoundError extends TrellisError<{
    id: string;
    type: "ExampleNotFoundError";
    message: string;
    resource: string;
    context?: Record<string, unknown>;
    traceId?: string;
  }> {
    static readonly schema = Type.Object({
      id: Type.String(),
      type: Type.Literal("ExampleNotFoundError"),
      message: Type.String(),
      resource: Type.String(),
      context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      traceId: Type.Optional(Type.String()),
    });
    override readonly name = "ExampleNotFoundError" as const;

    static fromSerializable(data: Static<typeof ExampleNotFoundError.schema>) {
      return new ExampleNotFoundError(data.resource, {
        id: data.id,
        context: data.context,
      });
    }

    readonly resource: string;

    constructor(
      resource: string,
      options?: ErrorOptions & {
        context?: Record<string, unknown>;
        id?: string;
      },
    ) {
      super(`${resource} not found`, options);
      this.resource = resource;
    }

    override toSerializable() {
      return {
        ...this.baseSerializable(),
        type: this.name,
        resource: this.resource,
      } as const;
    }
  }

  const localError = defineError(ExampleNotFoundError);

  assertEquals(localError.type, "ExampleNotFoundError");
});

Deno.test("root public API stays browser-safe and excludes server runtime exports", () => {
  assert(!("TrellisServer" in trellis));
  assertEquals("buildLoginUrl" in trellis, false);
  assertEquals("fetchPortalFlowState" in trellis, false);
  assertEquals("portalFlowIdFromUrl" in trellis, false);
  assertEquals("portalProviderLoginUrl" in trellis, false);
  assertEquals("portalRedirectLocation" in trellis, false);
  assertEquals("submitPortalApproval" in trellis, false);
});
