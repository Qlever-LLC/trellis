import { err, ok, UnexpectedError } from "@qlever-llc/trellis";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { getActiveSpan } from "@qlever-llc/trellis/telemetry";
import { contract, NotFoundError } from "./contract.ts";
import type { HarnessTsPingHandler, HarnessTsPingInput } from "./sdk/mod.ts";

new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
}).register();

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

const handleTsPing = (({ input }: { input: HarnessTsPingInput }) => {
  if (input.message === "handler-error") {
    return err(
      new UnexpectedError({ cause: new Error("ts handler error marker") }),
    );
  }
  if (input.message === "not-found") {
    return err(new NotFoundError({ resource: "Workspace" }));
  }
  return ok({ message: input.message });
}) satisfies HarnessTsPingHandler;

await service.handle.rpc.harness.tsPing(handleTsPing);
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
