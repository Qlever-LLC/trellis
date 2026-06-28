import { assertEquals } from "@std/assert";
import { TrellisClient } from "@qlever-llc/trellis";
import { waitFor } from "@qlever-llc/trellis-test";
import { connectionKey } from "../../services/trellis/auth/session/connections.ts";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID =
  "auth.connections-list-skips-malformed-connection-entries" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);

liveTrellisTest({
  name:
    "auth.connections-list-skips-malformed-connection-entries skips malformed presence and returns valid entries",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.setupService(runtime);
    const admin = await fixture.setupSessionAdmin(runtime);
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
      await client.rpc.authLogin.ping({ message: fixture.pingMessage })
        .orThrow();
      const valid = await waitFor(async () => {
        const page = await admin.rpc.auth.connectionsList({
          sessionKey: clientKey.sessionKey,
          limit: 500,
        }).orThrow();
        return page.entries[0] ?? false;
      });
      if (valid.principal.type !== "user") {
        throw new Error("expected app connection to carry user principal");
      }
      if (!runtime.seedRawAuthConnectionPresence) {
        throw new Error("runtime cannot seed raw auth connection presence");
      }

      await runtime.seedRawAuthConnectionPresence({
        key: connectionKey(
          clientKey.sessionKey,
          valid.principal.userId,
          `${valid.userNkey}_malformed`,
        ),
        value: {
          serverId: "malformed-server",
          connectedAt: new Date().toISOString(),
        },
      });

      const listed = await admin.rpc.auth.connectionsList({
        sessionKey: clientKey.sessionKey,
        limit: 500,
      }).orThrow();
      assertEquals(listed.count, 1);
      assertEquals(listed.entries.map((entry) => entry.userNkey), [
        valid.userNkey,
      ]);
    } finally {
      await client.connection.close().catch(() => undefined);
      await admin.connection.close().catch(() => undefined);
      await service.stop();
    }
  },
});
