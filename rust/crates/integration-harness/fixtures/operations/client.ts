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
import { getTracer, withSpanAsync } from "@qlever-llc/trellis/tracing";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as health } from "@qlever-llc/trellis/sdk/health";
import { Type } from "typebox";

new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
}).register();

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

const harness = defineServiceContract({ schemas }, (ref) => ({
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

const contract = defineAgentContract(() => ({
  id: "trellis.integration-operations-agent@v1",
  displayName: "Trellis Integration Agent",
  description: "Verify delegated Rust agent login and harness operation calls.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Sessions.Me"] } }),
      harness: harness.use({
        operations: {
          call: [
            "Harness.Rust.Operation",
            "Harness.Ts.Operation",
            "Harness.Rust.Status",
            "Harness.Ts.Status",
            "Harness.Rust.Capability",
            "Harness.Rust.TraceOperation",
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
  contract,
  auth: {
    mode: "session_key",
    sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!,
    redirectTo: "/_trellis/portal/users/login",
  },
  log: undefined,
}).orThrow();

type OperationName = "Harness.Rust.Operation" | "Harness.Ts.Operation";
type StatusOperationName = "Harness.Rust.Status" | "Harness.Ts.Status";
type TraceContextResponse = {
  provider: string;
  traceId: string;
  traceparent: string;
};

const statusOperation: Record<OperationName, StatusOperationName> = {
  "Harness.Rust.Operation": "Harness.Rust.Status",
  "Harness.Ts.Operation": "Harness.Ts.Status",
};

function operationFacade(method: OperationName) {
  return method === "Harness.Rust.Operation"
    ? client.operation.harness.rustOperation
    : client.operation.harness.tsOperation;
}

function statusFacade(method: StatusOperationName) {
  return method === "Harness.Rust.Status"
    ? client.operation.harness.rustStatus
    : client.operation.harness.tsStatus;
}

async function assertNormalOperation(method: OperationName, message: string) {
  const ref = await operationFacade(method).start({ message })
    .orThrow();
  const snapshot = await ref.get().orThrow();
  if (
    snapshot.state !== "pending" && snapshot.state !== "running" &&
    snapshot.state !== "completed"
  ) {
    throw new Error(`${method} get returned ${snapshot.state}`);
  }
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(`${method} wait returned ${terminal.state}`);
  }
  const output = terminal.output as { message?: string } | undefined;
  if (output?.message !== message) {
    throw new Error(`${method} returned ${JSON.stringify(terminal.output)}`);
  }
}

async function assertWatchedOperation(method: OperationName, message: string) {
  const ref = await operationFacade(method).start({ message, mode: "watch" })
    .orThrow();
  const events = await ref.watch().orThrow();
  let sawProgress = false;
  for await (const event of events) {
    if (event.type === "progress") {
      sawProgress = true;
      const progress = event.progress as { message?: string; mode?: string };
      if (progress.message !== message || progress.mode !== "watch") {
        throw new Error(
          `${method} watch progress returned ${JSON.stringify(progress)}`,
        );
      }
    }
    if (event.type === "completed") {
      const output = event.snapshot.output as {
        message?: string;
        mode?: string;
      } | undefined;
      if (output?.message !== message || output?.mode !== "watch") {
        throw new Error(
          `${method} watch completed with ${
            JSON.stringify(event.snapshot.output)
          }`,
        );
      }
      if (!sawProgress) {
        throw new Error(`${method} watch completed before progress`);
      }
      return;
    }
  }
  throw new Error(`${method} watch ended before completion`);
}

async function assertCancelOperation(method: OperationName, message: string) {
  const ref = await operationFacade(method).start({ message, mode: "cancel" })
    .orThrow();
  const cancelled = await ref.cancel().orThrow();
  if (cancelled.state !== "cancelled") {
    throw new Error(`${method} cancel returned ${cancelled.state}`);
  }
}

async function assertDeferredOperation(method: OperationName, message: string) {
  const ref = await operationFacade(method).start({
    message,
    mode: "deferred",
  }).orThrow();
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(`${method} deferred wait returned ${terminal.state}`);
  }
  const output = terminal.output as
    | { message?: string; mode?: string }
    | undefined;
  if (output?.message !== message || output?.mode !== "deferred") {
    throw new Error(
      `${method} deferred returned ${JSON.stringify(terminal.output)}`,
    );
  }
}

async function assertAttachedOperation(method: OperationName, message: string) {
  const ref = await operationFacade(method).start({ message, mode: "attach" })
    .orThrow();
  await waitFor(async () => {
    const snapshot = await ref.get().orThrow();
    const progress = snapshot.progress as
      | { message?: string; mode?: string }
      | undefined;
    return snapshot.state === "running" && progress?.message === message &&
      progress?.mode === "attach";
  }, `${method} running attach operation`);
  await ref.signal("continue", { confirmed: true }).orThrow();
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(`${method} attach wait returned ${terminal.state}`);
  }
  const output = terminal.output as
    | { message?: string; mode?: string }
    | undefined;
  if (output?.message !== message || output?.mode !== "attach") {
    throw new Error(
      `${method} attach returned ${JSON.stringify(terminal.output)}`,
    );
  }
}

async function assertSignalOperation(method: OperationName, message: string) {
  const ref = await operationFacade(method).start({ message, mode: "signal" })
    .orThrow();
  await waitFor(async () => {
    const snapshot = await ref.get().orThrow();
    return snapshot.state === "running";
  }, `${method} running before signal`);
  const first = await ref.signal("selectWorkspace", { workspaceId: message })
    .orThrow();
  if (first.kind !== "signal-accepted" || first.signalSequence !== 1) {
    throw new Error(`${method} first signal ack was ${JSON.stringify(first)}`);
  }
  const second = await ref.signal("continue", { confirmed: true }).orThrow();
  if (second.signalSequence !== 2) {
    throw new Error(
      `${method} second signal ack was ${JSON.stringify(second)}`,
    );
  }
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(`${method} signal wait returned ${terminal.state}`);
  }
  const terminalSignal = await ref.signal("continue", { confirmed: true });
  if (terminalSignal.isOk()) {
    throw new Error(`${method} accepted terminal signal`);
  }
}

