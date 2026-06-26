import {
  base64urlEncode,
  canonicalizeJsonValue,
  sha256,
  toArrayBuffer,
  utf8,
} from "../utils.ts";
import { createProof } from "../proof.ts";
import {
  buildLogoutSignaturePayload,
  type LogoutSignaturePayloadInput,
} from "../schemas.ts";
import { buildNatsConnectSignaturePayload } from "../session_auth.ts";
import {
  deleteKeyPair,
  hasKeyPair,
  loadKeyPair,
  storeKeyPair,
} from "./storage.ts";

export type SessionKeyHandle = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyRaw: Uint8Array;
  sessionKey: string;
  persistence?: SessionKeyPersistenceMode;
  expiresAt?: number;
};

export type SessionKeyPersistenceMode = "temporary" | "remembered";

export type SessionKeyOptions = {
  /** Defaults to remembered IndexedDB storage. */
  persistence?: SessionKeyPersistenceMode;
  /** Expiry for remembered keys, as epoch milliseconds or a Date. */
  expiresAt?: number | Date;
  /** Relative expiry for remembered keys. Ignored when expiresAt is set. */
  ttlMs?: number;
};

let temporarySessionKey: SessionKeyHandle | null = null;

function resolveExpiresAt(options: SessionKeyOptions): number | undefined {
  if (options.expiresAt instanceof Date) return options.expiresAt.getTime();
  if (typeof options.expiresAt === "number") return options.expiresAt;
  if (typeof options.ttlMs === "number") return Date.now() + options.ttlMs;
  return undefined;
}

export async function generateSessionKey(
  options: SessionKeyOptions = {},
): Promise<SessionKeyHandle> {
  const persistence = options.persistence ?? "remembered";
  const expiresAt = resolveExpiresAt(options);
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  ) as CryptoKeyPair;

  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  const sessionKey = base64urlEncode(publicKeyRaw);

  const handle: SessionKeyHandle = {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyRaw,
    sessionKey,
    persistence,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };

  if (persistence === "temporary") {
    temporarySessionKey = handle;
  } else {
    await storeKeyPair(keyPair, publicKeyRaw, { expiresAt });
  }

  return handle;
}

export async function loadSessionKey(
  options: Pick<SessionKeyOptions, "persistence"> = {},
): Promise<SessionKeyHandle | null> {
  const persistence = options.persistence ?? "remembered";
  if (persistence === "temporary") return temporarySessionKey;
  const stored = await loadKeyPair();
  if (!stored) return null;
  return {
    privateKey: stored.privateKey,
    publicKey: stored.publicKey,
    publicKeyRaw: stored.publicKeyRaw,
    sessionKey: base64urlEncode(stored.publicKeyRaw),
    persistence: "remembered",
    ...(stored.expiresAt === undefined ? {} : { expiresAt: stored.expiresAt }),
  };
}

export async function getOrCreateSessionKey(
  options: SessionKeyOptions = {},
): Promise<SessionKeyHandle> {
  const existing = await loadSessionKey(options);
  if (existing) return existing;
  return await generateSessionKey(options);
}

export async function signBytes(
  handle: SessionKeyHandle,
  data: Uint8Array,
): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    handle.privateKey,
    toArrayBuffer(data),
  );
  return new Uint8Array(sig);
}

export function getPublicSessionKey(handle: SessionKeyHandle): string {
  return handle.sessionKey;
}

export async function oauthInitSig(
  handle: SessionKeyHandle,
  redirectTo: string,
  context?: unknown,
  provider?: string,
  contract?: Record<string, unknown> | string,
): Promise<string> {
  const canonicalContext = canonicalizeJsonValue(context ?? null);
  const payload = contract === undefined
    ? `${redirectTo}:${canonicalContext}`
    : `${redirectTo}:${provider ?? ""}:${
      canonicalizeJsonValue(contract)
    }:${canonicalContext}`;
  const digest = await sha256(utf8(`oauth-init:${payload}`));
  const sig = await signBytes(handle, digest);
  return base64urlEncode(sig);
}

export async function bindFlowSig(
  handle: SessionKeyHandle,
  flowId: string,
): Promise<string> {
  const digest = await sha256(utf8(`bind-flow:${flowId}`));
  const sig = await signBytes(handle, digest);
  return base64urlEncode(sig);
}

export async function natsConnectSigForIat(
  handle: SessionKeyHandle,
  iat: number,
  contractDigest: string,
): Promise<string> {
  const digest = await sha256(
    utf8(
      `nats-connect:${buildNatsConnectSignaturePayload(iat, contractDigest)}`,
    ),
  );
  const sig = await signBytes(handle, digest);
  return base64urlEncode(sig);
}

export async function logoutSessionSig(
  handle: SessionKeyHandle,
  input: LogoutSignaturePayloadInput,
): Promise<string> {
  const digest = await sha256(
    utf8(`logout-session:${buildLogoutSignaturePayload(input)}`),
  );
  const sig = await signBytes(handle, digest);
  return base64urlEncode(sig);
}

export async function createRpcProof(
  handle: SessionKeyHandle,
  subject: string,
  payload: Uint8Array,
  requestId: string,
  iat: number,
): Promise<string> {
  const payloadHash = await sha256(payload);
  return await createProof(handle.privateKey, {
    sessionKey: handle.sessionKey,
    subject,
    payloadHash,
    iat,
    requestId,
  });
}

export async function clearSessionKey(
  options: Pick<SessionKeyOptions, "persistence"> = {},
): Promise<void> {
  const persistence = options.persistence;
  if (persistence === undefined || persistence === "temporary") {
    temporarySessionKey = null;
  }
  if (persistence === undefined || persistence === "remembered") {
    await deleteKeyPair();
  }
}

export async function hasSessionKey(
  options: Pick<SessionKeyOptions, "persistence"> = {},
): Promise<boolean> {
  const persistence = options.persistence ?? "remembered";
  if (persistence === "temporary") return temporarySessionKey !== null;
  return await hasKeyPair();
}
