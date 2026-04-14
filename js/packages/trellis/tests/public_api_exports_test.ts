import { assert, assertEquals } from "@std/assert";
import { Type, type Static } from "typebox";

import {
  buildLoginUrl,
  defineError,
  DownloadTransferGrantSchema,
  defineContract,
  err,
  fetchPortalFlowState,
  isErr,
  isOk,
  ok,
  portalFlowIdFromUrl,
  portalProviderLoginUrl,
  portalRedirectLocation,
  Result,
  schema,
  StoreError,
  submitPortalApproval,
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

Deno.test("root public API includes core runtime, contracts, result, and common auth helpers", () => {
  assertEquals(typeof defineContract, "function");
  assertEquals(typeof defineError, "function");
  assertEquals(typeof schema, "function");
  assertEquals(typeof buildLoginUrl, "function");
  assertEquals(typeof portalFlowIdFromUrl, "function");
  assertEquals(typeof fetchPortalFlowState, "function");
  assertEquals(typeof portalProviderLoginUrl, "function");
  assertEquals(typeof submitPortalApproval, "function");
  assertEquals(typeof portalRedirectLocation, "function");
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
  assert("schema" in schema<{ ok: true }>(Type.Object({ ok: Type.Literal(true) })));

  const contract = defineContract({
    id: "example.app@v1",
    displayName: "Example App",
    description: "Example app contract.",
    kind: "app",
    schemas: {
      Ping: Type.Object({ ok: Type.Literal(true) }),
    },
    rpc: {
      "Example.Ping": {
        version: "v1",
        input: { schema: "Ping" },
        output: { schema: "Ping" },
      },
    },
  });

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
    }, { additionalProperties: false });
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
});
