import { assertEquals } from "@std/assert";
import {
  base64urlEncode,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth.ts";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID = "control-plane.bootstrap-requires-auth-for-unbound-client";

liveTrellisTest({
  name:
    "control-plane.bootstrap-requires-auth-for-unbound-client returns auth_required without a bound session",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const auth = await createAuth({ sessionKeySeed: randomSessionSeed() });
    const response = await fetchClientBootstrap(runtime.trellisUrl, auth);
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.status, "auth_required");
  },
});

function randomSessionSeed(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function fetchClientBootstrap(
  trellisUrl: string,
  auth: Awaited<ReturnType<typeof createAuth>>,
): Promise<Response> {
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
