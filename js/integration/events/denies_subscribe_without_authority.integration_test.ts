import { assertEquals } from "@std/assert";
import { type EventListenerContext, Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createEventsFixture } from "./_fixture.ts";

const CASE_ID = "events.denies-subscribe-without-authority" as const;
const fixture = createEventsFixture(CASE_ID);

liveTrellisTest({
  name:
    "events.denies-subscribe-without-authority does not deliver events to a publish-only client",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.contracts.approve({ contract: fixture.serviceContract });
    const listenerController = new AbortController();
    const publishOnlyClient = await runtime.connectClient({
      name: fixture.publishOnlyName,
      contract: fixture.publishOnlyClientContract,
    });
    const publisher = await runtime.connectClient({
      name: fixture.authorizedPublisherName,
      contract: fixture.pubSubClientContract,
    });
    let received = false;

    try {
      await publishOnlyClient.event.entity.changed.listen(
        (
          _event: { id: string; value: string },
          _context: EventListenerContext,
        ) => {
          received = true;
          return Result.ok(undefined);
        },
        {},
        { mode: "ephemeral", signal: listenerController.signal },
      ).orThrow();

      await publisher.event.entity.changed.publish({
        id: fixture.deniedSubscribeEntityId,
        value: "should-not-deliver",
      }).orThrow();

      await new Promise((resolve) => setTimeout(resolve, 250));
      assertEquals(received, false);
    } finally {
      listenerController.abort();
    }
  },
});
