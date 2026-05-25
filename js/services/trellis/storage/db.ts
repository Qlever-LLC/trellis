import {
  type Client,
  createClient,
  type InArgs,
  type InStatement,
  type Replicated,
  type ResultSet,
  type Transaction,
  type TransactionMode,
} from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { dirname } from "@std/path";

import { schema } from "./schema.ts";
import { runTrellisStorageUpgrades } from "./upgrades.ts";

const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export type TrellisStorageDb = LibSQLDatabase<typeof schema>;

export type TrellisStorage = {
  client: Client;
  db: TrellisStorageDb;
};

class AsyncOperationQueue {
  #tail = Promise.resolve();

  async acquire(): Promise<() => void> {
    let releaseNext!: () => void;
    const next = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    const previous = this.#tail;
    this.#tail = previous.then(() => next, () => next);
    await previous;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseNext();
    };
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

class SerializedTransaction implements Transaction {
  readonly #transaction: Transaction;
  readonly #release: () => void;
  #released = false;

  constructor(transaction: Transaction, release: () => void) {
    this.#transaction = transaction;
    this.#release = release;
  }

  get closed(): boolean {
    return this.#transaction.closed;
  }

  async execute(stmt: InStatement): Promise<ResultSet> {
    return await this.#transaction.execute(stmt);
  }

  async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
    return await this.#transaction.batch(stmts);
  }

  async executeMultiple(sql: string): Promise<void> {
    await this.#transaction.executeMultiple(sql);
  }

  async rollback(): Promise<void> {
    try {
      await this.#transaction.rollback();
    } finally {
      this.#releaseOnce();
    }
  }

  async commit(): Promise<void> {
    await this.#transaction.commit();
    this.#releaseOnce();
  }

  close(): void {
    try {
      this.#transaction.close();
    } finally {
      this.#releaseOnce();
    }
  }

  #releaseOnce(): void {
    if (this.#released) return;
    this.#released = true;
    this.#release();
  }
}

class SerializedClient implements Client {
  readonly #client: Client;
  readonly #queue = new AsyncOperationQueue();
  #connectionPragmasApplied = false;

  constructor(client: Client) {
    this.#client = client;
  }

  get closed(): boolean {
    return this.#client.closed;
  }

  set closed(value: boolean) {
    this.#client.closed = value;
  }

  get protocol(): string {
    return this.#client.protocol;
  }

  set protocol(value: string) {
    this.#client.protocol = value;
  }

  execute(stmt: InStatement): Promise<ResultSet>;
  execute(sql: string, args?: InArgs): Promise<ResultSet>;
  async execute(
    stmtOrSql: InStatement | string,
    args?: InArgs,
  ): Promise<ResultSet> {
    return await this.#queue.run(async () => {
      await this.#applyConnectionPragmas();
      if (typeof stmtOrSql === "string") {
        return await this.#client.execute(stmtOrSql, args);
      }
      return await this.#client.execute(stmtOrSql);
    });
  }

  async batch(
    stmts: Array<InStatement | [string, InArgs?]>,
    mode?: TransactionMode,
  ): Promise<Array<ResultSet>> {
    return await this.#queue.run(async () => {
      await this.#applyConnectionPragmas();
      return await this.#client.batch(stmts, mode);
    });
  }

  async migrate(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
    return await this.#queue.run(async () => {
      await this.#applyConnectionPragmas();
      return await this.#client.migrate(stmts);
    });
  }

  async transaction(mode?: TransactionMode): Promise<Transaction> {
    const release = await this.#queue.acquire();
    try {
      await this.#applyConnectionPragmas();
      const transaction = await this.#client.transaction(mode);
      this.#connectionPragmasApplied = false;
      return new SerializedTransaction(transaction, release);
    } catch (error) {
      release();
      throw error;
    }
  }

  async executeMultiple(sql: string): Promise<void> {
    await this.#queue.run(async () => {
      await this.#applyConnectionPragmas();
      await this.#client.executeMultiple(sql);
    });
  }

  async sync(): Promise<Replicated> {
    return await this.#queue.run(() => this.#client.sync());
  }

  reconnect(): void {
    this.#connectionPragmasApplied = false;
    this.#client.reconnect();
  }

  close(): void {
    this.#client.close();
  }

  async #applyConnectionPragmas(): Promise<void> {
    if (this.#connectionPragmasApplied) return;
    await this.#client.execute(
      `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`,
    );
    this.#connectionPragmasApplied = true;
  }
}

/** Opens a file-backed SQLite database for Trellis service durable storage. */
export async function openTrellisStorageDb(
  path: string,
): Promise<TrellisStorage> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const client = new SerializedClient(createClient({ url: `file:${path}` }));
  await client.execute("PRAGMA journal_mode = WAL");
  const db = drizzle(client, { schema });

  return { client, db };
}

/** Applies Trellis SQL storage migrations without post-migration upgrade tasks. */
export async function applyTrellisStorageSqlMigrations(
  storage: TrellisStorage,
): Promise<void> {
  await migrate(storage.db, {
    migrationsFolder: new URL("./migrations", import.meta.url).pathname,
  });
}

/** Applies Trellis storage migrations and post-migration upgrade tasks. */
export async function initializeTrellisStorageSchema(
  storage: TrellisStorage,
): Promise<void> {
  await applyTrellisStorageSqlMigrations(storage);
  await runTrellisStorageUpgrades(storage.db);
}
