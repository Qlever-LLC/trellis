import { assert, assertEquals } from "@std/assert";
import {
  type ConnectedTrellisClient,
  TrellisClient,
} from "@qlever-llc/trellis";
import { waitFor } from "@qlever-llc/trellis-test";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID =
  "auth.session-revoke-cleans-runtime-connection-presence" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);
type SessionAdminClient = Awaited<ReturnType<typeof fixture.setupSessionAdmin>>;

liveTrellisTest({
  name:
    "auth.session-revoke-cleans-runtime-connection-presence removes runtime connection presence for a revoked app session",
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

      const targetSession = await appSessionFor(admin, clientKey.sessionKey);
      const beforeConnections = await waitFor(async () => {
        const page = await admin.rpc.auth.connectionsList({
          sessionKey: targetSession.sessionKey,
          limit: 500,
        }).orThrow();
        return page.entries.length > 0 && page;
      });
      assertEquals(
        beforeConnections.entries[0]?.sessionKey,
        targetSession.sessionKey,
      );

      const revoked = await admin.rpc.auth.sessionsRevoke({
        sessionKey: targetSession.sessionKey,
      }).orThrow();
      assertEquals(revoked.success, true);

      await waitFor(async () => {
        const sessions = await admin.rpc.auth.sessionsList({ limit: 500 })
          .orThrow();
        return sessions.entries.every((entry) =>
          entry.sessionKey !== targetSession.sessionKey
        );
      });
      await waitFor(async () => {
        const connections = await admin.rpc.auth.connectionsList({
          sessionKey: targetSession.sessionKey,
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

async function appSessionFor(
  admin: SessionAdminClient,
  sessionKey: string,
) {
  const sessions = await admin.rpc.auth.sessionsList({ limit: 500 }).orThrow();
  const session = sessions.entries.find((entry) =>
    entry.participantKind === "app" && entry.sessionKey === sessionKey
  );
  assert(session, "expected Auth.Sessions.List to include app session");
  return session;
}
