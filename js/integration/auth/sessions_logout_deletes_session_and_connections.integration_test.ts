import { assertEquals } from "@std/assert";
import {
  type ConnectedTrellisClient,
  TrellisClient,
} from "@qlever-llc/trellis";
import { waitFor } from "@qlever-llc/trellis-test";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID = "auth.sessions-logout-deletes-session-and-connections" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);

liveTrellisTest({
  name:
    "auth.sessions-logout-deletes-session-and-connections deletes the app session and connection presence",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.setupService(runtime);
    const admin = await fixture.setupSessionAdmin(runtime);
    const { clientKey, clientAuth } = await fixture.setupClientRegistration(
      runtime,
    );

    let client:
      | ConnectedTrellisClient<typeof fixture.clientContract>
      | undefined;

    try {
      client = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: fixture.clientName,
        contract: fixture.clientContract,
        auth: clientAuth.auth,
        onAuthRequired: async (ctx) => await clientAuth.onAuthRequired(ctx),
      }).orThrow();

      await client.rpc.authLogin.ping({ message: fixture.pingMessage })
        .orThrow();
      await waitFor(async () => {
        const page = await admin.rpc.auth.connectionsList({
          sessionKey: clientKey.sessionKey,
          limit: 500,
        }).orThrow();
        return page.entries.length === 1;
      });

      const logout = await client.rpc.auth.sessionsLogout({}).orThrow();
      assertEquals(logout.success, true);

      await waitFor(async () => {
        const sessions = await admin.rpc.auth.sessionsList({ limit: 500 })
          .orThrow();
        return sessions.entries.every((entry) =>
          entry.sessionKey !== clientKey.sessionKey
        );
      });
      await waitFor(async () => {
        const connections = await admin.rpc.auth.connectionsList({
          sessionKey: clientKey.sessionKey,
          limit: 500,
        }).orThrow();
        return connections.entries.length === 0;
      });
      await waitFor(async () => {
        const result = await client!.rpc.auth.sessionsMe({});
        return result.isErr();
      });
    } finally {
      await client?.connection.close().catch(() => undefined);
      await admin.connection.close().catch(() => undefined);
      await service.stop();
    }
  },
});
