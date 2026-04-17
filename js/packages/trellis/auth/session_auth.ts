import { type Authenticator } from "@nats-io/nats-core";
import { Buffer } from "node:buffer";
import { createHash, createPrivateKey, sign as signBytesSync } from "node:crypto";

import {
  importEd25519PrivateKeyFromSeedBase64url,
  pkcs8FromEd25519Seed,
  publicKeyBase64urlFromPrivateKey,
} from "./keys.ts";
import { createProof } from "./proof.ts";
import {
  base64urlDecode,
  base64urlEncode,
  canonicalizeJsonValue,
  sha256,
  toArrayBuffer,
  utf8,
} from "./utils.ts";
import type { NatsAuthTokenV1 } from "./types.ts";

export type NatsConnectOptions = {
  authenticator: Authenticator;
  inboxPrefix: string;
};

export type TrellisAuth = {
  sessionKey: string; // base64url raw public key
  sign: (data: Uint8Array) => Promise<Uint8Array>;

  oauthInitSig: (redirectTo: string, context?: unknown) => Promise<string>;
  bindSig: (authToken: string) => Promise<string>;
  natsConnectSigForBindingToken: (bindingToken: string) => Promise<string>;
  natsConnectSigForIat: (iat: number) => Promise<string>;

  createProof: (subject: string, payloadHash: Uint8Array) => Promise<string>;
  natsConnectOptions: () => Promise<NatsConnectOptions>;
};

export async function createAuth(
  opts: { sessionKeySeed: string },
): Promise<TrellisAuth> {
  const seed = base64urlDecode(opts.sessionKeySeed);
  const privateKey = await importEd25519PrivateKeyFromSeedBase64url(opts.sessionKeySeed);
  const sessionKey = await publicKeyBase64urlFromPrivateKey(privateKey);
  const reconnectKey = createPrivateKey({
    key: Buffer.from(pkcs8FromEd25519Seed(seed)),
    format: "der",
    type: "pkcs8",
  });

  const sign = async (data: Uint8Array): Promise<Uint8Array> => {
    const sig = await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      toArrayBuffer(data),
    );
    return new Uint8Array(sig);
  };

  const signDomainHash = async (prefix: string, value: string): Promise<string> => {
    const digest = await sha256(utf8(`${prefix}:${value}`));
    const sigBytes = await sign(digest);
    return base64urlEncode(sigBytes);
  };

  const signOauthInit = async (redirectTo: string, context?: unknown): Promise<string> => {
    const canonicalContext = canonicalizeJsonValue(context ?? null);
    return await signDomainHash("oauth-init", `${redirectTo}:${canonicalContext}`);
  };

  const buildServiceNatsAuthToken = (iat: number): NatsAuthTokenV1 => {
    const digest = createHash("sha256").update(`nats-connect:${iat}`, "utf8").digest();
    const sig = signBytesSync(null, digest, reconnectKey);
    return {
      v: 1,
      sessionKey,
      iat,
      sig: base64urlEncode(new Uint8Array(sig)),
    };
  };

  return {
    sessionKey,
    sign,
    oauthInitSig: signOauthInit,
    bindSig: (authToken) => signDomainHash("bind", authToken),
    natsConnectSigForBindingToken: (bindingToken) =>
      signDomainHash("nats-connect", bindingToken),
    natsConnectSigForIat: (iat) => signDomainHash("nats-connect", String(iat)),
    createProof: (subject, payloadHash) =>
      createProof(privateKey, { sessionKey, subject, payloadHash }),
    natsConnectOptions: async () => {
      return {
        authenticator: () => {
          const authToken = buildServiceNatsAuthToken(Math.floor(Date.now() / 1000));
          return { auth_token: JSON.stringify(authToken) };
        },
        inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}`,
      };
    },
  };
}
