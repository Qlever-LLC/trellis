import { AsyncResult, isErr, Result } from "@qlever-llc/result";
import {
  KVError,
  UnexpectedError,
  ValidationError,
} from "@qlever-llc/trellis";
import { parseUnknownSchema } from "../../../packages/trellis/codec.ts";
import type { StateDeleteResponse } from "../../../packages/trellis/models/trellis/rpc/StateDelete.ts";
import type { StateGetResponse } from "../../../packages/trellis/models/trellis/rpc/StateGet.ts";
import type { StateListResponse } from "../../../packages/trellis/models/trellis/rpc/StateList.ts";
import type { StatePutResponse } from "../../../packages/trellis/models/trellis/rpc/StatePut.ts";
import type {
  JsonValue,
  StateEntry,
} from "../../../packages/trellis/models/trellis/State.ts";
import type { ResolvedStateStore, StoredStateEntry } from "./model.ts";

export const MAX_STATE_KEY_BYTES = 512;
export const MAX_STATE_VALUE_BYTES = 64 * 1024;
export const MAX_STATE_LIST_LIMIT = 100;

const VALUE_STORE_KEY = "__value";

type StateKvEntryLike = {
  key: string;
  value: StoredStateEntry;
  revision: number;
  put(value: unknown, vcc?: boolean): AsyncResult<void, KVError>;
  delete(vcc?: boolean): AsyncResult<void, KVError>;
};

type StateKvLike = {
  create(key: string, value: unknown): AsyncResult<void, KVError>;
  put(key: string, value: unknown): AsyncResult<void, KVError>;
  get(key: string): AsyncResult<StateKvEntryLike, KVError | ValidationError>;
  keys(filter?: string | string[]): AsyncResult<AsyncIterable<string>, KVError>;
};

type StateStoreDeps = {
  kv: StateKvLike;
  now?: () => Date;
  maxKeyBytes?: number;
  maxValueBytes?: number;
  maxListLimit?: number;
};

type TypedStateKvLike = {
  create(key: string, value: unknown): AsyncResult<void, KVError>;
  put(key: string, value: unknown): AsyncResult<void, KVError>;
  get(key: string): AsyncResult<unknown, KVError | ValidationError>;
  keys(filter?: string | string[]): AsyncResult<AsyncIterable<string>, KVError>;
};

type StateAddress = {
  key?: string;
};

type StateWrite = {
  key?: string;
  value: JsonValue;
  expectedRevision?: string | null;
  ttlMs?: number;
};

