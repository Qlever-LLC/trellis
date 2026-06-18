import { assertEquals } from "@std/assert";
import { TrellisClient } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAppIdentityApprovalFixture } from "./_fixture.ts";

const CASE_ID = "app-identity-approval.approved-client-connects" as const;
const fixture = createAppIdentityApprovalFixture(CASE_ID);

liveTrellisTest({
  name:
    "app-identity-approval.approved-client-connects produces a connected public client",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.setupService(runtime);
    const { clientAuth } = await fixture.setupClientRegistration(runtime);

    try {
      const client = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: fixture.clientName,
        contract: fixture.clientContract,
        auth: clientAuth.auth,
        onAuthRequired: async (ctx) => await clientAuth.onAuthRequired(ctx),
      }).orThrow();

      try {
        assertEquals(typeof client.connection, "object");
        assertEquals(client.connection !== null, true);
      } finally {
        await client.connection.close();
      }
    } finally {
      await service.stop();
    }
  },
});
