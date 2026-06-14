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
  OutboxDispatcher,
  type OutboxKvEntry,
  type OutboxKvStore,
  type OutboxMessage,
  type OutboxRepository,
  type SqlExecutor,
  type SqlRow,
} from "../service/outbox_inbox.ts";

function prepared(id: string): PreparedTrellisEvent {
  const payload = Object.freeze({
    value: "test",
  });
  const time = "2026-05-25T00:00:00.000Z";
  return Object.freeze({
    event: "Thing.Changed",
    subject: "events.v1.Thing.Changed",
    header: Object.freeze({ id, time }),
    payload,
    encodedPayload: JSON.stringify(payload),
    headers: Object.freeze({
      "Nats-Msg-Id": id,
      "Trellis-Event-Time": time,
    }),
  });
}

function okRuntime(): Pick<Trellis, "publishPrepared"> {
  return {
    publishPrepared: () => AsyncResult.ok(undefined),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flushTimers(): Promise<void> {
  return delay(0);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(1);
  }
  throw new Error("condition was not met");
}

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
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
          event.header.id === "fail"
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
    headers: {
      "Nats-Msg-Id": "fail",
      "Trellis-Event-Time": "2026-05-25T00:00:00.000Z",
    },
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
          event.header.id === "kv_fail"
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

Deno.test("OutboxDispatcher notify coalesces multiple calls into one drain wave", async () => {
  const repository = new QueueOutboxRepository([[]]);
  const dispatcher = new OutboxDispatcher(repository, okRuntime(), {
    debounceMs: 0,
  });

  dispatcher.notify();
  dispatcher.notify();
  dispatcher.notify();
  await waitFor(() => repository.claims === 1);

  assertEquals(repository.claims, 1);
  dispatcher.stop();
});

Deno.test("OutboxDispatcher queues follow-up pass without concurrent runs", async () => {
  const firstClaim = new Deferred<OutboxMessage[]>();
  const secondStarted = new Deferred<void>();
  const repository = new BlockingOutboxRepository(firstClaim, secondStarted);
  const dispatcher = new OutboxDispatcher(repository, okRuntime(), {
    debounceMs: 0,
  });

  dispatcher.notify();
  await repository.firstStarted.promise;
  dispatcher.notify();
  firstClaim.resolve([]);
  await secondStarted.promise;
  await flushTimers();

  assertEquals(repository.claims, 2);
  assertEquals(repository.maxActiveClaims, 1);
  dispatcher.stop();
});

Deno.test("OutboxDispatcher drains multiple dispatchOutbox batches until empty", async () => {
  const repository = new MemoryOutboxRepository();
  await repository.enqueue(prepared("batch_1"));
  await repository.enqueue(prepared("batch_2"));
  await repository.enqueue(prepared("batch_3"));
  const dispatcher = new OutboxDispatcher(repository, okRuntime(), {
    debounceMs: 0,
    limit: 1,
  });

  dispatcher.notify();
  await waitFor(() =>
    repository.snapshot().every((message) => message.state === "dispatched")
  );

  assertEquals(
    repository.snapshot().map((message) => message.state),
    ["dispatched", "dispatched", "dispatched"],
  );
  dispatcher.stop();
});

Deno.test("OutboxDispatcher keeps draining due messages after a failed batch", async () => {
  const repository = new MemoryOutboxRepository();
  await repository.enqueue(prepared("fails_first"));
  await repository.enqueue(prepared("still_due"));
  const runtime: Pick<Trellis, "publishPrepared"> = {
    publishPrepared: (event) =>
      event.header.id === "fails_first"
        ? AsyncResult.err(new UnexpectedError({ cause: new Error("boom") }))
        : AsyncResult.ok(undefined),
  };
  const dispatcher = new OutboxDispatcher(repository, runtime, {
    debounceMs: 0,
    limit: 1,
    retryDelayMs: 20,
  });

  dispatcher.notify();
  await waitFor(() =>
    repository.snapshot().some((message) =>
      message.id === "still_due" && message.state === "dispatched"
    )
  );

  const states = new Map(
    repository.snapshot().map((message) => [message.id, message.state]),
  );
  assertEquals(states.get("fails_first"), "failed");
  assertEquals(states.get("still_due"), "dispatched");
  dispatcher.stop();
});

Deno.test("OutboxDispatcher schedules retry wakeup after failed publish", async () => {
  const repository = new MemoryOutboxRepository();
  await repository.enqueue(prepared("retry"));
  let publishes = 0;
  const runtime: Pick<Trellis, "publishPrepared"> = {
    publishPrepared: () => {
      publishes += 1;
      return AsyncResult.from(
        Promise.resolve(
          publishes === 1
            ? err(new UnexpectedError({ cause: new Error("boom") }))
            : ok(undefined),
        ),
      );
    },
  };
  const dispatcher = new OutboxDispatcher(repository, runtime, {
    debounceMs: 0,
    retryDelayMs: 1,
  });

  dispatcher.notify();
  await waitFor(() => publishes >= 2);

  assertEquals(repository.snapshot()[0]?.state, "dispatched");
  dispatcher.stop();
});

Deno.test("OutboxDispatcher retry wakeups do not wait for debounce", async () => {
  const repository = new MemoryOutboxRepository();
  await repository.enqueue(prepared("retry_without_debounce"));
  let publishes = 0;
  const runtime: Pick<Trellis, "publishPrepared"> = {
    publishPrepared: () => {
      publishes += 1;
      return publishes === 1
        ? AsyncResult.err(new UnexpectedError({ cause: new Error("boom") }))
        : AsyncResult.ok(undefined);
    },
  };
  const dispatcher = new OutboxDispatcher(repository, runtime, {
    debounceMs: 50,
    retryDelayMs: 1,
  });

  dispatcher.notify();
  await waitFor(() => publishes === 1);
  await waitFor(() => publishes === 2);

  assertEquals(publishes, 2);
  dispatcher.stop();
});

Deno.test("OutboxDispatcher does not retry failures in the same drain wave", async () => {
  const repository = new MemoryOutboxRepository();
  await repository.enqueue(prepared("delayed_retry"));
  let publishes = 0;
  const runtime: Pick<Trellis, "publishPrepared"> = {
    publishPrepared: () => {
      publishes += 1;
      if (publishes === 1) {
        return AsyncResult.from(
          delay(10).then(() =>
            err(new UnexpectedError({ cause: new Error("boom") }))
          ),
        );
      }
      return AsyncResult.ok(undefined);
    },
  };
  const dispatcher = new OutboxDispatcher(repository, runtime, {
    debounceMs: 0,
    retryDelayMs: 5,
  });

  dispatcher.notify();
  await waitFor(() => repository.snapshot()[0]?.state === "failed");
  await flushTimers();

  assertEquals(publishes, 1);
  await waitFor(() => publishes === 2);
  assertEquals(repository.snapshot()[0]?.state, "dispatched");
  dispatcher.stop();
});

Deno.test("OutboxDispatcher retries after timer fires during a long drain", async () => {
  const repository = new MemoryOutboxRepository();
  await repository.enqueue(prepared("retry_during_drain"));
  await repository.enqueue(prepared("blocked_publish"));
  const blockedPublish = new Deferred<void>();
  let retryPublishes = 0;
  let blockedStarted = false;
  const runtime: Pick<Trellis, "publishPrepared"> = {
    publishPrepared: (event) => {
      if (event.header.id === "blocked_publish") {
        blockedStarted = true;
        return AsyncResult.from(
          blockedPublish.promise.then(() => ok(undefined)),
        );
      }
      retryPublishes += 1;
      return retryPublishes === 1
        ? AsyncResult.err(new UnexpectedError({ cause: new Error("boom") }))
        : AsyncResult.ok(undefined);
    },
  };
  const dispatcher = new OutboxDispatcher(repository, runtime, {
    debounceMs: 0,
    limit: 1,
    retryDelayMs: 1,
  });

  dispatcher.notify();
  await waitFor(() => blockedStarted);
  await delay(5);
  assertEquals(retryPublishes, 1);

  blockedPublish.resolve(undefined);
  await waitFor(() => retryPublishes === 2);

  assertEquals(repository.snapshot()[0]?.state, "dispatched");
  dispatcher.stop();
});

Deno.test("OutboxDispatcher reports background dispatch errors", async () => {
  let reported: unknown;
  const repository = new ThrowingOutboxRepository(new Error("claim failed"));
  const dispatcher = new OutboxDispatcher(repository, okRuntime(), {
    debounceMs: 0,
    onError: (error) => {
      reported = error;
    },
  });

  dispatcher.notify();
  await waitFor(() => reported !== undefined);

  assertEquals(reported instanceof Error, true);
  assertEquals(repository.claims, 1);
  dispatcher.stop();
});

Deno.test("OutboxDispatcher keeps recovery when onError throws", async () => {
  const repository = new ThrowingOutboxRepository(new Error("claim failed"));
  const dispatcher = new OutboxDispatcher(repository, okRuntime(), {
    debounceMs: 0,
    retryDelayMs: 1,
    onError: () => {
      throw new Error("handler failed");
    },
  });

  dispatcher.notify();
  await waitFor(() => repository.claims >= 2);

  dispatcher.stop();
});

Deno.test("OutboxDispatcher stop cancels pending work and later notify work", async () => {
  const repository = new QueueOutboxRepository([[]]);
  const dispatcher = new OutboxDispatcher(repository, okRuntime(), {
    debounceMs: 10,
  });

  dispatcher.notify();
  dispatcher.stop();
  dispatcher.notify();
  await delay(15);

  assertEquals(repository.claims, 0);
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

class QueueOutboxRepository implements OutboxRepository {
  claims = 0;

  constructor(readonly batches: OutboxMessage[][]) {}

  enqueue(_event: PreparedTrellisEvent): Promise<OutboxMessage> {
    throw new Error("not implemented");
  }

  claimDue(_limit: number, _now: Date): Promise<OutboxMessage[]> {
    this.claims += 1;
    return Promise.resolve(this.batches.shift() ?? []);
  }

  markDispatched(_id: string, _now: Date): Promise<void> {
    return Promise.resolve();
  }

  markFailed(
    _id: string,
    _failure: { error: string; nextAttemptAt: Date; now: Date },
  ): Promise<void> {
    return Promise.resolve();
  }
}

class BlockingOutboxRepository extends QueueOutboxRepository {
  readonly firstStarted = new Deferred<void>();
  activeClaims = 0;
  maxActiveClaims = 0;

  constructor(
    readonly firstClaim: Deferred<OutboxMessage[]>,
    readonly secondStarted: Deferred<void>,
  ) {
    super([]);
  }

  override async claimDue(
    _limit: number,
    _now: Date,
  ): Promise<OutboxMessage[]> {
    this.claims += 1;
    this.activeClaims += 1;
    this.maxActiveClaims = Math.max(this.maxActiveClaims, this.activeClaims);
    if (this.claims === 1) {
      this.firstStarted.resolve();
      const messages = await this.firstClaim.promise;
      this.activeClaims -= 1;
      return messages;
    }
    this.secondStarted.resolve();
    this.activeClaims -= 1;
    return [];
  }
}

class ThrowingOutboxRepository extends QueueOutboxRepository {
  constructor(readonly error: Error) {
    super([]);
  }

  override claimDue(_limit: number, _now: Date): Promise<OutboxMessage[]> {
    this.claims += 1;
    return Promise.reject(this.error);
  }
}

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
