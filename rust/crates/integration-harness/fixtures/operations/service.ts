import { AsyncResult, defineServiceContract, ok } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as health } from "@qlever-llc/trellis/sdk/health";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";

const schemas = {
  OperationInput: Type.Object({
    message: Type.String(),
    mode: Type.Optional(Type.String()),
  }),
  OperationProgress: Type.Object({
    message: Type.String(),
    mode: Type.Optional(Type.String()),
  }),
  OperationOutput: Type.Object({
    message: Type.String(),
    mode: Type.Optional(Type.String()),
  }),
  TraceContextResponse: Type.Object({
    provider: Type.String(),
    traceId: Type.String(),
    traceparent: Type.String(),
  }),
  SelectWorkspaceSignal: Type.Object({ workspaceId: Type.String() }),
  ContinueSignal: Type.Object({ confirmed: Type.Boolean() }),
} as const;

const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.operations@v1",
  displayName: "Trellis Integration Harness Operations",
  description:
    "Harness-owned service contract for full-stack Rust/TypeScript operations verification.",
  capabilities: {
    "operation.call": {
      displayName: "Call capability-gated operation",
      description: "Call capability-gated operation",
    },
    "operation.read": {
      displayName: "Read capability-gated operation",
      description: "Read capability-gated operation",
    },
    "operation.cancel": {
      displayName: "Cancel capability-gated operation",
      description: "Cancel capability-gated operation",
    },
  },
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
      health: health.use({ events: { publish: ["Health.Heartbeat"] } }),
    },
  },
  operations: {
    "Harness.Rust.Operation": {
      version: "v1",
      subject: "operations.v1.Harness.Rust.Operation",
      input: ref.schema("OperationInput"),
      progress: ref.schema("OperationProgress"),
      output: ref.schema("OperationOutput"),
      capabilities: { call: [], observe: [], cancel: [] },
      signals: {
        selectWorkspace: { input: ref.schema("SelectWorkspaceSignal") },
        continue: { input: ref.schema("ContinueSignal") },
      },
      cancel: true,
    },
    "Harness.Ts.Operation": {
      version: "v1",
      subject: "operations.v1.Harness.Ts.Operation",
      input: ref.schema("OperationInput"),
      progress: ref.schema("OperationProgress"),
      output: ref.schema("OperationOutput"),
      capabilities: { call: [], observe: [], cancel: [] },
      signals: {
        selectWorkspace: { input: ref.schema("SelectWorkspaceSignal") },
        continue: { input: ref.schema("ContinueSignal") },
      },
      cancel: true,
    },
    "Harness.Rust.Status": {
      version: "v1",
      subject: "operations.v1.Harness.Rust.Status",
      input: ref.schema("OperationInput"),
      progress: ref.schema("OperationProgress"),
      output: ref.schema("OperationOutput"),
      capabilities: { call: [], observe: [], cancel: [] },
      cancel: false,
    },
    "Harness.Ts.Status": {
      version: "v1",
      subject: "operations.v1.Harness.Ts.Status",
      input: ref.schema("OperationInput"),
      progress: ref.schema("OperationProgress"),
      output: ref.schema("OperationOutput"),
      capabilities: { call: [], observe: [], cancel: [] },
      cancel: false,
    },
    "Harness.Rust.Capability": {
      version: "v1",
      subject: "operations.v1.Harness.Rust.Capability",
      input: ref.schema("OperationInput"),
      progress: ref.schema("OperationProgress"),
      output: ref.schema("OperationOutput"),
      capabilities: {
        call: ["operation.call"],
        observe: ["operation.read"],
        cancel: ["operation.cancel"],
      },
      cancel: true,
    },
    "Harness.Rust.TraceOperation": {
      version: "v1",
      subject: "operations.v1.Harness.Rust.TraceOperation",
      input: ref.schema("OperationInput"),
      progress: ref.schema("TraceContextResponse"),
      output: ref.schema("TraceContextResponse"),
      capabilities: { call: [], observe: [], cancel: [] },
      cancel: false,
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
  name: "harness-operations-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: undefined },
}).orThrow();

