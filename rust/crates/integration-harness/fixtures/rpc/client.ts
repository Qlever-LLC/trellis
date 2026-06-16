import { defineAgentContract, isErr, TrellisClient } from "@qlever-llc/trellis";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { getTracer, withSpanAsync } from "@qlever-llc/trellis/telemetry";
import { NotFoundError, sdk as harness } from "./sdk/mod.ts";

new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
}).register();

const contract = defineAgentContract(() => ({
  id: "trellis.integration-rpc-agent@v1",
  displayName: "Trellis Integration Agent",
  description: "Verify delegated Rust agent login and harness RPC calls.",
  uses: {
    required: {
      auth: auth.use({
        rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
      }),
      harness: harness.use({
        rpc: {
          call: [
            "Harness.Rust.Ping",
            "Harness.Ts.Ping",
            "Harness.Rust.CallerContext",
            "Harness.Ts.CallerContext",
            "Harness.Rust.TraceContext",
            "Harness.Ts.TraceContext",
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

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: ${actual} !== ${expected}`);
  }
}

type ConnectionLike = typeof client.connection;

async function waitForConnectionPhase(
  connection: ConnectionLike,
  phase: ConnectionLike["status"]["phase"],
  message: string,
) {
  if (connection.status.phase === phase) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe?.();
      reject(
        new Error(
          `${message}: ${connection.status.phase} !== ${phase}`,
        ),
      );
    }, 5_000);
    let unsubscribe: (() => void) | undefined;
    unsubscribe = connection.subscribe((status) => {
      if (status.phase !== phase) return;
      clearTimeout(timer);
      unsubscribe?.();
      resolve();
    });
  });
}

async function assertPing(
  method: "Harness.Rust.Ping" | "Harness.Ts.Ping",
  message: string,
) {
  const response =
    await (method === "Harness.Rust.Ping"
      ? client.rpc.harness.rustPing({ message })
      : client.rpc.harness.tsPing({ message })).orThrow();
  if (response.message !== message) {
    throw new Error(`${method} returned ${JSON.stringify(response)}`);
  }
}

type CallerContextResponse = {
  provider: string;
  callerType: string;
  participantKind: string;
  userId: string;
};

function assertCallerContextValue(
  actual: CallerContextResponse,
  provider: "rust" | "ts",
) {
  assertEqual(
    actual.provider,
    provider,
    `${provider} caller context provider mismatch`,
  );
  assertEqual(actual.callerType, "user", `${provider} caller type mismatch`);
  assertEqual(
    actual.participantKind,
    "agent",
    `${provider} participant kind mismatch`,
  );
  assert(actual.userId.length > 0, `${provider} user id should be populated`);
}

async function assertCallerContext(
  method: "Harness.Rust.CallerContext" | "Harness.Ts.CallerContext",
  provider: "rust" | "ts",
) {
  const response =
    await (method === "Harness.Rust.CallerContext"
      ? client.rpc.harness.rustCallerContext({
        message: "caller-context-or-throw",
      })
      : client.rpc.harness.tsCallerContext({
        message: "caller-context-or-throw",
      })).orThrow() as CallerContextResponse;
  assertCallerContextValue(response, provider);
  const result = method === "Harness.Rust.CallerContext"
    ? await client.rpc.harness.rustCallerContext({
      message: "caller-context-take",
    })
    : await client.rpc.harness.tsCallerContext({
      message: "caller-context-take",
    });
  const taken = result.take();
  if (isErr(taken)) {
    throw taken.error;
  }
  assertCallerContextValue(taken as CallerContextResponse, provider);
}

type TraceContextResponse = {
  provider: string;
  traceId: string;
  traceparent: string;
};

async function assertTraceContext(
  method: "Harness.Rust.TraceContext" | "Harness.Ts.TraceContext",
  provider: "rust" | "ts",
) {
  const span = getTracer().startSpan(`harness.ts.${provider}.trace`);
  const expectedTraceId = span.spanContext().traceId;
  const response = await withSpanAsync(span, async () => {
    return await (method === "Harness.Rust.TraceContext"
      ? client.rpc.harness.rustTraceContext({ message: "trace-context" })
      : client.rpc.harness.tsTraceContext({ message: "trace-context" }))
      .orThrow() as TraceContextResponse;
  });
  span.end();
  assertEqual(
    response.provider,
    provider,
    `${provider} trace provider mismatch`,
  );
  assertEqual(
    response.traceId,
    expectedTraceId,
    `${provider} trace id mismatch`,
  );
  assert(
    response.traceparent.includes(expectedTraceId),
    `${provider} traceparent did not include ${expectedTraceId}: ${response.traceparent}`,
  );
}

async function assertHandlerError(
  method: "Harness.Rust.Ping" | "Harness.Ts.Ping",
) {
  const result = method === "Harness.Rust.Ping"
    ? await client.rpc.harness.rustPing({ message: "handler-error" })
    : await client.rpc.harness.tsPing({ message: "handler-error" });
  if (result.isOk()) {
    throw new Error(`${method} handler error unexpectedly succeeded`);
  }
  const error = result.error;
  if (error.name !== "UnexpectedError") {
    throw new Error(
      `${method} returned ${error.name} instead of UnexpectedError`,
    );
  }
}

async function assertNotFoundError(
  method: "Harness.Rust.Ping" | "Harness.Ts.Ping",
) {
  const result = method === "Harness.Rust.Ping"
    ? await client.rpc.harness.rustPing({ message: "not-found" })
    : await client.rpc.harness.tsPing({ message: "not-found" });
  if (result.isOk()) {
    throw new Error(`${method} not-found unexpectedly succeeded`);
  }
  const error = result.error;
  if (!(error instanceof NotFoundError)) {
    throw new Error(`${method} did not reconstruct NotFoundError`);
  }
  assertEqual(
    error.data.resource,
    "Workspace",
    `${method} NotFoundError resource mismatch`,
  );
  assertEqual(
    error.message,
    "Workspace not found",
    `${method} NotFoundError message mismatch`,
  );
}

function assertTemplateBehavior() {
  // @ts-expect-error The connected client exposes template at runtime, but the narrowed contract type hides it.
  const templateClient = client as Trellis;
  const escaped = templateClient.template("rpc.{/id}", { id: "a.b" });
  assert(escaped.isOk(), "escaped template failed");
  assertEqual(escaped.take(), "rpc.a~2E~b", "escaped template result mismatch");

  const zero = templateClient.template("rpc.{/id}", { id: 0 });
  assert(zero.isOk(), "zero template failed");
  assertEqual(zero.take(), "rpc.0", "zero template result mismatch");

  const empty = templateClient.template("rpc.{/id}", { id: "" });
  assert(empty.isOk(), "empty template failed");
  assertEqual(empty.take(), "rpc._", "empty template result mismatch");

  const wildcard = templateClient.template("rpc.{/id}", {}, true);
  assert(wildcard.isOk(), "wildcard template failed");
  assertEqual(wildcard.take(), "rpc.*", "wildcard template result mismatch");
}

async function assertInputValidationBeforeSend() {
  const result = await client.rpc.harness.rustPing(JSON.parse('{"message":1}'));
  assert(result.isErr(), "invalid RPC input unexpectedly succeeded");
}

async function assertServiceStopLifecycle(
  name: string,
  mode: "once" | "twice" | "concurrent",
) {
  const service = await TrellisService.connect({
    trellisUrl: Deno.env.get("TRELLIS_URL")!,
    contract: harness,
    name,
    sessionKeySeed: Deno.env.get("HARNESS_STOP_SERVICE_SEED")!,
    server: { log: undefined },
  }).orThrow();
  assertEqual(
    service.connection.status.phase,
    "connected",
    `${name} connection should start open`,
  );

  if (mode === "once") {
    await service.stop();
  } else if (mode === "twice") {
    await service.stop();
    await service.stop();
  } else {
    await Promise.all([service.stop(), service.stop()]);
  }

  await waitForConnectionPhase(
    service.connection,
    "closed",
    `${name} connection should be closed after stop`,
  );
}

async function assertClientConnectionLifecycle() {
  assertEqual(
    client.connection.status.phase,
    "connected",
    "client connection should start connected",
  );
  await client.connection.close();
  assertEqual(
    client.connection.status.phase,
    "closed",
    "client connection should be closed after close",
  );
}

await assertPing("Harness.Rust.Ping", "ts-client-rust-service");
await assertPing("Harness.Ts.Ping", "ts-client-ts-service");
await assertCallerContext("Harness.Rust.CallerContext", "rust");
await assertCallerContext("Harness.Ts.CallerContext", "ts");
await assertTraceContext("Harness.Rust.TraceContext", "rust");
await assertTraceContext("Harness.Ts.TraceContext", "ts");
await assertHandlerError("Harness.Rust.Ping");
await assertHandlerError("Harness.Ts.Ping");
await assertNotFoundError("Harness.Rust.Ping");
await assertNotFoundError("Harness.Ts.Ping");
assertTemplateBehavior();
await assertInputValidationBeforeSend();
await assertServiceStopLifecycle("harness-rpc-ts-stop-once", "once");
await assertServiceStopLifecycle("harness-rpc-ts-stop-twice", "twice");
await assertServiceStopLifecycle(
  "harness-rpc-ts-stop-concurrent",
  "concurrent",
);
await assertClientConnectionLifecycle();
console.log("TS_CLIENT_OK");
