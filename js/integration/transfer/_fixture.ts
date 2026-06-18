import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "../_support/names.ts";

export type ReceiveTransferGrant = {
  readonly type: "TransferGrant";
  readonly direction: "receive";
  readonly service: string;
  readonly sessionKey: string;
  readonly transferId: string;
  readonly subject: string;
  readonly expiresAt: string;
  readonly chunkBytes: number;
  readonly info: {
    readonly key: string;
    readonly size: number;
    readonly updatedAt: string;
    readonly digest?: string;
    readonly contentType?: string;
    readonly metadata: Record<string, string>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireReceiveTransferGrant(
  value: unknown,
): ReceiveTransferGrant {
  if (!isRecord(value) || !isRecord(value.info)) {
    throw new Error("expected receive transfer grant");
  }
  if (
    value.type !== "TransferGrant" || value.direction !== "receive" ||
    typeof value.service !== "string" || typeof value.sessionKey !== "string" ||
    typeof value.transferId !== "string" || typeof value.subject !== "string" ||
    typeof value.expiresAt !== "string" ||
    typeof value.chunkBytes !== "number" ||
    typeof value.info.key !== "string" || typeof value.info.size !== "number" ||
    typeof value.info.updatedAt !== "string" || !isRecord(value.info.metadata)
  ) {
    throw new Error("expected receive transfer grant fields");
  }
  const metadata: Record<string, string> = {};
  for (const [key, metadataValue] of Object.entries(value.info.metadata)) {
    if (typeof metadataValue !== "string") {
      throw new Error("expected receive transfer grant metadata values");
    }
    metadata[key] = metadataValue;
  }
  return {
    type: value.type,
    direction: value.direction,
    service: value.service,
    sessionKey: value.sessionKey,
    transferId: value.transferId,
    subject: value.subject,
    expiresAt: value.expiresAt,
    chunkBytes: value.chunkBytes,
    info: {
      key: value.info.key,
      size: value.info.size,
      updatedAt: value.info.updatedAt,
      digest: typeof value.info.digest === "string"
        ? value.info.digest
        : undefined,
      contentType: typeof value.info.contentType === "string"
        ? value.info.contentType
        : undefined,
      metadata,
    },
  };
}

export function createTransferFixture(caseId: string) {
  const slug = integrationSlug(caseId);
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

  const serviceContract = defineServiceContract(
    { schemas: transferSchemas },
    (ref) => ({
      id: caseScopedContractId("trellis.integration.transfer-service", caseId),
      displayName: `Trellis Integration Transfer Service (${slug})`,
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
          subject: caseScopedSubject(
            "operations.v1.Integration.Transfer",
            caseId,
            "Files.Upload",
          ),
          input: ref.schema("UploadInput"),
          output: ref.schema("UploadOutput"),
          errors: [ref.error("UnexpectedError")],
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
          subject: caseScopedSubject(
            "rpc.v1.Integration.Transfer",
            caseId,
            "Files.Download",
          ),
          input: ref.schema("DownloadInput"),
          output: ref.schema("DownloadGrant"),
          transfer: { direction: "receive" },
          capabilities: { call: [] },
          errors: [],
        },
      },
    }),
  );

  const clientContract = defineAppContract(() => ({
    id: caseScopedContractId("trellis.integration.transfer-client", caseId),
    displayName: `Trellis Integration Transfer Client (${slug})`,
    description: "App/client participant for the transfer integration fixture.",
    uses: {
      required: {
        transferService: serviceContract.use({
          operations: { call: ["Files.Upload"] },
          rpc: { call: ["Files.Download"] },
        }),
      },
    },
  }));

  const serviceName = caseScopedName("transfer-fixture-service", caseId);

  async function withTransferFixture(
    runtime: LiveTrellisRuntime,
    fn: (
      ctx: { runtime: LiveTrellisRuntime; service: TrellisService },
    ) => Promise<void>,
  ) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: serviceName,
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
  }

  return {
    slug,
    serviceContract,
    clientContract,
    serviceName,
    clientName: caseScopedName("transfer-fixture-client", caseId),
    clientAName: caseScopedName("transfer-fixture-client-A", caseId),
    clientBName: caseScopedName("transfer-fixture-client-B", caseId),
    uploadKey: caseScopedName("client-upload", caseId),
    downloadKey: caseScopedName("client-download", caseId),
    sessionBoundKey: caseScopedName("client-session-bound", caseId),
    withTransferFixture,
  };
}
