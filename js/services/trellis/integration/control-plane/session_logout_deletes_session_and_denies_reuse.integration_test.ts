import { assert, assertEquals } from "@std/assert";
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  base64urlEncode,
  buildLogoutSignaturePayload,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth.ts";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";

const CASE_ID = "control-plane.session-logout-deletes-session-and-denies-reuse";
const clientName = caseScopedName("session-logout-delete-client", CASE_ID);

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.session-logout-delete-client",
    CASE_ID,
  ),
  displayName: "Trellis Session Logout Delete Client",
  description: "Creates a bound app session for signed HTTP logout coverage.",
  uses: {
    required: {
      auth: trellisAuth.use({ rpc: { call: ["Auth.Sessions.Me"] } }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.session-logout-deletes-session-and-denies-reuse deletes the session and returns auth_required on reuse",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = runtime.controlPlane?.sqlite;
    assert(sqlite, "live runtime must expose control-plane SQLite");

    const clientKey = await runtime.registerClient({
      name: clientName,
      contract: clientContract,
    });
    const clientAuth = runtime.clientAuth(clientKey);
    const client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: clientName,
      contract: clientContract,
      auth: clientAuth.auth,
      onAuthRequired: clientAuth.onAuthRequired,
    }).orThrow();
    await client.connection.close();

    const response = await fetchSessionLogout(
      runtime.trellisUrl,
      clientKey.seed,
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { success: true });
    assertEquals(await sessionExists(sqlite, clientKey.sessionKey), false);

    const reuse = await fetchClientBootstrap(
      runtime.trellisUrl,
      clientKey.seed,
    );
    assertEquals(reuse.status, 200);
    assertEquals((await reuse.json()).status, "auth_required");
  },
});

async function fetchSessionLogout(
  trellisUrl: string,
  seed: string,
): Promise<Response> {
  const auth = await createAuth({ sessionKeySeed: seed });
  const iat = auth.currentIat();
  const payload = { iat };
  const sig = base64urlEncode(
    await auth.sign(
      await sha256(
        utf8(`logout-session:${buildLogoutSignaturePayload(payload)}`),
      ),
    ),
  );
  return await fetch(new URL("/auth/sessions/logout", trellisUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey: auth.sessionKey, ...payload, sig }),
  });
}

async function fetchClientBootstrap(
  trellisUrl: string,
  seed: string,
): Promise<Response> {
  const auth = await createAuth({ sessionKeySeed: seed });
  const iat = auth.currentIat();
  const sig = base64urlEncode(
    await auth.sign(await sha256(utf8(`bootstrap-client:${iat}`))),
  );
  return await fetch(new URL("/bootstrap/client", trellisUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey: auth.sessionKey, iat, sig }),
  });
}

async function sessionExists(
  sqlite: NonNullable<LiveTrellisRuntime["controlPlane"]>["sqlite"],
  sessionKey: string,
): Promise<boolean> {
  const rows = await sqlite.query(
    "SELECT 1 FROM sessions WHERE session_key = ?",
    [sessionKey],
  );
  return rows.length > 0;
}
