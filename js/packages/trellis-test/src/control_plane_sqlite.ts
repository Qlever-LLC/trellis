import { createClient, type InArgs } from "@libsql/client";

/** Row returned by a control-plane SQLite query. */
export type TrellisControlPlaneSqliteRow = Record<string, unknown>;

/** Result returned by a control-plane SQLite write. */
export type TrellisControlPlaneSqliteExecuteResult = {
  rowsAffected: number;
};

type SqliteArg = string | number | bigint | Uint8Array | null;

function quoteSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqliteValue(value: unknown): SqliteArg {
  if (
    value === null || typeof value === "string" || typeof value === "number" ||
    typeof value === "bigint" || value instanceof Uint8Array
  ) {
    return value;
  }
  return JSON.stringify(value);
}

/** Snapshot of a removed control-plane session row. */
export class TrellisControlPlaneSessionSnapshot {
  readonly #sqlite: TrellisControlPlaneSqlite;
  readonly #row: TrellisControlPlaneSqliteRow;

  constructor(
    sqlite: TrellisControlPlaneSqlite,
    row: TrellisControlPlaneSqliteRow,
  ) {
    this.#sqlite = sqlite;
    this.#row = row;
  }

  /** Restores the captured session row if it has not already been recreated. */
  async restore(): Promise<TrellisControlPlaneSqliteExecuteResult> {
    const columns = Object.keys(this.#row);
    const quotedColumns = columns.map(quoteSqlIdentifier).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    return await this.#sqlite.execute(
      `INSERT OR IGNORE INTO sessions (${quotedColumns}) VALUES (${placeholders})`,
      columns.map((column) => sqliteValue(this.#row[column])),
    );
  }
}

/** Direct SQLite access for the isolated Trellis control plane under test. */
export class TrellisControlPlaneSqlite {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** Runs a SQL query against the live control-plane database. */
  async query(
    sql: string,
    args?: InArgs,
  ): Promise<TrellisControlPlaneSqliteRow[]> {
    const client = createClient({ url: `file:${this.path}` });
    try {
      await client.execute("PRAGMA busy_timeout = 5000");
      const result = await client.execute({ sql, args });
      return result.rows.map((row: TrellisControlPlaneSqliteRow) => ({
        ...row,
      }));
    } finally {
      client.close();
    }
  }

  /** Runs a SQL write against the live control-plane database. */
  async execute(
    sql: string,
    args?: InArgs,
  ): Promise<TrellisControlPlaneSqliteExecuteResult> {
    const client = createClient({ url: `file:${this.path}` });
    try {
      await client.execute("PRAGMA busy_timeout = 5000");
      const result = await client.execute({ sql, args });
      return { rowsAffected: Number(result.rowsAffected) };
    } finally {
      client.close();
    }
  }

  /** Deletes and returns one session row so tests can restore it later. */
  async takeSession(
    sessionKey: string,
  ): Promise<TrellisControlPlaneSessionSnapshot | null> {
    const rows = await this.query(
      "SELECT * FROM sessions WHERE session_key = ?",
      [sessionKey],
    );
    const row = rows[0];
    if (!row) return null;
    await this.execute("DELETE FROM sessions WHERE session_key = ?", [
      sessionKey,
    ]);
    return new TrellisControlPlaneSessionSnapshot(this, row);
  }
}
