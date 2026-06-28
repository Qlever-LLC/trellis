import { assert } from "@std/assert";
import { TrellisClient } from "@qlever-llc/trellis";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

type ControlPlaneSqlite = NonNullable<
  LiveTrellisRuntime["controlPlane"]
>["sqlite"];

const CASE_ID = "auth.sessions-me-rejects-stale-user-principals" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);

liveTrellisTest({
  name:
    "auth.sessions-me-rejects-stale-user-principals rejects deleted sessions and missing user projections",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = requireControlPlaneSqlite(runtime);
    const service = await fixture.setupService(runtime);
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
      await client.rpc.auth.sessionsMe({}).orThrow();

      const session = await sqlite.takeSession(clientKey.sessionKey);
      assert(session !== null, "expected live user session row");
      assert((await client.rpc.auth.sessionsMe({})).isErr());
      await session.restore();

      await sqlite.execute(
        "DELETE FROM users WHERE user_id = (SELECT trellis_id FROM sessions WHERE session_key = ?)",
        [clientKey.sessionKey],
      );
      const missingUser = await client.rpc.auth.sessionsMe({});
      assert(missingUser.isErr());
    } finally {
      await client.connection.close().catch(() => undefined);
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
