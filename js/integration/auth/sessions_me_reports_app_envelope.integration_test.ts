import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { TrellisClient } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID = "auth.sessions-me-reports-app-envelope" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);

liveTrellisTest({
  name: "auth.sessions-me-reports-app-envelope reports the app user envelope",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.setupService(runtime);
    const { clientAuth } = await fixture.setupClientRegistration(runtime);
    const client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: fixture.clientName,
      contract: fixture.clientContract,
      ...clientAuth,
    }).orThrow();

    try {
      const me = await client.rpc.auth.sessionsMe({}).orThrow();
      assertEquals(me.participantKind, "app");
      assert(me.user !== null, "expected Auth.Sessions.Me to return a user");
      assertEquals(me.user.active, true);
      assertArrayIncludes(me.user.capabilities, ["admin"]);
      assertEquals(me.device, null);
      assertEquals(me.service, null);
    } finally {
      await client.connection.close().catch(() => undefined);
      await service.stop();
    }
  },
});
