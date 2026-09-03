import { Prefix } from "@nats-io/nkeys";
import { Codec } from "@nats-io/nkeys/lib/codec.js";
import { ed25519 } from "@noble/curves/ed25519.js";

import { importEd25519PublicKeyFromBase64url } from "./keys.ts";
import {
  base64urlDecode,
  base64urlEncode,
  canonicalizeJsonValue,
  sha256,
  toArrayBuffer,
  utf8,
} from "./utils.ts";

/** Strict wire format for auth, bootstrap, and authorization-context refresh proofs. */
export const SESSION_PROOF_FORMAT_V1 = "trellis.session-proof.v1" as const;

/** One fixed session-proof signature domain. */
export type SessionProofPurpose =
  | "userAuthRequest"
  | "userAuthBind"
  | "serviceBootstrap"
  | "deviceBootstrap"
  | "authorizationContextRefresh";

type CommonInput = {
  requestId: string;
  issuedAt: number;
};

/** Validated purpose-specific values used to construct one session proof. */
export type SessionProofInput =
  | CommonInput & {
    purpose: "userAuthBind";
    flowId: string;
    sessionPublicKey: string;
    requestDigest: string;
  }
  | CommonInput & {
    purpose: "userAuthRequest";
    sessionPublicKey: string;
    sessionNkey: string;
    participantId: string;
    participantDigest: string;
    redirectTarget: string;
    requestDigest: string;
  }
  | CommonInput & {
    purpose: "serviceBootstrap";
    deploymentId: string;
    instanceId: string;
    provisionedIdentityKeyId: string;
    newSessionPublicKey: string;
    newSessionNkey: string;
    participantId: string;
    participantDigest: string;
    requestDigest: string;
  }
  | CommonInput & {
    purpose: "deviceBootstrap";
    deploymentId: string;
    instanceId: string;
    deviceIdentityKeyId: string;
    newSessionPublicKey: string;
    newSessionNkey: string;
    participantId: string;
    participantDigest: string;
    challengeDigest: string | null;
    requestDigest: string;
  }
  | CommonInput & {
    purpose: "authorizationContextRefresh";
    sessionId: string;
    sessionKeyId: string;
    currentContextDigest: string | null;
    expectedParticipantDigest: string | null;
    expectedNeedsDigest: string | null;
    knownRootKeyId: string;
    minimumManifestGeneration: number;
    requestDigest: string;
  };

/** One strict session-proof signature envelope. */
export type SessionProof = {
  format: typeof SESSION_PROOF_FORMAT_V1;
  signature: string;
};

/** Freshness policy applied by the pure TypeScript verifier. */
export type SessionProofPolicy = {
  maximumAgeMs: number;
  maximumFutureSkewMs: number;
};

const MAXIMUM_SAFE_INTEGER = 9_007_199_254_740_991;
const MAXIMUM_PROOF_WINDOW_MS = 5 * 60 * 1_000;
const MAXIMUM_REQUEST_ID_BYTES = 256;
const MAXIMUM_TEXT_BYTES = 16 * 1024;

function assertText(value: string, name: string): Uint8Array {
  const bytes = utf8(value);
  const first = value.codePointAt(0);
  const last = value.codePointAt(value.length - 1);
  if (
    value.length === 0 ||
    bytes.length > MAXIMUM_TEXT_BYTES ||
    (first !== undefined && isProtocolWhitespace(first)) ||
    (last !== undefined && isProtocolWhitespace(last)) ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new Error(`${name} must be bounded, nonempty protocol-safe text`);
  }
  return bytes;
}

function isProtocolWhitespace(code: number): boolean {
  return (code >= 0x0009 && code <= 0x000d) ||
    code === 0x0020 ||
    code === 0x0085 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000;
}