async function assertInvalidSignalRejected(
  method: OperationName,
  message: string,
) {
  const ref = await operationFacade(method).start({ message, mode: "cancel" })
    .orThrow();
  await waitFor(async () => {
    const snapshot = await ref.get().orThrow();
    return snapshot.state === "running";
  }, `${method} running before invalid signal`);
  const invalid = await ref.signal("selectWorkspace", { workspaceId: 123 });
  if (invalid.isOk()) {
    throw new Error(`${method} accepted invalid signal payload`);
  }
  await ref.cancel().orThrow();
}

async function assertInvalidControlRejected(
  method: OperationName,
  message: string,
) {
  const ref = await operationFacade(method).start({ message })
    .orThrow();
  const missing = await operationFacade(method).resume({
    id: `missing-${message}`,
    service: ref.service,
    operation: method,
  }).get();
  if (missing.isOk()) {
    throw new Error(`${method} accepted missing id get`);
  }

  const wrongOperation = await statusFacade(statusOperation[method]).resume(
    {
      id: ref.id,
      service: ref.service,
      operation: statusOperation[method],
    },
  ).get();
  if (wrongOperation.isOk()) {
    throw new Error(`${method} accepted wrong operation get`);
  }
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(`${method} terminal wait returned ${terminal.state}`);
  }
  const terminalCancel = await ref.cancel();
  if (terminalCancel.isOk()) {
    throw new Error(`${method} accepted terminal cancel`);
  }

  const status = await statusFacade(statusOperation[method]).start({
    message,
    mode: "status",
  }).orThrow();
  await waitFor(async () => {
    const snapshot = await status.get().orThrow();
    return snapshot.state === "running";
  }, `${statusOperation[method]} running before non-cancelable cancel`);
  const statusCancel = await status.cancel();
  if (statusCancel.isOk()) {
    throw new Error(
      `${statusOperation[method]} accepted non-cancelable cancel`,
    );
  }
}

async function assertTraceOperation() {
  const span = getTracer().startSpan("harness.ts.rust-operation.trace");
  const expectedTraceId = span.spanContext().traceId;
  try {
    const terminal = await withSpanAsync(span, async () => {
      const ref = await client.operation.harness.rustTraceOperation.start({
        message: "ts-client-rust-operation-trace",
      }).orThrow();
      return await ref.wait().orThrow();
    });
    if (terminal.state !== "completed") {
      throw new Error(
        `Harness.Rust.TraceOperation wait returned ${terminal.state}`,
      );
    }
    const output = terminal.output as TraceContextResponse | undefined;
    if (
      output?.provider !== "rust-operation" ||
      output.traceId !== expectedTraceId ||
      !output.traceparent.includes(expectedTraceId)
    ) {
      throw new Error(
        `Harness.Rust.TraceOperation trace context was ${
          JSON.stringify(output)
        }, expected trace id ${expectedTraceId}`,
      );
    }
  } finally {
    span.end();
  }
}

async function runDurableStart(method: OperationName, message: string) {
  const ref = await operationFacade(method).start({ message })
    .orThrow();
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(`${method} durable start wait returned ${terminal.state}`);
  }
  const output = terminal.output as { message?: string } | undefined;
  if (output?.message !== message) {
    throw new Error(
      `${method} durable start returned ${JSON.stringify(terminal.output)}`,
    );
  }
  console.log(
    `TS_OPERATIONS_DURABLE_REF:${
      JSON.stringify({
        id: ref.id,
        service: ref.service,
        operation: ref.operation,
      })
    }`,
  );
}

