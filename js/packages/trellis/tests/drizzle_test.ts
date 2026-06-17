import { assertEquals, assertThrows } from "@std/assert";
import type { SQL } from "drizzle-orm";
import { CasingCache } from "npm:drizzle-orm@0.44.7/casing";
import type { PreparedOutboxRecord } from "../service/outbox_inbox.ts";
import { createSqlOutboxAdapter, type SqlRow } from "../service/mod.ts";
import {
  bindDrizzleSqlStatement,
  createDrizzleSqlExecutor,
  type DrizzleSqlDatabase,
  type DrizzleSqlOutboxOptions,
  runDrizzleSqlTransaction,
} from "../service/drizzle.ts";

const casing = new CasingCache();

function prepared(id: string): PreparedOutboxRecord {
  return {
    id,
    kind: "event.publish",
    name: "Thing.Changed",
    subject: "events.v1.Thing.Changed",
    payload: JSON.stringify({
      header: { id, time: "2026-05-25T00:00:00.000Z" },
      value: "test",
    }),
    headers: { "Nats-Msg-Id": id },
  };
}

function toSqliteQuery(query: SQL) {
  return query.toQuery({
    casing,
    escapeName: (name: string) => `"${name.replaceAll('"', '""')}"`,
    escapeParam: () => "?",
    escapeString: (value: string) => `'${value.replaceAll("'", "''")}'`,
  });
}

function toPostgresQuery(query: SQL) {
  return query.toQuery({
    casing,
    escapeName: (name: string) => `"${name.replaceAll('"', '""')}"`,
    escapeParam: (index: number) => `$${index + 1}`,
    escapeString: (value: string) => `'${value.replaceAll("'", "''")}'`,
  });
}

Deno.test("bindDrizzleSqlStatement binds question placeholders", () => {
  const query = toSqliteQuery(
    bindDrizzleSqlStatement("select ? as first, ? as second", ["one", 2]),
  );

  assertEquals(query.sql, "select ? as first, ? as second");
  assertEquals(query.params, ["one", 2]);
});

Deno.test("bindDrizzleSqlStatement binds numbered placeholders", () => {
  const query = toPostgresQuery(
    bindDrizzleSqlStatement("select $2 as second, $1 as first", ["one", 2]),
  );

  assertEquals(query.sql, "select $1 as second, $2 as first");
  assertEquals(query.params, [2, "one"]);
});

Deno.test("bindDrizzleSqlStatement rejects placeholder mismatches", () => {
  assertThrows(
    () => bindDrizzleSqlStatement("select ?, ?", ["one"]),
    Error,
    "expected 2 parameters for ? placeholders, received 1",
  );
  assertThrows(
    () => bindDrizzleSqlStatement("select $1, $3", ["one", "two", "three"]),
    Error,
    "missing PostgreSQL placeholder $2",
  );
  assertThrows(
    () => bindDrizzleSqlStatement("select ? as a, $2 as b", ["one", "two"]),
    Error,
    "cannot mix ? and $n placeholders",
  );
});

Deno.test("createDrizzleSqlExecutor delegates query and execute", async () => {
  const database = new RecordingDrizzleDatabase([{ id: "row_1" }]);
  const executor = createDrizzleSqlExecutor(database);

  const rows = await executor.query("select ? as id", ["row_1"]);
  await executor.execute("insert into test (id) values (?)", ["row_2"]);

  assertEquals(rows, [{ id: "row_1" }]);
  assertEquals(
    toSqliteQuery(single(database.allQueries)).params,
    ["row_1"],
  );
  assertEquals(
    toSqliteQuery(single(database.runQueries)).params,
    ["row_2"],
  );
});

Deno.test("createDrizzleSqlExecutor creates no DB calls by itself", () => {
  const database = new RecordingDrizzleDatabase();
  const executor = createDrizzleSqlExecutor(database);

  assertEquals(typeof executor.query, "function");
  assertEquals(typeof executor.execute, "function");
  assertEquals(database.allQueries, []);
  assertEquals(database.runQueries, []);
});

Deno.test("runDrizzleSqlTransaction adapts transaction executors", async () => {
  const database = new RecordingDrizzleDatabase();
  const transaction = new RecordingDrizzleDatabase([{ id: "tx_row" }]);
  const calls: string[] = [];
  const options: DrizzleSqlOutboxOptions<
    RecordingDrizzleDatabase,
    RecordingDrizzleDatabase
  > = {
    db: database,
    transaction: async (db, work) => {
      if (db !== database) {
        throw new Error("transaction runner received unexpected database");
      }
      calls.push("begin");
      const result = await work(transaction);
      calls.push("commit");
      return result;
    },
  };

  const result = await runDrizzleSqlTransaction(options, async ({
    tx,
    executor,
  }) => {
    if (tx !== transaction) {
      throw new Error("work received unexpected transaction");
    }
    const rows = await executor.query("select ? as id", ["tx_row"]);
    await executor.execute("insert into test (id) values (?)", ["tx_write"]);
    return rows;
  });

  assertEquals(result, [{ id: "tx_row" }]);
  assertEquals(calls, ["begin", "commit"]);
  assertEquals(database.allQueries, []);
  assertEquals(database.runQueries, []);
  assertEquals(toSqliteQuery(single(transaction.allQueries)).params, [
    "tx_row",
  ]);
  assertEquals(toSqliteQuery(single(transaction.runQueries)).params, [
    "tx_write",
  ]);
});

Deno.test("Drizzle SQL executor works with sqlite outbox adapter", async () => {
  const database = new RecordingDrizzleDatabase();
  const executor = createDrizzleSqlExecutor(database);
  const adapter = createSqlOutboxAdapter(executor, "sqlite");

  await adapter.outbox.enqueue(prepared("drizzle_outbox"));
  await adapter.outbox.claimDue(10, new Date("2026-05-25T00:00:00.000Z"));

  const insert = toSqliteQuery(single(database.runQueries));
  assertEquals(insert.params[0], "drizzle_outbox");
  assertEquals(insert.params.length, 13);

  const claim = toSqliteQuery(single(database.allQueries));
  assertEquals(claim.sql.includes("FROM trellis_outbox"), true);
  assertEquals(claim.params, [
    "dispatched",
    "2026-05-25T00:00:00.000Z",
    10,
  ]);
});

class RecordingDrizzleDatabase implements DrizzleSqlDatabase {
  readonly allQueries: SQL[] = [];
  readonly runQueries: SQL[] = [];

  constructor(readonly rows: readonly SqlRow[] = []) {}

  all(query: SQL): Promise<readonly SqlRow[]> {
    this.allQueries.push(query);
    return Promise.resolve(this.rows);
  }

  run(query: SQL): Promise<unknown> {
    this.runQueries.push(query);
    return Promise.resolve(undefined);
  }
}

function single<T>(values: readonly T[]): T {
  if (values.length !== 1 || values[0] === undefined) {
    throw new Error(`Expected one value, received ${values.length}`);
  }
  return values[0];
}