function decodeFixed(value: string, length: number, name: string): Uint8Array {
  if (value.includes("=")) {
    throw new Error(`${name} must be unpadded base64url`);
  }
  const bytes = base64urlDecode(value);
  if (bytes.length !== length || base64urlEncode(bytes) !== value) {
    throw new Error(`${name} must canonically encode ${length} bytes`);
  }
  return bytes;
}

function assertPublicKey(value: string, name: string): Uint8Array {
  const bytes = decodeFixed(value, 32, name);
  try {
    const point = ed25519.Point.fromBytes(bytes);
    point.assertValidity();
    if (point.isSmallOrder()) throw new Error();
  } catch {
    throw new Error(`${name} must be a non-weak canonical Ed25519 public key`);
  }
  return bytes;
}

function assertNkey(
  value: string,
  publicKey: Uint8Array,
  name: string,
): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = Codec.decode(Prefix.User, utf8(value));
  } catch {
    throw new Error(`${name} must be a canonical NATS User NKey`);
  }
  if (
    bytes.length !== publicKey.length ||
    bytes.some((byte, index) => byte !== publicKey[index])
  ) {
    throw new Error(`${name} does not encode the session public key`);
  }
  return bytes;
}

function optionalDigest(value: string | null, name: string): Uint8Array {
  return value === null ? new Uint8Array() : decodeFixed(value, 32, name);
}

function appendLengthPrefixed(parts: Uint8Array[], value: Uint8Array): void {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, value.length);
  parts.push(length, value);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function signerKeyId(input: SessionProofInput): Promise<string> | string {
  switch (input.purpose) {
    case "userAuthRequest":
    case "userAuthBind":
      return sha256(assertPublicKey(input.sessionPublicKey, "sessionPublicKey"))
        .then(base64urlEncode);
    case "serviceBootstrap":
      return input.provisionedIdentityKeyId;
    case "deviceBootstrap":
      return input.deviceIdentityKeyId;
    default:
      return input.sessionKeyId;
  }
}

function assertSignerPublicKey(
  input: SessionProofInput,
  signerPublicKey: string,
): void {
  if (
    (input.purpose === "userAuthRequest" || input.purpose === "userAuthBind") &&
    input.sessionPublicKey !== signerPublicKey
  ) {
    throw new Error(
      "session public key does not match the declared signer public key",
    );
  }
}

