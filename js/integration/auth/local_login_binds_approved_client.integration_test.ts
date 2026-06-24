import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { TrellisClient } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID = "auth.local-login-binds-approved-client" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);

liveTrellisTest({
  name:
    "auth.local-login-binds-approved-client binds local admin session and calls service",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.setupService(runtime);
    const { clientAuth } = await fixture.setupClientRegistration(runtime);
    let authRequired = false;

    try {
      const client = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: fixture.clientName,
        contract: fixture.clientContract,
        auth: clientAuth.auth,
        onAuthRequired: async (ctx) => {
          authRequired = true;
          return await clientAuth.onAuthRequired(ctx);
        },
      }).orThrow();

      try {
        assert(authRequired, "expected local-login flow to require auth");

        const me = await client.rpc.auth.sessionsMe({}).orThrow();
        assertEquals(me.participantKind, "app");
        assert(me.user !== null, "expected Auth.Sessions.Me to return a user");
        assertEquals(me.user.active, true);
        assertArrayIncludes(me.user.capabilities, ["admin"]);

        const ping = await client.rpc.authLogin.ping({
          message: fixture.pingMessage,
        }).orThrow();
        assertEquals(ping, { message: fixture.pingMessage, accepted: true });
      } finally {
        await client.connection.close();
      }
    } finally {
      await service.stop();
    }
  },
});
