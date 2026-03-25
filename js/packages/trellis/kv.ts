// @ts-nocheck -- svelte-check hits pathological generic instantiation in this file
import { type KV, type KvEntry, Kvm } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core/internal";
import { Result } from "@trellis/result";
import { merge } from "ts-deepmerge";
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

function parseExternalValue<S extends TSchema>(schema: S, value: unknown): StaticDecode<S> {
  if (Value.HasCodec(schema)) {
    return Value.Decode(schema, value) as StaticDecode<S>;
  }
  return Value.Parse(schema, value) as StaticDecode<S>;
}

function serializeValue(schema: TSchema, value: unknown): string {
  return JSON.stringify(Value.Parse(schema, externalizeValue(value)));
}

function serializeExternalValue(schema: TSchema, value: unknown): string {
  return serializeValue(schema, value);
}

/**
 * Represents a watch event emitted when a KV entry changes.
 */
export type WatchEvent<S extends TSchema> = {
  /** The type of change: "update" for new/modified values, "delete" for deletions */
  type: "update" | "delete";
  /** The key that changed */
  key: string;
  /** The new value (only present for update events) */
  value?: StaticDecode<S>;
  /** The revision number of this change */
  revision: number;
  /** The timestamp when this change occurred */
  timestamp: Date;
};

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

  static async open<S extends TSchema>(
    nats: NatsConnection,
    name: string,
    schema: S,
    options: {
      history?: number;
      ttl?: number;
      bindOnly?: boolean;
      maxValueBytes?: number;
    },
  ): Promise<Result<TypedKV<S>, KVError>> {
    try {
      const kvm = new Kvm(nats);
      const kv = options.bindOnly
        ? await kvm.open(name)
        : await kvm.create(name, {
        history: options.history ?? 1,
        ttl: options.ttl ?? 0,
        ...(options.maxValueBytes ? { maxValueSize: options.maxValueBytes } : {}),
      });

      const typedKv = new TypedKV(schema as TSchema, kv) as unknown as TypedKV<S>;
      return Result.ok<TypedKV<S>, KVError>(typedKv);
    } catch (cause) {
      return Result.err(new KVError({ operation: "open", cause }));
    }
  }

  async get(
    key: string,
  ): Promise<Result<TypedKVEntry<S>, KVError | ValidationError>> {
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
    return await createTypedKvEntry(this.schema as TSchema, this.kv, s) as Result<
      TypedKVEntry<S>,
      ValidationError
    >;
  }

  async create(
    key: string,
    value: StaticDecode<S>,
  ): Promise<Result<void, KVError>> {
    const schema = this.schema as TSchema;
    const rawValue: unknown = value;
    // @ts-expect-error svelte-check hits excessive type instantiation here
    const serialized = serializeExternalValue(schema, rawValue);
    try {
      await this.kv.create(escapeKvKey(key), serialized);
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(
        new KVError({ operation: "create", cause, context: { key } }),
      );
    }
  }

  async put(
    key: string,
    value: StaticDecode<S>,
  ): Promise<Result<void, KVError>> {
    const schema = this.schema as TSchema;
    const rawValue: unknown = value;
    // @ts-expect-error svelte-check hits excessive type instantiation here
    const serialized = serializeExternalValue(schema, rawValue);
    try {
      await this.kv.put(escapeKvKey(key), serialized);
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(
        new KVError({ operation: "put", cause, context: { key } }),
      );
    }
  }

  async delete(key: string): Promise<Result<void, KVError>> {
    try {
      await this.kv.delete(escapeKvKey(key));
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(
        new KVError({ operation: "delete", cause, context: { key } }),
      );
    }
  }

  async keys(
    filter: string | string[] = ">",
  ): Promise<Result<AsyncIterable<string>, KVError>> {
    try {
      return Result.ok(await this.kv.keys(filter));
    } catch (cause) {
      return Result.err(
        new KVError({ operation: "keys", cause, context: { filter } }),
      );
    }
  }

  async status(): Promise<Result<{ values: number }, KVError>> {
    try {
      const status = await this.kv.status();
      return Result.ok({ values: status.values });
    } catch (cause) {
      return Result.err(new KVError({ operation: "status", cause }));
    }
  }
}

export class TypedKVEntry<S extends TSchema> {
  readonly value: StaticDecode<S>;

  constructor(
    private schema: S,
    private kv: KV,
    private entry: KvEntry,
    value: StaticDecode<S>,
  ) {
    // @ts-expect-error svelte-check hits excessive type instantiation on assignment
    this.value = value;
  }

  static async create<S extends TSchema>(
    schema: S,
    kv: KV,
    entry: KvEntry,
  ): Promise<Result<TypedKVEntry<S>, ValidationError>> {
    return await createTypedKvEntry(schema as TSchema, kv, entry) as Result<TypedKVEntry<S>, ValidationError>;
  }