async function runDurableAssert(
  method: OperationName,
  operationRefJson: string,
  message: string,
) {
  const refData = parseOperationRefData(operationRefJson);
  if (refData.operation !== method) {
    throw new Error(
      `durable ref operation ${refData.operation} did not match ${method}`,
    );
  }
  const ref = operationFacade(method).resume(refData);
  const snapshot = await ref.get().orThrow();
  if (snapshot.state !== "completed") {
    throw new Error(`${method} durable get returned ${snapshot.state}`);
  }
  const output = snapshot.output as { message?: string } | undefined;
  if (output?.message !== message) {
    throw new Error(
      `${method} durable get returned ${JSON.stringify(snapshot.output)}`,
    );
  }
}

async function runDurableRunningAssert(
  method: OperationName,
  operationRefJson: string,
  message: string,
) {
  const refData = parseOperationRefData(operationRefJson);
  if (refData.operation !== method) {
    throw new Error(
      `durable ref operation ${refData.operation} did not match ${method}`,
    );
  }
  const ref = operationFacade(method).resume(refData);
  const running = await ref.get().orThrow();
  if (running.state !== "running") {
    throw new Error(`${method} durable running get returned ${running.state}`);
  }
  if (Deno.env.get("HARNESS_OPERATIONS_DURABLE_SIGNAL_COMPLETE") === "1") {
    await ref.signal("continue", { confirmed: true }).orThrow();
  }
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(
      `${method} durable running wait returned ${terminal.state}`,
    );
  }
  const output = terminal.output as
    | { message?: string; mode?: string }
    | undefined;
  if (output?.message !== message || output?.mode !== "durable-running") {
    throw new Error(
      `${method} durable running returned ${JSON.stringify(terminal.output)}`,
    );
  }
}

function parseOperationRefData(
  raw: string,
): { id: string; service: string; operation: string } {
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("service" in value) ||
    !("operation" in value)
  ) {
    throw new Error(`invalid durable operation ref ${raw}`);
  }
  const { id, service, operation } = value;
  if (
    typeof id !== "string" || typeof service !== "string" ||
    typeof operation !== "string"
  ) {
    throw new Error(`invalid durable operation ref ${raw}`);
  }
  return { id, service, operation };
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  description: string,
) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timeout waiting for ${description}`);
}

const durableAction = Deno.env.get("HARNESS_OPERATIONS_DURABLE_ACTION");
if (!durableAction) {
  await assertNormalOperation(
    "Harness.Rust.Operation",
    "ts-client-rust-operation",
  );
  await assertNormalOperation("Harness.Ts.Operation", "ts-client-ts-operation");
  await assertWatchedOperation(
    "Harness.Rust.Operation",
    "ts-client-rust-watch",
  );
  await assertWatchedOperation("Harness.Ts.Operation", "ts-client-ts-watch");
  await assertCancelOperation(
    "Harness.Rust.Operation",
    "ts-client-rust-cancel",
  );
  await assertCancelOperation("Harness.Ts.Operation", "ts-client-ts-cancel");
  await assertDeferredOperation(
    "Harness.Rust.Operation",
    "ts-client-rust-deferred",
  );
  await assertDeferredOperation(
    "Harness.Ts.Operation",
    "ts-client-ts-deferred",
  );
  await assertAttachedOperation(
    "Harness.Rust.Operation",
    "ts-client-rust-attach",
  );
  await assertAttachedOperation("Harness.Ts.Operation", "ts-client-ts-attach");
  await assertSignalOperation(
    "Harness.Rust.Operation",
    "ts-client-rust-signal",
  );
  await assertSignalOperation("Harness.Ts.Operation", "ts-client-ts-signal");
  await assertInvalidSignalRejected(
    "Harness.Rust.Operation",
    "ts-client-rust-invalid-signal",
  );
  await assertInvalidSignalRejected(
    "Harness.Ts.Operation",
    "ts-client-ts-invalid-signal",
  );
  await assertInvalidControlRejected(
    "Harness.Rust.Operation",
    "ts-client-rust-invalid-control",
  );
  await assertInvalidControlRejected(
    "Harness.Ts.Operation",
    "ts-client-ts-invalid-control",
  );
  await assertTraceOperation();
} else if (durableAction === "start") {
  await runDurableStart(
    Deno.env.get("HARNESS_OPERATIONS_DURABLE_METHOD") as OperationName,
    Deno.env.get("HARNESS_OPERATIONS_DURABLE_MESSAGE")!,
  );
} else if (durableAction === "assert") {
  await runDurableAssert(
    Deno.env.get("HARNESS_OPERATIONS_DURABLE_METHOD") as OperationName,
    Deno.env.get("HARNESS_OPERATIONS_DURABLE_REF")!,
    Deno.env.get("HARNESS_OPERATIONS_DURABLE_MESSAGE")!,
  );
} else if (durableAction === "assert-running") {
  await runDurableRunningAssert(
    Deno.env.get("HARNESS_OPERATIONS_DURABLE_METHOD") as OperationName,
    Deno.env.get("HARNESS_OPERATIONS_DURABLE_REF")!,
    Deno.env.get("HARNESS_OPERATIONS_DURABLE_MESSAGE")!,
  );
} else {
  throw new Error(`unknown durable action '${durableAction}'`);
}
await client.connection.close();
console.log("TS_OPERATIONS_CLIENT_OK");
