import { type AsyncResult, type BaseError, isErr } from "@qlever-llc/result";
import { type StaticDecode, Type } from "typebox";
import type { PreparedTrellisEvent, Trellis } from "../trellis.ts";
import { TypedKV } from "../kv.ts";
import { recordTrellisError } from "../telemetry/mod.ts";

export type OutboxMessageState = "pending" | "dispatched" | "failed";

export type OutboxMessage = {
  id: string;
  event: string;
  subject: string;
  payload: string;
  headers: Record<string, string>;
  state: OutboxMessageState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string;
  lastError?: string;
};

export type OutboxDispatchResult = {
  dispatched: number;
  failed: number;
};

/** Options for {@link OutboxDispatcher}. */
export type OutboxDispatcherOptions = {
  /** Maximum number of messages claimed by each `dispatchOutbox` batch. */
  limit?: number;
  /** Delay before failed messages become eligible; values below 1ms become 1ms. */
  retryDelayMs?: number;
  /** Delay used to debounce `notify()` calls before starting a drain. */
  debounceMs?: number;
  /** Optional low-frequency wakeup for missed signals or process restarts. */
  idleRetryMs?: number;
  /** Receives repository or publish errors raised by background dispatch. */
  onError?: (error: unknown) => void;
};

export type OutboxRepository = {
  enqueue(event: PreparedTrellisEvent): Promise<OutboxMessage>;
  claimDue(limit: number, now: Date): Promise<OutboxMessage[]>;
  markDispatched(id: string, now: Date): Promise<void>;
  markFailed(
    id: string,
    failure: { error: string; nextAttemptAt: Date; now: Date },
  ): Promise<void>;
};

export type InboxRepository = {
  record(messageId: string, now?: Date): Promise<boolean>;
};

export type SqlDialect = "sqlite" | "postgres";

export type SqlOutboxTables = {
  outbox: string;
  inbox: string;
};

export type SqlExecutor = {
  query(sql: string, params: readonly unknown[]): Promise<readonly SqlRow[]>;
  execute(sql: string, params: readonly unknown[]): Promise<void>;
};

export type SqlRow = Record<string, unknown>;

export type SqlOutboxAdapter = {
  outbox: SqlOutboxRepository;
  inbox: SqlInboxRepository;
  ddl: readonly string[];
};

type KvAsyncResult<T> = Pick<AsyncResult<T, BaseError>, "take">;

export type OutboxKvEntry = {
  readonly key: string;
  readonly revision: number;
  readonly value: KvOutboxRecord;
  put(value: KvOutboxRecord, vcc?: boolean): KvAsyncResult<void>;
};

export type OutboxKvStore = {
  create(key: string, value: KvOutboxRecord): KvAsyncResult<void>;
  get(key: string): KvAsyncResult<OutboxKvEntry>;
  keys(filter?: string | string[]): KvAsyncResult<AsyncIterable<string>>;
};

export const defaultSqlOutboxTables: SqlOutboxTables = Object.freeze({
  outbox: "trellis_outbox",
  inbox: "trellis_inbox",
});

/**
 * Creates SQL outbox/inbox repositories plus DDL for caller-owned migrations.
 *
 * Trellis does not import Drizzle here to avoid making every service depend on a
 * specific migration library. Services should include the returned DDL, or an
 * equivalent Drizzle table definition using these table and column names, in
 * their own Drizzle-managed migration flow.
 */
export function createSqlOutboxAdapter(
  executor: SqlExecutor,
  dialect: SqlDialect,
  tables: SqlOutboxTables = defaultSqlOutboxTables,
): SqlOutboxAdapter {
  return {
    outbox: new SqlOutboxRepository(executor, dialect, tables),
    inbox: new SqlInboxRepository(executor, dialect, tables),
    ddl: dialect === "postgres"
      ? createPostgresOutboxSchema(tables)
      : createSqliteOutboxSchema(tables),
  };
}

