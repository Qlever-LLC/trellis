import { assert } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createFeedsFixture } from "./_fixture.ts";

const CASE_ID = "feeds.abort-stops-client-subscription" as const;
const fixture = createFeedsFixture(CASE_ID);

liveTrellisTest({
  name: "feeds.abort-stops-client-subscription stops the feed stream on abort",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      await service.handle.feed.entity.live(async ({ input, emit }) => {
        for (let i = 1; i <= 10; i++) {
          await emit({
            topic: input.topic,
            message: `feed:${input.topic}:${i}`,
            sequence: i,
          }).orThrow();
        }
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const controller = new AbortController();

      const stream = await client.feed.entity.live(
        { topic: fixture.topic },
        { signal: controller.signal },
      ).orThrow();

      controller.abort();

      let terminated = false;
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("stream did not terminate after abort")),
          5000,
        )
      );
      const iterate = (async () => {
        for await (const _ of stream) {
          // drain
        }
        terminated = true;
      })();

      await Promise.race([iterate, timeout]);
      assert(terminated, "feed stream should terminate after abort");
    } finally {
      await service.stop();
    }
  },
});
