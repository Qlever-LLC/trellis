import { assert, assertEquals } from "@std/assert";
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";
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

const CASE_ID = "control-plane.session-logout-validates-return-to";
const clientName = caseScopedName("session-logout-return-to-client", CASE_ID);

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.session-logout-return-to-client",
    CASE_ID,
  ),
  displayName: "Trellis Session Logout ReturnTo Client",
  description: "Creates a bound app session for logout returnTo validation.",
}));

liveTrellisTest({
  name:
    "control-plane.session-logout-validates-return-to rejects cross-origin returnTo and accepts same-origin returnTo",
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

    const rejected = await fetchSessionLogout(
      runtime.trellisUrl,
      clientKey.seed,
      {
        returnTo: "https://evil.example/signed-out",
      },
    );
    assertEquals(rejected.status, 400);
    assertEquals(await rejected.json(), { error: "invalid_return_to" });
    assertEquals(await sessionExists(sqlite, clientKey.sessionKey), true);

    const returnTo = new URL("/_trellis/test/signed-out", runtime.trellisUrl)
      .href;
    const accepted = await fetchSessionLogout(
      runtime.trellisUrl,
      clientKey.seed,
      {
        returnTo,
      },
    );
    assertEquals(accepted.status, 200);
    assertEquals(await accepted.json(), {
      success: true,
      redirectTo: returnTo,
    });
    assertEquals(await sessionExists(sqlite, clientKey.sessionKey), false);
  },
});

async function fetchSessionLogout(
  trellisUrl: string,
  seed: string,
  options: { returnTo?: string } = {},
): Promise<Response> {
  const auth = await createAuth({ sessionKeySeed: seed });
  const iat = auth.currentIat();
  const payload = { iat, ...options };
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