/** Returns SQLite DDL for Trellis outbox and inbox tables. */
export function createSqliteOutboxSchema(
  tables: SqlOutboxTables = defaultSqlOutboxTables,
): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${tables.outbox} (id TEXT PRIMARY KEY, event TEXT NOT NULL, subject TEXT NOT NULL, payload TEXT NOT NULL, headers TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_attempt_at TEXT, last_error TEXT)`,
    `CREATE INDEX IF NOT EXISTS ${tables.outbox}_due_idx ON ${tables.outbox} (state, next_attempt_at)`,
    `CREATE TABLE IF NOT EXISTS ${tables.inbox} (message_id TEXT PRIMARY KEY, received_at TEXT NOT NULL)`,
  ];
}

/** Returns Postgres DDL for Trellis outbox and inbox tables. */
export function createPostgresOutboxSchema(
  tables: SqlOutboxTables = defaultSqlOutboxTables,
): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${tables.outbox} (id text PRIMARY KEY, event text NOT NULL, subject text NOT NULL, payload text NOT NULL, headers jsonb NOT NULL, state text NOT NULL, attempts integer NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, next_attempt_at timestamptz, last_error text)`,
    `CREATE INDEX IF NOT EXISTS ${tables.outbox}_due_idx ON ${tables.outbox} (state, next_attempt_at)`,
    `CREATE TABLE IF NOT EXISTS ${tables.inbox} (message_id text PRIMARY KEY, received_at timestamptz NOT NULL)`,
  ];
}

/** In-memory outbox repository intended for tests and local process adapters. */
export class MemoryOutboxRepository implements OutboxRepository {
  #messages = new Map<string, OutboxMessage>();

  async enqueue(event: PreparedTrellisEvent): Promise<OutboxMessage> {
    const now = new Date().toISOString();
    const id = messageId(event);
    const existing = this.#messages.get(id);
    if (existing) return existing;
    const message: OutboxMessage = {
      id,
      event: event.event,
      subject: event.subject,
      payload: event.encodedPayload,
      headers: { ...event.headers },
      state: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.#messages.set(id, message);
    return message;
  }

  async claimDue(limit: number, now: Date): Promise<OutboxMessage[]> {
    const dueAt = now.toISOString();
    const claimed: OutboxMessage[] = [];
    for (const message of this.#messages.values()) {
      if (claimed.length >= limit) break;
      if (message.state === "dispatched") continue;
      if (
        message.nextAttemptAt !== undefined && message.nextAttemptAt > dueAt
      ) {
        continue;
      }
      claimed.push({ ...message, headers: { ...message.headers } });
    }
    return claimed;
  }

  async markDispatched(id: string, now: Date): Promise<void> {
    const message = this.#messages.get(id);
    if (!message) return;
    this.#messages.set(id, {
      ...message,
      state: "dispatched",
      updatedAt: now.toISOString(),
      nextAttemptAt: undefined,
      lastError: undefined,
    });
  }

  async markFailed(
    id: string,
    failure: { error: string; nextAttemptAt: Date; now: Date },
  ): Promise<void> {
    const message = this.#messages.get(id);
    if (!message) return;
    this.#messages.set(id, {
      ...message,
      state: "failed",
      attempts: message.attempts + 1,
      updatedAt: failure.now.toISOString(),
      nextAttemptAt: failure.nextAttemptAt.toISOString(),
      lastError: failure.error,
    });
  }

  snapshot(): readonly OutboxMessage[] {
    return Array.from(this.#messages.values()).map((message) => ({
      ...message,
      headers: { ...message.headers },
    }));
  }
}

/** In-memory inbox repository intended for duplicate-suppression tests. */
export class MemoryInboxRepository implements InboxRepository {
  #seen = new Set<string>();

  async record(messageId: string): Promise<boolean> {
    if (this.#seen.has(messageId)) return false;
    this.#seen.add(messageId);
    return true;
  }
}

/** SQL-backed outbox repository over a caller-owned executor. */
export class SqlOutboxRepository implements OutboxRepository {
  constructor(
    readonly executor: SqlExecutor,
    readonly dialect: SqlDialect,
    readonly tables: SqlOutboxTables = defaultSqlOutboxTables,
  ) {}

