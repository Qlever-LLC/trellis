import { base64urlEncode, sha256, toArrayBuffer, utf8 } from "../utils.ts";
import { createProof } from "../proof.ts";
import { deleteKeyPair, hasKeyPair, loadKeyPair, storeKeyPair } from "./storage.ts";

export type SessionKeyHandle = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyRaw: Uint8Array;
  sessionKey: string;
};

export async function generateSessionKey(): Promise<SessionKeyHandle> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  ) as CryptoKeyPair;

  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const sessionKey = base64urlEncode(publicKeyRaw);

  await storeKeyPair(keyPair, publicKeyRaw);

  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, publicKeyRaw, sessionKey };
}

export async function loadSessionKey(): Promise<SessionKeyHandle | null> {
  const stored = await loadKeyPair();
  if (!stored) return null;
  return {
    privateKey: stored.privateKey,
    publicKey: stored.publicKey,
    publicKeyRaw: stored.publicKeyRaw,
    sessionKey: base64urlEncode(stored.publicKeyRaw),
  };
}

export async function getOrCreateSessionKey(): Promise<SessionKeyHandle> {
  const existing = await loadSessionKey();
  if (existing) return existing;
  return await generateSessionKey();
}

export async function signBytes(handle: SessionKeyHandle, data: Uint8Array): Promise<Uint8Array> {
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

export async function oauthInitSig(handle: SessionKeyHandle, redirectTo: string): Promise<string> {
  const digest = await sha256(utf8(`oauth-init:${redirectTo}`));
  const sig = await signBytes(handle, digest);
  return base64urlEncode(sig);
}

export async function bindSig(handle: SessionKeyHandle, authToken: string): Promise<string> {
  const digest = await sha256(utf8(`bind:${authToken}`));
  const sig = await signBytes(handle, digest);
  return base64urlEncode(sig);
}

export async function natsConnectSigForBindingToken(
  handle: SessionKeyHandle,
  bindingToken: string,
): Promise<string> {
  const digest = await sha256(utf8(`nats-connect:${bindingToken}`));
  const sig = await signBytes(handle, digest);
  return base64urlEncode(sig);
}

export async function createRpcProof(
  handle: SessionKeyHandle,
  subject: string,
  payload: Uint8Array,
): Promise<string> {
  const payloadHash = await sha256(payload);
  return await createProof(handle.privateKey, { sessionKey: handle.sessionKey, subject, payloadHash });
}

export async function clearSessionKey(): Promise<void> {
  await deleteKeyPair();
}

export async function hasSessionKey(): Promise<boolean> {
  return await hasKeyPair();
}
