import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  collectFeedFrames,
  createFeedsFixture,
  withTimeout,
} from "./_fixture.ts";

const CASE_ID = "feeds.client-receives-ordered-frames" as const;
const fixture = createFeedsFixture(CASE_ID);

liveTrellisTest({
  name:
    "feeds.client-receives-ordered-frames receives two frames in sequence order",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

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
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const controller = new AbortController();

      try {
        const stream = await client.feed.entity.live(
          { topic: fixture.topic },
          { signal: controller.signal },
        ).orThrow();
        const frames = await withTimeout(
          collectFeedFrames(stream, 2),
          "feeds.client-receives-ordered-frames frames",
        );

        assertEquals(frames, [
          {
            topic: fixture.topic,
            message: `feed:${fixture.topic}:1`,
            sequence: 1,
          },
          {
            topic: fixture.topic,
            message: `feed:${fixture.topic}:2`,
            sequence: 2,
          },
        ]);
      } finally {
        controller.abort();
      }
    } finally {
      await service.stop();
    }
  },
});