  async enqueue(event: PreparedTrellisEvent): Promise<OutboxMessage> {
    const now = new Date().toISOString();
    const message: OutboxMessage = {
      id: messageId(event),
      event: event.event,
      subject: event.subject,
      payload: event.encodedPayload,
      headers: { ...event.headers },
      state: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    const headers = JSON.stringify(message.headers);
    const conflict = this.dialect === "postgres"
      ? "ON CONFLICT (id) DO NOTHING"
      : "ON CONFLICT(id) DO NOTHING";
    await this.executor.execute(
      `INSERT INTO ${this.tables.outbox} (id, event, subject, payload, headers, state, attempts, created_at, updated_at, next_attempt_at, last_error) VALUES (${
        placeholders(this.dialect, 11)
      }) ${conflict}`,
      [
        message.id,
        message.event,
        message.subject,
        message.payload,
        headers,
        message.state,
        message.attempts,
        message.createdAt,
        message.updatedAt,
        null,
        null,
      ],
    );
    return message;
  }

  async claimDue(limit: number, now: Date): Promise<OutboxMessage[]> {
    const rows = await this.executor.query(
      `SELECT id, event, subject, payload, headers, state, attempts, created_at, updated_at, next_attempt_at, last_error FROM ${this.tables.outbox} WHERE state != ${
        placeholder(this.dialect, 1)
      } AND (next_attempt_at IS NULL OR next_attempt_at <= ${
        placeholder(this.dialect, 2)
      }) ORDER BY created_at LIMIT ${placeholder(this.dialect, 3)}`,
      ["dispatched", now.toISOString(), limit],
    );
    return rows.map(rowToOutboxMessage);
  }

  async markDispatched(id: string, now: Date): Promise<void> {
    await this.executor.execute(
      `UPDATE ${this.tables.outbox} SET state = ${
        placeholder(this.dialect, 1)
      }, updated_at = ${
        placeholder(this.dialect, 2)
      }, next_attempt_at = NULL, last_error = NULL WHERE id = ${
        placeholder(this.dialect, 3)
      }`,
      ["dispatched", now.toISOString(), id],
    );
  }

  async markFailed(
    id: string,
    failure: { error: string; nextAttemptAt: Date; now: Date },
  ): Promise<void> {
    await this.executor.execute(
      `UPDATE ${this.tables.outbox} SET state = ${
        placeholder(this.dialect, 1)
      }, attempts = attempts + 1, updated_at = ${
        placeholder(this.dialect, 2)
      }, next_attempt_at = ${placeholder(this.dialect, 3)}, last_error = ${
        placeholder(this.dialect, 4)
      } WHERE id = ${placeholder(this.dialect, 5)}`,
      [
        "failed",
        failure.now.toISOString(),
        failure.nextAttemptAt.toISOString(),
        failure.error,
        id,
      ],
    );
  }
}

/** SQL-backed inbox repository over a caller-owned executor. */
export class SqlInboxRepository implements InboxRepository {
  constructor(
    readonly executor: SqlExecutor,
    readonly dialect: SqlDialect,
    readonly tables: SqlOutboxTables = defaultSqlOutboxTables,
  ) {}

  async record(messageId: string, now: Date = new Date()): Promise<boolean> {
    try {
      const existing = await this.executor.query(
        `SELECT message_id FROM ${this.tables.inbox} WHERE message_id = ${
          placeholder(this.dialect, 1)
        }`,
        [messageId],
      );
      if (existing.length > 0) return false;
      const conflict = this.dialect === "postgres"
        ? "ON CONFLICT (message_id) DO NOTHING"
        : "ON CONFLICT(message_id) DO NOTHING";
      await this.executor.execute(
        `INSERT INTO ${this.tables.inbox} (message_id, received_at) VALUES (${
          placeholders(this.dialect, 2)
        }) ${conflict}`,
        [messageId, now.toISOString()],
      );
      return true;
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("unique")) {
        return false;
      }
      throw cause;
    }
  }
}

const KvInboxRecordSchema = Type.Object({
  messageId: Type.String(),
  receivedAt: Type.String(),
});

type KvInboxRecord = StaticDecode<typeof KvInboxRecordSchema>;

export const KvOutboxRecordSchema = Type.Object({
  id: Type.String(),
  event: Type.String(),
  subject: Type.String(),
  payload: Type.String(),
  headers: Type.Record(Type.String(), Type.String()),
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("dispatched"),
    Type.Literal("failed"),
    Type.Literal("claimed"),
  ]),
  attempts: Type.Number(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  nextAttemptAt: Type.Optional(Type.String()),
  lastError: Type.Optional(Type.String()),
});

export type KvOutboxRecord = StaticDecode<typeof KvOutboxRecordSchema>;

/** Durable NATS KV outbox repository for services without SQL state. */
export class NatsKvOutboxRepository implements OutboxRepository {
  constructor(readonly kv: OutboxKvStore) {}

