import type { StaticDecode } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { BaseError } from "@qlever-llc/result";
import { AsyncResult } from "@qlever-llc/result";

import {
  importEd25519PrivateKeyFromSeedBase64url,
  importEd25519PublicKeyFromBase64url,
  publicKeyBase64urlFromPrivateKey,
} from "./keys.ts";
import type { NatsAuthTokenV1 } from "./schemas.ts";
import {
  AuthActivateDeviceResponseSchema,
  AuthActivateDeviceSchema,
  AuthGetDeviceActivationStatusResponseSchema,
  AuthGetDeviceActivationStatusSchema,
  AuthGetDeviceConnectInfoResponseSchema,
  AuthGetDeviceConnectInfoSchema,
  AuthListDeviceActivationsResponseSchema,
  AuthListDeviceActivationsSchema,
  AuthRevokeDeviceActivationResponseSchema,
  AuthRevokeDeviceActivationSchema,
  WaitForDeviceActivationResponseSchema,
} from "./protocol.ts";
import {
  base64urlDecode,
  base64urlEncode,
  sha256,
  toArrayBuffer,
  utf8,
} from "./utils.ts";

const DEVICE_IDENTITY_HKDF_INFO = "trellis/device-identity/v1";
const DEVICE_ACTIVATION_HKDF_INFO = "trellis/device-activate/v1";
const DEVICE_QR_MAC_DOMAIN = "trellis-device-qr/v1";
const DEVICE_CONFIRMATION_DOMAIN = "trellis-device-confirm/v1";
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DEFAULT_WAIT_POLL_INTERVAL_MS = 1_000;

