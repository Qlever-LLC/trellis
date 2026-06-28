import { assert, assertEquals } from "@std/assert";
import {
  type ConnectedTrellisClient,
  TrellisClient,
} from "@qlever-llc/trellis";
import { waitFor } from "@qlever-llc/trellis-test";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID = "auth.sessions-revoke-cascades-app-grants" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);
type SessionAdminClient = Awaited<ReturnType<typeof fixture.setupSessionAdmin>>;
type ControlPlaneSqlite = NonNullable<
  LiveTrellisRuntime["controlPlane"]
>["sqlite"];

liveTrellisTest({
  name:
    "auth.sessions-revoke-cascades-app-grants revokes sibling app sessions and deletes the grant",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = requireControlPlaneSqlite(runtime);
    const service = await fixture.setupService(runtime);
    const admin = await fixture.setupSessionAdmin(runtime);
    const firstRegistration = await fixture.setupClientRegistration(runtime);
    const secondRegistration = await runtime.registerClient({
      name: `${fixture.clientName}-sibling`,
      contract: fixture.clientContract,
    });
    const secondAuth = runtime.clientAuth(secondRegistration);
    let first:
      | ConnectedTrellisClient<typeof fixture.clientContract>
      | undefined;
    let second:
      | ConnectedTrellisClient<typeof fixture.clientContract>
      | undefined;

    try {
      first = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: fixture.clientName,
        contract: fixture.clientContract,
        auth: firstRegistration.clientAuth.auth,
        onAuthRequired: async (ctx) =>
          await firstRegistration.clientAuth.onAuthRequired(ctx),
      }).orThrow();
      second = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: `${fixture.clientName}-sibling`,
        contract: fixture.clientContract,
        auth: secondAuth.auth,
        onAuthRequired: async (ctx) => await secondAuth.onAuthRequired(ctx),
      }).orThrow();

      await first.rpc.authLogin.ping({ message: `${fixture.pingMessage}-1` })
        .orThrow();
      await second.rpc.authLogin.ping({ message: `${fixture.pingMessage}-2` })
        .orThrow();
      await appSessionFor(admin, firstRegistration.clientKey.sessionKey);
      await appSessionFor(admin, secondRegistration.sessionKey);
      await waitForConnection(admin, firstRegistration.clientKey.sessionKey);
      await waitForConnection(admin, secondRegistration.sessionKey);

      const identityGrantId = await sharedIdentityGrantId(
        sqlite,
        firstRegistration.clientKey.sessionKey,
        secondRegistration.sessionKey,
      );
      assertEquals(await grantExists(sqlite, identityGrantId), true);

      const revoked = await admin.rpc.auth.sessionsRevoke({
        sessionKey: firstRegistration.clientKey.sessionKey,
      }).orThrow();
      assertEquals(revoked.success, true);

      await waitForSessionAbsent(admin, firstRegistration.clientKey.sessionKey);
      await waitForSessionAbsent(admin, secondRegistration.sessionKey);
      await waitForConnectionsAbsent(
        admin,
        firstRegistration.clientKey.sessionKey,
      );
      await waitForConnectionsAbsent(admin, secondRegistration.sessionKey);
      await waitFor(async () => !(await grantExists(sqlite, identityGrantId)));
      await waitFor(async () =>
        (await first!.rpc.auth.sessionsMe({})).isErr() &&
        (await second!.rpc.auth.sessionsMe({})).isErr()
      );
    } finally {
      await first?.connection.close().catch(() => undefined);
      await second?.connection.close().catch(() => undefined);
      await admin.connection.close().catch(() => undefined);
      await service.stop();
    }
  },
});

function requireControlPlaneSqlite(
  runtime: LiveTrellisRuntime,
): ControlPlaneSqlite {
  const sqlite = runtime.controlPlane?.sqlite;
  assert(sqlite, "live runtime must expose control-plane SQLite");
  return sqlite;
}

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

async function waitForSessionAbsent(
  admin: SessionAdminClient,
  sessionKey: string,
) {
  await waitFor(async () => {
    const sessions = await admin.rpc.auth.sessionsList({ limit: 500 })
      .orThrow();
    return sessions.entries.every((entry) => entry.sessionKey !== sessionKey);
  });
}

async function waitForConnection(
  admin: SessionAdminClient,
  sessionKey: string,
) {
  await waitFor(async () => {
    const connections = await admin.rpc.auth.connectionsList({
      sessionKey,
      limit: 500,
    }).orThrow();
    return connections.entries.length > 0;
  });
}

async function waitForConnectionsAbsent(
  admin: SessionAdminClient,
  sessionKey: string,
) {
  await waitFor(async () => {
    const connections = await admin.rpc.auth.connectionsList({
      sessionKey,
      limit: 500,
    }).orThrow();
    return connections.entries.length === 0;
  });
}

async function sharedIdentityGrantId(
  sqlite: ControlPlaneSqlite,
  firstSessionKey: string,
  secondSessionKey: string,
): Promise<string> {
  const rows = await sqlite.query(
    "SELECT DISTINCT identity_grant_id AS identityGrantId FROM sessions WHERE session_key IN (?, ?)",
    [firstSessionKey, secondSessionKey],
  );
  assertEquals(rows.length, 1);
  const identityGrantId = rows[0]?.identityGrantId;
  assert(typeof identityGrantId === "string" && identityGrantId.length > 0);
  return identityGrantId;
}

async function grantExists(
  sqlite: ControlPlaneSqlite,
  identityGrantId: string,
): Promise<boolean> {
  const rows = await sqlite.query(
    "SELECT identity_grant_id FROM identity_grants WHERE identity_grant_id = ?",
    [identityGrantId],
  );
  return rows.length > 0;
}