  async enqueue(event: PreparedTrellisEvent): Promise<OutboxMessage> {
    const now = new Date().toISOString();
    const record: KvOutboxRecord = {
      id: messageId(event),
      event: event.event,
      subject: event.subject,
      payload: event.encodedPayload,
      headers: { ...event.headers },
      state: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    const stored = await this.kv.create(record.id, record).take();
    if (!isErr(stored)) return kvRecordToOutboxMessage(record);
    if (!hasKvReason(stored.error, "exists")) throw stored.error;

    const existing = await this.kv.get(record.id).take();
    if (isErr(existing)) throw existing.error;
    return kvRecordToOutboxMessage(existing.value);
  }

  async claimDue(limit: number, now: Date): Promise<OutboxMessage[]> {
    const keys = await this.kv.keys().take();
    if (isErr(keys)) throw keys.error;

    const dueAt = now.toISOString();
    const claimed: OutboxMessage[] = [];
    for await (const key of keys) {
      if (claimed.length >= limit) break;
      const loaded = await this.kv.get(key).take();
      if (isErr(loaded)) {
        if (hasKvReason(loaded.error, "not found")) continue;
        throw loaded.error;
      }

      const entry = loaded;
      const record = entry.value;
      if (record.state === "dispatched" || record.state === "claimed") {
        continue;
      }
      if (record.nextAttemptAt !== undefined && record.nextAttemptAt > dueAt) {
        continue;
      }

      const next: KvOutboxRecord = {
        ...record,
        state: "claimed",
        updatedAt: dueAt,
      };
      const stored = await entry.put(next, true).take();
      if (isErr(stored)) {
        if (hasKvReason(stored.error, "revision mismatch")) continue;
        throw stored.error;
      }
      claimed.push(kvRecordToOutboxMessage(next));
    }
    return claimed;
  }

  async markDispatched(id: string, now: Date): Promise<void> {
    const loaded = await this.kv.get(id).take();
    if (isErr(loaded)) {
      if (hasKvReason(loaded.error, "not found")) return;
      throw loaded.error;
    }
    const stored = await loaded.put({
      ...loaded.value,
      state: "dispatched",
      updatedAt: now.toISOString(),
      nextAttemptAt: undefined,
      lastError: undefined,
    }, true).take();
    if (isErr(stored)) throw stored.error;
  }

  async markFailed(
    id: string,
    failure: { error: string; nextAttemptAt: Date; now: Date },
  ): Promise<void> {
    const loaded = await this.kv.get(id).take();
    if (isErr(loaded)) {
      if (hasKvReason(loaded.error, "not found")) return;
      throw loaded.error;
    }
    const record = loaded.value;
    const stored = await loaded.put({
      ...record,
      state: "failed",
      attempts: record.attempts + 1,
      updatedAt: failure.now.toISOString(),
      nextAttemptAt: failure.nextAttemptAt.toISOString(),
      lastError: failure.error,
    }, true).take();
    if (isErr(stored)) throw stored.error;
  }
}

/** Durable NATS KV inbox repository for event-id duplicate suppression. */
export class NatsKvInboxRepository implements InboxRepository {
  constructor(readonly kv: TypedKV<typeof KvInboxRecordSchema>) {}

  async record(messageId: string, now: Date = new Date()): Promise<boolean> {
    // Durable NATS KV dedupe is useful for event handlers without SQL state, but
    // it is not transactional with unrelated DB side effects.
    const record: KvInboxRecord = { messageId, receivedAt: now.toISOString() };
    const stored = await this.kv.create(messageId, record);
    const value = stored.take();
    if (isErr(value)) {
      const reason = value.error.toSerializable().context?.["reason"];
      if (reason === "exists") return false;
      throw value.error;
    }
    return true;
  }
}

/**
 * Coalesces outbox wakeups and drains due messages through `dispatchOutbox`.
 *
 * The dispatcher is process-local coordination only. Callers should invoke
 * `notify()` after committing outbox rows so dispatch does not observe rolled
 * back work.
 */
export class OutboxDispatcher {
  readonly #repository: OutboxRepository;
  readonly #runtime: Pick<Trellis, "publishPrepared">;
  readonly #options: OutboxDispatcherOptions;
  #wakeTimer: ReturnType<typeof setTimeout> | undefined;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #pending = false;
  #retryDue = false;
  #stopped = false;

