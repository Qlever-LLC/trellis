import { assertEquals } from "@std/assert";

import { buildLoginUrl } from "./login.ts";
import type { SessionKeyHandle } from "./session.ts";

async function createHandle(): Promise<SessionKeyHandle> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const sessionKey = btoa(String.fromCharCode(...publicKeyRaw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyRaw,
    sessionKey,
  };
}

Deno.test("buildLoginUrl targets auth chooser when provider is omitted", async () => {
  const url = await buildLoginUrl(
    { authUrl: "http://localhost:3000" },
    undefined,
    "http://localhost:5173/profile",
    await createHandle(),
    { id: "demo.app@v1" },
  );

  const parsed = new URL(url);
  assertEquals(parsed.pathname, "/auth/login");
  assertEquals(parsed.searchParams.get("redirectTo"), "http://localhost:5173/profile");
  assertEquals(parsed.searchParams.get("contract"), "eyJpZCI6ImRlbW8uYXBwQHYxIn0");
});
