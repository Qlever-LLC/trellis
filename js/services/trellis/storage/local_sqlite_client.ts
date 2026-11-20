import { Database } from "@db/sqlite";
import type { BindValue, Statement } from "@db/sqlite";
import type {
  Client,
  InArgs,
  InStatement,
  InValue,
  Replicated,
  ResultSet,
  Row,
  Transaction,
  TransactionMode,
  Value,
} from "@libsql/client";

/**
 * Creates the local SQLite client used by the Trellis control plane.
 *
 * Statements are finalized deterministically so native allocations do not
 * accumulate outside V8's managed heap.
 */
export function createLocalSqliteClient(path: string): Client {
  return new LocalSqliteClient(path);
}

class LocalSqliteClient implements Client {
  readonly #path: string;
  #database: Database;

  constructor(path: string) {
    this.#path = path;
    this.#database = this.#open();
  }

  get closed(): boolean {
    return !this.#database.open;
  }

  set closed(value: boolean) {
    if (value) this.close();
    else this.reconnect();
  }

  get protocol(): string {
    return "file";
  }

  execute(stmt: InStatement): Promise<ResultSet>;
  execute(sql: string, args?: InArgs): Promise<ResultSet>;
  execute(stmt: InStatement, args?: InArgs): Promise<ResultSet> {
    const input = typeof stmt === "string" ? { sql: stmt, args } : stmt;
    return Promise.resolve(this.#execute(input.sql, input.args));
  }

  async batch(
    statements: Array<InStatement | [string, InArgs?]>,
    mode: TransactionMode = "deferred",
  ): Promise<Array<ResultSet>> {
    const transaction = await this.transaction(mode);
    try {
      const results: ResultSet[] = [];
      for (const statement of statements) {
        results.push(
          Array.isArray(statement)
            ? await transaction.execute({
              sql: statement[0],
              args: statement[1],
            })
            : await transaction.execute(statement),
        );
      }
      await transaction.commit();
      return results;
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
  }

  async migrate(statements: InStatement[]): Promise<Array<ResultSet>> {
    await this.execute("PRAGMA foreign_keys = OFF");
    try {
      return await this.batch(statements, "deferred");
    } finally {
      await this.execute("PRAGMA foreign_keys = ON");
    }
  }

  transaction(
    mode: TransactionMode = "write",
  ): Promise<Transaction> {
    const readOnly = mode === "read";
    if (readOnly) this.#database.exec("PRAGMA query_only = ON");
    try {
      this.#database.exec(
        mode === "write" ? "BEGIN IMMEDIATE" : "BEGIN DEFERRED",
      );
      return Promise.resolve(new LocalSqliteTransaction(this, readOnly));
    } catch (error) {
      if (readOnly) this.#database.exec("PRAGMA query_only = OFF");
      throw error;
    }
  }

  executeMultiple(sql: string): Promise<void> {
    this.#database.exec(sql);
    return Promise.resolve();
  }

  sync(): Promise<Replicated> {
    return Promise.resolve(undefined);
  }

  close(): void {
    this.#database.close();
  }

  reconnect(): void {
    if (this.closed) {
      this.#database = this.#open();
    }
  }

  finishTransaction(sql: "COMMIT" | "ROLLBACK", readOnly: boolean): void {
    try {
      this.#database.exec(sql);
    } finally {
      if (readOnly) this.#database.exec("PRAGMA query_only = OFF");
    }
  }

  #open(): Database {
    return new Database(this.#path, { int64: true, parseJson: false });
  }

  #execute(sql: string, args?: InArgs): ResultSet {
    const statement = this.#database.prepare(sql);
    try {
      const columns = statement.columnNames();
      const rows = this.#rows(statement, args, columns);
      const rowsAffected = statement.readonly ? 0 : this.#database.changes;
      const lastInsertRowid = BigInt(this.#database.lastInsertRowId);
      const columnTypes = columns.map(() => "");

      return {
        columns,
        columnTypes,
        rows,
        rowsAffected,
        lastInsertRowid,
        toJSON() {
          return {
            columns,
            columnTypes,
            rows,
            rowsAffected,
            lastInsertRowid: lastInsertRowid.toString(),
          };
        },
      };
    } finally {
      statement.finalize();
    }
  }

  #rows(
    statement: Statement,
    args: InArgs | undefined,
    columns: string[],
  ): Row[] {
    const boundArgs = args === undefined
      ? undefined
      : Array.isArray(args)
      ? args.map(normalizeInputValue)
      : Object.fromEntries(
        Object.entries(args).map(([key, value]) => [
          key,
          normalizeInputValue(value),
        ]),
      );
    const values = boundArgs === undefined
      ? statement.values<unknown[]>()
      : Array.isArray(boundArgs)
      ? statement.values<unknown[]>(...boundArgs)
      : statement.values<unknown[]>(boundArgs);

    return values.map((rawValues) => {
      const positionalValues = rawValues.map(normalizeOutputValue);
      const namedValues: Record<string, Value> = {};
      for (const [index, column] of columns.entries()) {
        namedValues[column] = positionalValues[index];
      }
      return Object.assign(positionalValues, namedValues);
    });
  }
}

class LocalSqliteTransaction implements Transaction {
  readonly #client: LocalSqliteClient;
  readonly #readOnly: boolean;
  #closed = false;

  constructor(client: LocalSqliteClient, readOnly: boolean) {
    this.#client = client;
    this.#readOnly = readOnly;
  }

  get closed(): boolean {
    return this.#closed;
  }

  execute(statement: InStatement): Promise<ResultSet> {
    this.#assertOpen();
    return this.#client.execute(statement);
  }

  async batch(statements: InStatement[]): Promise<ResultSet[]> {
    this.#assertOpen();
    const results: ResultSet[] = [];
    for (const statement of statements) {
      results.push(await this.#client.execute(statement));
    }
    return results;
  }

  executeMultiple(sql: string): Promise<void> {
    this.#assertOpen();
    return this.#client.executeMultiple(sql);
  }

  rollback(): Promise<void> {
    this.#assertOpen();
    this.#client.finishTransaction("ROLLBACK", this.#readOnly);
    this.#closed = true;
    return Promise.resolve();
  }

  commit(): Promise<void> {
    this.#assertOpen();
    this.#client.finishTransaction("COMMIT", this.#readOnly);
    this.#closed = true;
    return Promise.resolve();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#client.finishTransaction("ROLLBACK", this.#readOnly);
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("The transaction is closed");
    }
  }
}

function normalizeInputValue(value: InValue): BindValue {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

function normalizeOutputValue(value: unknown): Value {
  if (
    value === null || typeof value === "string" || typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue)) {
      throw new RangeError(
        `SQLite integer ${value} is outside JavaScript's safe integer range`,
      );
    }
    return numberValue;
  }
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Uint8Array) return value.slice().buffer;
  throw new TypeError(`Unsupported SQLite value: ${typeof value}`);
}
