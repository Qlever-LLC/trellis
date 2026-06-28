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

const CASE_ID = "control-plane.session-logout-uses-provider-logout-redirect";
const providerId = "logout_oidc";
const clientName = caseScopedName("session-logout-provider-client", CASE_ID);

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.session-logout-provider-client",
    CASE_ID,
  ),
  displayName: "Trellis Session Logout Provider Client",
  description:
    "Creates a bound app session for live provider logout redirect coverage.",
}));

liveTrellisTest({
  name:
    "control-plane.session-logout-uses-provider-logout-redirect returns provider logout redirect and deletes the session",
  scope: runtimeScopeForCase(CASE_ID),
  runtime: {
    oauthProviders: {
      [providerId]: {
        type: "oidc",
        issuer: "https://idp.example",
        clientId: "logout-client",
        clientSecret: "logout-secret",
        logout: {
          enabled: true,
          endpoint: "https://idp.example/logout",
          mode: "auth0",
          allowFederated: true,
        },
      },
    },
  },
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
    await rewriteSessionProvider(sqlite, clientKey.sessionKey, providerId);

    const returnTo = new URL("/_trellis/test/signed-out", runtime.trellisUrl)
      .href;
    const response = await fetchSessionLogout(
      runtime.trellisUrl,
      clientKey.seed,
      {
        providerLogout: true,
        federatedProviderLogout: true,
        returnTo,
      },
    );
    const body = await response.json();
    const expected = new URL("https://idp.example/logout");
    expected.searchParams.set("client_id", "logout-client");
    expected.searchParams.set("returnTo", returnTo);
    expected.searchParams.set("federated", "");

    assertEquals(response.status, 200);
    assertEquals(body, { success: true, redirectTo: expected.href });
    assertEquals(await sessionExists(sqlite, clientKey.sessionKey), false);
  },
});

async function fetchSessionLogout(
  trellisUrl: string,
  seed: string,
  options: {
    providerLogout?: boolean;
    federatedProviderLogout?: boolean;
    returnTo?: string;
  },
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

async function rewriteSessionProvider(
  sqlite: NonNullable<LiveTrellisRuntime["controlPlane"]>["sqlite"],
  sessionKey: string,
  provider: string,
): Promise<void> {
  const rows = await sqlite.query(
    "SELECT session FROM sessions WHERE session_key = ?",
    [sessionKey],
  );
  const session: Record<string, unknown> = JSON.parse(String(rows[0]?.session));
  const identity = session.identity as Record<string, unknown> | undefined;
  assert(identity, "expected a user session identity");
  identity.provider = provider;
  identity.identityId = `idn_${provider}_user`;
  await sqlite.execute(
    "UPDATE sessions SET origin = ?, session = ? WHERE session_key = ?",
    [provider, JSON.stringify(session), sessionKey],
  );
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
