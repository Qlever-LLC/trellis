import { type SQL, sql } from "drizzle-orm";
import type { SqlExecutor, SqlRow } from "./outbox_inbox.ts";

/**
 * Structural Drizzle database or transaction shape accepted by Trellis SQL
 * outbox helpers.
 */
export type DrizzleSqlDatabase = {
  /** Runs a SQL statement that returns rows. */
  all(query: SQL): Promise<readonly SqlRow[]>;
  /** Runs a SQL statement that does not return rows. */
  run(query: SQL): Promise<unknown>;
};

/**
 * Structural transaction runner used by Drizzle-backed Trellis SQL outbox
 * integrations.
 */
export type DrizzleSqlTransactionRunner<
  TDb extends DrizzleSqlDatabase,
  TTx extends DrizzleSqlDatabase,
> = (
  database: TDb,
  work: (transaction: TTx) => Promise<unknown>,
) => Promise<unknown>;

/** Options for Drizzle-backed Trellis SQL outbox integration. */
export type DrizzleSqlOutboxOptions<
  TDb extends DrizzleSqlDatabase,
  TTx extends DrizzleSqlDatabase,
> = {
  /** Caller-owned base Drizzle database used for non-transactional outbox work. */
  readonly db: TDb;
  /** Caller-owned transaction runner used to scope service work and enqueues. */
  readonly transaction: DrizzleSqlTransactionRunner<TDb, TTx>;
};

/**
 * Adapts a caller-owned Drizzle database or transaction to Trellis'
 * generic `SqlExecutor` interface.
 *
 * This helper is cheap: it creates a small closure object only. It does not open
 * connections, prepare statements, or inspect schema. Service authors can use it
 * when adapting Drizzle databases or transactions to the generic
 * `withSqlOutbox(...)` SQL executor options.
 */
export function createDrizzleSqlExecutor(
  database: DrizzleSqlDatabase,
): SqlExecutor {
  return {
    query(statement, params) {
      return database.all(bindDrizzleSqlStatement(statement, params));
    },
    async execute(statement, params) {
      await database.run(bindDrizzleSqlStatement(statement, params));
    },
  };
}

/**
 * Runs work inside a caller-owned Drizzle transaction and provides the
 * transaction plus a Trellis SQL executor bound to that transaction.
 */
export async function runDrizzleSqlTransaction<
  TDb extends DrizzleSqlDatabase,
  TTx extends DrizzleSqlDatabase,
  TResult,
>(
  options: DrizzleSqlOutboxOptions<TDb, TTx>,
  work: (
    context: { tx: TTx; executor: SqlExecutor },
  ) => Promise<TResult> | TResult,
): Promise<TResult> {
  let result: { value: TResult } | undefined;
  await options.transaction(options.db, async (tx) => {
    const value = await work({
      tx,
      executor: createDrizzleSqlExecutor(tx),
    });
    result = { value };
    return value;
  });

  if (result === undefined) {
    throw new Error("Drizzle SQL transaction runner did not invoke work");
  }

  return result.value;
}

/**
 * Converts a Trellis SQL statement with positional placeholders into a Drizzle
 * `SQL` object with parameters bound in order.
 *
 * Supports SQLite-style `?` placeholders and PostgreSQL-style `$1`, `$2`, ...
 * placeholders. A single statement must not mix both styles.
 */
export function bindDrizzleSqlStatement(
  statement: string,
  params: readonly unknown[],
): SQL {
  const matches = [...statement.matchAll(/\?|\$(\d+)/g)];
  const hasQuestionPlaceholders = matches.some((match) => match[0] === "?");
  const hasNumberedPlaceholders = matches.some((match) =>
    match[1] !== undefined
  );

  if (hasQuestionPlaceholders && hasNumberedPlaceholders) {
    throw new Error(
      "SQL statement cannot mix ? and $n placeholders for Drizzle binding",
    );
  }

  if (hasQuestionPlaceholders) {
    validateQuestionPlaceholders(matches.length, params.length);
  } else if (hasNumberedPlaceholders) {
    validateNumberedPlaceholders(matches, params.length);
  } else if (params.length !== 0) {
    throw new Error(
      `SQL statement has no placeholders but received ${params.length} parameters`,
    );
  }

  const chunks: SQL[] = [];
  let cursor = 0;
  let nextQuestionParam = 0;
  for (const match of matches) {
    const matchIndex = match.index;
    chunks.push(sql.raw(statement.slice(cursor, matchIndex)));
    if (match[0] === "?") {
      chunks.push(sql`${params[nextQuestionParam]}`);
      nextQuestionParam += 1;
    } else {
      const index = Number(match[1]) - 1;
      chunks.push(sql`${params[index]}`);
    }
    cursor = matchIndex + match[0].length;
  }
  chunks.push(sql.raw(statement.slice(cursor)));

  return sql.join(chunks);
}

function validateQuestionPlaceholders(
  placeholders: number,
  paramCount: number,
): void {
  if (placeholders !== paramCount) {
    throw new Error(
      `SQL statement expected ${placeholders} parameters for ? placeholders, received ${paramCount}`,
    );
  }
}

function validateNumberedPlaceholders(
  matches: RegExpMatchArray[],
  paramCount: number,
): void {
  const referenced = new Set<number>();
  for (const match of matches) {
    if (match[1] === undefined) continue;
    const index = Number(match[1]);
    if (index < 1) {
      throw new Error("PostgreSQL SQL placeholder indexes must start at $1");
    }
    referenced.add(index);
  }

  const maxIndex = Math.max(...referenced);
  if (maxIndex !== paramCount) {
    throw new Error(
      `SQL statement expected ${maxIndex} parameters for $n placeholders, received ${paramCount}`,
    );
  }

  for (let index = 1; index <= maxIndex; index += 1) {
    if (!referenced.has(index)) {
      throw new Error(
        `SQL statement is missing PostgreSQL placeholder $${index}`,
      );
    }
  }
}
