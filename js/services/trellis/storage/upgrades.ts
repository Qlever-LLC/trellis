import { eq } from "drizzle-orm";
import Value from "typebox/value";

import { ServiceSessionSchema } from "../auth/schemas.ts";
import { analyzeContract } from "../catalog/analysis.ts";
import { validateContractManifest } from "../catalog/store.ts";
import type { TrellisStorageDb } from "./db.ts";
import {
  contracts,
  serviceInstances,
  sessions,
  trellisUpgrades,
} from "./schema.ts";

/** Upgrade id for the one-time contract digest projection v1 reindex. */
const CONTRACT_DIGEST_REINDEX_UPGRADE_ID =
  "contract_digest_projection_v1_reindex";

/** Upgrade id for the one-time legacy service session prune. */
const SERVICE_SESSION_CONTRACT_FIELDS_UPGRADE_ID =
  "service_session_legacy_prune_v1";

type UpgradeSummary = Record<string, unknown>;

type TrellisUpgradeTask = {
  upgradeId: string;
  run: (db: TrellisStorageDb) => Promise<UpgradeSummary>;
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tracks generic one-time Trellis storage upgrade tasks. */
export class SqlTrellisUpgradeRepository {
  readonly #db: TrellisStorageDb;

  /** Creates an upgrade marker repository backed by Trellis storage. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns whether an upgrade id has already been applied. */
  async hasApplied(upgradeId: string): Promise<boolean> {
    const rows = await this.#db.select({ upgradeId: trellisUpgrades.upgradeId })
      .from(trellisUpgrades)
      .where(eq(trellisUpgrades.upgradeId, upgradeId))
      .limit(1);
    return rows.length > 0;
  }

  /** Records an applied upgrade id and optional JSON summary. */
  async recordApplied(
    upgradeId: string,
    summary?: UpgradeSummary,
  ): Promise<void> {
    const appliedAt = new Date().toISOString();
    const summaryJson = summary === undefined ? null : JSON.stringify(summary);
    await this.#db.insert(trellisUpgrades).values({
      upgradeId,
      appliedAt,
      summary: summaryJson,
    }).onConflictDoUpdate({
      target: trellisUpgrades.upgradeId,
      set: { appliedAt, summary: summaryJson },
    });
  }
}

async function runContractDigestProjectionV1Reindex(
  db: TrellisStorageDb,
): Promise<UpgradeSummary> {
  const rows = await db.select().from(contracts).orderBy(contracts.digest);
  let scanned = 0;
  let skipped = 0;
  let unchanged = 0;
  let reindexed = 0;

  for (const row of rows) {
    scanned += 1;
    let validated: Awaited<ReturnType<typeof validateContractManifest>>;
    try {
      const parsed: unknown = JSON.parse(row.contract);
      validated = await validateContractManifest(parsed);
    } catch {
      skipped += 1;
      continue;
    }

    if (validated.digest === row.digest) {
      unchanged += 1;
      continue;
    }

    const analyzed = analyzeContract(validated.contract);
    await db.transaction(async (tx) => {
      await tx.insert(contracts).values({
        digest: validated.digest,
        contractId: validated.contract.id,
        displayName: validated.contract.displayName,
        description: validated.contract.description,
        installedAt: row.installedAt,
        contract: validated.canonical,
        resources: validated.contract.resources === undefined
          ? null
          : JSON.stringify(validated.contract.resources),
        analysisSummary: JSON.stringify(analyzed.summary),
        analysis: JSON.stringify(analyzed.analysis),
      }).onConflictDoUpdate({
        target: contracts.digest,
        set: {
          contractId: validated.contract.id,
          displayName: validated.contract.displayName,
          description: validated.contract.description,
          contract: validated.canonical,
          resources: validated.contract.resources === undefined
            ? null
            : JSON.stringify(validated.contract.resources),
          analysisSummary: JSON.stringify(analyzed.summary),
          analysis: JSON.stringify(analyzed.analysis),
        },
      });
      await tx.update(serviceInstances)
        .set({ currentContractDigest: validated.digest })
        .where(eq(serviceInstances.currentContractDigest, row.digest));
      await tx.delete(contracts).where(eq(contracts.digest, row.digest));
    });
    reindexed += 1;
  }

  return { scanned, skipped, unchanged, reindexed };
}

async function runServiceSessionContractFieldsUpgrade(
  db: TrellisStorageDb,
): Promise<UpgradeSummary> {
  const rows = await db.select({ id: sessions.id, session: sessions.session })
    .from(sessions)
    .where(eq(sessions.type, "service"))
    .orderBy(sessions.id);
  let scanned = 0;
  let deletedInvalidJson = 0;
  let deletedNonObject = 0;
  let deletedLegacy = 0;
  let deletedInvalidShape = 0;
  let unchanged = 0;

  for (const row of rows) {
    scanned += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.session);
    } catch {
      await db.delete(sessions).where(eq(sessions.id, row.id));
      deletedInvalidJson += 1;
      continue;
    }

    if (!isJsonObject(parsed)) {
      await db.delete(sessions).where(eq(sessions.id, row.id));
      deletedNonObject += 1;
      continue;
    }

    if ("currentContractId" in parsed || "currentContractDigest" in parsed) {
      await db.delete(sessions).where(eq(sessions.id, row.id));
      deletedLegacy += 1;
      continue;
    }

    try {
      Value.Decode(ServiceSessionSchema, parsed);
    } catch {
      await db.delete(sessions).where(eq(sessions.id, row.id));
      deletedInvalidShape += 1;
      continue;
    }

    unchanged += 1;
  }

  return {
    scanned,
    deletedInvalidJson,
    deletedNonObject,
    deletedLegacy,
    deletedInvalidShape,
    unchanged,
  };
}

const TRELLIS_UPGRADE_TASKS: TrellisUpgradeTask[] = [
  {
    upgradeId: CONTRACT_DIGEST_REINDEX_UPGRADE_ID,
    run: runContractDigestProjectionV1Reindex,
  },
  {
    upgradeId: SERVICE_SESSION_CONTRACT_FIELDS_UPGRADE_ID,
    run: runServiceSessionContractFieldsUpgrade,
  },
];

/** Runs registered one-time Trellis storage upgrade tasks after SQL migrations. */
export async function runTrellisStorageUpgrades(
  db: TrellisStorageDb,
): Promise<void> {
  const repository = new SqlTrellisUpgradeRepository(db);
  for (const task of TRELLIS_UPGRADE_TASKS) {
    if (await repository.hasApplied(task.upgradeId)) continue;
    const summary = await task.run(db);
    await repository.recordApplied(task.upgradeId, summary);
  }
}

export {
  CONTRACT_DIGEST_REINDEX_UPGRADE_ID,
  SERVICE_SESSION_CONTRACT_FIELDS_UPGRADE_ID,
};
