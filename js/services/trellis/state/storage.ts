import { isErr, Result } from "@qlever-llc/result";
import {
  KVError,
  UnexpectedError,
  ValidationError,
} from "@qlever-llc/trellis";
import type {
  StateCompareAndSetResponse,
} from "../../../packages/trellis/models/trellis/rpc/StateCompareAndSet.ts";
import type { StateDeleteResponse } from "../../../packages/trellis/models/trellis/rpc/StateDelete.ts";
import type { StateGetResponse } from "../../../packages/trellis/models/trellis/rpc/StateGet.ts";
import type { StateListResponse } from "../../../packages/trellis/models/trellis/rpc/StateList.ts";
import type { StatePutResponse } from "../../../packages/trellis/models/trellis/rpc/StatePut.ts";
import type {
  JsonValue,
  StateEntry,
} from "../../../packages/trellis/models/trellis/State.ts";
import type { StoredStateEntry, StateNamespace } from "./model.ts";

export const MAX_STATE_KEY_BYTES = 512;
export const MAX_STATE_VALUE_BYTES = 64 * 1024;
export const MAX_STATE_LIST_LIMIT = 100;

type StateKvEntryLike = {
  key: string;
  value: StoredStateEntry;
  revision: number;
  put(value: unknown, vcc?: boolean): Promise<Result<void, KVError>>;
  delete(vcc?: boolean): Promise<Result<void, KVError>>;
};

type StateKvLike = {
  create(key: string, value: unknown): Promise<Result<void, KVError>>;
  put(key: string, value: unknown): Promise<Result<void, KVError>>;
  get(key: string): Promise<Result<StateKvEntryLike, KVError | ValidationError>>;
  keys(filter?: string | string[]): Promise<Result<AsyncIterable<string>, KVError>>;
};

type StateStoreDeps = {
  kv: StateKvLike;
  now?: () => Date;
  maxKeyBytes?: number;
  maxValueBytes?: number;
  maxListLimit?: number;
};

type TypedStateKvLike = {
  create(key: string, value: unknown): Promise<Result<void, KVError>>;
  put(key: string, value: unknown): Promise<Result<void, KVError>>;
  get(key: string): Promise<Result<unknown, KVError | ValidationError>>;
  keys(filter?: string | string[]): Promise<Result<AsyncIterable<string>, KVError>>;
};

