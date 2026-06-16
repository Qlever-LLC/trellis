import { assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";
import type { TrellisTestRuntime } from "@qlever-llc/trellis-test";

const transferSchemas = {
  UploadInput: Type.Object({
    key: Type.String(),
    contentType: Type.Optional(Type.String()),
  }),
  UploadOutput: Type.Object({
    key: Type.String(),
    size: Type.Integer(),
    contentType: Type.Optional(Type.String()),
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
      digest: Type.Optional(Type.String()),
      contentType: Type.Optional(Type.String()),
      metadata: Type.Record(Type.String(), Type.String()),
    }),
  }),
} as const;

const transferServiceContract = defineServiceContract(
  { schemas: transferSchemas },
  (ref) => ({
    id: "trellis.integration.transfer-service@v1",
    displayName: "Trellis Integration Transfer Service",
    description: "Exercises generated operation and RPC transfer surfaces.",
    resources: {
      store: {
        uploads: {
          purpose: "Temporary integration transfer files",
          required: true,
          ttlMs: 0,
          maxObjectBytes: 1048576,
          maxTotalBytes: 4194304,
        },
      },
    },
    operations: {
      "Files.Upload": {
        version: "v1",
        subject: "operations.v1.Files.Upload",
        input: ref.schema("UploadInput"),
        output: ref.schema("UploadOutput"),
        transfer: {
          direction: "send",
          store: "uploads",
          key: "/key",
          contentType: "/contentType",
          expiresInMs: 60000,
          maxBytes: 1048576,
        },
        capabilities: { call: [], observe: [], cancel: [] },
        cancel: false,
      },
    },
    rpc: {
      "Files.Download": {
        version: "v1",
        subject: "rpc.v1.Files.Download",
        input: ref.schema("DownloadInput"),
        output: ref.schema("DownloadGrant"),
        transfer: { direction: "receive" },
        capabilities: { call: [] },
        errors: [],
      },
    },
  }),
);

const transferClientContract = defineAppContract(() => ({
  id: "trellis.integration.transfer-client@v1",
  displayName: "Trellis Integration Transfer Client",
  description: "App/client participant for the transfer integration fixture.",
  uses: {
    required: {
      transferService: transferServiceContract.use({
        operations: { call: ["Files.Upload"] },
        rpc: { call: ["Files.Download"] },
      }),
    },
  },
}));

async function withTransferFixture(
  fn: (
    ctx: { runtime: TrellisTestRuntime; service: TrellisService },
  ) => Promise<void>,
) {
  await withTrellisRuntime(async (runtime) => {
    const serviceKey = await runtime.registerService({
      name: "transfer-fixture-service",
      contract: transferServiceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: transferServiceContract,
      name: "transfer-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

    try {
      await service.handle.operation.files.upload(
        async ({ input, op, transfer }) => {
          const transferred = await transfer.completed().orThrow();
          await op.started().orThrow();
          return Result.ok({
            key: input.key,
            size: transferred.size,
            ...(input.contentType ? { contentType: input.contentType } : {}),
          });
        },
      );

      await service.handle.rpc.files.download(
        async ({ input, context, client }) => {
          const payload = new TextEncoder().encode(`download:${input.key}`);
          const store = await client.store.uploads.open().orThrow();
          await store.put(input.key, payload, { contentType: "text/plain" })
            .orThrow();
          const grant = await service.createTransfer({
            direction: "receive",
            store: "uploads",
            key: input.key,
            sessionKey: context.sessionKey,
            expiresInMs: 60000,
          }).orThrow();
          return Result.ok(grant);
        },
      );

      await fn({ runtime, service });
    } finally {
      await service.stop();
    }
  });
}

Deno.test(
  "transfer.client-uploads-file-via-operation uploads bytes through a transfer operation",
  async () => {
    await withTransferFixture(async ({ runtime }) => {
      const client = await runtime.connectClient({
        name: "transfer-fixture-client",
        contract: transferClientContract,
      });

      const uploadBytes = new TextEncoder().encode("uploaded through transfer");
      const upload = await client.operation.files.upload.input({
        key: "client/upload.txt",
        contentType: "text/plain",
      }).transfer(uploadBytes).start().orThrow();
      const completed = await upload.wait().orThrow();

      assertEquals(completed.transferred.size, uploadBytes.length);
      assertEquals(completed.transferred.key, "client/upload.txt");
      assertEquals(completed.transferred.contentType, "text/plain");
      assertEquals(completed.terminal.state, "completed");
      assertEquals(completed.terminal.output, {
        key: "client/upload.txt",
        size: uploadBytes.length,
        contentType: "text/plain",
      });
    });
  },
);

Deno.test(
  "transfer.client-downloads-file-via-receive-grant downloads bytes through a receive grant",
  async () => {
    await withTransferFixture(async ({ runtime }) => {
      const client = await runtime.connectClient({
        name: "transfer-fixture-client",
        contract: transferClientContract,
      });

      const downloadKey = "client/download.txt";
      const grant = await client.rpc.files.download({ key: downloadKey })
        .orThrow();
      assertEquals(grant.direction, "receive");
      assertEquals(grant.info.key, downloadKey);
      assertEquals(grant.info.contentType, "text/plain");

      const downloaded = await client.transfer(grant).bytes().orThrow();
      assertEquals(
        new TextDecoder().decode(downloaded),
        `download:${downloadKey}`,
      );
    });
  },
);

Deno.test(
  "transfer.download-grant-is-session-bound rejects cross-session grant usage",
  async () => {
    await withTransferFixture(async ({ runtime }) => {
      const clientA = await runtime.connectClient({
        name: "transfer-fixture-client-A",
        contract: transferClientContract,
      });

      const downloadKey = "client/session-bound.txt";
      const grant = await clientA.rpc.files.download({ key: downloadKey })
        .orThrow();

      const clientB = await runtime.connectClient({
        name: "transfer-fixture-client-B",
        contract: transferClientContract,
      });

      const result = await clientB.transfer(grant).bytes();
      assertEquals(result.isOk(), false);
    });
  },
);
