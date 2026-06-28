import { assert } from "@std/assert";
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";
import {
  base64urlEncode,
  buildLogoutSignaturePayload,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth.ts";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { waitFor } from "@qlever-llc/trellis-test";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID = "control-plane.session-logout-kicks-runtime-access";
const clientName = caseScopedName("session-logout-kick-client", CASE_ID);

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.session-logout-kick-client",
    CASE_ID,
  ),
  displayName: "Trellis Session Logout Kick Client",
  description:
    "Keeps live app connections open to verify HTTP logout revokes runtime access.",
  uses: {
    required: {
      auth: trellisAuth.use({ rpc: { call: ["Auth.Sessions.Me"] } }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.session-logout-kicks-runtime-access kicks all live connections for the session key",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const clientKey = await runtime.registerClient({
      name: clientName,
      contract: clientContract,
    });
    const clientAuth = runtime.clientAuth(clientKey);
    const first = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: clientName,
      contract: clientContract,
      auth: clientAuth.auth,
      onAuthRequired: clientAuth.onAuthRequired,
    }).orThrow();
    const second = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: `${clientName}-second`,
      contract: clientContract,
      auth: clientAuth.auth,
      onAuthRequired: clientAuth.onAuthRequired,
    }).orThrow();

    try {
      await first.rpc.auth.sessionsMe({}).orThrow();
      await second.rpc.auth.sessionsMe({}).orThrow();

      const logout = await fetchSessionLogout(
        runtime.trellisUrl,
        clientKey.seed,
      );
      assert(logout.ok, `expected logout to succeed, got ${logout.status}`);

      await waitFor(async () => {
        const firstMe = await first.rpc.auth.sessionsMe({});
        const secondMe = await second.rpc.auth.sessionsMe({});
        return firstMe.isErr() && secondMe.isErr();
      });
    } finally {
      await first.connection.close().catch(() => undefined);
      await second.connection.close().catch(() => undefined);
    }
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
