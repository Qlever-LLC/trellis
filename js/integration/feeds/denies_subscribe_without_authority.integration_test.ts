import { assertRejects } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createFeedsFixture, optionalFeedClient } from "./_fixture.ts";

const CASE_ID = "feeds.denies-subscribe-without-authority" as const;
const fixture = createFeedsFixture(CASE_ID);

liveTrellisTest({
  name:
    "feeds.denies-subscribe-without-authority rejects an unauthorized feed subscribe",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.contracts.approve({ contract: fixture.serviceContract });
    const client = await runtime.connectClient({
      name: fixture.unauthorizedClientName,
      contract: fixture.unauthorizedClientContract,
    });

    await assertRejects(async () => {
      const feedApi = optionalFeedClient(client).feed;
      if (feedApi?.entity?.live === undefined) {
        throw new Error("denied: feed subscribe is not available");
      }
      await feedApi.entity.live({ topic: fixture.topic }).orThrow();
    });
  },
});
