import {
  base64urlDecode,
  base64urlEncode,
  toArrayBuffer,
  utf8,
} from "@qlever-llc/trellis/auth";

import type { LocalCredential } from "../schemas.ts";

const LOCAL_PASSWORD_ALGORITHM = "pbkdf2-sha256";
const LOCAL_PASSWORD_PARAMS_VERSION = 1;
const DEFAULT_ITERATIONS = 310_000;
const DEFAULT_HASH_BITS = 256;
const DEFAULT_SALT_BYTES = 16;
const MAX_ITERATIONS = 2_000_000;
const MAX_SALT_BYTES = 64;
const MAX_ENCODED_SALT_LENGTH = 128;
const MAX_ENCODED_HASH_LENGTH = 128;

export type LocalCredentialPasswordParamsV1 = {
  v: 1;
  salt: string;
  iterations: number;
  hashBits: number;
};

export type CreateLocalCredentialPasswordOptions = {
  identityId: string;
  password: string;
  now?: Date;
  mustChangePassword?: boolean;
  salt?: Uint8Array;
  iterations?: number;
  hashBits?: number;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSupportedIterationCount(value: unknown): value is number {
  return isPositiveInteger(value) && value >= DEFAULT_ITERATIONS &&
    value <= MAX_ITERATIONS;
}

function isSupportedHashBits(value: unknown): value is number {
  return value === DEFAULT_HASH_BITS;
}

function parsePasswordParams(
  params: Record<string, unknown>,
): LocalCredentialPasswordParamsV1 | undefined {
  if (params.v !== LOCAL_PASSWORD_PARAMS_VERSION) return undefined;
  if (typeof params.salt !== "string" || params.salt.length === 0) {
    return undefined;
  }
  if (params.salt.length > MAX_ENCODED_SALT_LENGTH) return undefined;
  if (!isSupportedIterationCount(params.iterations)) return undefined;
  if (!isSupportedHashBits(params.hashBits)) return undefined;

  return {
    v: LOCAL_PASSWORD_PARAMS_VERSION,
    salt: params.salt,
    iterations: params.iterations,
    hashBits: params.hashBits,
  };
}

function makeSalt(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
  hashBits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    key,
    hashBits,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }

  return diff === 0;
}

/**
 * Creates durable local password credential material for one identity.
 */
export async function createLocalCredentialPassword(
  options: CreateLocalCredentialPasswordOptions,
): Promise<LocalCredential> {
  const now = options.now ?? new Date();
  const salt = options.salt ?? makeSalt(DEFAULT_SALT_BYTES);
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const hashBits = options.hashBits ?? DEFAULT_HASH_BITS;

  if (!isPositiveInteger(iterations)) {
    throw new Error("PBKDF2 iterations must be a positive integer");
  }
  if (!isSupportedIterationCount(iterations)) {
    throw new Error("PBKDF2 iterations are outside the supported range");
  }
  if (hashBits !== DEFAULT_HASH_BITS) {
    throw new Error("PBKDF2 hash bits must be 256");
  }
  if (salt.length < DEFAULT_SALT_BYTES || salt.length > MAX_SALT_BYTES) {
    throw new Error("PBKDF2 salt length is outside the supported range");
  }

  const passwordHash = await derivePasswordHash(
    options.password,
    salt,
    iterations,
    hashBits,
  );
  const timestamp = now.toISOString();

  return {
    identityId: options.identityId,
    passwordHash: base64urlEncode(passwordHash),
    passwordAlgorithm: LOCAL_PASSWORD_ALGORITHM,
    passwordParams: {
      v: LOCAL_PASSWORD_PARAMS_VERSION,
      salt: base64urlEncode(salt),
      iterations,
      hashBits,
    },
    passwordSetAt: timestamp,
    mustChangePassword: options.mustChangePassword ?? false,
    failedLoginCount: 0,
    lockedUntil: null,
    updatedAt: timestamp,
  };
}

/**
 * Verifies a plaintext password against stored local credential material.
 */
export async function verifyLocalCredentialPassword(
  credential: LocalCredential,
  password: string,
): Promise<boolean> {
  try {
    if (credential.passwordAlgorithm !== LOCAL_PASSWORD_ALGORITHM) return false;

    const params = parsePasswordParams(credential.passwordParams);
    if (params === undefined) return false;
    if (credential.passwordHash.length > MAX_ENCODED_HASH_LENGTH) return false;

    const salt = base64urlDecode(params.salt);
    if (salt.length < DEFAULT_SALT_BYTES || salt.length > MAX_SALT_BYTES) {
      return false;
    }

    const expectedHash = base64urlDecode(credential.passwordHash);
    if (expectedHash.length !== params.hashBits / 8) return false;
    const actualHash = await derivePasswordHash(
      password,
      salt,
      params.iterations,
      params.hashBits,
    );

    return constantTimeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}