/** Build the exact deterministic length-prefixed bytes hashed by session proofs. */
export function buildSessionProofTranscript(
  input: SessionProofInput,
): Uint8Array {
  if (!Number.isSafeInteger(input.issuedAt)) {
    throw new Error("issuedAt must be a safe integer");
  }
  const requestId = assertText(input.requestId, "requestId");
  if (requestId.length > MAXIMUM_REQUEST_ID_BYTES) {
    throw new Error("requestId exceeds 256 UTF-8 bytes");
  }

  const fields: Uint8Array[] = [];
  switch (input.purpose) {
    case "userAuthRequest": {
      const sessionKey = assertPublicKey(
        input.sessionPublicKey,
        "sessionPublicKey",
      );
      const sessionNkey = assertNkey(
        input.sessionNkey,
        sessionKey,
        "sessionNkey",
      );
      fields.push(
        sessionKey,
        sessionNkey,
        assertText(input.participantId, "participantId"),
        decodeFixed(input.participantDigest, 32, "participantDigest"),
        assertText(input.redirectTarget, "redirectTarget"),
        decodeFixed(input.requestDigest, 32, "requestDigest"),
      );
      break;
    }
    case "userAuthBind":
      fields.push(
        assertText(input.flowId, "flowId"),
        assertPublicKey(input.sessionPublicKey, "sessionPublicKey"),
        decodeFixed(input.requestDigest, 32, "requestDigest"),
      );
      break;
    case "serviceBootstrap": {
      const sessionKey = assertPublicKey(
        input.newSessionPublicKey,
        "newSessionPublicKey",
      );
      const sessionNkey = assertNkey(
        input.newSessionNkey,
        sessionKey,
        "newSessionNkey",
      );
      fields.push(
        assertText(input.deploymentId, "deploymentId"),
        assertText(input.instanceId, "instanceId"),
        decodeFixed(
          input.provisionedIdentityKeyId,
          32,
          "provisionedIdentityKeyId",
        ),
        sessionKey,
        sessionNkey,
        assertText(input.participantId, "participantId"),
        decodeFixed(input.participantDigest, 32, "participantDigest"),
        decodeFixed(input.requestDigest, 32, "requestDigest"),
      );
      break;
    }
    case "deviceBootstrap": {
      const sessionKey = assertPublicKey(
        input.newSessionPublicKey,
        "newSessionPublicKey",
      );
      const sessionNkey = assertNkey(
        input.newSessionNkey,
        sessionKey,
        "newSessionNkey",
      );
      fields.push(
        assertText(input.deploymentId, "deploymentId"),
        assertText(input.instanceId, "instanceId"),
        decodeFixed(input.deviceIdentityKeyId, 32, "deviceIdentityKeyId"),
        sessionKey,
        sessionNkey,
        assertText(input.participantId, "participantId"),
        decodeFixed(input.participantDigest, 32, "participantDigest"),
        optionalDigest(input.challengeDigest, "challengeDigest"),
        decodeFixed(input.requestDigest, 32, "requestDigest"),
      );
      break;
    }
    case "authorizationContextRefresh": {
      if (
        !Number.isSafeInteger(input.minimumManifestGeneration) ||
        input.minimumManifestGeneration <= 0
      ) {
        throw new Error(
          "minimumManifestGeneration must be a positive safe integer",
        );
      }
      fields.push(
        assertText(input.sessionId, "sessionId"),
        decodeFixed(input.sessionKeyId, 32, "sessionKeyId"),
        optionalDigest(input.currentContextDigest, "currentContextDigest"),
        optionalDigest(
          input.expectedParticipantDigest,
          "expectedParticipantDigest",
        ),
        optionalDigest(input.expectedNeedsDigest, "expectedNeedsDigest"),
        decodeFixed(input.knownRootKeyId, 32, "knownRootKeyId"),
        utf8(String(input.minimumManifestGeneration)),
        decodeFixed(input.requestDigest, 32, "requestDigest"),
      );
      break;
    }
  }

  const parts: Uint8Array[] = [];
  for (
    const field of [
      utf8(SESSION_PROOF_FORMAT_V1),
      utf8(input.purpose),
      requestId,
      utf8(String(input.issuedAt)),
      ...fields,
    ]
  ) {
    appendLengthPrefixed(parts, field);
  }
  return concat(parts);
}

function assertJsonValue(value: unknown, path = ""): void {
  if (
    value === null || typeof value === "boolean" || typeof value === "string"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite JSON number at ${path || "/"}`);
    }
    if (
      Number.isInteger(value) &&
      (!Number.isSafeInteger(value) || Math.abs(value) > MAXIMUM_SAFE_INTEGER)
    ) {
      throw new Error(`unsafe JSON integer at ${path || "/"}`);
    }
  } else if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) {
        throw new Error(`sparse JSON array at ${path || "/"}`);
      }
      assertJsonValue(value[index], `${path}/${index}`);
    }
  } else if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`non-JSON object at ${path || "/"}`);
    }
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) {
      throw new Error(`symbol-keyed JSON object at ${path || "/"}`);
    }
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(
        entry,
        `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      );
    }
  } else {
    throw new Error(`non-JSON value at ${path || "/"}`);
  }
}

/** Parse one session-proof signature envelope. */
export function parseSessionProof(value: unknown): SessionProof {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("session proof must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    record.format !== SESSION_PROOF_FORMAT_V1 ||
    typeof record.signature !== "string"
  ) {
    throw new Error("invalid session proof format");
  }
  decodeFixed(record.signature, 64, "proof.signature");
  return { format: SESSION_PROOF_FORMAT_V1, signature: record.signature };
}

