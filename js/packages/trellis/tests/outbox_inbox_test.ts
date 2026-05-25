import { assertEquals } from "@std/assert";
import { AsyncResult, err, ok } from "@qlever-llc/result";
import { KVError, UnexpectedError } from "../errors/index.ts";
import type { PreparedTrellisEvent, Trellis } from "../trellis.ts";
import {
  createSqlOutboxAdapter,
  dispatchOutbox,
  type KvOutboxRecord,
  MemoryInboxRepository,
  MemoryOutboxRepository,
  NatsKvOutboxRepository,
  type OutboxKvEntry,
  type OutboxKvStore,
  type SqlExecutor,
  type SqlRow,
} from "../service/outbox_inbox.ts";

function prepared(id: string): PreparedTrellisEvent {
  const payload = Object.freeze({
    header: Object.freeze({ id, time: "2026-05-25T00:00:00.000Z" }),
    value: "test",
  });
  return Object.freeze({
    event: "Thing.Changed",
    subject: "events.v1.Thing.Changed",
    payload,
    encodedPayload: JSON.stringify(payload),
    headers: Object.freeze({ "Nats-Msg-Id": id }),
  });
}

Deno.test("outbox dispatch marks successes and retries failures", async () => {
  const repository = new MemoryOutboxRepository();
  await repository.enqueue(prepared("ok"));
  await repository.enqueue(prepared("fail"));
  const published: string[] = [];
  const runtime: Pick<Trellis, "publishPrepared"> = {
    publishPrepared: (event) =>
      AsyncResult.from(
        Promise.resolve(
          event.payload.header.id === "fail"
            ? err(new UnexpectedError({ cause: new Error("boom") }))
            : ok(undefined),
        ),
      ),
  };

  const result = await dispatchOutbox(repository, runtime, {
    now: new Date("2026-05-25T00:00:00.000Z"),
    retryDelayMs: 5000,
  });
  published.push(
    ...repository.snapshot().filter((message) => message.state === "dispatched")
      .map((message) => message.id),
  );

  assertEquals(result, { dispatched: 1, failed: 1 });
  assertEquals(published, ["ok"]);
  const failed = repository.snapshot().find((message) => message.id === "fail");
  if (failed === undefined) throw new Error("missing failed message");
  assertEquals(failed, {
    id: "fail",
    event: "Thing.Changed",
    subject: "events.v1.Thing.Changed",
    payload: JSON.stringify(prepared("fail").payload),
    headers: { "Nats-Msg-Id": "fail" },
    state: "failed",
    attempts: 1,
    createdAt: failed.createdAt,
    updatedAt: "2026-05-25T00:00:00.000Z",
    nextAttemptAt: "2026-05-25T00:00:05.000Z",
    lastError: "An unexpected error has occurred",
  });
});

Deno.test("inbox repository suppresses duplicates", async () => {
  const inbox = new MemoryInboxRepository();

  assertEquals(await inbox.record("evt_1"), true);
  assertEquals(await inbox.record("evt_1"), false);
  assertEquals(await inbox.record("evt_2"), true);
});

Deno.test("NatsKvOutboxRepository dispatches through typed KV adapter", async () => {
  const store = new FakeOutboxKvStore();
  const repository = new NatsKvOutboxRepository(store);
  await repository.enqueue(prepared("kv_ok"));
  await repository.enqueue(prepared("kv_fail"));
  const runtime: Pick<Trellis, "publishPrepared"> = {
    publishPrepared: (event) =>
      AsyncResult.from(
        Promise.resolve(
          event.payload.header.id === "kv_fail"
            ? err(new UnexpectedError({ cause: new Error("boom") }))
            : ok(undefined),
        ),
      ),
  };

  const result = await dispatchOutbox(repository, runtime, {
    now: new Date("2026-05-25T00:00:00.000Z"),
    retryDelayMs: 5000,
  });

  assertEquals(result, { dispatched: 1, failed: 1 });
  assertEquals(store.snapshot().map((record) => record.id).sort(), [
    "kv_fail",
    "kv_ok",
  ]);
  const okRecord = store.snapshot().find((record) => record.id === "kv_ok");
  const failedRecord = store.snapshot().find((record) =>
    record.id === "kv_fail"
  );
  if (okRecord === undefined || failedRecord === undefined) {
    throw new Error("missing KV records");
  }
  assertEquals(okRecord.state, "dispatched");
  assertEquals(failedRecord.state, "failed");
  assertEquals(failedRecord.attempts, 1);
  assertEquals(failedRecord.nextAttemptAt, "2026-05-25T00:00:05.000Z");
});

