import { eq } from "drizzle-orm";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../storage/db.ts";
import { contracts } from "../storage/schema.ts";
import { type ContractRecord, ContractRecordSchema } from "./schemas.ts";

type ContractRow = typeof contracts.$inferSelect;
type ContractInsert = typeof contracts.$inferInsert;

function parseJsonField(name: string, value: string | null): unknown {
  if (value === null) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch (cause) {
    throw new Error(`Invalid JSON stored for contract ${name}`, { cause });
  }
}

function optionalJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function decodeContractRow(row: ContractRow): ContractRecord {
  return Value.Decode(ContractRecordSchema, {
    digest: row.digest,
    id: row.contractId,
    displayName: row.displayName,
    description: row.description,
    installedAt: row.installedAt,
    contract: row.contract,
    resources: parseJsonField("resources", row.resources),
    analysisSummary: parseJsonField("analysisSummary", row.analysisSummary),
    analysis: parseJsonField("analysis", row.analysis),
  });
}

function encodeContractRecord(record: ContractRecord): ContractInsert {
  return {
    digest: record.digest,
    contractId: record.id,
    displayName: record.displayName,
    description: record.description,
    installedAt: record.installedAt.toISOString(),
    contract: record.contract,
    resources: optionalJson(record.resources),
    analysisSummary: optionalJson(record.analysisSummary),
    analysis: optionalJson(record.analysis),
  };
}

/** Stores durable Trellis catalog contract records in SQL. */
export class SqlContractStorageRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a catalog contract repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns the contract record for a digest, or undefined when absent. */
  async get(digest: string): Promise<ContractRecord | undefined> {
    const rows = await this.#db.select().from(contracts).where(
      eq(contracts.digest, digest),
    ).limit(1);

    const row = rows[0];
    return row === undefined ? undefined : decodeContractRow(row);
  }

  /** Inserts or replaces the contract record keyed by its digest. */
  async put(record: ContractRecord): Promise<void> {
    const row = encodeContractRecord(record);
    await this.#db.insert(contracts).values(row).onConflictDoUpdate({
      target: contracts.digest,
      set: {
        contractId: row.contractId,
        displayName: row.displayName,
        description: row.description,
        installedAt: row.installedAt,
        contract: row.contract,
        resources: row.resources,
        analysisSummary: row.analysisSummary,
        analysis: row.analysis,
      },
    });
  }

  /** Returns all stored contract records ordered by digest. */
  async list(): Promise<ContractRecord[]> {
    const rows = await this.#db.select().from(contracts).orderBy(
      contracts.digest,
    );
    return rows.map((row) => decodeContractRow(row));
  }

  /** Returns whether a contract record exists for the digest. */
  async has(digest: string): Promise<boolean> {
    const rows = await this.#db.select({ digest: contracts.digest }).from(
      contracts,
    ).where(eq(contracts.digest, digest)).limit(1);
    return rows.length > 0;
  }
}
