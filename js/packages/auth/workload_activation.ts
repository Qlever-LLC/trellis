import type { StaticDecode } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";

import {
  importEd25519PrivateKeyFromSeedBase64url,
  importEd25519PublicKeyFromBase64url,
  publicKeyBase64urlFromPrivateKey,
} from "./keys.ts";
import type { NatsAuthTokenV1 } from "./schemas.ts";
import {
  AuthActivateWorkloadResponseSchema,
  AuthActivateWorkloadSchema,
  AuthGetWorkloadActivationStatusResponseSchema,
  AuthGetWorkloadActivationStatusSchema,
  AuthGetWorkloadConnectInfoResponseSchema,
  AuthGetWorkloadConnectInfoSchema,
  AuthListWorkloadActivationsResponseSchema,
  AuthListWorkloadActivationsSchema,
  AuthRevokeWorkloadActivationResponseSchema,
  AuthRevokeWorkloadActivationSchema,
  WaitForWorkloadActivationResponseSchema,
} from "./protocol.ts";
import { base64urlDecode, base64urlEncode, sha256, toArrayBuffer, utf8 } from "./utils.ts";

const WORKLOAD_IDENTITY_HKDF_INFO = "trellis/workload-identity/v1";
const WORKLOAD_ACTIVATION_HKDF_INFO = "trellis/workload-activate/v1";
const WORKLOAD_QR_MAC_DOMAIN = "trellis-workload-qr/v1";
const WORKLOAD_CONFIRMATION_DOMAIN = "trellis-workload-confirm/v1";
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DEFAULT_WAIT_POLL_INTERVAL_MS = 1_000;

export const WorkloadActivationPayloadSchema = Type.Object({
  v: Type.Literal(1),
  publicIdentityKey: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  qrMac: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const WorkloadActivationWaitRequestSchema = Type.Object({
  publicIdentityKey: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  contractDigest: Type.Optional(Type.String({ minLength: 1 })),
  iat: Type.Number(),
  sig: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export type WorkloadActivationPayload = StaticDecode<typeof WorkloadActivationPayloadSchema>;
export type WorkloadActivationWaitRequest = StaticDecode<typeof WorkloadActivationWaitRequestSchema>;
export type WaitForWorkloadActivationResponse = StaticDecode<typeof WaitForWorkloadActivationResponseSchema>;
export type AuthActivateWorkloadInput = StaticDecode<typeof AuthActivateWorkloadSchema>;
export type AuthActivateWorkloadOutput = StaticDecode<typeof AuthActivateWorkloadResponseSchema>;
export type AuthGetWorkloadActivationStatusInput = StaticDecode<typeof AuthGetWorkloadActivationStatusSchema>;
export type AuthGetWorkloadActivationStatusOutput = StaticDecode<typeof AuthGetWorkloadActivationStatusResponseSchema>;
export type AuthListWorkloadActivationsInput = StaticDecode<typeof AuthListWorkloadActivationsSchema>;
export type AuthListWorkloadActivationsOutput = StaticDecode<typeof AuthListWorkloadActivationsResponseSchema>;
export type AuthRevokeWorkloadActivationInput = StaticDecode<typeof AuthRevokeWorkloadActivationSchema>;
export type AuthRevokeWorkloadActivationResponse = StaticDecode<typeof AuthRevokeWorkloadActivationResponseSchema>;
export type GetWorkloadConnectInfoInput = StaticDecode<typeof AuthGetWorkloadConnectInfoSchema>;
export type GetWorkloadConnectInfoOutput = StaticDecode<typeof AuthGetWorkloadConnectInfoResponseSchema>;

export type WorkloadIdentity = {
  identitySeed: Uint8Array;
  identitySeedBase64url: string;
  publicIdentityKey: string;
  activationKey: Uint8Array;
  activationKeyBase64url: string;
};

type WorkloadActivationRpcMethod =
  | "Auth.ActivateWorkload"
  | "Auth.GetWorkloadActivationStatus"
  | "Auth.ListWorkloadActivations"
  | "Auth.RevokeWorkloadActivation"
  | "Auth.GetWorkloadConnectInfo";

type WorkloadActivationRpcInputMap = {
  "Auth.ActivateWorkload": AuthActivateWorkloadInput;
  "Auth.GetWorkloadActivationStatus": AuthGetWorkloadActivationStatusInput;
  "Auth.ListWorkloadActivations": AuthListWorkloadActivationsInput;
  "Auth.RevokeWorkloadActivation": AuthRevokeWorkloadActivationInput;
  "Auth.GetWorkloadConnectInfo": GetWorkloadConnectInfoInput;
};

type WorkloadActivationRpcOutputMap = {
  "Auth.ActivateWorkload": AuthActivateWorkloadOutput;
  "Auth.GetWorkloadActivationStatus": AuthGetWorkloadActivationStatusOutput;
  "Auth.ListWorkloadActivations": AuthListWorkloadActivationsOutput;
  "Auth.RevokeWorkloadActivation": AuthRevokeWorkloadActivationResponse;
  "Auth.GetWorkloadConnectInfo": GetWorkloadConnectInfoOutput;
};

type RequestClient = {
  requestOrThrow<M extends WorkloadActivationRpcMethod>(
    method: M,
    input: WorkloadActivationRpcInputMap[M],
    opts?: unknown,
  ): Promise<WorkloadActivationRpcOutputMap[M]>;
};

export type WorkloadActivationTransport = RequestClient;

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function normalizeSecretBytes(value: Uint8Array | string, name: string): Uint8Array {
  if (typeof value === "string") {
    const decoded = base64urlDecode(value);
    if (decoded.length === 0) throw new Error(`${name} must not be empty`);
    return decoded;
  }
  if (value.length === 0) throw new Error(`${name} must not be empty`);
  return value;
}

async function hkdfSha256(inputKeyingMaterial: Uint8Array, info: string, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(inputKeyingMaterial),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(new Uint8Array(0)),
      info: toArrayBuffer(utf8(info)),
    },
    key,
    length * 8,
  );
  return new Uint8Array(derivedBits);
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(data)));
}

