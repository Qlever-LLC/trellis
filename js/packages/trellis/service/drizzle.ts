import { type SQL, sql } from "drizzle-orm";
import type { SqlExecutor, SqlRow } from "./outbox_inbox.ts";

/**
 * Structural Drizzle SQLite database or transaction shape accepted by Trellis
 * SQL outbox helpers.
 */
export type DrizzleSqlDatabase = {
  /** Runs a SQL statement that returns rows. */
  all(query: SQL): Promise<readonly SqlRow[]>;
  /** Runs a SQL statement that does not return rows. */
  run(query: SQL): Promise<unknown>;
};

/**
 * Adapts a caller-owned Drizzle SQLite database or transaction to Trellis'
 * generic `SqlExecutor` interface.
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
