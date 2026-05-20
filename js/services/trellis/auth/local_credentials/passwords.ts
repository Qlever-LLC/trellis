import { base64urlDecode, base64urlEncode } from "@qlever-llc/trellis/auth";
import { argon2id } from "@noble/hashes/argon2";

import type { LocalCredential } from "../schemas.ts";

const LOCAL_PASSWORD_ALGORITHM = "argon2id";
const LOCAL_PASSWORD_PARAMS_VERSION = 1;
const DEFAULT_MEMORY_KIB = 19_456;
const DEFAULT_ITERATIONS = 2;
const DEFAULT_PARALLELISM = 1;
const DEFAULT_HASH_BYTES = 32;
const DEFAULT_SALT_BYTES = 16;
const MAX_MEMORY_KIB = 64 * 1024;
const MAX_ITERATIONS = 10;
const MAX_PARALLELISM = 4;
const MAX_SALT_BYTES = 64;
const MAX_ENCODED_SALT_LENGTH = 128;
const MAX_ENCODED_HASH_LENGTH = 128;
const DEFAULT_MIN_PASSWORD_LENGTH = 12;
const MIN_PASSWORD_LENGTH_FLOOR = 8;

export type LocalCredentialPasswordParamsV1 = {
  v: 1;
  salt: string;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  hashBytes: number;
};

export type CreateLocalCredentialPasswordOptions = {
  identityId: string;
  password: string;
  now?: Date;
  mustChangePassword?: boolean;
  salt?: Uint8Array;
  minLength?: number;
  iterations?: number;
  memoryKiB?: number;
  parallelism?: number;
  hashBytes?: number;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSupportedIterationCount(value: unknown): value is number {
  return isPositiveInteger(value) && value >= DEFAULT_ITERATIONS &&
    value <= MAX_ITERATIONS;
}

function parsePasswordParams(
  params: Record<string, unknown>,
): LocalCredentialPasswordParamsV1 | undefined {
  if (params.v !== LOCAL_PASSWORD_PARAMS_VERSION) return undefined;
  if (typeof params.salt !== "string" || params.salt.length === 0) {
    return undefined;
  }
  if (params.salt.length > MAX_ENCODED_SALT_LENGTH) return undefined;
  if (
    !isPositiveInteger(params.memoryKiB) ||
    params.memoryKiB < DEFAULT_MEMORY_KIB ||
    params.memoryKiB > MAX_MEMORY_KIB
  ) return undefined;
  if (!isSupportedIterationCount(params.iterations)) return undefined;
  if (
    !isPositiveInteger(params.parallelism) ||
    params.parallelism < DEFAULT_PARALLELISM ||
    params.parallelism > MAX_PARALLELISM
  ) return undefined;
  if (params.hashBytes !== DEFAULT_HASH_BYTES) return undefined;

  return {
    v: LOCAL_PASSWORD_PARAMS_VERSION,
    salt: params.salt,
    memoryKiB: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashBytes: params.hashBytes,
  };
}

function makeSalt(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Validates a plaintext local password against the configured local policy. */
export function validateLocalCredentialPasswordPolicy(
  password: string,
  minLength: number,
): void {
  if (!isPositiveInteger(minLength) || minLength < MIN_PASSWORD_LENGTH_FLOOR) {
    throw new Error("Local password minimum length must be at least 8");
  }
  if (password.length < minLength) {
    throw new Error(`Password must be at least ${minLength} characters`);
  }
}

function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  memoryKiB: number,
  iterations: number,
  parallelism: number,
  hashBytes: number,
): Uint8Array {
  return argon2id(password, salt, {
    t: iterations,
    m: memoryKiB,
    p: parallelism,
    dkLen: hashBytes,
  });
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
  const minLength = options.minLength ?? DEFAULT_MIN_PASSWORD_LENGTH;
  const memoryKiB = options.memoryKiB ?? DEFAULT_MEMORY_KIB;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const parallelism = options.parallelism ?? DEFAULT_PARALLELISM;
  const hashBytes = options.hashBytes ?? DEFAULT_HASH_BYTES;

  validateLocalCredentialPasswordPolicy(options.password, minLength);

  if (!isPositiveInteger(memoryKiB)) {
    throw new Error("Argon2id memory must be a positive integer");
  }
  if (memoryKiB < DEFAULT_MEMORY_KIB || memoryKiB > MAX_MEMORY_KIB) {
    throw new Error("Argon2id memory is outside the supported range");
  }
  if (!isSupportedIterationCount(iterations)) {
    throw new Error("Argon2id iterations are outside the supported range");
  }
  if (
    !isPositiveInteger(parallelism) || parallelism < DEFAULT_PARALLELISM ||
    parallelism > MAX_PARALLELISM
  ) {
    throw new Error("Argon2id parallelism is outside the supported range");
  }
  if (hashBytes !== DEFAULT_HASH_BYTES) {
    throw new Error("Argon2id hash length must be 32 bytes");
  }
  if (salt.length < DEFAULT_SALT_BYTES || salt.length > MAX_SALT_BYTES) {
    throw new Error("Argon2id salt length is outside the supported range");
  }

  const passwordHash = derivePasswordHash(
    options.password,
    salt,
    memoryKiB,
    iterations,
    parallelism,
    hashBytes,
  );
  const timestamp = now.toISOString();

  return {
    identityId: options.identityId,
    passwordHash: base64urlEncode(passwordHash),
    passwordAlgorithm: LOCAL_PASSWORD_ALGORITHM,
    passwordParams: {
      v: LOCAL_PASSWORD_PARAMS_VERSION,
      salt: base64urlEncode(salt),
      memoryKiB,
      iterations,
      parallelism,
      hashBytes,
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
    if (expectedHash.length !== params.hashBytes) return false;
    const actualHash = derivePasswordHash(
      password,
      salt,
      params.memoryKiB,
      params.iterations,
      params.parallelism,
      params.hashBytes,
    );

    return constantTimeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}
