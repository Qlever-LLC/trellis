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
import { trace } from "@qlever-llc/trellis/tracing";
import { Type } from "typebox";

new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
}).register();

const schemas = {
  FeedInput: Type.Object({ topic: Type.String() }),
  FeedEvent: Type.Object({
    message: Type.String(),
    topic: Type.String(),
    traceparent: Type.Optional(Type.String()),
  }),
} as const;

const harness = defineServiceContract({ schemas }, (ref) => ({
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

const contract = defineAgentContract(() => ({
  id: "trellis.integration-feeds-agent@v1",
  displayName: "Trellis Integration Feeds Agent",
  description:
    "Verify delegated Rust agent login and harness feed subscriptions.",
  uses: {
    required: {
      auth: auth.use({
        rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
      }),
      harness: harness.use({
        feeds: { subscribe: ["Harness.Rust.Feed", "Harness.Ts.Feed"] },
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

type FeedName = "Harness.Rust.Feed" | "Harness.Ts.Feed";

async function firstAsyncIterableValue<T>(
  stream: AsyncIterable<T>,
): Promise<T> {
  for await (const event of stream) return event;
  throw new Error("feed ended before first event");
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          10000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function assertFeed(
  feed: FeedName,
  topic: string,
  expectedMessage: string,
) {
  const controller = new AbortController();
  try {
    const stream = await client.feed(feed).input({ topic }).subscribe({
      signal: controller.signal,
    }).orThrow();
    const event = await withTimeout(
      firstAsyncIterableValue(stream),
      `${feed} first event`,
    ) as { message?: string; topic?: string };
    if (event.message !== expectedMessage || event.topic !== topic) {
      throw new Error(`${feed} returned ${JSON.stringify(event)}`);
    }
  } finally {
    controller.abort();
  }
}

async function assertConcurrentFeeds(
  feed: FeedName,
  prefix: string,
  expectedPrefix: string,
) {
  const started = performance.now();
  await Promise.all([
    assertFeed(feed, `slow-${prefix}-a`, `${expectedPrefix}:slow-${prefix}-a`),
    assertFeed(feed, `slow-${prefix}-b`, `${expectedPrefix}:slow-${prefix}-b`),
  ]);
  const elapsed = performance.now() - started;
  if (elapsed > 1500) {
    throw new Error(`${feed} concurrent feeds took ${elapsed}ms`);
  }
}

async function assertTraceFeed() {
  let expectedTraceId = "";
  await trace.getTracer("trellis-integration-feeds").startActiveSpan(
    "subscribe traced feed",
    async (span) => {
      expectedTraceId = span.spanContext().traceId;
      try {
        const controller = new AbortController();
        try {
          const stream = await client.feed("Harness.Rust.Feed").input({
            topic: "ts-client-rust-feed-trace",
          }).subscribe({ signal: controller.signal }).orThrow();
          const event = await withTimeout(
            firstAsyncIterableValue(stream),
            "Harness.Rust.Feed trace first event",
          ) as { message?: string; topic?: string; traceparent?: string };
          if (
            event.message !== "rust-feed:ts-client-rust-feed-trace" ||
            event.topic !== "ts-client-rust-feed-trace"
          ) {
            throw new Error(
              `Harness.Rust.Feed trace returned ${JSON.stringify(event)}`,
            );
          }
          if (
            event.traceparent === undefined ||
            !event.traceparent.includes(expectedTraceId)
          ) {
            throw new Error(
              `Harness.Rust.Feed traceparent ${event.traceparent} did not include ${expectedTraceId}`,
            );
          }
        } finally {
          controller.abort();
        }
      } finally {
        span.end();
      }
    },
  );
}

await assertFeed(
  "Harness.Rust.Feed",
  "ts-client-rust-feed",
  "rust-feed:ts-client-rust-feed",
);
await assertFeed(
  "Harness.Ts.Feed",
  "ts-client-ts-feed",
  "ts-feed:ts-client-ts-feed",
);
await assertConcurrentFeeds(
  "Harness.Rust.Feed",
  "ts-client-rust-feed",
  "rust-feed",
);
await assertConcurrentFeeds("Harness.Ts.Feed", "ts-client-ts-feed", "ts-feed");
await assertTraceFeed();
await client.natsConnection.drain();
console.log("TS_FEEDS_CLIENT_OK");
