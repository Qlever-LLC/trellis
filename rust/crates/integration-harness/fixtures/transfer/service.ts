import { defineServiceContract, ok } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as health } from "@qlever-llc/trellis/sdk/health";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";

type UploadInput = { key: string; contentType?: string };

function requireUploadInput(value: unknown, context: string): UploadInput {
  if (
    typeof value !== "object" || value === null || !("key" in value) ||
    typeof value.key !== "string"
  ) {
    throw new Error(
      `${context} did not receive upload input: ${JSON.stringify(value)}`,
    );
  }
  if (
    "contentType" in value && value.contentType !== undefined &&
    typeof value.contentType !== "string"
  ) {
    throw new Error(`${context} received invalid contentType`);
  }
  const contentType =
    "contentType" in value && typeof value.contentType === "string"
      ? value.contentType
      : undefined;
  return { key: value.key, contentType };
}

const schemas = {
  UploadInput: Type.Object({
    key: Type.String(),
    contentType: Type.Optional(Type.String()),
  }),
  UploadOutput: Type.Object({
    key: Type.String(),
    size: Type.Integer(),
    contentType: Type.Optional(Type.String()),
    traceparent: Type.Optional(Type.String()),
    chunkTraceparent: Type.Optional(Type.String()),
  }),
  DownloadInput: Type.Object({ key: Type.String() }),
  DownloadGrant: Type.Object({
    type: Type.Literal("TransferGrant"),
    direction: Type.Literal("receive"),
    service: Type.String(),
    sessionKey: Type.String(),
    transferId: Type.String(),
    subject: Type.String(),
    expiresAt: Type.String(),
    chunkBytes: Type.Integer(),
    info: Type.Object({
      key: Type.String(),
      size: Type.Integer(),
      updatedAt: Type.String(),
    }, { additionalProperties: true }),
  }, { additionalProperties: true }),
} as const;

const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.transfer@v1",
  displayName: "Trellis Integration Harness Transfer",
  description:
    "Harness-owned service contract for full-stack Rust/TypeScript transfer verification.",
  resources: {
    store: {
      uploads: {
        purpose: "Temporary transfer uploads",
        required: true,
        ttlMs: 0,
        maxObjectBytes: 1048576,
        maxTotalBytes: 4194304,
      },
    },
  },
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
      health: health.use({ events: { publish: ["Health.Heartbeat"] } }),
    },
  },
  operations: {
    "Harness.Rust.TransferUpload": {
      version: "v1",
      subject: "operations.v1.Harness.Rust.TransferUpload",
      input: ref.schema("UploadInput"),
      output: ref.schema("UploadOutput"),
      transfer: {
        direction: "send",
        store: "uploads",
        key: "/key",
        contentType: "/contentType",
        expiresInMs: 60000,
        maxBytes: 1024,
      },
      capabilities: { call: [], observe: [], cancel: [] },
      cancel: false,
    },
    "Harness.Ts.TransferUpload": {
      version: "v1",
      subject: "operations.v1.Harness.Ts.TransferUpload",
      input: ref.schema("UploadInput"),
      output: ref.schema("UploadOutput"),
      transfer: {
        direction: "send",
        store: "uploads",
        key: "/key",
        contentType: "/contentType",
        expiresInMs: 60000,
        maxBytes: 1024,
      },
      capabilities: { call: [], observe: [], cancel: [] },
      cancel: false,
    },
  },
  rpc: {
    "Harness.Rust.TransferDownload": {
      version: "v1",
      subject: "rpc.v1.Harness.Rust.TransferDownload",
      input: ref.schema("DownloadInput"),
      output: ref.schema("DownloadGrant"),
      transfer: { direction: "receive" },
      capabilities: { call: [] },
    },
    "Harness.Ts.TransferDownload": {
      version: "v1",
      subject: "rpc.v1.Harness.Ts.TransferDownload",
      input: ref.schema("DownloadInput"),
      output: ref.schema("DownloadGrant"),
      transfer: { direction: "receive" },
      capabilities: { call: [] },
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
  );
}

const service = await TrellisService.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  // @ts-expect-error Transfer RPC descriptors currently narrow less precisely than ServiceContract expects.
  contract,
  name: "harness-transfer-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: undefined },
}).orThrow();

await service.operation("Harness.Ts.TransferUpload").handle(async (context) => {
  const input = requireUploadInput(context.input, "Harness.Ts.TransferUpload");
  // @ts-expect-error Transfer-enabled operation context exposes transfer at runtime.
  const transfer = context.transfer;
  const op = context.op;
  if (input.key.includes("oversized")) {
    await op.started().orThrow();
    return ok({
      key: input.key,
      size: 0,
      ...(input.contentType ? { contentType: input.contentType } : {}),
    });
  }
  const transferred = await transfer.completed().orThrow();
  await op.started().orThrow();
  return ok({
    key: input.key,
    size: transferred.size,
    ...(input.contentType ? { contentType: input.contentType } : {}),
  });
});

await service.trellis.mount(
  "Harness.Ts.TransferDownload",
  async ({ input, context, trellis }) => {
    const typedInput = requireUploadInput(input, "Harness.Ts.TransferDownload");
    const payload = new TextEncoder().encode(`ts-download:${typedInput.key}`);
    const store = await trellis.store.uploads.open().orThrow();
    await store.put(typedInput.key, payload, { contentType: "text/plain" })
      .orThrow();
    const grant = await service.createTransfer({
      direction: "receive",
      store: "uploads",
      key: typedInput.key,
      sessionKey: context.sessionKey,
      expiresInMs: 60000,
    }).orThrow();
    return ok(grant);
  },
);

console.log("TS_TRANSFER_SERVICE_READY");
await new Promise<void>(() => {});
