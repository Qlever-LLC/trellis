import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import {
  base64urlEncode,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth.ts";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID = "control-plane.http-route-security-requires-admin-session";
const clientName = caseScopedName(
  "control-plane-http-route-security-probe",
  CASE_ID,
);

const adminHttpRouteProbeContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.http-route-security-probe",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane HTTP Route Security Probe",
  description:
    "Verifies control-plane HTTP bootstrap requires an authenticated admin session.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: { call: ["Auth.Sessions.Me", "Auth.Users.List"] },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.http-route-security-requires-admin-session rejects unauthenticated admin HTTP access",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const unauthenticatedSeed = randomSessionSeed();
    const unauthenticated = await fetchClientBootstrap(
      runtime.trellisUrl,
      unauthenticatedSeed,
    );
    assertEquals(unauthenticated.response.status, 200);
    assertEquals(unauthenticated.body.status, "auth_required");

    const adminSessionSeed = randomSessionSeed();
    const client = await runtime.connectClient({
      name: clientName,
      contract: adminHttpRouteProbeContract,
      sessionKeySeed: adminSessionSeed,
    });

    try {
      const me = await client.rpc.auth.sessionsMe({}).orThrow();
      assert(me.user !== null, "expected admin client session user");
      assertArrayIncludes(me.user.capabilities, ["admin"]);

      const authenticated = await fetchClientBootstrap(
        runtime.trellisUrl,
        adminSessionSeed,
      );
      assertEquals(authenticated.response.status, 200);
      assertEquals(authenticated.body.status, "ready");

      const connectInfo = requireRecord(
        authenticated.body.connectInfo,
        "connectInfo",
      );
      assertEquals(connectInfo.sessionKey, authenticated.sessionKey);

      const binding = requireRecord(authenticated.body.binding, "binding");
      assertArrayIncludes(
        requireStringArray(binding.capabilities, "binding.capabilities"),
        ["admin"],
      );
    } finally {
      await client.connection.close();
    }
  },
});

function randomSessionSeed(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function fetchClientBootstrap(
  trellisUrl: string,
  sessionKeySeed: string,
) {
  const auth = await createAuth({ sessionKeySeed });
  const iat = auth.currentIat();
  const sig = base64urlEncode(
    await auth.sign(await sha256(utf8(`bootstrap-client:${iat}`))),
  );
  const response = await fetch(new URL("/bootstrap/client", trellisUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey: auth.sessionKey, iat, sig }),
  });

  return {
    response,
    sessionKey: auth.sessionKey,
    body: requireRecord(await response.json(), "bootstrap response"),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `expected ${label} to be an object`,
  );
  return value as Record<string, unknown>;
}

function requireStringArray(value: unknown, label: string): string[] {
  assert(
    Array.isArray(value) && value.every((entry) => typeof entry === "string"),
    `expected ${label} to be a string array`,
  );
  return value;
}
