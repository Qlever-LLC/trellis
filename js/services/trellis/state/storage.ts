import { AsyncResult, isErr, Result } from "@qlever-llc/result";
import { KVError, UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import { parseUnknownSchema } from "../../../packages/trellis/codec.ts";
import type { StateDeleteResponse } from "../../../packages/trellis/models/trellis/rpc/StateDelete.ts";
import type { StateGetResponse } from "../../../packages/trellis/models/trellis/rpc/StateGet.ts";
import type { StateListResponse } from "../../../packages/trellis/models/trellis/rpc/StateList.ts";
import type { StatePutResponse } from "../../../packages/trellis/models/trellis/rpc/StatePut.ts";
import type {
  JsonValue,
  StateEntry,
  StateMigrationRequired,
} from "../../../packages/trellis/models/trellis/State.ts";
import type { ResolvedStateStore, StoredStateEntry } from "./model.ts";

export const MAX_STATE_KEY_BYTES = 512;
export const MAX_STATE_VALUE_BYTES = 64 * 1024;
export const MAX_STATE_LIST_LIMIT = 100;

const VALUE_STORE_KEY = "~value";

type StateKvEntryLike = {
  key: string;
  value: unknown;
  revision: number;
  put(value: unknown, vcc?: boolean): AsyncResult<void, KVError>;
  delete(vcc?: boolean): AsyncResult<void, KVError>;
};

type LiveStateKvEntry = Omit<StateKvEntryLike, "value"> & {
  value: StoredStateEntry;
};

type StateStoreDeps = {
  kv: StateKvLike;
  now?: () => Date;
  maxKeyBytes?: number;
  maxValueBytes?: number;
  maxListLimit?: number;
};

type StateKvLike = {
  create(key: string, value: unknown): AsyncResult<void, KVError>;
  put(key: string, value: unknown): AsyncResult<void, KVError>;
  get(key: string): AsyncResult<StateKvEntryLike, KVError | ValidationError>;
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

type ListedStateEntry = StateEntry | StateMigrationRequired;

type StoreValueValidation = {
  value: JsonValue;
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
    next: limit <= 0 || offset + limit >= count ? undefined : offset + limit,
    prev: offset > 0 ? Math.max(0, offset - limit) : undefined,
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function encodeStateComponent(value: string): string {
  return [...value].map((char) => {
    if (/^[A-Za-z0-9_/-]$/.test(char)) {
      return char;
    }

    return [...new TextEncoder().encode(char)]
      .map((byte) => `=${byte.toString(16).toUpperCase().padStart(2, "0")}`)
      .join("");
  }).join("");
}

function decodeStateComponent(value: string): string {
  const bytes: number[] = [];

  for (let index = 0; index < value.length;) {
    const char = value[index];
    if (char === "=") {
      const hex = value.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
        throw new Error(`invalid encoded state key component '${value}'`);
      }
      bytes.push(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }

    bytes.push(char.charCodeAt(0));
    index += 1;
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

function toRevision(revision: number): string {
  return `${revision}`;
}

function isNotFound(error: unknown): error is KVError {
  return error instanceof KVError && error.getContext().reason === "not found";
}

function isCreateConflict(error: unknown): error is KVError {
  return error instanceof KVError && error.operation === "create" &&
    error.getContext().reason === "exists";
}

function isRevisionConflict(error: unknown): error is KVError {
  return error instanceof KVError &&
    error.getContext().reason === "revision mismatch";
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

  async get(
    target: ResolvedStateStore,
    address: StateAddress = {},
  ): Promise<Result<StateGetResponse, ValidationError | UnexpectedError>> {
    const keyResult = this.#resolveKey(target, address.key);
    if (isErr(keyResult)) return keyResult;
    const key = keyResult.orThrow();

    const loaded = await this.#loadLiveEntry(target, key);
    if (loaded.isErr()) return Result.err(loaded.error);
    const entry = loaded.unwrapOrElse(() => null);
    if (!entry) return Result.ok({ found: false });
    const migration = this.#toMigrationRequired(target, entry, key);
    if (migration) return Result.ok(migration);
    return Result.ok({
      found: true,
      entry: this.#toPublicEntry(target, entry, key),
    });
  }

  async put(
    target: ResolvedStateStore,
    write: StateWrite,
  ): Promise<Result<StatePutResponse, ValidationError | UnexpectedError>> {
    const keyResult = this.#resolveKey(target, write.key);
    if (isErr(keyResult)) return keyResult;
    const key = keyResult.orThrow();

    const valid = this.#validateWrite(key, write.value);
    if (isErr(valid)) return valid;

    const parsedValue = this.#validateStoreValue(target, write.value);
    if (parsedValue.isErr()) return Result.err(parsedValue.error);
    const value = parsedValue.orThrow();

    const envelope = this.#createEnvelope(target, value, write.ttlMs);
    if (write.expectedRevision === undefined) {
      const putResult = await this.#kv.put(
        this.#storageKey(target, key),
        envelope,
      );
      if (isErr(putResult)) {
        return Result.err(new UnexpectedError({ cause: putResult.error }));
      }
      const refreshed = await this.#requireLiveEntry(target, key);
      if (refreshed.isErr()) return Result.err(refreshed.error);
      const response: StatePutResponse = {
        applied: true,
        entry: this.#toPublicEntry(
          target,
          refreshed.orThrow(),
          key,
        ),
      };
      return Result.ok(response);
    }

    const currentResult = await this.#loadLiveEntry(target, key);
    if (currentResult.isErr()) return Result.err(currentResult.error);
    const current = currentResult.unwrapOrElse(() => null);

    if (write.expectedRevision === null) {
      if (current) {
        const response: StatePutResponse = {
          applied: false,
          found: true,
          entry: this.#toPutConflictEntry(target, current, key),
        };
        return Result.ok(response);
      }

      const createResult = await this.#kv.create(
        this.#storageKey(target, key),
        envelope,
      );
      if (isErr(createResult)) {
        if (!isCreateConflict(createResult.error)) {
          return Result.err(new UnexpectedError({ cause: createResult.error }));
        }
        const latestResult = await this.#loadLiveEntry(target, key);
        if (latestResult.isErr()) return Result.err(latestResult.error);
        const latest = latestResult.unwrapOrElse(() => null);
        if (!latest) {
          return Result.err(new UnexpectedError({ cause: createResult.error }));
        }
        const response: StatePutResponse = {
          applied: false,
          found: true,
          entry: this.#toPutConflictEntry(target, latest, key),
        };
        return Result.ok(response);
      }

      const created = await this.#requireLiveEntry(target, key);
      if (created.isErr()) return Result.err(created.error);
      const response: StatePutResponse = {
        applied: true,
        entry: this.#toPublicEntry(
          target,
          created.orThrow(),
          key,
        ),
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
        entry: this.#toPutConflictEntry(target, current, key),
      };
      return Result.ok(response);
    }

    const putResult = await current.put(envelope, true);
    if (isErr(putResult)) {
      if (
        !isRevisionConflict(putResult.error) && !isNotFound(putResult.error)
      ) {
        return Result.err(new UnexpectedError({ cause: putResult.error }));
      }
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
        entry: this.#toPutConflictEntry(target, latest, key),
      };
      return Result.ok(response);
    }

    const updated = await this.#requireLiveEntry(target, key);
    if (updated.isErr()) return Result.err(updated.error);
    const response: StatePutResponse = {
      applied: true,
      entry: this.#toPublicEntry(
        target,
        updated.orThrow(),
        key,
      ),
    };
    return Result.ok(response);
  }

  async delete(
    target: ResolvedStateStore,
    input: StateDelete,
  ): Promise<Result<StateDeleteResponse, ValidationError | UnexpectedError>> {
    const keyResult = this.#resolveKey(target, input.key);
    if (isErr(keyResult)) return keyResult;
    const key = keyResult.orThrow();

    const currentResult = await this.#loadLiveEntry(target, key);
    if (currentResult.isErr()) return Result.err(currentResult.error);
    const current = currentResult.unwrapOrElse(() => null);
    if (!current) return Result.ok({ deleted: false });

    if (
      input.expectedRevision &&
      toRevision(current.revision) !== input.expectedRevision
    ) {
      return Result.ok({ deleted: false });
    }

    const deleteResult = await current.delete(Boolean(input.expectedRevision));
    if (isErr(deleteResult)) {
      if (input.expectedRevision && isRevisionConflict(deleteResult.error)) {
        return Result.ok({ deleted: false });
      }
      if (isNotFound(deleteResult.error)) {
        return Result.ok({ deleted: false });
      }
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

    const namespacePrefix = this.#namespacePrefix(target);
    const encodedPrefix = opts.prefix === undefined
      ? undefined
      : encodeStateComponent(opts.prefix);
    const keys = await this.#kv.keys(`${namespacePrefix}.>`);
    if (isErr(keys)) {
      return Result.err(new UnexpectedError({ cause: keys.error }));
    }

    const entries: ListedStateEntry[] = [];
    for await (
      const storageKey of keys.orThrow()
    ) {
      if (!storageKey.startsWith(`${namespacePrefix}.`)) continue;
      const encodedKey = storageKey.slice(namespacePrefix.length + 1);
      if (encodedKey === VALUE_STORE_KEY) continue;
      if (encodedPrefix && !encodedKey.startsWith(encodedPrefix)) continue;

      const key = decodeStateComponent(encodedKey);

      const entryResult = await this.#loadLiveEntry(target, key);
      if (entryResult.isErr()) return Result.err(entryResult.error);
      const entry = entryResult.unwrapOrElse(() => null);
      if (!entry) continue;
      entries.push(
        this.#toMigrationRequired(target, entry, key) ??
          this.#toPublicEntry(target, entry, key),
      );
    }

    entries.sort((left, right) =>
      (this.#entrySortKey(left)).localeCompare(this.#entrySortKey(right))
    );
    return Result.ok({
      ...makePaginated(opts.offset, opts.limit, entries.length),
      entries: entries.slice(opts.offset, opts.offset + opts.limit),
    });
  }

  #createEnvelope(
    target: ResolvedStateStore,
    value: JsonValue,
    ttlMs?: number,
  ): StoredStateEntry {
    const updatedAt = this.#now();
    const envelope = {
      value,
      updatedAt,
      stateVersion: target.stateVersion,
      writerContractDigest: target.contractDigest,
    };
    return ttlMs === undefined
      ? envelope
      : { ...envelope, expiresAt: new Date(updatedAt.getTime() + ttlMs) };
  }

  async #loadLiveEntry(
    target: ResolvedStateStore,
    key: string,
  ): Promise<
    Result<LiveStateKvEntry | null, ValidationError | UnexpectedError>
  > {
    const entry = await this.#kv.get(this.#storageKey(target, key));
    if (isErr(entry)) {
      if (isNotFound(entry.error)) return Result.ok(null);
      if (entry.error instanceof ValidationError) {
        return Result.err(new UnexpectedError({ cause: entry.error }));
      }
      return Result.err(new UnexpectedError({ cause: entry.error }));
    }

    const loaded = entry.orThrow();
    const parsedEntry = this.#parseStoredEntry(loaded.value);
    if (parsedEntry.isErr()) return Result.err(parsedEntry.error);
    const storedEntry = parsedEntry.orThrow();

    const parsedValue = this.#validateStoredValue(target, storedEntry);
    if (parsedValue.isErr()) return Result.err(parsedValue.error);
    const validation = parsedValue.orThrow();
    const liveEntry: LiveStateKvEntry = {
      key: loaded.key,
      value: {
        ...storedEntry,
        value: validation.value,
      },
      revision: loaded.revision,
      put: (value, vcc) => loaded.put(value, vcc),
      delete: (vcc) => loaded.delete(vcc),
    };
    if (!this.#isExpired(liveEntry.value)) return Result.ok(liveEntry);

    const deleteResult = await liveEntry.delete(true);
    if (isErr(deleteResult)) {
      return Result.err(new UnexpectedError({ cause: deleteResult.error }));
    }

    return Result.ok(null);
  }

  async #requireLiveEntry(
    target: ResolvedStateStore,
    key: string,
  ): Promise<Result<LiveStateKvEntry, ValidationError | UnexpectedError>> {
    const entry = await this.#loadLiveEntry(target, key);
    if (entry.isErr()) return Result.err(entry.error);
    const value = entry.unwrapOrElse(() => null);
    if (value) return Result.ok(value);
    return Result.err(
      new UnexpectedError({
        cause: new Error(`state entry '${key}' disappeared`),
      }),
    );
  }

  #isExpired(entry: StoredStateEntry): boolean {
    return entry.expiresAt !== undefined &&
      entry.expiresAt.getTime() <= this.#now().getTime();
  }

  #namespacePrefix(target: ResolvedStateStore): string {
    return [
      encodeStateComponent(target.ownerType),
      encodeStateComponent(target.ownerKey),
      encodeStateComponent(target.contractId),
      encodeStateComponent(target.store),
    ].join(".");
  }

  #storageKey(target: ResolvedStateStore, key: string): string {
    if (target.kind === "value") {
      return `${this.#namespacePrefix(target)}.${VALUE_STORE_KEY}`;
    }
    return `${this.#namespacePrefix(target)}.${encodeStateComponent(key)}`;
  }

  #toPublicEntry(
    target: ResolvedStateStore,
    entry: LiveStateKvEntry,
    key: string,
  ): StateEntry {
    return {
      ...(target.kind === "map" ? { key } : {}),
      value: entry.value.value,
      revision: toRevision(entry.revision),
      updatedAt: entry.value.updatedAt.toISOString(),
      ...(entry.value.expiresAt
        ? { expiresAt: entry.value.expiresAt.toISOString() }
        : {}),
    };
  }

  #toMigrationRequired(
    target: ResolvedStateStore,
    entry: LiveStateKvEntry,
    key: string,
  ): StateMigrationRequired | undefined {
    if (entry.value.stateVersion === target.stateVersion) return undefined;
    return {
      migrationRequired: true,
      entry: this.#toPublicEntry(target, entry, key),
      stateVersion: entry.value.stateVersion,
      currentStateVersion: target.stateVersion,
      writerContractDigest: entry.value.writerContractDigest,
    };
  }

  #toPutConflictEntry(
    target: ResolvedStateStore,
    entry: LiveStateKvEntry,
    key: string,
  ): StateEntry | StateMigrationRequired {
    return this.#toMigrationRequired(target, entry, key) ??
      this.#toPublicEntry(target, entry, key);
  }

  #entrySortKey(entry: ListedStateEntry): string {
    if ("migrationRequired" in entry) return entry.entry.key ?? "";
    return entry.key ?? "";
  }

  #resolveKey(
    target: ResolvedStateStore,
    key: string | undefined,
  ): Result<string, ValidationError> {
    if (target.kind === "value") {
      if (key !== undefined) {
        return Result.err(
          new ValidationError({
            errors: [{
              path: "/key",
              message: "value stores do not accept key",
            }],
          }),
        );
      }
      return Result.ok(VALUE_STORE_KEY);
    }

    if (key === undefined) {
      return Result.err(
        new ValidationError({
          errors: [{ path: "/key", message: "map stores require key" }],
        }),
      );
    }

    return this.#validateKey(key).map(() => key);
  }

  #validateWrite(key: string, value: JsonValue): Result<void, ValidationError> {
    const keyResult = this.#validateKey(key);
    if (isErr(keyResult)) return keyResult;

    if (byteLength(JSON.stringify(value)) > this.#maxValueBytes) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/value",
            message: `state value exceeds ${this.#maxValueBytes} bytes`,
          }],
        }),
      );
    }

    return Result.ok(undefined);
  }

  #validateStoreValue(
    target: ResolvedStateStore,
    value: JsonValue,
  ): Result<JsonValue, ValidationError | UnexpectedError> {
    const parsed = parseUnknownSchema(target.schema, value);
    if (parsed.isErr()) return Result.err(parsed.error);
    return Result.ok(parsed.orThrow() as JsonValue);
  }

  #parseStoredEntry(
    value: unknown,
  ): Result<StoredStateEntry, UnexpectedError> {
    if (value === null || typeof value !== "object") {
      return Result.err(
        this.#storedEntryCorruption({
          errors: [{ path: "/entry", message: "state KV entry is invalid" }],
        }),
      );
    }

    const record = value as Record<string, unknown>;
    if (!(record.updatedAt instanceof Date)) {
      return Result.err(
        this.#storedEntryCorruption({
          errors: [{
            path: "/updatedAt",
            message: "state KV entry updatedAt is invalid",
          }],
        }),
      );
    }
    if (record.expiresAt !== undefined && !(record.expiresAt instanceof Date)) {
      return Result.err(
        this.#storedEntryCorruption({
          errors: [{
            path: "/expiresAt",
            message: "state KV entry expiresAt is invalid",
          }],
        }),
      );
    }
    if (record.stateVersion === undefined) {
      return Result.err(
        this.#storedEntryCorruption({
          errors: [{
            path: "/stateVersion",
            message: "state KV entry stateVersion is required",
          }],
        }),
      );
    }
    if (typeof record.stateVersion !== "string" || record.stateVersion === "") {
      return Result.err(
        this.#storedEntryCorruption({
          errors: [{
            path: "/stateVersion",
            message: "state KV entry stateVersion is invalid",
          }],
        }),
      );
    }
    if (record.writerContractDigest === undefined) {
      return Result.err(
        this.#storedEntryCorruption({
          errors: [{
            path: "/writerContractDigest",
            message: "state KV entry writerContractDigest is required",
          }],
        }),
      );
    }
    if (
      typeof record.writerContractDigest !== "string" ||
      record.writerContractDigest === ""
    ) {
      return Result.err(
        this.#storedEntryCorruption({
          errors: [{
            path: "/writerContractDigest",
            message: "state KV entry writerContractDigest is invalid",
          }],
        }),
      );
    }

    return Result.ok({
      value: record.value as JsonValue,
      updatedAt: record.updatedAt,
      ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
      stateVersion: record.stateVersion,
      writerContractDigest: record.writerContractDigest,
    });
  }

  #storedEntryCorruption(
    args: ConstructorParameters<typeof ValidationError>[0],
  ) {
    return new UnexpectedError({ cause: new ValidationError(args) });
  }

  #validateStoredValue(
    target: ResolvedStateStore,
    entry: StoredStateEntry,
  ): Result<StoreValueValidation, ValidationError | UnexpectedError> {
    const stateVersion = entry.stateVersion;
    if (stateVersion === target.stateVersion) {
      return this.#validateStoreValue(target, entry.value).map((value) => ({
        value,
      }));
    }

    const schema = target.acceptedVersions[stateVersion];
    if (!schema) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/stateVersion",
            message:
              `state version '${stateVersion}' is not accepted by store '${target.store}'`,
          }],
        }),
      );
    }

    const parsed = parseUnknownSchema(schema, entry.value);
    if (parsed.isErr()) return Result.err(parsed.error);
    return Result.ok({
      value: parsed.orThrow() as JsonValue,
    });
  }

  #validateKey(key: string): Result<void, ValidationError> {
    if (byteLength(key) > this.#maxKeyBytes) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/key",
            message: `state key exceeds ${this.#maxKeyBytes} bytes`,
          }],
        }),
      );
    }

    return Result.ok(undefined);
  }

  #validateList(
    target: ResolvedStateStore,
    prefix: string | undefined,
    limit: number,
  ): Result<void, ValidationError> {
    if (target.kind === "value") {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/store",
            message: "value stores do not support list",
          }],
        }),
      );
    }

    if (prefix !== undefined && byteLength(prefix) > this.#maxKeyBytes) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/prefix",
            message: `state prefix exceeds ${this.#maxKeyBytes} bytes`,
          }],
        }),
      );
    }

    if (limit > this.#maxListLimit) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/limit",
            message: `state list limit exceeds ${this.#maxListLimit}`,
          }],
        }),
      );
    }

    return Result.ok(undefined);
  }
}
