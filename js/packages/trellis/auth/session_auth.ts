import {
  importEd25519PrivateKeyFromSeedBase64url,
  publicKeyBase64urlFromPrivateKey,
} from "./keys.ts";
import { createProof } from "./proof.ts";
import { base64urlEncode, canonicalizeJsonValue, sha256, toArrayBuffer, utf8 } from "./utils.ts";
import type { NatsAuthTokenV1 } from "./types.ts";

export type NatsConnectOptions = {
  token: string;
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
  createNatsAuthTokenForService: (iat: number) => Promise<NatsAuthTokenV1>;
  natsConnectOptions: () => Promise<NatsConnectOptions>;
};

export async function createAuth(
  opts: { sessionKeySeed: string },
): Promise<TrellisAuth> {
  const privateKey = await importEd25519PrivateKeyFromSeedBase64url(opts.sessionKeySeed);
  const sessionKey = await publicKeyBase64urlFromPrivateKey(privateKey);

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
    createNatsAuthTokenForService: async (iat) => {
      const sig = await signDomainHash("nats-connect", String(iat));
      return { v: 1, sessionKey, iat, sig };
    },
    natsConnectOptions: async () => {
      const iat = Math.floor(Date.now() / 1000);
      const sig = await signDomainHash("nats-connect", String(iat));
      const authToken: NatsAuthTokenV1 = { v: 1, sessionKey, iat, sig };
      return {
        token: JSON.stringify(authToken),
        inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}`,
      };
    },
  };
}
