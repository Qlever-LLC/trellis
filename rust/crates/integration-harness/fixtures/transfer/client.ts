import {
  defineAgentContract,
  defineServiceContract,
  TrellisClient,
} from "@qlever-llc/trellis";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as health } from "@qlever-llc/trellis/sdk/health";
import { trace } from "@qlever-llc/trellis/tracing";
import { Type } from "typebox";

type UploadOutput = {
  size: number;
  traceparent?: string;
  chunkTraceparent?: string;
};

function requireUploadOutput(value: unknown, context: string): UploadOutput {
  if (
    typeof value !== "object" || value === null || !("size" in value) ||
    typeof value.size !== "number"
  ) {
    throw new Error(
      `${context} did not return upload output: ${JSON.stringify(value)}`,
    );
  }
  const output = value as UploadOutput;
  if (
    output.traceparent !== undefined && typeof output.traceparent !== "string"
  ) {
    throw new Error(`${context} returned non-string traceparent`);
  }
  if (
    output.chunkTraceparent !== undefined &&
    typeof output.chunkTraceparent !== "string"
  ) {
    throw new Error(`${context} returned non-string chunkTraceparent`);
  }
  return output;
}

new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
}).register();

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

const harness = defineServiceContract({ schemas }, (ref) => ({
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

const contract = defineAgentContract(() => ({
  id: "trellis.integration-transfer-agent@v1",
  displayName: "Trellis Integration Transfer Agent",
  description: "Verify delegated Rust agent login and harness transfer calls.",
  uses: {
    required: {
      auth: auth.use({
        rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
      }),
      harness: harness.use({
        operations: {
          call: ["Harness.Rust.TransferUpload", "Harness.Ts.TransferUpload"],
        },
        rpc: {
          call: [
            "Harness.Rust.TransferDownload",
            "Harness.Ts.TransferDownload",
          ],
        },
      }),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
  );
}

const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  // @ts-expect-error Transfer RPC descriptors currently narrow less precisely than ClientContract expects.
  contract,
  auth: {
    mode: "session_key",
    sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!,
    redirectTo: "/_trellis/portal/users/login",
  },
  log: undefined,
}).orThrow();

type ClientTransferGrant = Parameters<typeof client.transfer>[0];
type ReceiveTransferGrant = Extract<
  ClientTransferGrant,
  { direction: "receive" }
>;

function uploadFacade(
  method: "Harness.Rust.TransferUpload" | "Harness.Ts.TransferUpload",
) {
  return method === "Harness.Rust.TransferUpload"
    ? client.operation.harness.rustTransferUpload
    : client.operation.harness.tsTransferUpload;
}

async function assertUpload(
  method: "Harness.Rust.TransferUpload" | "Harness.Ts.TransferUpload",
  key: string,
  text: string,
) {
  const upload = await uploadFacade(method).input({
    key,
    contentType: "text/plain",
  }).transfer(new TextEncoder().encode(text)).start().orThrow();
  const terminal = await upload.wait().orThrow();
  const output = requireUploadOutput(terminal.terminal.output, method);
  if (
    terminal.terminal.state !== "completed" || output.size !== text.length ||
    terminal.transferred.size !== text.length
  ) {
    throw new Error(`${method} returned ${JSON.stringify(terminal)}`);
  }
  if (
    output.traceparent !== undefined || output.chunkTraceparent !== undefined
  ) {
    throw new Error(
      `${method} unexpectedly returned traceparent ${output.traceparent}`,
    );
  }
}

async function assertTracedRustTransferUpload() {
  let expectedTraceId = "";
  await trace.getTracer("trellis-integration-transfer").startActiveSpan(
    "upload traced rust transfer",
    async (span) => {
      expectedTraceId = span.spanContext().traceId;
      try {
        const text = "ts to rust traced upload";
        const upload = await client.operation.harness.rustTransferUpload
          .input({
            key: "ts-client/rust-transfer-trace.txt",
            contentType: "text/plain",
          }).transfer(new TextEncoder().encode(text)).start().orThrow();
        const terminal = await upload.wait().orThrow();
        const output = requireUploadOutput(
          terminal.terminal.output,
          "Harness.Rust.TransferUpload",
        );
        if (
          terminal.terminal.state !== "completed" ||
          output.size !== text.length ||
          terminal.transferred.size !== text.length
        ) {
          throw new Error(
            `Harness.Rust.TransferUpload traced transfer returned ${
              JSON.stringify(terminal)
            }`,
          );
        }
        if (
          output.traceparent === undefined ||
          !output.traceparent.includes(expectedTraceId)
        ) {
          throw new Error(
            `Harness.Rust.TransferUpload traceparent ${output.traceparent} did not include ${expectedTraceId}`,
          );
        }
        if (
          output.chunkTraceparent === undefined ||
          !output.chunkTraceparent.includes(expectedTraceId)
        ) {
          throw new Error(
            `Harness.Rust.TransferUpload chunk traceparent ${output.chunkTraceparent} did not include ${expectedTraceId}`,
          );
        }
      } finally {
        span.end();
      }
    },
  );
}

async function assertOversizedUpload(
  method: "Harness.Rust.TransferUpload" | "Harness.Ts.TransferUpload",
  key: string,
) {
  const oversized = new Uint8Array(1025);
  const result = await uploadFacade(method).input({
    key,
    contentType: "application/octet-stream",
  }).transfer(oversized).start();
  if (result.isErr()) {
    return;
  }
  const upload = await result.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const waited = await upload.wait();
  if (!waited.isErr()) {
    throw new Error(`${method} unexpectedly completed oversized upload`);
  }
}

async function assertDownload(
  method: "Harness.Rust.TransferDownload" | "Harness.Ts.TransferDownload",
  key: string,
  expected: string,
) {
  const grant =
    await (method === "Harness.Rust.TransferDownload"
      ? client.rpc.harness.rustTransferDownload({ key })
      : client.rpc.harness.tsTransferDownload({ key }))
      .orThrow() as ReceiveTransferGrant;
  const bytes = await client.transfer(grant).bytes().orThrow();
  const text = new TextDecoder().decode(bytes);
  if (text !== expected) throw new Error(`${method} returned ${text}`);
}

await assertUpload(
  "Harness.Rust.TransferUpload",
  "ts-client/rust-upload.txt",
  "ts to rust upload",
);
await assertUpload(
  "Harness.Ts.TransferUpload",
  "ts-client/ts-upload.txt",
  "ts to ts upload",
);
await assertTracedRustTransferUpload();
await assertOversizedUpload(
  "Harness.Rust.TransferUpload",
  "ts-client/rust-oversized.bin",
);
await assertOversizedUpload(
  "Harness.Ts.TransferUpload",
  "ts-client/ts-oversized.bin",
);
await assertDownload(
  "Harness.Rust.TransferDownload",
  "ts-client/rust-download.txt",
  "rust-download:ts-client/rust-download.txt",
);
await assertDownload(
  "Harness.Ts.TransferDownload",
  "ts-client/ts-download.txt",
  "ts-download:ts-client/ts-download.txt",
);
await client.connection.close();
console.log("TS_TRANSFER_CLIENT_OK");
