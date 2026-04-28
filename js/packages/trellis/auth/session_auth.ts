import { type Authenticator } from "@nats-io/nats-core";

import {
  importEd25519PrivateKeyFromSeedBase64url,
  publicKeyBase64urlFromSeed,
  signEd25519SeedSha256,
} from "./keys.ts";
import { createProof } from "./proof.ts";
import { correctedIatSeconds } from "./time.ts";
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
  currentIat: () => number;
  setServerClockOffsetMs: (clockOffsetMs: number) => void;

  oauthInitSig: (
    redirectTo: string,
    context?: unknown,
    provider?: string,
    contract?: Record<string, unknown>,
  ) => Promise<string>;
  bindFlowSig: (flowId: string) => Promise<string>;
  natsConnectSigForIat: (
    iat: number,
    contractDigest: string,
  ) => Promise<string>;

  createProof: (subject: string, payloadHash: Uint8Array) => Promise<string>;
  natsConnectOptions: (
    opts: { contractDigest: string },
  ) => Promise<NatsConnectOptions>;
};

/**
 * Builds the canonical value signed for NATS runtime-auth tokens.
 */
export function buildNatsConnectSignaturePayload(
  iat: number,
  contractDigest: string,
): string {
  return `${iat}:${contractDigest}`;
}

export async function createAuth(
  opts: { sessionKeySeed: string },
): Promise<TrellisAuth> {
  const seed = base64urlDecode(opts.sessionKeySeed);
  const privateKey = await importEd25519PrivateKeyFromSeedBase64url(
    opts.sessionKeySeed,
  );
  const sessionKey = publicKeyBase64urlFromSeed(seed);
  let serverClockOffsetMs = 0;

  const sign = async (data: Uint8Array): Promise<Uint8Array> => {
    const sig = await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      toArrayBuffer(data),
    );
    return new Uint8Array(sig);
  };

  const signDomainHash = async (
    prefix: string,
    value: string,
  ): Promise<string> => {
    const digest = await sha256(utf8(`${prefix}:${value}`));
    const sigBytes = await sign(digest);
    return base64urlEncode(sigBytes);
  };

  const signOauthInit = async (
    redirectTo: string,
    context?: unknown,
    provider?: string,
    contract?: Record<string, unknown>,
  ): Promise<string> => {
    const canonicalContext = canonicalizeJsonValue(context ?? null);
    const payload = contract === undefined
      ? `${redirectTo}:${canonicalContext}`
      : `${redirectTo}:${provider ?? ""}:${
        canonicalizeJsonValue(contract)
      }:${canonicalContext}`;
    return await signDomainHash("oauth-init", payload);
  };

  const buildServiceNatsAuthToken = (
    iat: number,
    contractDigest: string,
  ): NatsAuthTokenV1 => {
    return {
      v: 1,
      sessionKey,
      iat,
      contractDigest,
      sig: base64urlEncode(
        signEd25519SeedSha256(
          seed,
          utf8(
            `nats-connect:${
              buildNatsConnectSignaturePayload(iat, contractDigest)
            }`,
          ),
        ),
      ),
    };
  };

  const currentIat = (): number =>
    correctedIatSeconds(Date.now(), serverClockOffsetMs);

  return {
    sessionKey,
    sign,
    currentIat,
    setServerClockOffsetMs: (clockOffsetMs) => {
      serverClockOffsetMs = clockOffsetMs;
    },
    oauthInitSig: signOauthInit,
    bindFlowSig: (flowId) => signDomainHash("bind-flow", flowId),
    natsConnectSigForIat: (iat, contractDigest) =>
      signDomainHash(
        "nats-connect",
        buildNatsConnectSignaturePayload(iat, contractDigest),
      ),
    createProof: (subject, payloadHash) =>
      createProof(privateKey, { sessionKey, subject, payloadHash }),
    natsConnectOptions: async (options) => {
      return {
        authenticator: () => {
          const authToken = buildServiceNatsAuthToken(
            currentIat(),
            options.contractDigest,
          );
          return { auth_token: JSON.stringify(authToken) };
        },
        inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}`,
      };
    },
  };
}