function makePaginated(
  offset: number,
  limit: number,
  count: number,
): Pick<StateListResponse, "count" | "offset" | "limit" | "next" | "prev"> {
  return {
    count,
    offset,
    limit,
    next: offset + limit >= count ? undefined : offset + limit,
    prev: offset - limit <= 0 ? undefined : offset - limit,
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function toRevision(revision: number): string {
  return `${revision}`;
}

function isNotFound(error: unknown): error is KVError {
  return error instanceof KVError && error.getContext().reason === "not found";
}

function isStateKvEntryLike(value: unknown): value is StateKvEntryLike {
  return value !== null && typeof value === "object" &&
    "key" in value && typeof value.key === "string" &&
    "value" in value && value.value !== null && typeof value.value === "object" &&
    "revision" in value && typeof value.revision === "number" &&
    "put" in value && typeof value.put === "function" &&
    "delete" in value && typeof value.delete === "function";
}

export function createStateKvAdapter(kv: TypedStateKvLike): StateKvLike {
  return {
    create(key, value) {
      return kv.create(key, value);
    },
    put(key, value) {
      return kv.put(key, value);
    },
    async get(key) {
      const result = await kv.get(key);
      if (result.isErr()) return Result.err(result.error);
      const entry = result.unwrapOrElse(() => {
        throw new Error("state KV get unexpectedly failed");
      });
      if (!isStateKvEntryLike(entry)) {
        return Result.err(new ValidationError({
          errors: [{ path: "/entry", message: "state KV entry shape is invalid" }],
        }));
      }
      return Result.ok(entry);
    },
    keys(filter) {
      return kv.keys(filter);
    },
  };
}

export class StateStore {
  readonly #kv: StateKvLike;
  readonly #now: () => Date;
  readonly #maxKeyBytes: number;
  readonly #maxValueBytes: number;
  readonly #maxListLimit: number;

  constructor(deps: StateStoreDeps) {
    this.#kv = deps.kv;
    this.#now = deps.now ?? (() => new Date());
    this.#maxKeyBytes = deps.maxKeyBytes ?? MAX_STATE_KEY_BYTES;
    this.#maxValueBytes = deps.maxValueBytes ?? MAX_STATE_VALUE_BYTES;
    this.#maxListLimit = deps.maxListLimit ?? MAX_STATE_LIST_LIMIT;
  }

  async get(namespace: StateNamespace, key: string): Promise<Result<StateGetResponse, ValidationError | UnexpectedError>> {
    const valid = this.#validateKey(key);
    if (isErr(valid)) return valid;

    const loaded = await this.#loadLiveEntry(namespace, key);
    if (loaded.isErr()) return Result.err(loaded.error);
    const entry = loaded.unwrapOrElse(() => null);
    if (!entry) return Result.ok({ found: false });
    return Result.ok({ found: true, entry: this.#toPublicEntry(entry, key) });
  }

  async put(
    namespace: StateNamespace,
    key: string,
    value: JsonValue,
    ttlMs?: number,
  ): Promise<Result<StatePutResponse, ValidationError | UnexpectedError>> {
    const valid = this.#validateWrite(key, value);
    if (isErr(valid)) return valid;

    const envelope = this.#createEnvelope(value, ttlMs);
    const putResult = (await this.#kv.put(this.#storageKey(namespace, key), envelope)).take();
    if (isErr(putResult)) {
      return Result.err(new UnexpectedError({ cause: putResult.error }));
    }

    const refreshed = await this.#requireLiveEntry(namespace, key);
    if (refreshed.isErr()) return Result.err(refreshed.error);
    return Result.ok({ entry: this.#toPublicEntry(refreshed.unwrapOrElse(() => {
      throw new Error("state KV refresh unexpectedly failed");
    }), key) });
  }

  async compareAndSet(
    namespace: StateNamespace,
    key: string,
    expectedRevision: string | null,
    value: JsonValue,
    ttlMs?: number,
  ): Promise<Result<StateCompareAndSetResponse, ValidationError | UnexpectedError>> {
    const valid = this.#validateWrite(key, value);
    if (isErr(valid)) return valid;

    const currentResult = await this.#loadLiveEntry(namespace, key);
    if (currentResult.isErr()) return Result.err(currentResult.error);
    const current = currentResult.unwrapOrElse(() => null);

    const envelope = this.#createEnvelope(value, ttlMs);
    if (expectedRevision === null) {
      if (current) {
        return Result.ok({
          applied: false,
          found: true,
          entry: this.#toPublicEntry(current, key),
        });
      }

      const createResult = (await this.#kv.create(this.#storageKey(namespace, key), envelope)).take();
      if (isErr(createResult)) {
        const latestResult = await this.#loadLiveEntry(namespace, key);
        if (latestResult.isErr()) return Result.err(latestResult.error);
        const latest = latestResult.unwrapOrElse(() => null);
        if (!latest) {
          return Result.err(new UnexpectedError({ cause: createResult.error }));
        }
        return Result.ok({
          applied: false,
          found: true,
          entry: this.#toPublicEntry(latest, key),
        });
      }

      const created = await this.#requireLiveEntry(namespace, key);
      if (created.isErr()) return Result.err(created.error);
      return Result.ok({ applied: true, entry: this.#toPublicEntry(created.unwrapOrElse(() => {
        throw new Error("state KV create unexpectedly failed");
      }), key) });
    }

    if (!current) {
      return Result.ok({ applied: false, found: false });
    }

    if (toRevision(current.revision) !== expectedRevision) {
      return Result.ok({
        applied: false,
        found: true,
        entry: this.#toPublicEntry(current, key),
      });
    }

    const putResult = (await current.put(envelope, true)).take();
    if (isErr(putResult)) {
      const latestResult = await this.#loadLiveEntry(namespace, key);
      if (latestResult.isErr()) return Result.err(latestResult.error);
      const latest = latestResult.unwrapOrElse(() => null);
      if (!latest) return Result.ok({ applied: false, found: false });
      return Result.ok({
        applied: false,
        found: true,
        entry: this.#toPublicEntry(latest, key),
      });
    }

    const updated = await this.#requireLiveEntry(namespace, key);
    if (updated.isErr()) return Result.err(updated.error);
    return Result.ok({ applied: true, entry: this.#toPublicEntry(updated.unwrapOrElse(() => {
      throw new Error("state KV update unexpectedly failed");
    }), key) });
  }

  async delete(
    namespace: StateNamespace,
    key: string,
    expectedRevision?: string,
  ): Promise<Result<StateDeleteResponse, ValidationError | UnexpectedError>> {
    const valid = this.#validateKey(key);
    if (isErr(valid)) return valid;

    const currentResult = await this.#loadLiveEntry(namespace, key);
    if (currentResult.isErr()) return Result.err(currentResult.error);
    const current = currentResult.unwrapOrElse(() => null);
    if (!current) return Result.ok({ deleted: false });

    if (expectedRevision && toRevision(current.revision) !== expectedRevision) {
      return Result.ok({ deleted: false });
    }

    const deleteResult = (await current.delete(Boolean(expectedRevision))).take();
    if (isErr(deleteResult)) {
      return Result.err(new UnexpectedError({ cause: deleteResult.error }));
    }

    return Result.ok({ deleted: true });
  }

  async list(
    namespace: StateNamespace,
    opts: { prefix?: string; offset: number; limit: number },
  ): Promise<Result<StateListResponse, ValidationError | UnexpectedError>> {
    const valid = this.#validateList(opts.prefix, opts.limit);
    if (isErr(valid)) return valid;

    const namespacePrefix = this.#namespacePrefix(namespace);
    const keys = (await this.#kv.keys(`${namespacePrefix}.>`)).take();
    if (isErr(keys)) {
      return Result.err(new UnexpectedError({ cause: keys.error }));
    }

    const entries: StateEntry[] = [];
    for await (const storageKey of keys) {
      if (!storageKey.startsWith(`${namespacePrefix}.`)) continue;
      const key = storageKey.slice(namespacePrefix.length + 1);
      if (opts.prefix && !key.startsWith(opts.prefix)) continue;

      const entryResult = await this.#loadLiveEntry(namespace, key);
      if (entryResult.isErr()) return Result.err(entryResult.error);
      const entry = entryResult.unwrapOrElse(() => null);
      if (!entry) continue;
      entries.push(this.#toPublicEntry(entry, key));
    }

    entries.sort((left, right) => left.key.localeCompare(right.key));
    return Result.ok({
      ...makePaginated(opts.offset, opts.limit, entries.length),
      entries: entries.slice(opts.offset, opts.offset + opts.limit),
    });
  }

  #createEnvelope(value: JsonValue, ttlMs?: number): StoredStateEntry {
    const updatedAt = this.#now();
    return ttlMs === undefined
      ? { value, updatedAt }
      : { value, updatedAt, expiresAt: new Date(updatedAt.getTime() + ttlMs) };
  }

  async #loadLiveEntry(
    namespace: StateNamespace,
    key: string,
  ): Promise<Result<StateKvEntryLike | null, ValidationError | UnexpectedError>> {
    const entry = (await this.#kv.get(this.#storageKey(namespace, key))).take();
    if (isErr(entry)) {
      if (isNotFound(entry.error)) return Result.ok(null);
      if (entry.error instanceof ValidationError) return Result.err(entry.error);
      return Result.err(new UnexpectedError({ cause: entry.error }));
    }

    if (!this.#isExpired(entry.value)) return Result.ok(entry);

    const deleteResult = (await entry.delete(true)).take();
    if (isErr(deleteResult)) {
      return Result.err(new UnexpectedError({ cause: deleteResult.error }));
    }

    return Result.ok(null);
  }

  async #requireLiveEntry(
    namespace: StateNamespace,
    key: string,
  ): Promise<Result<StateKvEntryLike, ValidationError | UnexpectedError>> {
    const entry = await this.#loadLiveEntry(namespace, key);
    if (entry.isErr()) return Result.err(entry.error);
    const value = entry.unwrapOrElse(() => null);
    if (value) return Result.ok(value);
    return Result.err(new UnexpectedError({ cause: new Error(`state entry '${key}' disappeared`) }));
  }

  #isExpired(entry: StoredStateEntry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt.getTime() <= this.#now().getTime();
  }

  #namespacePrefix(namespace: StateNamespace): string {
    return `${namespace.scope}.${namespace.ownerKey}.${namespace.contractId}`;
  }

  #storageKey(namespace: StateNamespace, key: string): string {
    return `${this.#namespacePrefix(namespace)}.${key}`;
  }

  #toPublicEntry(entry: StateKvEntryLike, key: string): StateEntry {
    return {
      key,
      value: entry.value.value,
      revision: toRevision(entry.revision),
      updatedAt: entry.value.updatedAt.toISOString(),
      ...(entry.value.expiresAt ? { expiresAt: entry.value.expiresAt.toISOString() } : {}),
    };
  }

  #validateWrite(key: string, value: JsonValue): Result<void, ValidationError> {
    const keyResult = this.#validateKey(key);
    if (isErr(keyResult)) return keyResult;

    if (byteLength(JSON.stringify(value)) > this.#maxValueBytes) {
      return Result.err(new ValidationError({
        errors: [{ path: "/value", message: `state value exceeds ${this.#maxValueBytes} bytes` }],
      }));
    }

    return Result.ok(undefined);
  }

  #validateKey(key: string): Result<void, ValidationError> {
    if (byteLength(key) > this.#maxKeyBytes) {
      return Result.err(new ValidationError({
        errors: [{ path: "/key", message: `state key exceeds ${this.#maxKeyBytes} bytes` }],
      }));
    }

    return Result.ok(undefined);
  }

  #validateList(prefix: string | undefined, limit: number): Result<void, ValidationError> {
    if (prefix !== undefined && byteLength(prefix) > this.#maxKeyBytes) {
      return Result.err(new ValidationError({
        errors: [{ path: "/prefix", message: `state prefix exceeds ${this.#maxKeyBytes} bytes` }],
      }));
    }

    if (limit > this.#maxListLimit) {
      return Result.err(new ValidationError({
        errors: [{ path: "/limit", message: `state list limit exceeds ${this.#maxListLimit}` }],
      }));
    }

    return Result.ok(undefined);
  }
}