export const DeviceActivationPayloadSchema = Type.Object({
  v: Type.Literal(1),
  publicIdentityKey: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  qrMac: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const DeviceActivationWaitRequestSchema = Type.Object({
  publicIdentityKey: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  contractDigest: Type.Optional(Type.String({ minLength: 1 })),
  iat: Type.Number(),
  sig: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export type DeviceActivationPayload = StaticDecode<
  typeof DeviceActivationPayloadSchema
>;
export type DeviceActivationWaitRequest = StaticDecode<
  typeof DeviceActivationWaitRequestSchema
>;
export type WaitForDeviceActivationResponse = StaticDecode<
  typeof WaitForDeviceActivationResponseSchema
>;
export type AuthActivateDeviceInput = StaticDecode<
  typeof AuthActivateDeviceSchema
>;
export type AuthActivateDeviceOutput = StaticDecode<
  typeof AuthActivateDeviceResponseSchema
>;
export type AuthGetDeviceActivationStatusInput = StaticDecode<
  typeof AuthGetDeviceActivationStatusSchema
>;
export type AuthGetDeviceActivationStatusOutput = StaticDecode<
  typeof AuthGetDeviceActivationStatusResponseSchema
>;
export type AuthListDeviceActivationsInput = StaticDecode<
  typeof AuthListDeviceActivationsSchema
>;
export type AuthListDeviceActivationsOutput = StaticDecode<
  typeof AuthListDeviceActivationsResponseSchema
>;
export type AuthRevokeDeviceActivationInput = StaticDecode<
  typeof AuthRevokeDeviceActivationSchema
>;
export type AuthRevokeDeviceActivationResponse = StaticDecode<
  typeof AuthRevokeDeviceActivationResponseSchema
>;
export type GetDeviceConnectInfoInput = StaticDecode<
  typeof AuthGetDeviceConnectInfoSchema
>;
export type GetDeviceConnectInfoOutput = StaticDecode<
  typeof AuthGetDeviceConnectInfoResponseSchema
>;

export type DeviceIdentity = {
  identitySeed: Uint8Array;
  identitySeedBase64url: string;
  publicIdentityKey: string;
  activationKey: Uint8Array;
  activationKeyBase64url: string;
};

type DeviceActivationRpcMethod =
  | "Auth.ActivateDevice"
  | "Auth.GetDeviceActivationStatus"
  | "Auth.ListDeviceActivations"
  | "Auth.RevokeDeviceActivation"
  | "Auth.GetDeviceConnectInfo";

type DeviceActivationRpcInputMap = {
  "Auth.ActivateDevice": AuthActivateDeviceInput;
  "Auth.GetDeviceActivationStatus": AuthGetDeviceActivationStatusInput;
  "Auth.ListDeviceActivations": AuthListDeviceActivationsInput;
  "Auth.RevokeDeviceActivation": AuthRevokeDeviceActivationInput;
  "Auth.GetDeviceConnectInfo": GetDeviceConnectInfoInput;
};

type DeviceActivationRpcOutputMap = {
  "Auth.ActivateDevice": AuthActivateDeviceOutput;
  "Auth.GetDeviceActivationStatus": AuthGetDeviceActivationStatusOutput;
  "Auth.ListDeviceActivations": AuthListDeviceActivationsOutput;
  "Auth.RevokeDeviceActivation": AuthRevokeDeviceActivationResponse;
  "Auth.GetDeviceConnectInfo": GetDeviceConnectInfoOutput;
};

type RequestClient = {
  request<M extends DeviceActivationRpcMethod>(
    method: M,
    input: DeviceActivationRpcInputMap[M],
    opts?: unknown,
  ): AsyncResult<DeviceActivationRpcOutputMap[M], BaseError>;
};

export type DeviceActivationTransport = RequestClient;

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

function normalizeSecretBytes(
  value: Uint8Array | string,
  name: string,
): Uint8Array {
  if (typeof value === "string") {
    const decoded = base64urlDecode(value);
    if (decoded.length === 0) throw new Error(`${name} must not be empty`);
    return decoded;
  }
  if (value.length === 0) throw new Error(`${name} must not be empty`);
  return value;
}

async function hkdfSha256(
  inputKeyingMaterial: Uint8Array,
  info: string,
  length: number,
): Promise<Uint8Array> {
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

async function hmacSha256(
  keyBytes: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, toArrayBuffer(data)),
  );
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
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
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

async function responseErrorDetail(response: Response): Promise<string | null> {
  const text = await response.text();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.reason === "string" && parsed.reason.length > 0) {
      return parsed.reason;
    }
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // Fall through to raw text below.
  }

  return text;
}

export async function deriveDeviceIdentity(
  deviceRootSecret: Uint8Array,
): Promise<DeviceIdentity> {
  if (deviceRootSecret.length !== 32) {
    throw new Error(
      `Invalid device root secret length: ${deviceRootSecret.length} (expected 32)`,
    );
  }
  const identitySeed = await hkdfSha256(
    deviceRootSecret,
    DEVICE_IDENTITY_HKDF_INFO,
    32,
  );
  const activationKey = await hkdfSha256(
    deviceRootSecret,
    DEVICE_ACTIVATION_HKDF_INFO,
    32,
  );
  const identitySeedBase64url = base64urlEncode(identitySeed);
  const identityPrivateKey = await importEd25519PrivateKeyFromSeedBase64url(
    identitySeedBase64url,
  );
  const publicIdentityKey = await publicKeyBase64urlFromPrivateKey(
    identityPrivateKey,
  );
  return {
    identitySeed,
    identitySeedBase64url,
    publicIdentityKey,
    activationKey,
    activationKeyBase64url: base64urlEncode(activationKey),
  };
}

export async function deriveDeviceQrMac(input: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<string> {
  const activationKey = normalizeSecretBytes(
    input.activationKey,
    "activationKey",
  );
  const mac = await hmacSha256(
    activationKey,
    concatBytes([
      utf8(DEVICE_QR_MAC_DOMAIN),
      utf8(input.publicIdentityKey),
      utf8(input.nonce),
    ]),
  );
  return base64urlEncode(mac.slice(0, 8));
}

export async function buildDeviceActivationPayload(input: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<DeviceActivationPayload> {
  const qrMac = await deriveDeviceQrMac(input);
  return {
    v: 1,
    publicIdentityKey: input.publicIdentityKey,
    nonce: input.nonce,
    qrMac,
  };
}

export function encodeDeviceActivationPayload(
  payload: DeviceActivationPayload,
): string {
  return base64urlEncode(utf8(JSON.stringify(payload)));
}

export function parseDeviceActivationPayload(
  value: string,
): DeviceActivationPayload {
  const decoded = new TextDecoder().decode(base64urlDecode(value));
  const parsed = JSON.parse(decoded);
  if (!Value.Check(DeviceActivationPayloadSchema, parsed)) {
    throw new Error("Invalid device activation payload");
  }
  return parsed;
}

export async function startDeviceActivationRequest(args: {
  trellisUrl: string;
  payload: DeviceActivationPayload;
}): Promise<
  {
    flowId: string;
    instanceId: string;
    profileId: string;
    activationUrl: string;
  }
> {
  const response = await fetch(
    new URL("/auth/devices/activate/requests", args.trellisUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: args.payload }),
    },
  );
  if (!response.ok) {
    const detail = await responseErrorDetail(response);
    throw new Error(
      `Device activation request failed: ${response.status}${
        detail ? ` ${detail}` : ""
      }`,
    );
  }

  const parsed = await response.json() as Record<string, unknown>;
  if (
    typeof parsed.flowId !== "string" ||
    typeof parsed.instanceId !== "string" ||
    typeof parsed.profileId !== "string" ||
    typeof parsed.activationUrl !== "string"
  ) {
    throw new Error("Device activation request returned an invalid response");
  }

  return {
    flowId: parsed.flowId,
    instanceId: parsed.instanceId,
    profileId: parsed.profileId,
    activationUrl: parsed.activationUrl,
  };
}

export async function deriveDeviceConfirmationCode(input: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<string> {
  const activationKey = normalizeSecretBytes(
    input.activationKey,
    "activationKey",
  );
  const mac = await hmacSha256(
    activationKey,
    concatBytes([
      utf8(DEVICE_CONFIRMATION_DOMAIN),
      utf8(input.publicIdentityKey),
      utf8(input.nonce),
    ]),
  );
  return crockfordEncode(mac.slice(0, 5)).slice(0, 8);
}

export async function verifyDeviceConfirmationCode(input: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
  confirmationCode: string;
}): Promise<boolean> {
  const expected = await deriveDeviceConfirmationCode(input);
  return normalizeCrockford(expected) ===
    normalizeCrockford(input.confirmationCode);
}

export function buildDeviceWaitProofInput(
  publicIdentityKey: string,
  nonce: string,
  iat: number,
  contractDigest?: string,
): Uint8Array {
  const enc = new TextEncoder();
  const publicIdentityKeyBytes = enc.encode(publicIdentityKey);
  const nonceBytes = enc.encode(nonce);
  const iatBytes = enc.encode(String(iat));
  const contractDigestBytes = enc.encode(contractDigest ?? "");
  const buf = new Uint8Array(
    4 + publicIdentityKeyBytes.length +
      4 + nonceBytes.length +
      4 + iatBytes.length +
      4 + contractDigestBytes.length,
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
  offset += iatBytes.length;
  view.setUint32(offset, contractDigestBytes.length);
  offset += 4;
  buf.set(contractDigestBytes, offset);
  return buf;
}

export async function signDeviceWaitRequest(args: {
  publicIdentityKey: string;
  nonce: string;
  identitySeed: Uint8Array | string;
  contractDigest?: string;
  iat?: number;
}): Promise<DeviceActivationWaitRequest> {
  const identitySeed = normalizeSecretBytes(args.identitySeed, "identitySeed");
  const identityPrivateKey = await importEd25519PrivateKeyFromSeedBase64url(
    base64urlEncode(identitySeed),
  );
  const iat = args.iat ?? Math.floor(Date.now() / 1_000);
  const proofInput = buildDeviceWaitProofInput(
    args.publicIdentityKey,
    args.nonce,
    iat,
    args.contractDigest,
  );
  const proofHash = await sha256(proofInput);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      identityPrivateKey,
      toArrayBuffer(proofHash),
    ),
  );
  return {
    publicIdentityKey: args.publicIdentityKey,
    nonce: args.nonce,
    ...(args.contractDigest ? { contractDigest: args.contractDigest } : {}),
    iat,
    sig: base64urlEncode(signature),
  };
}

export async function createDeviceNatsAuthToken(args: {
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  iat?: number;
}): Promise<NatsAuthTokenV1 & { contractDigest: string }> {
  const identitySeed = normalizeSecretBytes(args.identitySeed, "identitySeed");
  const identityPrivateKey = await importEd25519PrivateKeyFromSeedBase64url(
    base64urlEncode(identitySeed),
  );
  const iat = args.iat ?? Math.floor(Date.now() / 1_000);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(utf8(`nats-connect:${iat}`)),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", identityPrivateKey, digest),
  );
  return {
    v: 1,
    sessionKey: args.publicIdentityKey,
    iat,
    sig: base64urlEncode(signature),
    contractDigest: args.contractDigest,
  };
}

