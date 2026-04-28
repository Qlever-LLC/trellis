import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  base64urlDecode,
  base64urlEncode,
  correctedIatSeconds,
  createAuth,
  sha256,
  toArrayBuffer,
  trellisIdFromOriginId,
  utf8,
  verifyProof,
} from "./mod.ts";

function authTokenFromAuthenticatorResult(value: unknown): string {
  if (!value || typeof value !== "object") {
    throw new Error(
      "Expected NATS authenticator to return an auth token payload",
    );
  }

  const record = value as { auth_token?: unknown };
  if (typeof record.auth_token !== "string") {
    throw new Error("Expected NATS authenticator to return auth_token");
  }

  return record.auth_token;
}

Deno.test("createAuth derives sessionKey from 32-byte seed", async () => {
  const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const auth = await createAuth({ sessionKeySeed: seed });

  const pk = base64urlDecode(auth.sessionKey);
  assertEquals(pk.length, 32);
});

Deno.test("oauthInitSig signs the auth-start payload including provider, contract, and context", async () => {
  const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const auth = await createAuth({ sessionKeySeed: seed });

  const redirectTo = "https://example.com/app";
  const sig = await auth.oauthInitSig(
    redirectTo,
    { subtitle: "Welcome back" },
    "github",
    { id: "trellis.console@v1", origin: "https://console.example.com" },
  );

  const digest = await sha256(
    utf8(
      'oauth-init:https://example.com/app:github:{"id":"trellis.console@v1","origin":"https://console.example.com"}:{"subtitle":"Welcome back"}',
    ),
  );
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
  const payloadHash = await sha256(
    utf8(JSON.stringify({ userId: { origin: "github", id: "1" } })),
  );
  const proof = await auth.createProof(subject, payloadHash);

  const ok = await verifyProof(
    auth.sessionKey,
    { sessionKey: auth.sessionKey, subject, payloadHash },
    proof,
  );
  assert(ok);

  const bad = await verifyProof(
    auth.sessionKey,
    {
      sessionKey: auth.sessionKey,
      subject,
      payloadHash: await sha256(utf8("different")),
    },
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

Deno.test("natsConnectOptions returns a reconnect-safe authenticator with fresh iat values", async () => {
  const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const auth = await createAuth({ sessionKeySeed: seed });
  const originalNow = Date.now;

  try {
    let nowMs = 1_700_000_000_000;
    Date.now = () => nowMs;

    const options = await auth.natsConnectOptions({
      contractDigest: "digest-a",
    });
    const firstToken = JSON.parse(
      authTokenFromAuthenticatorResult(options.authenticator()),
    ) as {
      sessionKey: string;
      iat: number;
      sig: string;
      contractDigest: string;
    };

    nowMs += 31_000;

    const secondToken = JSON.parse(
      authTokenFromAuthenticatorResult(options.authenticator()),
    ) as {
      sessionKey: string;
      iat: number;
      sig: string;
      contractDigest: string;
    };

    assertEquals(options.inboxPrefix, `_INBOX.${auth.sessionKey.slice(0, 16)}`);
    assertEquals(firstToken.sessionKey, auth.sessionKey);
    assertEquals(secondToken.sessionKey, auth.sessionKey);
    assertEquals(firstToken.contractDigest, "digest-a");
    assertEquals(secondToken.contractDigest, "digest-a");
    assertEquals(
      firstToken.sig,
      await auth.natsConnectSigForIat(
        firstToken.iat,
        firstToken.contractDigest,
      ),
    );
    assertEquals(
      secondToken.sig,
      await auth.natsConnectSigForIat(
        secondToken.iat,
        secondToken.contractDigest,
      ),
    );
    assertEquals(secondToken.iat - firstToken.iat, 31);
    assertNotEquals(firstToken.sig, secondToken.sig);
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("createAuth applies server clock offsets to current iat and reconnect auth tokens", async () => {
  const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const auth = await createAuth({ sessionKeySeed: seed });
  const originalNow = Date.now;

  try {
    Date.now = () => 1_700_000_000_250;
    auth.setServerClockOffsetMs(900);

    assertEquals(auth.currentIat(), correctedIatSeconds(Date.now(), 900));

    const options = await auth.natsConnectOptions({
      contractDigest: "digest-a",
    });
    const token = JSON.parse(
      authTokenFromAuthenticatorResult(options.authenticator()),
    ) as {
      iat: number;
      sig: string;
      contractDigest: string;
    };

    assertEquals(token.iat, 1_700_000_001);
    assertEquals(
      token.sig,
      await auth.natsConnectSigForIat(1_700_000_001, token.contractDigest),
    );
  } finally {
    Date.now = originalNow;
  }
});
