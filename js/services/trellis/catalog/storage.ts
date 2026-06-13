import { eq, inArray } from "drizzle-orm";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../storage/db.ts";
import {
  type BoundedListQuery,
  boundedListQuery,
} from "../storage/list_query.ts";
import { contracts } from "../storage/schema.ts";
import { type ContractRecord, ContractRecordSchema } from "./schemas.ts";

type ContractRow = typeof contracts.$inferSelect;
type ContractInsert = typeof contracts.$inferInsert;

/** Minimal stored contract manifest record read without decoded projections. */
export type StoredContractManifestRecord = {
  digest: string;
  id: string;
  contract: string;
};

type ContractManifestRow = {
  digest: string;
  contractId: string;
  contract: string;
};

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

function decodeContractManifestRow(
  row: ContractManifestRow,
): StoredContractManifestRecord {
  return {
    digest: row.digest,
    id: row.contractId,
    contract: row.contract,
  };
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

  /** Returns the raw stored manifest for a digest without decoding projections. */
  async getManifest(
    digest: string,
  ): Promise<StoredContractManifestRecord | undefined> {
    const rows = await this.#db.select({
      digest: contracts.digest,
      contractId: contracts.contractId,
      contract: contracts.contract,
    }).from(contracts).where(eq(contracts.digest, digest)).limit(1);

    const row = rows[0];
    return row === undefined ? undefined : decodeContractManifestRow(row);
  }

  /** Returns contract records for the requested digests ordered by digest. */
  async getMany(digests: Iterable<string>): Promise<ContractRecord[]> {
    const requested = [...new Set(digests)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select().from(contracts).where(
      inArray(contracts.digest, requested),
    ).orderBy(contracts.digest);
    return rows.map((row) => decodeContractRow(row));
  }

  /** Returns raw stored manifests for the requested digests ordered by digest. */
  async getManifests(
    digests: Iterable<string>,
  ): Promise<StoredContractManifestRecord[]> {
    const requested = [...new Set(digests)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select({
      digest: contracts.digest,
      contractId: contracts.contractId,
      contract: contracts.contract,
    }).from(contracts).where(inArray(contracts.digest, requested)).orderBy(
      contracts.digest,
    );
    return rows.map((row) => decodeContractManifestRow(row));
  }

  /** Returns contract records for a contract id ordered by digest. */
  async listByContractId(contractId: string): Promise<ContractRecord[]> {
    const rows = await this.#db.select().from(contracts).where(
      eq(contracts.contractId, contractId),
    ).orderBy(contracts.digest);
    return rows.map((row) => decodeContractRow(row));
  }

  /** Returns raw stored manifests for a contract id ordered by digest. */
  async listManifestsByContractId(
    contractId: string,
  ): Promise<StoredContractManifestRecord[]> {
    const rows = await this.#db.select({
      digest: contracts.digest,
      contractId: contracts.contractId,
      contract: contracts.contract,
    }).from(contracts).where(eq(contracts.contractId, contractId)).orderBy(
      contracts.digest,
    );
    return rows.map((row) => decodeContractManifestRow(row));
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

  /** Returns a bounded page of stored contract records ordered by digest. */
  async listPage(query: BoundedListQuery): Promise<ContractRecord[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(contracts).orderBy(
      contracts.digest,
    ).limit(limit).offset(offset);
    return rows.map((row) => decodeContractRow(row));
  }

  /** Returns a bounded page of raw stored manifests ordered by digest. */
  async listManifestPage(
    query: BoundedListQuery,
  ): Promise<StoredContractManifestRecord[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select({
      digest: contracts.digest,
      contractId: contracts.contractId,
      contract: contracts.contract,
    }).from(contracts).orderBy(contracts.digest).limit(limit).offset(offset);
    return rows.map((row) => decodeContractManifestRow(row));
  }

  /** Returns whether a contract record exists for the digest. */
  async has(digest: string): Promise<boolean> {
    const rows = await this.#db.select({ digest: contracts.digest }).from(
      contracts,
    ).where(eq(contracts.digest, digest)).limit(1);
    return rows.length > 0;
  }

  /** Deletes a contract record by digest. */
  async delete(digest: string): Promise<void> {
    await this.#db.delete(contracts).where(eq(contracts.digest, digest));
  }
}
