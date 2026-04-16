import { assert, assertEquals } from "@std/assert";
import {
  base64urlDecode,
  base64urlEncode,
  createAuth,
  sha256,
  toArrayBuffer,
  trellisIdFromOriginId,
  utf8,
  verifyProof,
} from "./mod.ts";

Deno.test("createAuth derives sessionKey from 32-byte seed", async () => {
  const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const auth = await createAuth({ sessionKeySeed: seed });

  const pk = base64urlDecode(auth.sessionKey);
  assertEquals(pk.length, 32);
});

Deno.test("oauthInitSig signs hash('oauth-init:' + redirectTo + ':' + canonicalContext)", async () => {
  const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const auth = await createAuth({ sessionKeySeed: seed });

  const redirectTo = "https://example.com/app";
  const sig = await auth.oauthInitSig(redirectTo, { subtitle: "Welcome back" });

  const digest = await sha256(utf8(`oauth-init:${redirectTo}:{"subtitle":"Welcome back"}`));
  const pub = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(base64urlDecode(auth.sessionKey)),
    { name: "Ed25519" },
    true,
    ["verify"],
  );

  const ok = await crypto.subtle.verify(
    { name: "Ed25519" },
    pub,
    toArrayBuffer(base64urlDecode(sig)),
    toArrayBuffer(digest),
  );
  assert(ok);
});

Deno.test("proof creation and verification match ADR format", async () => {
  const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const auth = await createAuth({ sessionKeySeed: seed });

  const subject = "rpc.v1.User.Find";
  const payloadHash = await sha256(utf8(JSON.stringify({ userId: { origin: "github", id: "1" } })));
  const proof = await auth.createProof(subject, payloadHash);

  const ok = await verifyProof(
    auth.sessionKey,
    { sessionKey: auth.sessionKey, subject, payloadHash },
    proof,
  );
  assert(ok);

  const bad = await verifyProof(
    auth.sessionKey,
    { sessionKey: auth.sessionKey, subject, payloadHash: await sha256(utf8("different")) },
    proof,
  );
  assertEquals(bad, false);
});

Deno.test("trellisIdFromOriginId is stable and 22 chars", async () => {
  const id1 = await trellisIdFromOriginId("github", "123");
  const id2 = await trellisIdFromOriginId("github", "123");
  const id3 = await trellisIdFromOriginId("github", "124");

  assertEquals(id1.length, 22);
  assertEquals(id1, id2);
  assert(id1 !== id3);
});
