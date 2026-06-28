import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { TrellisClient } from "@qlever-llc/trellis";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

type ControlPlaneSqlite = NonNullable<
  LiveTrellisRuntime["controlPlane"]
>["sqlite"];

const CASE_ID =
  "auth.sessions-me-reports-service-envelope-and-current-user-state" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);

liveTrellisTest({
  name:
    "auth.sessions-me-reports-service-envelope-and-current-user-state reports service and current user state",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = requireControlPlaneSqlite(runtime);
    const { service, serviceKey } = await fixture.setupServiceWithKey(runtime);
    const { clientKey, clientAuth } = await fixture.setupClientRegistration(
      runtime,
    );
    const client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: fixture.clientName,
      contract: fixture.clientContract,
      ...clientAuth,
    }).orThrow();

    try {
      const first = await client.rpc.auth.sessionsMe({}).orThrow();
      assert(first.user !== null, "expected Auth.Sessions.Me to return a user");
      assertEquals(first.user.active, true);
      assertArrayIncludes(first.user.capabilities, ["admin"]);
      const originalCapabilities = first.user.capabilities;

      const userId = await sessionUserId(sqlite, clientKey.sessionKey);
      await sqlite.execute(
        "UPDATE users SET capabilities = ?, capability_groups = ? WHERE user_id = ?",
        [
          JSON.stringify(originalCapabilities),
          JSON.stringify(["admin"]),
          userId,
        ],
      );
      const grouped = await client.rpc.auth.sessionsMe({}).orThrow();
      assertArrayIncludes(grouped.user?.capabilities ?? [], [
        "trellis.auth::device.review",
      ]);

      const sessionRows = await sqlite.query(
        "SELECT session FROM sessions WHERE session_key = ?",
        [serviceKey.sessionKey],
      );
      const sessionText = sessionRows[0]?.session;
      assert(typeof sessionText === "string" && sessionText.length > 0);
      const serviceSession = JSON.parse(sessionText);
      assert(
        serviceSession !== null && typeof serviceSession === "object" &&
          !Array.isArray(serviceSession),
      );
      serviceSession.deploymentId = `${serviceSession.deploymentId}.stale`;
      await sqlite.execute(
        "UPDATE sessions SET deployment_id = ?, session = ? WHERE session_key = ?",
        [
          serviceSession.deploymentId,
          JSON.stringify(serviceSession),
          serviceKey.sessionKey,
        ],
      );

      await sqlite.execute(
        "UPDATE service_instances SET capabilities = ? WHERE instance_key = ?",
        [JSON.stringify(["service.current"]), serviceKey.sessionKey],
      );
      const serviceMe = await client.rpc.authLogin.ping({
        message: "sessions-me",
      }).orThrow();
      assertEquals(serviceMe.participantKind, "service");
      assertEquals(serviceMe.serviceActive, true);
      assertArrayIncludes(serviceMe.serviceCapabilities ?? [], [
        "service.current",
      ]);

      await sqlite.execute(
        "UPDATE users SET active = 0, capabilities = ?, capability_groups = ? WHERE user_id = ?",
        [
          JSON.stringify([...originalCapabilities, "users.write"]),
          JSON.stringify([]),
          userId,
        ],
      );
      assert((await client.rpc.auth.sessionsMe({})).isErr());
    } finally {
      await client.connection.close().catch(() => undefined);
      await service.stop();
    }
  },
});

async function sessionUserId(
  sqlite: ControlPlaneSqlite,
  sessionKey: string,
): Promise<string> {
  const rows = await sqlite.query(
    "SELECT trellis_id AS trellisId FROM sessions WHERE session_key = ?",
    [sessionKey],
  );
  const userId = rows[0]?.trellisId;
  assert(typeof userId === "string" && userId.length > 0);
  return userId;
}

function requireControlPlaneSqlite(
  runtime: LiveTrellisRuntime,
): ControlPlaneSqlite {
  const sqlite = runtime.controlPlane?.sqlite;
  assert(sqlite, "live runtime must expose control-plane SQLite");
  return sqlite;
}