await service.operation("Harness.Ts.Operation").handle(
  async ({ input, op }) => {
    await op.started().orThrow();
    if (input.mode === "durable-running") {
      return op.defer();
    }
    if (input.mode === "signal") {
      const seen: string[] = [];
      for await (const signal of op.signals()) {
        seen.push(signal.signal);
        if (signal.signal === "selectWorkspace") {
          const payload = signal.input as { workspaceId?: string };
          if (payload.workspaceId !== input.message) {
            throw new Error(
              `selectWorkspace returned ${JSON.stringify(signal.input)}`,
            );
          }
          await op.progress({ message: "workspace selected", mode: input.mode })
            .orThrow();
        }
        if (signal.signal === "continue") {
          const payload = signal.input as { confirmed?: boolean };
          if (payload.confirmed !== true) {
            throw new Error(
              `continue returned ${JSON.stringify(signal.input)}`,
            );
          }
          if (seen.join(",") !== "selectWorkspace,continue") {
            throw new Error(`signals arrived out of order: ${seen.join(",")}`);
          }
          await op.complete({ message: input.message, mode: input.mode })
            .orThrow();
          return ok({ message: input.message, mode: input.mode });
        }
      }
      throw new Error("signal stream ended before continue");
    }
    if (input.mode === "watch") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await op.progress({ message: input.message, mode: input.mode }).orThrow();
    if (input.mode === "attach") {
      return await op.attach({
        wait: () =>
          AsyncResult.from((async () => {
            await op.nextSignal("continue").orThrow();
            await op.complete({ message: input.message, mode: input.mode })
              .orThrow();
            return ok(undefined);
          })()),
      });
    }
    if (input.mode === "cancel") {
      return op.defer();
    }
    if (input.mode === "deferred") {
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const controlled = await service.operation("Harness.Ts.Operation")
          .control(op.id).orThrow();
        await controlled.complete({ message: input.message, mode: input.mode })
          .orThrow();
      })();
      return op.defer();
    }
    if (input.mode === "watch") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return ok({ message: input.message, mode: input.mode });
  },
);

await service.operation("Harness.Ts.Status").handle(async ({ input, op }) => {
  await op.started().orThrow();
  await op.progress({ message: input.message, mode: input.mode }).orThrow();
  if (input.mode === "status") {
    return op.defer();
  }
  return ok({ message: input.message, mode: input.mode });
});

async function assertProviderInvalidControl() {
  const accepted = await service.operation("Harness.Ts.Operation").accept({
    sessionKey: service.auth.sessionKey,
  }).orThrow();
  const missing = await service.operation("Harness.Ts.Operation").control(
    "missing-ts-provider-operation",
  ).take();
  // @ts-expect-error Invalid-control tests intentionally assert Result shape for rejected controls.
  if (missing.isOk()) {
    throw new Error("TS provider accepted missing operation control");
  }
  const wrongOperation = await service.operation("Harness.Ts.Status").control(
    accepted.id,
  ).take();
  // @ts-expect-error Invalid-control tests intentionally assert Result shape for rejected controls.
  if (wrongOperation.isOk()) {
    throw new Error("TS provider accepted wrong operation control");
  }

  const status = await service.operation("Harness.Ts.Status").accept({
    sessionKey: service.auth.sessionKey,
  }).orThrow();
  const statusCancel = await status.cancel().take();
  // @ts-expect-error Invalid-control tests intentionally assert Result shape for rejected controls.
  if (statusCancel.isOk()) {
    throw new Error("TS provider accepted non-cancelable cancel");
  }

  const controlled = await service.operation("Harness.Ts.Operation").control(
    accepted.id,
  ).orThrow();
  const invalidProgress = await controlled.progress({ message: 123 }).take();
  // @ts-expect-error Invalid-control tests intentionally assert Result shape for rejected controls.
  if (invalidProgress.isOk()) {
    throw new Error("TS provider accepted invalid progress payload");
  }
  const invalidOutput = await controlled.complete({ message: 123 }).take();
  // @ts-expect-error Invalid-control tests intentionally assert Result shape for rejected controls.
  if (invalidOutput.isOk()) {
    throw new Error("TS provider accepted invalid output payload");
  }
  await controlled.complete({ message: "ts-provider-terminal" }).orThrow();
  const terminalUpdate = await controlled.progress({ message: "too late" })
    .take();
  // @ts-expect-error Invalid-control tests intentionally assert Result shape for rejected controls.
  if (terminalUpdate.isOk()) {
    throw new Error("TS provider accepted terminal update");
  }
}

await assertProviderInvalidControl();

const durableAction = Deno.env.get("HARNESS_TS_SERVICE_DURABLE_ACTION");
if (durableAction === "start") {
  const accepted = await service.operation("Harness.Ts.Operation").accept({
    sessionKey: Deno.env.get("HARNESS_TS_SERVICE_DURABLE_SESSION_KEY") ??
      service.auth.sessionKey,
  }).orThrow();
  await accepted.started().orThrow();
  console.log(`TS_OPERATIONS_DURABLE_REF:${JSON.stringify(accepted.ref)}`);
} else if (durableAction === "complete") {
  const operationId = Deno.env.get("HARNESS_TS_SERVICE_DURABLE_ID")!;
  const message = Deno.env.get("HARNESS_TS_SERVICE_DURABLE_MESSAGE")!;
  const controlled = await service.operation("Harness.Ts.Operation").control(
    operationId,
  ).orThrow();
  void (async () => {
    await controlled.nextSignal("continue").orThrow();
    await controlled.complete({ message, mode: "durable-running" }).orThrow();
  })();
} else if (durableAction) {
  throw new Error(`unknown TS service durable action '${durableAction}'`);
}
console.log("TS_OPERATIONS_SERVICE_READY");

await new Promise<void>(() => {});