  /** Creates a dispatcher over an existing outbox repository and runtime. */
  constructor(
    repository: OutboxRepository,
    runtime: Pick<Trellis, "publishPrepared">,
    options: OutboxDispatcherOptions = {},
  ) {
    this.#repository = repository;
    this.#runtime = runtime;
    this.#options = options;
    this.#scheduleIdleRetry();
  }

  /** Signals that outbox work may be available and schedules a drain soon. */
  notify(): void {
    if (this.#stopped) return;
    this.#pending = true;
    if (this.#running) return;
    this.#scheduleWakeup(this.#options.debounceMs ?? 0);
  }

  /** Cancels pending wakeups and prevents future dispatch work. */
  stop(): void {
    this.#stopped = true;
    this.#pending = false;
    this.#retryDue = false;
    this.#clearTimer("wake");
    this.#clearTimer("retry");
    this.#clearTimer("idle");
  }

  #scheduleWakeup(delayMs: number): void {
    if (this.#stopped) return;
    this.#clearTimer("wake");
    this.#wakeTimer = setTimeout(() => {
      this.#wakeTimer = undefined;
      void this.#run();
    }, delayMs);
  }

  #scheduleRetryWakeup(): void {
    if (this.#stopped) return;
    if (this.#retryTimer !== undefined) return;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      if (this.#stopped) return;
      this.#retryDue = true;
      this.#pending = true;
      if (!this.#running) this.#scheduleWakeup(0);
    }, this.#retryDelayMs());
  }

  #scheduleIdleRetry(): void {
    if (this.#stopped || this.#options.idleRetryMs === undefined) return;
    this.#clearTimer("idle");
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      this.notify();
    }, this.#options.idleRetryMs);
  }

  async #run(): Promise<void> {
    if (this.#stopped || this.#running) return;
    this.#running = true;
    this.#clearTimer("idle");
    let drainNow = new Date();
    try {
      do {
        if (this.#retryDue) {
          drainNow = new Date();
          this.#retryDue = false;
        }
        this.#pending = false;
        while (!this.#stopped) {
          const result = await this.#dispatchBatch(drainNow);
          if (result.failed > 0) {
            this.#scheduleRetryWakeup();
          }
          if (result.dispatched === 0 && result.failed === 0) break;
        }
      } while (this.#pending && !this.#stopped);
    } finally {
      this.#running = false;
      if (this.#pending && !this.#stopped) {
        this.#scheduleWakeup(0);
      } else {
        this.#scheduleIdleRetry();
      }
    }
  }

  async #dispatchBatch(now: Date): Promise<OutboxDispatchResult> {
    try {
      return await dispatchOutbox(this.#repository, this.#runtime, {
        limit: this.#options.limit,
        now,
        retryDelayMs: this.#retryDelayMs(),
      });
    } catch (error) {
      recordTrellisError(error, {
        surface: "outbox",
        direction: "dispatcher",
        operation: "batch",
        phase: "dispatch",
      });
      this.#scheduleRetryWakeup();
      try {
        this.#options.onError?.(error);
      } catch {
        // Error callbacks must not break dispatcher recovery.
      }
      return { dispatched: 0, failed: 0 };
    }
  }

  #retryDelayMs(): number {
    return Math.max(1, this.#options.retryDelayMs ?? 1000);
  }