export async function waitForDeviceActivation(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  nonce: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
}): Promise<
  Extract<WaitForDeviceActivationResponse, { status: "activated" }>
> {
  const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_WAIT_POLL_INTERVAL_MS;
  while (true) {
    const request = await signDeviceWaitRequest(args);
    let response: Response;
    try {
      response = await fetch(
        new URL("/auth/devices/activate/wait", args.trellisUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: args.signal,
        },
      );
    } catch (error) {
      if (args.signal?.aborted) {
        throw error;
      }
      await sleep(pollIntervalMs, args.signal);
      continue;
    }
    if (!response.ok) {
      const detail = await responseErrorDetail(response);
      throw new Error(
        detail
          ? `device activation wait failed: ${response.status} ${detail}`
          : `device activation wait failed: ${response.status}`,
      );
    }
    const body = await response.json();
    if (!Value.Check(WaitForDeviceActivationResponseSchema, body)) {
      throw new Error("Invalid device activation wait response");
    }
    if (body.status === "pending") {
      await sleep(pollIntervalMs, args.signal);
      continue;
    }
    if (body.status === "rejected") {
      throw new Error(
        `device activation rejected: ${body.reason ?? "unknown_reason"}`,
      );
    }
    return body;
  }
}

export async function getDeviceConnectInfo(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  iat?: number;
}): Promise<GetDeviceConnectInfoOutput> {
  const request = await signDeviceWaitRequest({
    publicIdentityKey: args.publicIdentityKey,
    identitySeed: args.identitySeed,
    contractDigest: args.contractDigest,
    nonce: "connect-info",
    iat: args.iat,
  });
  const payload: GetDeviceConnectInfoInput = {
    publicIdentityKey: request.publicIdentityKey,
    contractDigest: args.contractDigest,
    iat: request.iat,
    sig: request.sig,
  };
  const response = await fetch(
    new URL("/auth/devices/connect-info", args.trellisUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new Error(`device connect info failed: ${response.status}`);
  }
  const body = await response.json();
  if (!Value.Check(AuthGetDeviceConnectInfoResponseSchema, body)) {
    throw new Error("Invalid device connect info response");
  }
  return body;
}

export function createDeviceActivationClient(
  client: DeviceActivationTransport,
) {
  return {
    activateDevice(input: AuthActivateDeviceInput) {
      return client.request("Auth.ActivateDevice", input).orThrow();
    },
    getDeviceActivationStatus(input: AuthGetDeviceActivationStatusInput) {
      return client.request("Auth.GetDeviceActivationStatus", input).orThrow();
    },
    listDeviceActivations(input: AuthListDeviceActivationsInput = {}) {
      return client.request("Auth.ListDeviceActivations", input).orThrow();
    },
    revokeDeviceActivation(input: AuthRevokeDeviceActivationInput) {
      return client.request("Auth.RevokeDeviceActivation", input).orThrow();
    },
    getDeviceConnectInfo(input: GetDeviceConnectInfoInput) {
      return client.request("Auth.GetDeviceConnectInfo", input).orThrow();
    },
  };
}

export async function verifyDeviceWaitSignature(
  input: DeviceActivationWaitRequest,
): Promise<boolean> {
  const publicKey = await importEd25519PublicKeyFromBase64url(
    input.publicIdentityKey,
  );
  const proofHash = await sha256(
    buildDeviceWaitProofInput(
      input.publicIdentityKey,
      input.nonce,
      input.iat,
      input.contractDigest,
    ),
  );
  return await crypto.subtle.verify(
    "Ed25519",
    publicKey,
    toArrayBuffer(base64urlDecode(input.sig)),
    toArrayBuffer(proofHash),
  );
}