Deno.test("NatsKvOutboxRepository uses CAS when claiming KV messages", async () => {
  const store = new FakeOutboxKvStore({ conflictOnNextPut: true });
  const repository = new NatsKvOutboxRepository(store);
  await repository.enqueue(prepared("cas"));

  assertEquals(
    await repository.claimDue(10, new Date("2026-05-25T00:00:00.000Z")),
    [],
  );
  assertEquals(
    (await repository.claimDue(10, new Date("2026-05-25T00:00:01.000Z"))).map(
      (message) => message.id,
    ),
    ["cas"],
  );
});

Deno.test("SQL outbox adapter emits Postgres placeholders", async () => {
  const executor = new RecordingSqlExecutor();
  const adapter = createSqlOutboxAdapter(executor, "postgres");

  await adapter.outbox.enqueue(prepared("pg"));
  await adapter.outbox.claimDue(5, new Date("2026-05-25T00:00:00.000Z"));
  await adapter.inbox.record("pg", new Date("2026-05-25T00:00:00.000Z"));

  assertEquals(executor.statements.every((sql) => !sql.includes("?")), true);
  assertEquals(executor.statements.some((sql) => sql.includes("$11")), true);
  assertEquals(executor.statements.some((sql) => sql.includes("$3")), true);
});

class FakeOutboxKvStore implements OutboxKvStore {
  readonly #records = new Map<
    string,
    { record: KvOutboxRecord; revision: number }
  >();
  #conflictOnNextPut: boolean;

  constructor(options: { conflictOnNextPut?: boolean } = {}) {
    this.#conflictOnNextPut = options.conflictOnNextPut ?? false;
  }

  create(key: string, value: KvOutboxRecord) {
    if (this.#records.has(key)) {
      return AsyncResult.err(
        new KVError({
          operation: "create",
          context: { key, reason: "exists" },
        }),
      );
    }
    this.#records.set(key, { record: { ...value }, revision: 1 });
    return AsyncResult.ok(undefined);
  }

  get(key: string) {
    const stored = this.#records.get(key);
    if (stored === undefined) {
      return AsyncResult.err(
        new KVError({
          operation: "get",
          context: { key, reason: "not found" },
        }),
      );
    }
    return AsyncResult.ok(
      new FakeOutboxKvEntry(
        key,
        stored.revision,
        { ...stored.record, headers: { ...stored.record.headers } },
        (value, revision) => this.#put(key, value, revision),
      ),
    );
  }

  keys(): ReturnType<OutboxKvStore["keys"]> {
    const keys = [...this.#records.keys()];
    return AsyncResult.ok((async function* () {
      for (const key of keys) yield key;
    })());
  }

  snapshot(): readonly KvOutboxRecord[] {
    return [...this.#records.values()].map(({ record }) => ({
      ...record,
      headers: { ...record.headers },
    }));
  }

  #put(key: string, value: KvOutboxRecord, revision: number) {
    const stored = this.#records.get(key);
    if (
      stored === undefined || this.#conflictOnNextPut ||
      stored.revision !== revision
    ) {
      this.#conflictOnNextPut = false;
      return AsyncResult.err(
        new KVError({
          operation: "put",
          context: { key, reason: "revision mismatch" },
        }),
      );
    }
    this.#records.set(key, {
      record: { ...value, headers: { ...value.headers } },
      revision: revision + 1,
    });
    return AsyncResult.ok(undefined);
  }
}

class FakeOutboxKvEntry implements OutboxKvEntry {
  constructor(
    readonly key: string,
    readonly revision: number,
    readonly value: KvOutboxRecord,
    readonly storePut: (
      value: KvOutboxRecord,
      revision: number,
    ) => ReturnType<OutboxKvEntry["put"]>,
  ) {}

  put(value: KvOutboxRecord, vcc?: boolean): ReturnType<OutboxKvEntry["put"]> {
    return this.storePut(value, vcc ? this.revision : this.revision);
  }
}

class RecordingSqlExecutor implements SqlExecutor {
  readonly statements: string[] = [];

  query(sql: string, _params: readonly unknown[]): Promise<readonly SqlRow[]> {
    this.statements.push(sql);
    return Promise.resolve([]);
  }

  execute(sql: string, _params: readonly unknown[]): Promise<void> {
    this.statements.push(sql);
    return Promise.resolve();
  }
}
