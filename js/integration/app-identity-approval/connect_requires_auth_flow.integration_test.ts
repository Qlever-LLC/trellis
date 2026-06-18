import { assertEquals } from "@std/assert";
import { TrellisClient } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAppIdentityApprovalFixture } from "./_fixture.ts";

const CASE_ID = "app-identity-approval.connect-requires-auth-flow" as const;
const fixture = createAppIdentityApprovalFixture(CASE_ID);

liveTrellisTest({
  name:
    "app-identity-approval.connect-requires-auth-flow invokes auth-required callback",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.setupService(runtime);
    const { clientKey, clientAuth } = await fixture.setupClientRegistration(
      runtime,
    );
    let observedAuth:
      | {
        loginUrl: string;
        sessionKey: string;
        mode: "browser" | "session_key";
      }
      | undefined;

    try {
      const client = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: fixture.clientName,
        contract: fixture.clientContract,
        auth: clientAuth.auth,
        onAuthRequired: async (ctx) => {
          observedAuth = ctx;
          return await clientAuth.onAuthRequired(ctx);
        },
      }).orThrow();

      try {
        if (observedAuth === undefined) {
          throw new Error("expected app identity approval to require auth");
        }
        const loginUrl = new URL(observedAuth.loginUrl);
        const runtimeUrl = new URL(runtime.trellisUrl);
        assertEquals(loginUrl.protocol, runtimeUrl.protocol);
        assertEquals(loginUrl.port, runtimeUrl.port);
        assertEquals(
          ["127.0.0.1", "localhost"].includes(loginUrl.hostname),
          true,
        );
        assertEquals(loginUrl.searchParams.has("flowId"), true);
        assertEquals(observedAuth.mode, "session_key");
        assertEquals(observedAuth.sessionKey, clientKey.sessionKey);
      } finally {
        await client.connection.close();
      }
    } finally {
      await service.stop();
    }
  },
});