function crockfordEncode(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += CROCKFORD_ALPHABET[(value >>> bits) & 31] ?? "0";
    }
  }
  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31] ?? "0";
  }
  return output;
}

function normalizeCrockford(value: string): string {
  return value.trim().toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function deriveWorkloadIdentity(workloadRootSecret: Uint8Array): Promise<WorkloadIdentity> {
  if (workloadRootSecret.length !== 32) {
    throw new Error(`Invalid workload root secret length: ${workloadRootSecret.length} (expected 32)`);
  }
  const identitySeed = await hkdfSha256(workloadRootSecret, WORKLOAD_IDENTITY_HKDF_INFO, 32);
  const activationKey = await hkdfSha256(workloadRootSecret, WORKLOAD_ACTIVATION_HKDF_INFO, 32);
  const identitySeedBase64url = base64urlEncode(identitySeed);
  const identityPrivateKey = await importEd25519PrivateKeyFromSeedBase64url(identitySeedBase64url);
  const publicIdentityKey = await publicKeyBase64urlFromPrivateKey(identityPrivateKey);
  return {
    identitySeed,
    identitySeedBase64url,
    publicIdentityKey,
    activationKey,
    activationKeyBase64url: base64urlEncode(activationKey),
  };
}

export async function deriveWorkloadQrMac(input: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<string> {
  const activationKey = normalizeSecretBytes(input.activationKey, "activationKey");
  const mac = await hmacSha256(
    activationKey,
    concatBytes([
      utf8(WORKLOAD_QR_MAC_DOMAIN),
      utf8(input.publicIdentityKey),
      utf8(input.nonce),
    ]),
  );
  return base64urlEncode(mac.slice(0, 8));
}

export async function buildWorkloadActivationPayload(input: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<WorkloadActivationPayload> {
  const qrMac = await deriveWorkloadQrMac(input);
  return {
    v: 1,
    publicIdentityKey: input.publicIdentityKey,
    nonce: input.nonce,
    qrMac,
  };
}

export function encodeWorkloadActivationPayload(payload: WorkloadActivationPayload): string {
  return base64urlEncode(utf8(JSON.stringify(payload)));
}

export function parseWorkloadActivationPayload(value: string): WorkloadActivationPayload {
  const decoded = new TextDecoder().decode(base64urlDecode(value));
  const parsed = JSON.parse(decoded);
  if (!Value.Check(WorkloadActivationPayloadSchema, parsed)) {
    throw new Error("Invalid workload activation payload");
  }
  return parsed;
}

export function buildWorkloadActivationUrl(args: {
  trellisUrl: string;
  payload: WorkloadActivationPayload | string;
}): string {
  const baseUrl = new URL(args.trellisUrl);
  baseUrl.pathname = "/auth/workloads/activate";
  baseUrl.searchParams.set(
    "payload",
    typeof args.payload === "string" ? args.payload : encodeWorkloadActivationPayload(args.payload),
  );
  return baseUrl.toString();
}

export async function deriveWorkloadConfirmationCode(input: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<string> {
  const activationKey = normalizeSecretBytes(input.activationKey, "activationKey");
  const mac = await hmacSha256(
    activationKey,
    concatBytes([
      utf8(WORKLOAD_CONFIRMATION_DOMAIN),
      utf8(input.publicIdentityKey),
      utf8(input.nonce),
    ]),
  );
  return crockfordEncode(mac.slice(0, 5)).slice(0, 8);
}

export async function verifyWorkloadConfirmationCode(input: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
  confirmationCode: string;
}): Promise<boolean> {
  const expected = await deriveWorkloadConfirmationCode(input);
  return normalizeCrockford(expected) === normalizeCrockford(input.confirmationCode);
}

export function buildWorkloadWaitProofInput(
  publicIdentityKey: string,
  nonce: string,
  iat: number,
): Uint8Array {
  const enc = new TextEncoder();
  const publicIdentityKeyBytes = enc.encode(publicIdentityKey);
  const nonceBytes = enc.encode(nonce);
  const iatBytes = enc.encode(String(iat));
  const buf = new Uint8Array(
    4 + publicIdentityKeyBytes.length +
      4 + nonceBytes.length +
      4 + iatBytes.length,
  );
  const view = new DataView(buf.buffer);
  let offset = 0;
  view.setUint32(offset, publicIdentityKeyBytes.length);
  offset += 4;
  buf.set(publicIdentityKeyBytes, offset);
  offset += publicIdentityKeyBytes.length;
  view.setUint32(offset, nonceBytes.length);
  offset += 4;
  buf.set(nonceBytes, offset);
  offset += nonceBytes.length;
  view.setUint32(offset, iatBytes.length);
  offset += 4;
  buf.set(iatBytes, offset);
  return buf;
}

export async function signWorkloadWaitRequest(args: {
  publicIdentityKey: string;
  nonce: string;
  identitySeed: Uint8Array | string;
  contractDigest?: string;
  iat?: number;
}): Promise<WorkloadActivationWaitRequest> {
  const identitySeed = normalizeSecretBytes(args.identitySeed, "identitySeed");
  const identityPrivateKey = await importEd25519PrivateKeyFromSeedBase64url(base64urlEncode(identitySeed));
  const iat = args.iat ?? Math.floor(Date.now() / 1_000);
  const proofInput = buildWorkloadWaitProofInput(args.publicIdentityKey, args.nonce, iat);
  const proofHash = await sha256(proofInput);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", identityPrivateKey, toArrayBuffer(proofHash)));
  return {
    publicIdentityKey: args.publicIdentityKey,
    nonce: args.nonce,
    ...(args.contractDigest ? { contractDigest: args.contractDigest } : {}),
    iat,
    sig: base64urlEncode(signature),
  };
}

export async function createWorkloadNatsAuthToken(args: {
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  iat?: number;
}): Promise<NatsAuthTokenV1 & { contractDigest: string }> {
  const identitySeed = normalizeSecretBytes(args.identitySeed, "identitySeed");
  const identityPrivateKey = await importEd25519PrivateKeyFromSeedBase64url(base64urlEncode(identitySeed));
  const iat = args.iat ?? Math.floor(Date.now() / 1_000);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(utf8(`nats-connect:${iat}`)));
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", identityPrivateKey, digest));
  return {
    v: 1,
    sessionKey: args.publicIdentityKey,
    iat,
    sig: base64urlEncode(signature),
    contractDigest: args.contractDigest,
  };
}

export async function waitForWorkloadActivation(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  nonce: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
}): Promise<Extract<WaitForWorkloadActivationResponse, { status: "activated" }>> {
  const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_WAIT_POLL_INTERVAL_MS;
  while (true) {
    const request = await signWorkloadWaitRequest(args);
    const response = await fetch(new URL("/auth/workloads/activate/wait", args.trellisUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: args.signal,
    });
    if (!response.ok) {
      throw new Error(`workload activation wait failed: ${response.status}`);
    }
    const body = await response.json();
    if (!Value.Check(WaitForWorkloadActivationResponseSchema, body)) {
      throw new Error("Invalid workload activation wait response");
    }
    if (body.status === "pending") {
      await sleep(pollIntervalMs, args.signal);
      continue;
    }
    if (body.status === "rejected") {
      throw new Error(`workload activation rejected: ${body.reason ?? "unknown_reason"}`);
    }
    return body;
  }
}

export async function getWorkloadConnectInfo(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  iat?: number;
}): Promise<GetWorkloadConnectInfoOutput> {
  const request = await signWorkloadWaitRequest({
    publicIdentityKey: args.publicIdentityKey,
    identitySeed: args.identitySeed,
    contractDigest: args.contractDigest,
    nonce: "connect-info",
    iat: args.iat,
  });
  const payload: GetWorkloadConnectInfoInput = {
    publicIdentityKey: request.publicIdentityKey,
    contractDigest: args.contractDigest,
    iat: request.iat,
    sig: request.sig,
  };
  const response = await fetch(new URL("/auth/workloads/connect-info", args.trellisUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`workload connect info failed: ${response.status}`);
  }
  const body = await response.json();
  if (!Value.Check(AuthGetWorkloadConnectInfoResponseSchema, body)) {
    throw new Error("Invalid workload connect info response");
  }
  return body;
}

