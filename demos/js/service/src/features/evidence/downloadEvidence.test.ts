import { assertEquals, assertExists } from "@std/assert";
import {
  AsyncResult,
  isErr,
  type ReceiveTransferGrant,
  Result,
  StoreError,
  TransferError,
} from "@qlever-llc/trellis";
import { downloadEvidence } from "./downloadEvidence.ts";

const rpcContext = {
  caller: {
    type: "service" as const,
    id: "caller-service",
    name: "Caller Service",
    active: true,
    capabilities: [],
  },
  sessionKey: "session-key",
};

function grantFor(key: string): ReceiveTransferGrant {
  return {
    type: "TransferGrant",
    direction: "receive",
    service: "field-ops-demo-service",
    sessionKey: "session-key",
    transferId: "transfer-id",
    subject: "trellis.transfer.download.service.transfer-id",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    chunkBytes: 64 * 1024,
    info: {
      key,
      size: 42,
      updatedAt: new Date().toISOString(),
      metadata: {},
    },
  };
}

Deno.test("downloadEvidence adds root-cause context for missing evidence keys", async () => {
  const handler = downloadEvidence({
    createTransfer: () =>
      AsyncResult.err(
        new TransferError({
          operation: "initiateDownload",
          cause: new StoreError({
            operation: "get",
            context: { key: "evidence/missing.jpg", reason: "not_found" },
          }),
        }),
      ),
    store: {
      uploads: {
        binding: { ttlMs: 0 },
        waitFor: () =>
          AsyncResult.err(
            new StoreError({
              operation: "waitFor",
              context: {
                key: "evidence/missing.jpg",
                reason: "timeout",
                timeoutMs: 500,
              },
            }),
          ),
      },
    },
  });

  const result = await handler({
    input: { key: "evidence/missing.jpg" },
    context: rpcContext,
  });

  const value = result.take();
  assertEquals(isErr(value), true);
  if (!isErr(value)) return;

  const errorContext = value.error.getContext();
  assertEquals(errorContext.diagnosis, "missing_key");
  assertEquals(errorContext.requestedKey, "evidence/missing.jpg");
  assertEquals(errorContext.storeTtlMs, 0);
  assertEquals(errorContext.transferCauseReason, "not_found");
  assertEquals(errorContext.visibilityCheck, "not_visible_after_wait");
});

Deno.test("downloadEvidence retries when a key appears after the first miss", async () => {
  let createAttempts = 0;
  const handler = downloadEvidence({
    createTransfer: ({ key }) => {
      createAttempts += 1;
      if (createAttempts === 1) {
        return AsyncResult.err(
          new TransferError({
            operation: "initiateDownload",
            cause: new StoreError({
              operation: "get",
              context: { key, reason: "not_found" },
            }),
          }),
        );
      }
      return AsyncResult.from(Promise.resolve(Result.ok(grantFor(key))));
    },
    store: {
      uploads: {
        binding: { ttlMs: 0 },
        waitFor: () => AsyncResult.from(Promise.resolve(Result.ok({}))),
      },
    },
  });

  const result = await handler({
    input: { key: "evidence/racy.jpg" },
    context: rpcContext,
  });

  const value = result.take();
  assertEquals(isErr(value), false);
  if (isErr(value)) return;

  assertExists(value.transfer);
  assertEquals(value.transfer.info.key, "evidence/racy.jpg");
  assertEquals(createAttempts, 2);
});