/** Hash one complete proof-bearing request after removing only `proof.signature`. */
export async function sessionProofRequestDigest(
  request: Record<string, unknown>,
): Promise<string> {
  assertJsonValue(request);
  const unsigned = structuredClone(request);
  const proof = unsigned.proof;
  if (proof === null || typeof proof !== "object" || Array.isArray(proof)) {
    throw new Error("proof must be an object");
  }
  const proofRecord = proof as Record<string, unknown>;
  if (proofRecord.format !== SESSION_PROOF_FORMAT_V1) {
    throw new Error(`proof.format must equal ${SESSION_PROOF_FORMAT_V1}`);
  }
  if (!("signature" in proofRecord)) {
    throw new Error("proof.signature is required");
  }
  delete proofRecord.signature;
  return base64urlEncode(await sha256(utf8(canonicalizeJsonValue(unsigned))));
}

/** Sign one purpose-specific session proof with an Ed25519 private key. */
export async function signSessionProof(
  input: SessionProofInput,
  privateKey: CryptoKey,
  signerPublicKey: string,
): Promise<SessionProof> {
  assertSignerPublicKey(input, signerPublicKey);
  const digest = await sha256(buildSessionProofTranscript(input));
  const publicBytes = assertPublicKey(signerPublicKey, "signerPublicKey");
  const expectedKeyId = base64urlEncode(await sha256(publicBytes));
  if (await signerKeyId(input) !== expectedKeyId) {
    throw new Error("signer key ID mismatch");
  }
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    toArrayBuffer(digest),
  );
  const signatureBytes = new Uint8Array(signature);
  const publicKey = await importEd25519PublicKeyFromBase64url(signerPublicKey);
  if (
    !await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(digest),
    )
  ) {
    throw new Error(
      "private key does not match the declared signer public key",
    );
  }
  return {
    format: SESSION_PROOF_FORMAT_V1,
    signature: base64urlEncode(signatureBytes),
  };
}

/** Verify one session proof. */
export async function verifySessionProof(
  input: SessionProofInput,
  proof: SessionProof,
  signerPublicKey: string,
  nowMs: number,
  policy: SessionProofPolicy = {
    maximumAgeMs: 30_000,
    maximumFutureSkewMs: 30_000,
  },
): Promise<void> {
  const parsedProof = parseSessionProof(proof);
  assertSignerPublicKey(input, signerPublicKey);
  if (
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(policy.maximumAgeMs) ||
    !Number.isSafeInteger(policy.maximumFutureSkewMs) ||
    policy.maximumAgeMs < 0 ||
    policy.maximumFutureSkewMs < 0 ||
    policy.maximumAgeMs > MAXIMUM_PROOF_WINDOW_MS ||
    policy.maximumFutureSkewMs > MAXIMUM_PROOF_WINDOW_MS
  ) {
    throw new Error("invalid proof freshness policy");
  }
  if (
    input.issuedAt < nowMs - policy.maximumAgeMs ||
    input.issuedAt > nowMs + policy.maximumFutureSkewMs
  ) {
    throw new Error("proof issuedAt is outside the accepted policy window");
  }

  const publicBytes = assertPublicKey(signerPublicKey, "signerPublicKey");
  const expectedKeyId = base64urlEncode(await sha256(publicBytes));
  if (await signerKeyId(input) !== expectedKeyId) {
    throw new Error("signer key ID mismatch");
  }
  const transcriptDigest = await sha256(buildSessionProofTranscript(input));
  const signature = decodeFixed(parsedProof.signature, 64, "proof.signature");
  const publicKey = await importEd25519PublicKeyFromBase64url(signerPublicKey);
  if (
    !await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(transcriptDigest),
    )
  ) {
    throw new Error("session proof signature verification failed");
  }
}
