import { assertEquals } from "@std/assert";
import { TrellisClient } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAppIdentityApprovalFixture } from "./_fixture.ts";

const CASE_ID = "app-identity-approval.approved-client-calls-service" as const;
const fixture = createAppIdentityApprovalFixture(CASE_ID);

liveTrellisTest({
  name:
    "app-identity-approval.approved-client-calls-service calls service RPC after approval",
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
        const result = await client.rpc.grant.ping({
          message: fixture.pingMessage,
        }).orThrow();
        assertEquals(result, { message: fixture.pingMessage, approved: true });
      } finally {
        await client.connection.close();
      }
    } finally {
      await service.stop();
    }
  },
});