  get key() {
    return decodeSubject(this.entry.key);
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
          let validated: StaticDecode<S>;
          try {
            const json = entry.json();
            validated = parseExternalValue(this.schema as TSchema, json) as StaticDecode<S>;
          } catch {
            try {
              await this.kv.delete(entry.key, {
                previousSeq: entry.revision,
              });
            } catch {
              // Best-effort cleanup of invalid entries.
            }
            continue;
          }
          callback({
            type: "update",
            key: decodeSubject(entry.key),
            value: validated,
            revision: entry.revision,
            timestamp: entry.created,
          });
        }
      }
    })();

    return () => {
      abortController.abort();
      watcher.stop();
    };
  }

  async merge(
    value: Partial<StaticDecode<S>>,
    vcc?: boolean,
  ): Promise<Result<void, KVError | ValidationError>> {
    // @ts-expect-error svelte-check hits excessive type instantiation here
    const mergedData = merge(this.value as Record<string, unknown>, value) as StaticDecode<S>;
    const schema = this.schema as TSchema;
    const mergedRawValue: unknown = mergedData;
    // @ts-expect-error svelte-check hits excessive type instantiation here
    const mergeResult = Result.try(() => serializeExternalValue(schema, mergedRawValue));
    if (mergeResult.isErr()) {
      const cause = mergeResult.error.cause;
      if (cause instanceof ParseError) {
        const errors = Value.Errors(schema, externalizeValue(mergedData));
        return Result.err(new ValidationError({ errors, cause }));
      }
      return Result.err(
        new KVError({ operation: "merge", cause: mergeResult.error, context: { key: this.key } }),
      );
    }
    return this.put(mergedData, vcc);
  }

  async put(
    value: StaticDecode<S>,
    vcc?: boolean,
  ): Promise<Result<void, KVError>> {
    const schema = this.schema as TSchema;
    const serialized = serializeValue(schema, value as unknown);
    try {
      await this.kv.put(this.entry.key, serialized, {
        previousSeq: vcc ? this.entry.revision : undefined,
      });
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(
        new KVError({ operation: "put", cause, context: { key: this.key } }),
      );
    }
  }

  async delete(vcc?: boolean): Promise<Result<void, KVError>> {
    try {
      await this.kv.delete(this.entry.key, {
        previousSeq: vcc ? this.entry.revision : undefined,
      });
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(
        new KVError({ operation: "delete", cause, context: { key: this.key } }),
      );
    }
  }
}

async function createTypedKvEntry(
  schema: TSchema,
  kv: KV,
  entry: KvEntry,
): Promise<Result<TypedKVEntry<TSchema>, ValidationError>> {
  async function deleteInvalidEntry(reason: string): Promise<Record<string, unknown>> {
    try {
      await kv.delete(entry.key, {
        previousSeq: entry.revision,
      });

      return {
        key: decodeSubject(entry.key),
        revision: entry.revision,
        invalidEntryDeleted: true,
        invalidEntryReason: reason,
      };
    } catch (cause) {
      return {
        key: decodeSubject(entry.key),
        revision: entry.revision,
        invalidEntryDeleted: false,
        invalidEntryDeleteError: cause instanceof Error ? cause.message : String(cause),
        invalidEntryReason: reason,
      };
    }
  }

  const jsonResult = Result.try(() => entry.json());
  if (jsonResult.isErr()) {
    const context = await deleteInvalidEntry(`decode failed: ${jsonResult.error.message}`);
    return Result.err(
      new ValidationError({
        errors: [{ path: "", message: `Failed to decode KV value: ${jsonResult.error.message}` }],
        cause: jsonResult.error,
        context,
      }),
    );
  }
  const json = jsonResult.take() as unknown;
  const parseResult = Result.try(() => parseExternalValue(schema, json));
  if (parseResult.isErr()) {
    const cause = parseResult.error.cause;
    if (cause instanceof ParseError) {
      const errors = Value.Errors(schema, json);
      const context = await deleteInvalidEntry("schema parse failed");
      return Result.err(new ValidationError({ errors, cause, context }));
    }
    const context = await deleteInvalidEntry(parseResult.error.message);
    return Result.err(
      new ValidationError({
        errors: [{ path: "", message: parseResult.error.message }],
        cause: parseResult.error,
        context,
      }),
    );
  }

  const typedEntry = new TypedKVEntry(
    schema,
    kv,
    entry,
    parseResult.take() as StaticDecode<TSchema>,
  );
  return Result.ok<TypedKVEntry<TSchema>, ValidationError>(typedEntry);
}
