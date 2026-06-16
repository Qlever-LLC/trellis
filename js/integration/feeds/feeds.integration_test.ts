import { assertEquals } from "@std/assert";
import { defineAppContract, defineServiceContract } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";

const feedSchemas = {
  FeedInput: Type.Object({ topic: Type.String() }),
  FeedFrame: Type.Object({
    topic: Type.String(),
    message: Type.String(),
    sequence: Type.Number(),
  }),
} as const;

const feedsServiceContract = defineServiceContract(
  { schemas: feedSchemas },
  (ref) => ({
    id: "trellis.integration.feeds-service@v1",
    displayName: "Trellis Integration Feeds Service",
    description: "Exercises generated feed subscribe and handler surfaces.",
    capabilities: {
      readFeeds: {
        displayName: "Read feeds",
        description: "Subscribe to entity feed updates.",
      },
    },
    feeds: {
      "Entity.Live": {
        version: "v1",
        subject: "feeds.v1.Entity.Live",
        input: ref.schema("FeedInput"),
        event: ref.schema("FeedFrame"),
        capabilities: { subscribe: ["readFeeds"] },
      },
    },
  }),
);

const feedsClientContract = defineAppContract(() => ({
  id: "trellis.integration.feeds-client@v1",
  displayName: "Trellis Integration Feeds Client",
  description: "App/client participant for the feeds integration fixture.",
  uses: {
    required: {
      feedsService: feedsServiceContract.use({
        feeds: { subscribe: ["Entity.Live"] },
      }),
    },
  },
}));

type FeedFrame = {
  readonly topic: string;
  readonly message: string;
  readonly sequence: number;
};

Deno.test("feeds.client-consumes-service-feed receives generated feed frames", async () => {
  await withTrellisRuntime(async (runtime) => {
    const serviceKey = await runtime.registerService({
      name: "feeds-fixture-service",
      contract: feedsServiceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: feedsServiceContract,
      name: "feeds-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

    try {
      await service.handle.feed.entity.live(async ({ input, emit }) => {
        await emit({
          topic: input.topic,
          message: `feed:${input.topic}:1`,
          sequence: 1,
        }).orThrow();
        await emit({
          topic: input.topic,
          message: `feed:${input.topic}:2`,
          sequence: 2,
        }).orThrow();
      });

      const client = await runtime.connectClient({
        name: "feeds-fixture-client",
        contract: feedsClientContract,
      });
      const controller = new AbortController();

      try {
        const stream = await client.feed.entity.live(
          { topic: "entity-feed-1" },
          {
            signal: controller.signal,
          },
        ).orThrow();
        const frames = await withTimeout(
          collectFeedFrames(stream, 2),
          "feeds.client-consumes-service-feed frames",
        );

        assertEquals(frames, [
          {
            topic: "entity-feed-1",
            message: "feed:entity-feed-1:1",
            sequence: 1,
          },
          {
            topic: "entity-feed-1",
            message: "feed:entity-feed-1:2",
            sequence: 2,
          },
        ]);
      } finally {
        controller.abort();
      }
    } finally {
      await service.stop();
    }
  });
});

async function collectFeedFrames(
  stream: AsyncIterable<FeedFrame>,
  count: number,
): Promise<FeedFrame[]> {
  const frames: FeedFrame[] = [];
  for await (const frame of stream) {
    frames.push(frame);
    if (frames.length === count) return frames;
  }
  throw new Error(`feed ended after ${frames.length} of ${count} frames`);
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