export function createWorkloadActivationClient(client: WorkloadActivationTransport) {
  return {
    activateWorkload(input: AuthActivateWorkloadInput) {
      return client.requestOrThrow("Auth.ActivateWorkload", input);
    },
    getWorkloadActivationStatus(input: AuthGetWorkloadActivationStatusInput) {
      return client.requestOrThrow("Auth.GetWorkloadActivationStatus", input);
    },
    listWorkloadActivations(input: AuthListWorkloadActivationsInput = {}) {
      return client.requestOrThrow("Auth.ListWorkloadActivations", input);
    },
    revokeWorkloadActivation(input: AuthRevokeWorkloadActivationInput) {
      return client.requestOrThrow("Auth.RevokeWorkloadActivation", input);
    },
    getWorkloadConnectInfo(input: GetWorkloadConnectInfoInput) {
      return client.requestOrThrow("Auth.GetWorkloadConnectInfo", input);
    },
  };
}

export async function verifyWorkloadWaitSignature(input: WorkloadActivationWaitRequest): Promise<boolean> {
  const publicKey = await importEd25519PublicKeyFromBase64url(input.publicIdentityKey);
  const proofHash = await sha256(buildWorkloadWaitProofInput(input.publicIdentityKey, input.nonce, input.iat));
  return await crypto.subtle.verify(
    "Ed25519",
    publicKey,
    toArrayBuffer(base64urlDecode(input.sig)),
    toArrayBuffer(proofHash),
  );
}
