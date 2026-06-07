import {
  defineError,
  defineServiceContract,
  err,
  ok,
  UnexpectedError,
} from "@qlever-llc/trellis";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { getActiveSpan } from "@qlever-llc/trellis/telemetry";
import { Type } from "typebox";

new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
}).register();

const schemas = {
  PingRequest: Type.Object({ message: Type.String() }),
  PingResponse: Type.Object({ message: Type.String() }),
  CallerContextResponse: Type.Object({
    provider: Type.String(),
    callerType: Type.String(),
    participantKind: Type.String(),
    userId: Type.String(),
  }),
  TraceContextResponse: Type.Object({
    provider: Type.String(),
    traceId: Type.String(),
    traceparent: Type.String(),
  }),
} as const;

const NotFoundError = defineError({
  type: "NotFoundError",
  fields: { resource: Type.String() },
  message: ({ resource }) => `${resource} not found`,
});

const contract = defineServiceContract(
  { schemas, errors: { NotFoundError } },
  (ref) => ({
    id: "trellis.integration-harness.rpc@v1",
    displayName: "Trellis Integration Harness RPC",
    description:
      "Harness-owned service contract for full-stack Rust/TypeScript RPC verification.",
    uses: {
      required: {
        auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
      },
    },
    rpc: {
      "Harness.Rust.Ping": {
        version: "v1",
        subject: "rpc.v1.Harness.Rust.Ping",
        input: ref.schema("PingRequest"),
        output: ref.schema("PingResponse"),
        capabilities: { call: [] },
        errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
      },
      "Harness.Ts.Ping": {
        version: "v1",
        subject: "rpc.v1.Harness.Ts.Ping",
        input: ref.schema("PingRequest"),
        output: ref.schema("PingResponse"),
        capabilities: { call: [] },
        errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
      },
      "Harness.Rust.CallerContext": {
        version: "v1",
        subject: "rpc.v1.Harness.Rust.CallerContext",
        input: ref.schema("PingRequest"),
        output: ref.schema("CallerContextResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Harness.Ts.CallerContext": {
        version: "v1",
        subject: "rpc.v1.Harness.Ts.CallerContext",
        input: ref.schema("PingRequest"),
        output: ref.schema("CallerContextResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Harness.Rust.TraceContext": {
        version: "v1",
        subject: "rpc.v1.Harness.Rust.TraceContext",
        input: ref.schema("PingRequest"),
        output: ref.schema("TraceContextResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Harness.Ts.TraceContext": {
        version: "v1",
        subject: "rpc.v1.Harness.Ts.TraceContext",
        input: ref.schema("PingRequest"),
        output: ref.schema("TraceContextResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
    },
  }),
);

const expectedDigest = Deno.env.get("HARNESS_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
  );
}

const service = await TrellisService.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  name: "harness-rpc-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: undefined },
}).orThrow();

await service.handle.rpc.harness.tsPing(({ input }) => {
  if (input.message === "handler-error") {
    return err(
      new UnexpectedError({ cause: new Error("ts handler error marker") }),
    );
  }
  if (input.message === "not-found") {
    return err(new NotFoundError({ resource: "Workspace" }));
  }
  return ok({ message: input.message });
});
await service.handle.rpc.harness.tsCallerContext(({ context }) => {
  const caller = context.caller;
  if (caller.type !== "user") {
    throw new Error(`expected user caller, got ${caller.type}`);
  }
  if (caller.participantKind !== "agent") {
    throw new Error(`expected agent caller, got ${caller.participantKind}`);
  }
  return ok({
    provider: "ts",
    callerType: caller.type,
    participantKind: caller.participantKind,
    userId: caller.userId,
  });
});
await service.handle.rpc.harness.tsTraceContext(() => {
  const span = getActiveSpan();
  const traceId = span?.spanContext().traceId ?? "";
  return ok({
    provider: "ts",
    traceId,
    traceparent: traceId.length > 0 ? `00-${traceId}-0000000000000000-01` : "",
  });
});
console.log("TS_SERVICE_READY");

await new Promise<void>(() => {});
