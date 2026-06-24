import { assert, assertEquals } from "@std/assert";
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import {
  liveTrellisTest,
  restartTrellisControlPlane,
  runtimeScopeForCase,
} from "../_support/runtime.ts";

const CASE_ID = "control-plane.sessions-survive-control-plane-restart";
const clientName = caseScopedName("sessions-restart-client", CASE_ID);

const sessionsRestartClientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.sessions-restart-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Sessions Restart Client",
  description:
    "Verifies approved app sessions remain authenticated after control-plane restart.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: { call: ["Auth.Sessions.Me", "Auth.Sessions.List"] },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.sessions-survive-control-plane-restart reuses an approved app session after restart",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const clientKey = await runtime.registerClient({
      name: clientName,
      contract: sessionsRestartClientContract,
    });
    const clientAuth = runtime.clientAuth(clientKey);

    let client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: clientName,
      contract: sessionsRestartClientContract,
      auth: clientAuth.auth,
      onAuthRequired: clientAuth.onAuthRequired,
    }).orThrow();

    try {
      const beforeMe = await client.rpc.auth.sessionsMe({}).orThrow();
      assertEquals(beforeMe.participantKind, "app");
      assert(beforeMe.user !== null, "expected authenticated user session");

      assertSessionListed(
        await client.rpc.auth.sessionsList({ limit: 100 }).orThrow(),
        clientKey.sessionKey,
      );

      await client.connection.close();

      await restartTrellisControlPlane(runtime);

      client = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: clientName,
        contract: sessionsRestartClientContract,
        auth: clientAuth.auth,
        onAuthRequired: () => {
          throw new Error("session reconnect unexpectedly required auth flow");
        },
      }).orThrow();

      const afterMe = await client.rpc.auth.sessionsMe({}).orThrow();
      assertEquals(afterMe.participantKind, "app");
      assertEquals(afterMe.user?.userId, beforeMe.user.userId);
      assertEquals(afterMe.user?.active, true);

      assertSessionListed(
        await client.rpc.auth.sessionsList({ limit: 100 }).orThrow(),
        clientKey.sessionKey,
      );
    } finally {
      await client.connection.close().catch(() => undefined);
    }
  },
});

function assertSessionListed(
  response: { entries: Array<{ sessionKey: string; participantKind: string }> },
  sessionKey: string,
): void {
  const session = response.entries.find((entry) =>
    entry.sessionKey === sessionKey
  );
  assert(session, `expected Auth.Sessions.List to include ${sessionKey}`);
  assertEquals(session.participantKind, "app");
}