type StateDelete = {
  key?: string;
  expectedRevision?: string;
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
    get(key) {
      return AsyncResult.from((async () => {
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
      })());
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

  async get(target: ResolvedStateStore, address: StateAddress = {}): Promise<Result<StateGetResponse, ValidationError | UnexpectedError>> {
    const keyResult = this.#resolveKey(target, address.key);
    if (isErr(keyResult)) return keyResult;
    const key = keyResult.unwrapOrElse(() => {
      throw new Error("state key resolution unexpectedly failed");
    });

    const loaded = await this.#loadLiveEntry(target, key);
    if (loaded.isErr()) return Result.err(loaded.error);
    const entry = loaded.unwrapOrElse(() => null);
    if (!entry) return Result.ok({ found: false });
    return Result.ok({ found: true, entry: this.#toPublicEntry(target, entry, key) });
  }

  async put(target: ResolvedStateStore, write: StateWrite): Promise<Result<StatePutResponse, ValidationError | UnexpectedError>> {
    const keyResult = this.#resolveKey(target, write.key);
    if (isErr(keyResult)) return keyResult;
    const key = keyResult.unwrapOrElse(() => {
      throw new Error("state key resolution unexpectedly failed");
    });

    const valid = this.#validateWrite(key, write.value);
    if (isErr(valid)) return valid;

    const parsedValue = this.#validateStoreValue(target, write.value);
    if (parsedValue.isErr()) return Result.err(parsedValue.error);
    const value = parsedValue.unwrapOrElse(() => {
      throw new Error("state value validation unexpectedly failed");
    });

    const currentResult = await this.#loadLiveEntry(target, key);
    if (currentResult.isErr()) return Result.err(currentResult.error);
    const current = currentResult.unwrapOrElse(() => null);

    const envelope = this.#createEnvelope(value, write.ttlMs);
    if (write.expectedRevision === undefined) {
      const putResult = await this.#kv.put(this.#storageKey(target, key), envelope);
      if (isErr(putResult)) {
        return Result.err(new UnexpectedError({ cause: putResult.error }));
      }
      const refreshed = await this.#requireLiveEntry(target, key);
      if (refreshed.isErr()) return Result.err(refreshed.error);
      const response: StatePutResponse = {
        applied: true,
        entry: this.#toPublicEntry(target, refreshed.unwrapOrElse(() => {
          throw new Error("state KV refresh unexpectedly failed");
        }), key),
      };
      return Result.ok(response);
    }

    if (write.expectedRevision === null) {
      if (current) {
        const response: StatePutResponse = {
          applied: false,
          found: true,
          entry: this.#toPublicEntry(target, current, key),
        };
        return Result.ok(response);
      }

      const createResult = await this.#kv.create(this.#storageKey(target, key), envelope);
      if (isErr(createResult)) {
        const latestResult = await this.#loadLiveEntry(target, key);
        if (latestResult.isErr()) return Result.err(latestResult.error);
        const latest = latestResult.unwrapOrElse(() => null);
        if (!latest) {
          return Result.err(new UnexpectedError({ cause: createResult.error }));
        }
        const response: StatePutResponse = {
          applied: false,
          found: true,
          entry: this.#toPublicEntry(target, latest, key),
        };
        return Result.ok(response);
      }

      const created = await this.#requireLiveEntry(target, key);
      if (created.isErr()) return Result.err(created.error);
      const response: StatePutResponse = {
        applied: true,
        entry: this.#toPublicEntry(target, created.unwrapOrElse(() => {
          throw new Error("state KV create unexpectedly failed");
        }), key),
      };
      return Result.ok(response);
    }

    if (!current) {
      const response: StatePutResponse = { applied: false, found: false };
      return Result.ok(response);
    }

    if (toRevision(current.revision) !== write.expectedRevision) {
      const response: StatePutResponse = {
        applied: false,
        found: true,
        entry: this.#toPublicEntry(target, current, key),
      };
      return Result.ok(response);
    }

    const putResult = await current.put(envelope, true);
    if (isErr(putResult)) {
      const latestResult = await this.#loadLiveEntry(target, key);
      if (latestResult.isErr()) return Result.err(latestResult.error);
      const latest = latestResult.unwrapOrElse(() => null);
      if (!latest) {
        const response: StatePutResponse = { applied: false, found: false };
        return Result.ok(response);
      }
      const response: StatePutResponse = {
        applied: false,
        found: true,
        entry: this.#toPublicEntry(target, latest, key),
      };
      return Result.ok(response);
    }

    const updated = await this.#requireLiveEntry(target, key);
    if (updated.isErr()) return Result.err(updated.error);
    const response: StatePutResponse = {
      applied: true,
      entry: this.#toPublicEntry(target, updated.unwrapOrElse(() => {
        throw new Error("state KV update unexpectedly failed");
      }), key),
    };
    return Result.ok(response);
  }

  async delete(target: ResolvedStateStore, input: StateDelete): Promise<Result<StateDeleteResponse, ValidationError | UnexpectedError>> {
    const keyResult = this.#resolveKey(target, input.key);
    if (isErr(keyResult)) return keyResult;
    const key = keyResult.unwrapOrElse(() => {
      throw new Error("state key resolution unexpectedly failed");
    });

    const currentResult = await this.#loadLiveEntry(target, key);
    if (currentResult.isErr()) return Result.err(currentResult.error);
    const current = currentResult.unwrapOrElse(() => null);
    if (!current) return Result.ok({ deleted: false });

    if (input.expectedRevision && toRevision(current.revision) !== input.expectedRevision) {
      return Result.ok({ deleted: false });
    }

    const deleteResult = await current.delete(Boolean(input.expectedRevision));
    if (isErr(deleteResult)) {
      return Result.err(new UnexpectedError({ cause: deleteResult.error }));
    }

    return Result.ok({ deleted: true });
  }

  async list(
    target: ResolvedStateStore,
    opts: { prefix?: string; offset: number; limit: number },
  ): Promise<Result<StateListResponse, ValidationError | UnexpectedError>> {
    const valid = this.#validateList(target, opts.prefix, opts.limit);
    if (isErr(valid)) return valid;

    if (target.kind === "value") {
      const current = await this.get(target);
      if (current.isErr()) return Result.err(current.error);
      const currentValue = current.unwrapOrElse(() => {
        throw new Error("state get unexpectedly failed");
      });
      const entries = currentValue.found ? [currentValue.entry] : [];
      return Result.ok({
        ...makePaginated(opts.offset, opts.limit, entries.length),
        entries: entries.slice(opts.offset, opts.offset + opts.limit),
      });
    }

    const namespacePrefix = this.#namespacePrefix(target);
    const keys = await this.#kv.keys(`${namespacePrefix}.>`);
    if (isErr(keys)) {
      return Result.err(new UnexpectedError({ cause: keys.error }));
    }

    const entries: StateEntry[] = [];
    for await (const storageKey of keys.unwrapOrElse(() => {
      throw new Error("state KV keys unexpectedly failed");
    })) {
      if (!storageKey.startsWith(`${namespacePrefix}.`)) continue;
      const key = storageKey.slice(namespacePrefix.length + 1);
      if (key === VALUE_STORE_KEY) continue;
      if (opts.prefix && !key.startsWith(opts.prefix)) continue;

      const entryResult = await this.#loadLiveEntry(target, key);
      if (entryResult.isErr()) return Result.err(entryResult.error);
      const entry = entryResult.unwrapOrElse(() => null);
      if (!entry) continue;
      entries.push(this.#toPublicEntry(target, entry, key));
    }

    entries.sort((left, right) => (left.key ?? "").localeCompare(right.key ?? ""));
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
    target: ResolvedStateStore,
    key: string,
  ): Promise<Result<StateKvEntryLike | null, ValidationError | UnexpectedError>> {
    const entry = await this.#kv.get(this.#storageKey(target, key));
    if (isErr(entry)) {
      if (isNotFound(entry.error)) return Result.ok(null);
      if (entry.error instanceof ValidationError) return Result.err(entry.error);
      return Result.err(new UnexpectedError({ cause: entry.error }));
    }

    const loaded = entry.unwrapOrElse(() => {
      throw new Error("state KV get unexpectedly failed");
    });
    const parsedValue = this.#validateStoreValue(target, loaded.value.value);
    if (parsedValue.isErr()) return Result.err(parsedValue.error);
    loaded.value.value = parsedValue.unwrapOrElse(() => {
      throw new Error("state value validation unexpectedly failed");
    });
    if (!this.#isExpired(loaded.value)) return Result.ok(loaded);

    const deleteResult = await loaded.delete(true);
    if (isErr(deleteResult)) {
      return Result.err(new UnexpectedError({ cause: deleteResult.error }));
    }

    return Result.ok(null);
  }

  async #requireLiveEntry(
    target: ResolvedStateStore,
    key: string,
  ): Promise<Result<StateKvEntryLike, ValidationError | UnexpectedError>> {
    const entry = await this.#loadLiveEntry(target, key);
    if (entry.isErr()) return Result.err(entry.error);
    const value = entry.unwrapOrElse(() => null);
    if (value) return Result.ok(value);
    return Result.err(new UnexpectedError({ cause: new Error(`state entry '${key}' disappeared`) }));
  }

  #isExpired(entry: StoredStateEntry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt.getTime() <= this.#now().getTime();
  }

  #namespacePrefix(target: ResolvedStateStore): string {
    return `${target.ownerType}.${target.ownerKey}.${target.contractId}.${target.store}`;
  }

  #storageKey(target: ResolvedStateStore, key: string): string {
    return `${this.#namespacePrefix(target)}.${key}`;
  }

  #toPublicEntry(target: ResolvedStateStore, entry: StateKvEntryLike, key: string): StateEntry {
    return {
      ...(target.kind === "map" ? { key } : {}),
      value: entry.value.value,
      revision: toRevision(entry.revision),
      updatedAt: entry.value.updatedAt.toISOString(),
      ...(entry.value.expiresAt ? { expiresAt: entry.value.expiresAt.toISOString() } : {}),
    };
  }

  #resolveKey(target: ResolvedStateStore, key: string | undefined): Result<string, ValidationError> {
    if (target.kind === "value") {
      if (key !== undefined) {
        return Result.err(new ValidationError({
          errors: [{ path: "/key", message: "value stores do not accept key" }],
        }));
      }
      return Result.ok(VALUE_STORE_KEY);
    }

    if (key === undefined) {
      return Result.err(new ValidationError({
        errors: [{ path: "/key", message: "map stores require key" }],
      }));
    }

    return this.#validateKey(key).map(() => key);
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

  #validateStoreValue(
    target: ResolvedStateStore,
    value: JsonValue,
  ): Result<JsonValue, ValidationError | UnexpectedError> {
    const parsed = parseUnknownSchema(target.schema, value);
    if (parsed.isErr()) return Result.err(parsed.error);
    return Result.ok(parsed.unwrapOrElse(() => {
      throw new Error("state value validation unexpectedly failed");
    }) as JsonValue);
  }

  #validateKey(key: string): Result<void, ValidationError> {
    if (byteLength(key) > this.#maxKeyBytes) {
      return Result.err(new ValidationError({
        errors: [{ path: "/key", message: `state key exceeds ${this.#maxKeyBytes} bytes` }],
      }));
    }

    return Result.ok(undefined);
  }

  #validateList(target: ResolvedStateStore, prefix: string | undefined, limit: number): Result<void, ValidationError> {
    if (target.kind === "value" && prefix !== undefined) {
      return Result.err(new ValidationError({
        errors: [{ path: "/prefix", message: "value stores do not support prefix" }],
      }));
    }

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
