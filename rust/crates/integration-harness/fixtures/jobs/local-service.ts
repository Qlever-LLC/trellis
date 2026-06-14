import { defineServiceContract } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as health } from "@qlever-llc/trellis/sdk/health";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";

const schemas = {
  JobPayload: Type.Object({ documentId: Type.String() }),
  JobResult: Type.Object({
    documentId: Type.String(),
    processedBy: Type.String(),
    requestId: Type.Optional(Type.String()),
    traceId: Type.Optional(Type.String()),
    traceparent: Type.Optional(Type.String()),
  }),
} as const;

const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.jobs-local@v1",
  displayName: "Trellis Integration Harness Service-Local Jobs",
  description:
    "Harness-owned service contract for full-stack service-local Jobs verification.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
      health: health.use({ events: { publish: ["Health.Heartbeat"] } }),
    },
  },
  jobs: {
    rustProcess: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
    },
    rustConcurrency: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
      concurrency: 2,
    },
    rustKeyedConcurrency: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
      concurrency: 2,
      ackWaitMs: 5000,
      keyConcurrency: {
        key: ["/documentId"],
        maxActive: 1,
        heartbeatIntervalMs: 30000,
        heartbeatTtlMs: 60000,
        stalePolicy: "fail-stale",
      },
      queue: { maxQueuedPerKey: 2, whenFull: "reject" },
    },
    rustKeyedReject: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
      concurrency: 1,
      keyConcurrency: {
        key: ["/documentId"],
        maxActive: 1,
        heartbeatIntervalMs: 30000,
        heartbeatTtlMs: 60000,
        stalePolicy: "fail-stale",
      },
      queue: { maxQueuedPerKey: 0, whenFull: "reject" },
    },
    rustKeyedCoalesce: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
      concurrency: 1,
      keyConcurrency: {
        key: ["/documentId"],
        maxActive: 1,
        heartbeatIntervalMs: 30000,
        heartbeatTtlMs: 60000,
        stalePolicy: "fail-stale",
      },
      queue: { maxQueuedPerKey: 0, whenFull: "coalesce" },
    },
    rustKeyedReplace: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
      concurrency: 1,
      keyConcurrency: {
        key: ["/documentId"],
        maxActive: 1,
        heartbeatIntervalMs: 30000,
        heartbeatTtlMs: 60000,
        stalePolicy: "fail-stale",
      },
      queue: { maxQueuedPerKey: 1, whenFull: "replace-oldest" },
    },
    rustKeyedStale: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
      concurrency: 1,
      ackWaitMs: 5000,
      keyConcurrency: {
        key: ["/documentId"],
        maxActive: 1,
        heartbeatIntervalMs: 30000,
        heartbeatTtlMs: 60000,
        stalePolicy: "fail-stale",
      },
      queue: { maxQueuedPerKey: 2, whenFull: "reject" },
    },
    rustNaturalDead: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
      maxDeliver: 2,
      backoffMs: [100],
      ackWaitMs: 100,
    },
    rustShutdown: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
      maxDeliver: 5,
      backoffMs: [100],
      ackWaitMs: 100,
    },
    tsProcess: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
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
  contract,
  name: "harness-local-jobs-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: undefined },
}).orThrow();

service.jobs.tsProcess.handle(async ({ job }) => {
  const contextResult = {
    requestId: job.context.requestId,
    traceId: job.context.traceId,
    traceparent: job.context.traceparent,
  };
  if (job.payload.documentId === "ts-active-cancel") {
    await job.progress({
      step: "process",
      current: 0,
      total: 1,
      message: "ts cancel waiting",
    }).orThrow();
    while (!job.cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return Result.ok({
      documentId: job.payload.documentId,
      processedBy: "ts-cancelled",
      ...contextResult,
    });
  }
  await job.progress({
    step: "process",
    current: 1,
    total: 1,
    message: "ts processing",
  }).orThrow();
  await job.log({
    timestamp: new Date().toISOString(),
    level: "info",
    message: "ts processed",
  }).orThrow();
  return Result.ok({
    documentId: job.payload.documentId,
    processedBy: "ts",
    ...contextResult,
  });
});

async function waitForState(
  ref: { id: string; get(): { orThrow(): Promise<{ state: string }> } },
  state: string,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await ref.get().orThrow();
    if (snapshot.state === state) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `timed out waiting for TS local job ${ref.id} to reach ${state}`,
  );
}

void service.wait().catch((error) => {
  console.error(error);
  Deno.exit(1);
});

console.log("TS_LOCAL_JOBS_SERVICE_READY");
await new Promise((resolve) => setTimeout(resolve, 500));

const ref = await service.jobs.tsProcess.create({
  documentId: "ts-service-local",
}).orThrow();
const terminal = await ref.wait().orThrow();
if (terminal.state !== "completed") {
  throw new Error(
    `expected TS service-local job to complete, got ${terminal.state}`,
  );
}
if (
  terminal.result?.processedBy !== "ts" ||
  terminal.result?.documentId !== "ts-service-local"
) {
  throw new Error(
    `unexpected TS service-local result ${JSON.stringify(terminal.result)}`,
  );
}
console.log(`TS_LOCAL_JOBS_COMPLETED ${ref.id}`);

const rustRef = await service.jobs.rustProcess.create({
  documentId: "ts-created-rust-worker",
}).orThrow();
console.log(`TS_CREATED_RUST_JOBS_CREATED ${rustRef.id}`);
const rustTerminal = await rustRef.wait().orThrow();
if (rustTerminal.state !== "completed") {
  throw new Error(
    `expected TS-created Rust job to complete, got ${rustTerminal.state}`,
  );
}
if (
  rustTerminal.result?.processedBy !== "rust-cross" ||
  rustTerminal.result?.documentId !== "ts-created-rust-worker"
) {
  throw new Error(
    `unexpected TS-created Rust result ${JSON.stringify(rustTerminal.result)}`,
  );
}
if (
  rustTerminal.result?.requestId !== rustTerminal.context.requestId ||
  rustTerminal.result?.traceId !== rustTerminal.context.traceId ||
  rustTerminal.result?.traceparent !== rustTerminal.context.traceparent
) {
  throw new Error(
    `TS-created Rust job context was not echoed by Rust handler: ${
      JSON.stringify(rustTerminal)
    }`,
  );
}
console.log(`TS_CREATED_RUST_JOBS_COMPLETED ${rustRef.id}`);

const typedSubmitOutcome = await service.jobs.rustKeyedReject.submit({
  documentId: "ts-keyed-submit-typing",
}).orThrow();
if (typedSubmitOutcome.kind !== "accepted") {
  throw new Error(
    `expected TS typed keyed submit to accept, got ${typedSubmitOutcome.kind}`,
  );
}
console.log(`TS_KEYED_SUBMIT_TYPED ${typedSubmitOutcome.ref.id}`);

const cancelRef = await service.jobs.tsProcess.create({
  documentId: "ts-active-cancel",
}).orThrow();
await waitForState(cancelRef, "active");
const cancelled = await cancelRef.cancel().orThrow();
if (cancelled.state !== "cancelled") {
  throw new Error(
    `expected TS service-local cancel to return cancelled, got ${cancelled.state}`,
  );
}
console.log(`TS_LOCAL_JOBS_CANCELLED ${cancelRef.id}`);

await new Promise<void>(() => {});
