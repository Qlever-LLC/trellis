import { defineServiceContract } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";

const schemas = {
  FeedInput: Type.Object({ topic: Type.String() }),
  FeedEvent: Type.Object({
    message: Type.String(),
    topic: Type.String(),
    traceparent: Type.Optional(Type.String()),
  }),
} as const;

const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.feeds@v1",
  displayName: "Trellis Integration Harness Feeds",
  description:
    "Harness-owned service contract for full-stack Rust/TypeScript feed verification.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
    },
  },
  feeds: {
    "Harness.Rust.Feed": {
      version: "v1",
      subject: "feeds.v1.Harness.Rust.Feed",
      input: ref.schema("FeedInput"),
      event: ref.schema("FeedEvent"),
      capabilities: { subscribe: [] },
    },
    "Harness.Ts.Feed": {
      version: "v1",
      subject: "feeds.v1.Harness.Ts.Feed",
      input: ref.schema("FeedInput"),
      event: ref.schema("FeedEvent"),
      capabilities: { subscribe: [] },
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
  name: "harness-feeds-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: undefined },
}).orThrow();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await service.handle.feed.harness.tsFeed(async ({ input, emit }) => {
  if (input.topic.startsWith("slow-")) await sleep(500);
  await emit({ message: `ts-feed:${input.topic}`, topic: input.topic })
    .orThrow();
});
console.log("TS_FEEDS_SERVICE_READY");

await new Promise<void>(() => {});
