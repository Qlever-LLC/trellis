import { type KV, type KvEntry, Kvm } from "@nats-io/kv";
import { jetstreamManager } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core/internal";
import { AsyncResult, Result } from "@qlever-llc/result";
import type { StaticDecode, TSchema } from "typebox";
import Value, { ParseError } from "typebox/value";
import { KVError, ValidationError } from "./errors/index.ts";
import { decodeSubject, escapeKvKey } from "./helpers.ts";

function externalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(externalizeValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        out[key] = externalizeValue(entry);
      }
    }
    return out;
  }
  return value;
}

function parseExternalValue(schema: TSchema, value: unknown): unknown {
  if (Value.HasCodec(schema)) {
    return Value.Decode(schema, value);
  }
  return Value.Parse(schema, value);
}

function serializeValue(schema: TSchema, value: unknown): string {
  return JSON.stringify(Value.Parse(schema, externalizeValue(value)));
}

function serializeExternalValue(schema: TSchema, value: unknown): string {
  return serializeValue(schema, value);
}

async function ensureExistingBucketOptions(
  nats: NatsConnection,
  name: string,
  options: { ttl?: number },
): Promise<void> {
  const desiredTtlMs = options.ttl ?? 0;
  if (desiredTtlMs <= 0) return;

  const jsm = await jetstreamManager(nats);
  const streamName = `KV_${name}`;
  const info = await jsm.streams.info(streamName);
  const desiredMaxAge = desiredTtlMs * 1_000_000;
  if (info.config.max_age >= desiredMaxAge) return;

  await jsm.streams.update(info.config.name, {
    ...info.config,
    max_age: desiredMaxAge,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeUnknown(target: unknown, source: unknown): unknown {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return source;
  }

  const out: Record<string, unknown> = { ...target };
  for (const [key, entry] of Object.entries(source)) {
    if (entry === undefined) continue;
    out[key] = mergeUnknown(target[key], entry);
  }
  return out;
}

type KvFailureReason = "exists" | "revision mismatch";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function collectFailureText(value: unknown, depth = 0): string {
  if (depth > 2) return "";
  const parts: string[] = [];

  if (value instanceof Error) {
    parts.push(value.name, value.message);
    if (value.cause !== undefined) {
      parts.push(collectFailureText(value.cause, depth + 1));
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    parts.push(String(value));
  }

  const record = asRecord(value);
  if (record) {
    for (const key of ["name", "message", "description", "code", "err_code"]) {
      const field = record[key];
      if (typeof field === "string" || typeof field === "number") {
        parts.push(String(field));
      }
    }
    if (record.api_error !== undefined) {
      parts.push(collectFailureText(record.api_error, depth + 1));
    }
    if (record.cause !== undefined) {
      parts.push(collectFailureText(record.cause, depth + 1));
    }
  }

  return parts.join(" ").toLowerCase();
}

function inferKvFailureReason(
  operation: "create" | "put" | "delete",
  cause: unknown,
): KvFailureReason | undefined {
  const text = collectFailureText(cause);
  if (
    text.includes("wrong last sequence") ||
    text.includes("revision mismatch") ||
    text.includes("sequence mismatch")
  ) {
    return operation === "create" ? "exists" : "revision mismatch";
  }
  if (
    operation === "create" &&
    (text.includes("already exists") || text.includes("key exists"))
  ) {
    return "exists";
  }
  return undefined;
}

function kvError(
  operation: "create" | "put" | "delete",
  key: string,
  cause: unknown,
): KVError {
  const reason = inferKvFailureReason(operation, cause);
  return new KVError({
    operation,
    cause,
    context: reason === undefined ? { key } : { key, reason },
  });
}

/**
 * Represents a watch event emitted when a KV entry changes.
 */
export type WatchEvent<S extends TSchema> =
  & {
    /** The key that changed */
    key: string;
    /** The revision number of this change */
    revision: number;
    /** The timestamp when this change occurred */
    timestamp: Date;
  }
  & (
    | {
      /** The type of change: "update" for new/modified values */
      type: "update";
      value: StaticDecode<S>;
    }
    | {
      /** The type of change: "delete" for deletions */
      type: "delete";
      value?: undefined;
    }
    | {
      /** The type of change: "error" for invalid stored values */
      type: "error";
      error: ValidationError;
      value?: undefined;
    }
  );

/**
 * Options for the watch() method.
 */
export type WatchOptions = {
  /** If true, include delete events in the watch stream. Defaults to false. */
  includeDeletes?: boolean;
};

export class TypedKV<S extends TSchema> {
  private constructor(
    readonly schema: S,
    readonly kv: KV,
  ) {}

  private static fromParts<S extends TSchema>(schema: S, kv: KV): TypedKV<S> {
    return new TypedKV<S>(schema, kv);
  }

  static open<S extends TSchema>(
    nats: NatsConnection,
    name: string,
    schema: S,
    options: {
      history?: number;
      ttl?: number;
      bindOnly?: boolean;
      maxValueBytes?: number;
    },
  ): AsyncResult<TypedKV<S>, KVError> {
    return AsyncResult.from((async () => {
      try {
        const kvm = new Kvm(nats);
        const kv = options.bindOnly
          ? await kvm.open(name)
          : await kvm.create(name, {
            history: options.history ?? 1,
            ttl: options.ttl ?? 0,
            ...(options.maxValueBytes
              ? { maxValueSize: options.maxValueBytes }
              : {}),
          });

        if (!options.bindOnly) {
          await ensureExistingBucketOptions(nats, name, options);
        }

        const typedKv = TypedKV.fromParts(schema, kv);
        return Result.ok<TypedKV<S>, KVError>(typedKv);
      } catch (cause) {
        return Result.err(new KVError({ operation: "open", cause }));
      }
    })());
  }

  get(
    key: string,
  ): AsyncResult<TypedKVEntry<S>, KVError | ValidationError> {
    return AsyncResult.from((async () => {
      let s: KvEntry | null;
      try {
        s = await this.kv.get(escapeKvKey(key));
      } catch (cause) {
        return Result.err(
          new KVError({ operation: "get", cause, context: { key } }),
        );
      }
      if (!s) {
        return Result.err(
          new KVError({
            operation: "get",
            context: { key, reason: "not found" },
          }),
        );
      }
      const result = await createTypedKvEntry(this.schema, this.kv, s);
      return result as Result<TypedKVEntry<S>, KVError | ValidationError>;
    })());
  }

  private serialize(value: unknown): string {
    return serializeExternalValue(this.schema, value);
  }

  create(
    key: string,
    value: unknown,
  ): AsyncResult<void, KVError> {
    return AsyncResult.from((async () => {
      try {
        await this.kv.create(escapeKvKey(key), this.serialize(value));
        return Result.ok(undefined);
      } catch (cause) {
        return Result.err(kvError("create", key, cause));
      }
    })());
  }

  put(
    key: string,
    value: unknown,
  ): AsyncResult<void, KVError> {
    return AsyncResult.from((async () => {
      try {
        await this.kv.put(escapeKvKey(key), this.serialize(value));
        return Result.ok(undefined);
      } catch (cause) {
        return Result.err(kvError("put", key, cause));
      }
    })());
  }

  delete(key: string): AsyncResult<void, KVError> {
    return AsyncResult.from((async () => {
      try {
        await this.kv.delete(escapeKvKey(key));
        return Result.ok(undefined);
      } catch (cause) {
        return Result.err(kvError("delete", key, cause));
      }
    })());
  }

  keys(
    filter: string | string[] = ">",
  ): AsyncResult<AsyncIterable<string>, KVError> {
    return AsyncResult.from((async () => {
      try {
        return Result.ok(await this.kv.keys(filter));
      } catch (cause) {
        return Result.err(
          new KVError({ operation: "keys", cause, context: { filter } }),
        );
      }
    })());
  }

  status(): AsyncResult<{ values: number }, KVError> {
    return AsyncResult.from((async () => {
      try {
        const status = await this.kv.status();
        return Result.ok({ values: status.values });
      } catch (cause) {
        return Result.err(new KVError({ operation: "status", cause }));
      }
    })());
  }
}

export class TypedKVEntry<S extends TSchema> {
  readonly #value: unknown;

  constructor(
    private schema: S,
    private kv: KV,
    private entry: KvEntry,
    value: unknown,
  ) {
    this.#value = value;
  }

  get value(): StaticDecode<S> {
    return this.#value as StaticDecode<S>;
  }

  static create<S extends TSchema>(
    schema: S,
    kv: KV,
    entry: KvEntry,
  ): AsyncResult<TypedKVEntry<S>, ValidationError> {
    return AsyncResult.from((async () => {
      const result = await createTypedKvEntry(schema, kv, entry);
      return result as Result<TypedKVEntry<S>, ValidationError>;
    })());
  }

  get key() {
    return decodeSubject(this.entry.key);
  }

  get revision() {
    return this.entry.revision;
  }

  get createdAt() {
    return this.entry.created;
  }

  /**
   * Watch this KV entry for changes.
   *
   * @param callback - Function called when the entry changes
   * @param opts - Watch options (e.g., includeDeletes)
   * @returns A function to stop watching
   */
  async watch(
    callback: (event: WatchEvent<S>) => void,
    opts?: WatchOptions,
  ): Promise<() => void> {
    const watcher = await this.kv.watch({
      key: this.entry.key,
      include: opts?.includeDeletes ? "history" : "updates",
    });

    const abortController = new AbortController();

    // Start the async iteration in the background
    (async () => {
      for await (const entry of watcher) {
        if (abortController.signal.aborted) break;

        if (entry.operation === "DEL" || entry.operation === "PURGE") {
          if (opts?.includeDeletes) {
            callback({
              type: "delete",
              key: decodeSubject(entry.key),
              revision: entry.revision,
              timestamp: entry.created,
            });
          }
        } else {
          try {
            const json = entry.json();
            const validated = parseExternalValue(this.schema, json);
            callback({
              type: "update",
              key: decodeSubject(entry.key),
              value: validated as StaticDecode<S>,
              revision: entry.revision,
              timestamp: entry.created,
            });
          } catch (cause) {
            callback({
              type: "error",
              key: decodeSubject(entry.key),
              error: createValidationError(this.schema, entry, cause),
              revision: entry.revision,
              timestamp: entry.created,
            });
          }
        }
      }
    })();

    return () => {
      abortController.abort();
      watcher.stop();
    };
  }

  merge(
    value: unknown,
    vcc?: boolean,
  ): AsyncResult<void, KVError | ValidationError> {
    const mergedData = mergeUnknown(this.#value, value);
    const mergeResult = Result.try(() =>
      serializeExternalValue(this.schema, mergedData)
    );
    if (mergeResult.isErr()) {
      const cause = mergeResult.error.cause;
      if (cause instanceof ParseError) {
        const errors = Value.Errors(this.schema, externalizeValue(mergedData));
        return AsyncResult.err(new ValidationError({ errors, cause }));
      }
      return AsyncResult.err(
        new KVError({
          operation: "merge",
          cause: mergeResult.error,
          context: { key: this.key },
        }),
      );
    }
    return this.put(mergedData, vcc);
  }

  put(
    value: unknown,
    vcc?: boolean,
  ): AsyncResult<void, KVError> {
    return AsyncResult.from((async () => {
      const serialized = serializeValue(this.schema, value);
      try {
        await this.kv.put(this.entry.key, serialized, {
          previousSeq: vcc ? this.entry.revision : undefined,
        });
        return Result.ok(undefined);
      } catch (cause) {
        return Result.err(kvError("put", this.key, cause));
      }
    })());
  }

  delete(vcc?: boolean): AsyncResult<void, KVError> {
    return AsyncResult.from((async () => {
      try {
        await this.kv.delete(this.entry.key, {
          previousSeq: vcc ? this.entry.revision : undefined,
        });
        return Result.ok(undefined);
      } catch (cause) {
        return Result.err(kvError("delete", this.key, cause));
      }
    })());
  }
}

async function createTypedKvEntry<S extends TSchema>(
  schema: S,
  kv: KV,
  entry: KvEntry,
): Promise<Result<TypedKVEntry<S>, ValidationError>> {
  const jsonResult = Result.try(() => entry.json());
  if (jsonResult.isErr()) {
    return Result.err(
      createValidationError(schema, entry, jsonResult.error),
    );
  }
  const json = jsonResult.take();
  const parseResult = Result.try<unknown>(() => {
    if (Value.HasCodec(schema)) {
      return Value.Decode(schema, json);
    }
    return Value.Parse(schema, json);
  });
  if (parseResult.isErr()) {
    return Result.err(
      createValidationError(schema, entry, parseResult.error, json),
    );
  }

  const typedEntry = new TypedKVEntry(
    schema,
    kv,
    entry,
    parseResult.take() as StaticDecode<S>,
  );
  return Result.ok<TypedKVEntry<S>, ValidationError>(typedEntry);
}

function createValidationError(
  schema: TSchema,
  entry: KvEntry,
  cause: unknown,
  json?: unknown,
): ValidationError {
  if (cause instanceof ParseError) {
    return new ValidationError({
      errors: Value.Errors(schema, json),
      cause,
      context: {
        key: decodeSubject(entry.key),
        revision: entry.revision,
      },
    });
  }

  const error = cause instanceof Error ? cause : new Error(String(cause));
  return new ValidationError({
    errors: [{
      path: "",
      message: `Failed to decode KV value: ${error.message}`,
    }],
    cause: error,
    context: {
      key: decodeSubject(entry.key),
      revision: entry.revision,
    },
  });
}