  #clearTimer(timer: "wake" | "retry" | "idle"): void {
    if (timer === "wake" && this.#wakeTimer !== undefined) {
      clearTimeout(this.#wakeTimer);
      this.#wakeTimer = undefined;
    }
    if (timer === "retry" && this.#retryTimer !== undefined) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
    if (timer === "idle" && this.#idleTimer !== undefined) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = undefined;
    }
  }
}

/** Dispatches due outbox messages through a Trellis runtime publisher. */
export async function dispatchOutbox(
  repository: OutboxRepository,
  runtime: Pick<Trellis, "publishPrepared">,
  options: { limit?: number; now?: Date; retryDelayMs?: number } = {},
): Promise<OutboxDispatchResult> {
  const now = options.now ?? new Date();
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const messages = await repository.claimDue(options.limit ?? 25, now);
  let dispatched = 0;
  let failed = 0;
  for (const message of messages) {
    const result = await runtime.publishPrepared(
      outboxMessageToPrepared(message),
    );
    const value = result.take();
    if (isErr(value)) {
      recordTrellisError(value.error, {
        surface: "outbox",
        direction: "dispatcher",
        operation: message.event,
        phase: "publish",
        messagingSystem: "nats",
      });
      failed += 1;
      await repository.markFailed(message.id, {
        error: value.error.message,
        nextAttemptAt: new Date(now.getTime() + retryDelayMs),
        now,
      });
      continue;
    }
    dispatched += 1;
    await repository.markDispatched(message.id, now);
  }
  return { dispatched, failed };
}

/** Rehydrates a persisted outbox row into a prepared event. */
export function outboxMessageToPrepared(
  message: OutboxMessage,
): PreparedTrellisEvent {
  const payload = JSON.parse(message.payload) as Record<string, unknown>;
  const header = eventHeaderFromMessage(message.headers);
  return Object.freeze({
    event: message.event,
    subject: message.subject,
    header: Object.freeze(header),
    payload: Object.freeze(payload),
    encodedPayload: message.payload,
    headers: Object.freeze({ ...message.headers }),
  });
}

function messageId(event: PreparedTrellisEvent): string {
  return event.headers["Nats-Msg-Id"] ?? event.headers["nats-msg-id"] ??
    event.header.id;
}

function eventHeaderFromMessage(
  headers: Record<string, string>,
): { id: string; time: string } {
  const id = headers["Nats-Msg-Id"] ?? headers["nats-msg-id"];
  const time = headers["Trellis-Event-Time"] ?? headers["trellis-event-time"];
  return {
    id: typeof id === "string" ? id : "",
    time: typeof time === "string" ? time : new Date(0).toISOString(),
  };
}

function rowToOutboxMessage(row: SqlRow): OutboxMessage {
  return {
    id: stringField(row, "id"),
    event: stringField(row, "event"),
    subject: stringField(row, "subject"),
    payload: stringField(row, "payload"),
    headers: parseHeaders(row["headers"]),
    state: stateField(row, "state"),
    attempts: numberField(row, "attempts"),
    createdAt: stringField(row, "created_at"),
    updatedAt: stringField(row, "updated_at"),
    nextAttemptAt: optionalStringField(row, "next_attempt_at"),
    lastError: optionalStringField(row, "last_error"),
  };
}

function kvRecordToOutboxMessage(record: KvOutboxRecord): OutboxMessage {
  return {
    id: record.id,
    event: record.event,
    subject: record.subject,
    payload: record.payload,
    headers: { ...record.headers },
    state: record.state === "claimed" ? "pending" : record.state,
    attempts: record.attempts,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nextAttemptAt: record.nextAttemptAt,
    lastError: record.lastError,
  };
}

function placeholder(dialect: SqlDialect, index: number): string {
  return dialect === "postgres" ? `$${index}` : "?";
}

function placeholders(dialect: SqlDialect, count: number): string {
  return Array.from(
    { length: count },
    (_, index) => placeholder(dialect, index + 1),
  ).join(", ");
}

function hasKvReason(error: BaseError, reason: string): boolean {
  return error.toSerializable().context?.["reason"] === reason;
}

function parseHeaders(value: unknown): Record<string, string> {
  if (typeof value === "string") {
    const parsed = JSON.parse(value);
    return recordOfStrings(parsed);
  }
  return recordOfStrings(value);
}

function recordOfStrings(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected SQL headers object");
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error("Expected SQL header value string");
    }
    out[key] = entry;
  }
  return out;
}

function stringField(row: SqlRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new Error(`Expected SQL field ${field} to be a string`);
  }
  return value;
}

function optionalStringField(row: SqlRow, field: string): string | undefined {
  const value = row[field];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Expected SQL field ${field} to be a string`);
  }
  return value;
}

function numberField(row: SqlRow, field: string): number {
  const value = row[field];
  if (typeof value !== "number") {
    throw new Error(`Expected SQL field ${field} to be a number`);
  }
  return value;
}

function stateField(row: SqlRow, field: string): OutboxMessageState {
  const value = stringField(row, field);
  if (value === "pending" || value === "dispatched" || value === "failed") {
    return value;
  }
  throw new Error(`Expected SQL field ${field} to be an outbox state`);
}
