import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  createTransferFixture,
  requireReceiveTransferGrant,
} from "./_fixture.ts";

const CASE_ID = "transfer.download-grant-is-session-bound" as const;
const fixture = createTransferFixture(CASE_ID);

liveTrellisTest({
  name:
    "transfer.download-grant-is-session-bound rejects cross-session grant usage",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await fixture.withTransferFixture(runtime, async ({ runtime: rt }) => {
      const clientA = await rt.connectClient({
        name: fixture.clientAName,
        contract: fixture.clientContract,
      });

      const grant = requireReceiveTransferGrant(
        await clientA.rpc.files.download({
          key: fixture.sessionBoundKey,
        }).orThrow(),
      );

      const clientB = await rt.connectClient({
        name: fixture.clientBName,
        contract: fixture.clientContract,
      });

      const result = await clientB.transfer(grant).bytes();
      assertEquals(result.isOk(), false);
    });
  },
});
