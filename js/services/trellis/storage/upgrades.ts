import { eq } from "drizzle-orm";
import Value from "typebox/value";

import { ServiceSessionSchema } from "../auth/schemas.ts";
import {
  type DeploymentAuthorityCapabilityNeed,
  DeploymentAuthorityCapabilityNeedSchema,
  type DeploymentAuthorityContractNeed,
  DeploymentAuthorityContractNeedSchema,
  type DeploymentAuthorityNeeds,
  DeploymentAuthorityNeedsSchema,
  type DeploymentAuthorityResourceNeed,
  DeploymentAuthorityResourceNeedSchema,
  type DeploymentAuthoritySurfaceNeed,
  DeploymentAuthoritySurfaceNeedSchema,
  MaterializedAuthorityCapabilityGrantSchema,
  type MaterializedAuthorityGrants,
  MaterializedAuthorityGrantsSchema,
  MaterializedAuthorityNatsGrantSchema,
  MaterializedAuthoritySurfaceGrantSchema,
} from "../auth/schemas.ts";
import { analyzeContract } from "../catalog/analysis.ts";
import { validateContractManifest } from "../catalog/store.ts";
import type { TrellisStorageDb } from "./db.ts";
import {
  contracts,
  deploymentAuthorityPlans,
  materializedAuthority,
  sessions,
  trellisUpgrades,
} from "./schema.ts";

/** Upgrade id for the one-time contract digest projection v1 reindex. */
const CONTRACT_DIGEST_REINDEX_UPGRADE_ID =
  "contract_digest_projection_v1_reindex";

/** Upgrade id for the one-time legacy service session prune. */
const SERVICE_SESSION_CONTRACT_FIELDS_UPGRADE_ID =
  "service_session_legacy_prune_v1";

/** Upgrade id for rewriting materialized authority grants to grouped families. */
const MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID =
  "materialized_authority_grouped_grants_v1";

/** Upgrade id for rewriting deployment authority plan needs to grouped families. */
const DEPLOYMENT_AUTHORITY_GROUPED_NEEDS_UPGRADE_ID =
  "deployment_authority_grouped_needs_v1";

type UpgradeSummary = Record<string, unknown>;

type TrellisUpgradeTask = {
  upgradeId: string;
  run: (db: TrellisStorageDb) => Promise<UpgradeSummary>;
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omitKind(record: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== "kind") copy[key] = value;
  }
  return copy;
}

function removedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  const allowedKeys = new Set(allowed);
  return Object.keys(record).filter((key) => !allowedKeys.has(key));
}

function emptyMaterializedAuthorityGrants(): MaterializedAuthorityGrants {
  return { capabilities: [], surfaces: [], nats: [] };
}

function emptyAuthorityNeeds(): DeploymentAuthorityNeeds {
  return { contracts: [], surfaces: [], capabilities: [], resources: [] };
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readArray(
  record: Record<string, unknown>,
  key: string,
): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}

function requiredFlag(record: Record<string, unknown>): boolean | undefined {
  return readBoolean(record, "required");
}

function decodeLegacyMaterializedGrants(value: unknown): {
  grants: MaterializedAuthorityGrants;
  droppedResourceGrants: number;
  droppedUnknownGrants: number;
} | undefined {
  if (!Array.isArray(value)) return undefined;
  const grants = emptyMaterializedAuthorityGrants();
  let droppedResourceGrants = 0;
  let droppedUnknownGrants = 0;

  for (const entry of value) {
    if (!isJsonObject(entry)) {
      droppedUnknownGrants += 1;
      continue;
    }

    const kind = readString(entry, "kind");
    if (kind === "resource") {
      droppedResourceGrants += 1;
      continue;
    }

    const candidate = omitKind(entry);
    if (kind === "capability") {
      if (Value.Check(MaterializedAuthorityCapabilityGrantSchema, candidate)) {
        grants.capabilities.push(
          Value.Decode(MaterializedAuthorityCapabilityGrantSchema, candidate),
        );
      } else {
        droppedUnknownGrants += 1;
      }
      continue;
    }

    if (kind === "surface") {
      if (Value.Check(MaterializedAuthoritySurfaceGrantSchema, candidate)) {
        grants.surfaces.push(
          Value.Decode(MaterializedAuthoritySurfaceGrantSchema, candidate),
        );
      } else {
        droppedUnknownGrants += 1;
      }
      continue;
    }

    if (kind === "nats") {
      if (Value.Check(MaterializedAuthorityNatsGrantSchema, candidate)) {
        grants.nats.push(
          Value.Decode(MaterializedAuthorityNatsGrantSchema, candidate),
        );
      } else {
        droppedUnknownGrants += 1;
      }
      continue;
    }

    droppedUnknownGrants += 1;
  }

  return { grants, droppedResourceGrants, droppedUnknownGrants };
}

function canonicalCapabilityGrant(
  value: unknown,
): { value: unknown; removed: string[] } {
  if (!isJsonObject(value)) return { value, removed: [] };
  const candidate = { capability: value.capability };
  if (!Value.Check(MaterializedAuthorityCapabilityGrantSchema, candidate)) {
    return { value, removed: [] };
  }
  return {
    value: Value.Decode(MaterializedAuthorityCapabilityGrantSchema, candidate),
    removed: removedKeys(value, ["capability"]),
  };
}

function canonicalSurfaceGrant(
  value: unknown,
): { value: unknown; removed: string[] } {
  if (!isJsonObject(value)) return { value, removed: [] };
  const candidate: Record<string, unknown> = {
    contractId: value.contractId,
    surfaceKind: value.surfaceKind,
    name: value.name,
  };
  if (value.action !== undefined) candidate.action = value.action;
  if (!Value.Check(MaterializedAuthoritySurfaceGrantSchema, candidate)) {
    return { value, removed: [] };
  }
  return {
    value: Value.Decode(MaterializedAuthoritySurfaceGrantSchema, candidate),
    removed: removedKeys(value, [
      "contractId",
      "surfaceKind",
      "name",
      "action",
    ]),
  };
}

function canonicalNatsSurface(value: unknown): {
  value: unknown;
  removed: string[];
} {
  if (!isJsonObject(value)) return { value, removed: [] };
  const candidate: Record<string, unknown> = {
    contractId: value.contractId,
    kind: value.kind,
    name: value.name,
  };
  if (value.action !== undefined) candidate.action = value.action;
  return {
    value: candidate,
    removed: removedKeys(value, ["contractId", "kind", "name", "action"])
      .map((key) => `surface.${key}`),
  };
}

function canonicalNatsGrant(
  value: unknown,
): { value: unknown; removed: string[] } {
  if (!isJsonObject(value)) return { value, removed: [] };
  const candidate: Record<string, unknown> = {
    direction: value.direction,
    subject: value.subject,
    requiredCapabilities: value.requiredCapabilities,
    grantSource: value.grantSource,
  };
  let nestedRemoved: string[] = [];
  if (value.surface !== undefined) {
    const surface = canonicalNatsSurface(value.surface);
    candidate.surface = surface.value;
    nestedRemoved = surface.removed;
  }
  if (!Value.Check(MaterializedAuthorityNatsGrantSchema, candidate)) {
    return { value, removed: [] };
  }
  return {
    value: Value.Decode(MaterializedAuthorityNatsGrantSchema, candidate),
    removed: [
      ...removedKeys(value, [
        "direction",
        "subject",
        "surface",
        "requiredCapabilities",
        "grantSource",
      ]),
      ...nestedRemoved,
    ],
  };
}

function onlyObsoleteKindRemoved(removed: string[]): boolean {
  return removed.length > 0 && removed.every((key) => key === "kind");
}

function sanitizeGroupedMaterializedGrants(value: unknown): {
  value: unknown;
  changed: boolean;
  shouldMarkPending: boolean;
} {
  if (!Value.Check(MaterializedAuthorityGrantsSchema, value)) {
    return { value, changed: false, shouldMarkPending: false };
  }
  if (!isJsonObject(value)) {
    return { value, changed: false, shouldMarkPending: false };
  }

  let changed = false;
  let shouldMarkPending = false;
  const sanitized: Record<string, unknown> = { ...value };
  const families = [{
    key: "capabilities",
    canonical: canonicalCapabilityGrant,
  }, {
    key: "surfaces",
    canonical: canonicalSurfaceGrant,
  }, {
    key: "nats",
    canonical: canonicalNatsGrant,
  }];

  for (const family of families) {
    const values = readArray(value, family.key) ?? [];
    const nextValues: unknown[] = [];
    for (const entry of values) {
      const next = family.canonical(entry);
      nextValues.push(next.value);
      if (next.removed.length === 0) continue;
      changed = true;
      if (!onlyObsoleteKindRemoved(next.removed)) shouldMarkPending = true;
    }
    sanitized[family.key] = nextValues;
  }

  return { value: sanitized, changed, shouldMarkPending };
}

function legacyContractNeed(
  record: Record<string, unknown>,
): DeploymentAuthorityContractNeed | undefined {
  const candidate = omitKind(record);
  if (Value.Check(DeploymentAuthorityContractNeedSchema, candidate)) {
    return Value.Decode(DeploymentAuthorityContractNeedSchema, candidate);
  }
  return undefined;
}

function legacyCapabilityNeed(
  record: Record<string, unknown>,
): DeploymentAuthorityCapabilityNeed | undefined {
  const candidate = omitKind(record);
  if (Value.Check(DeploymentAuthorityCapabilityNeedSchema, candidate)) {
    return Value.Decode(DeploymentAuthorityCapabilityNeedSchema, candidate);
  }
  return undefined;
}

function legacySurfaceNeed(
  record: Record<string, unknown>,
): DeploymentAuthoritySurfaceNeed | undefined {
  const direct = omitKind(record);
  if (Value.Check(DeploymentAuthoritySurfaceNeedSchema, direct)) {
    return Value.Decode(DeploymentAuthoritySurfaceNeedSchema, direct);
  }

  const surface = record.surface;
  if (!isJsonObject(surface)) return undefined;
  const candidate: Record<string, unknown> = {
    contractId: surface.contractId,
    kind: surface.kind,
    name: surface.name,
    required: requiredFlag(record),
  };
  if (surface.action !== undefined) candidate.action = surface.action;
  if (Value.Check(DeploymentAuthoritySurfaceNeedSchema, candidate)) {
    return Value.Decode(DeploymentAuthoritySurfaceNeedSchema, candidate);
  }
  return undefined;
}

function legacyResourceNeed(
  record: Record<string, unknown>,
): DeploymentAuthorityResourceNeed | undefined {
  const direct = omitKind(record);
  if (Value.Check(DeploymentAuthorityResourceNeedSchema, direct)) {
    return Value.Decode(DeploymentAuthorityResourceNeedSchema, direct);
  }

  const resource = record.resource;
  if (!isJsonObject(resource)) return undefined;
  const candidate: Record<string, unknown> = {
    kind: resource.kind,
    alias: resource.alias,
    required: requiredFlag(record) ?? resource.required,
  };
  if (resource.definition !== undefined) {
    candidate.definition = resource.definition;
  }
  if (Value.Check(DeploymentAuthorityResourceNeedSchema, candidate)) {
    return Value.Decode(DeploymentAuthorityResourceNeedSchema, candidate);
  }
  return undefined;
}

function legacyNeedArrayToGroupedNeeds(value: unknown): {
  needs: DeploymentAuthorityNeeds;
  changed: boolean;
} | undefined {
  if (!Array.isArray(value)) return undefined;
  const needs = emptyAuthorityNeeds();

  for (const entry of value) {
    if (!isJsonObject(entry)) continue;
    const kind = readString(entry, "kind");
    if (kind === "contract") {
      const need = legacyContractNeed(entry);
      if (need !== undefined) needs.contracts.push(need);
    } else if (kind === "surface") {
      const need = legacySurfaceNeed(entry);
      if (need !== undefined) needs.surfaces.push(need);
    } else if (kind === "capability") {
      const need = legacyCapabilityNeed(entry);
      if (need !== undefined) needs.capabilities.push(need);
    } else if (kind === "resource") {
      const need = legacyResourceNeed(entry);
      if (need !== undefined) needs.resources.push(need);
    }
  }

  return { needs, changed: true };
}

function rewriteCapabilityNeedSetArray(
  values: unknown[],
): { values: unknown[]; changed: boolean } {
  let changed = false;
  const rewritten = values.map((entry) => {
    if (typeof entry === "string") {
      changed = true;
      return { capability: entry, required: true };
    }
    if (isJsonObject(entry) && readString(entry, "kind") === "capability") {
      const need = legacyCapabilityNeed(entry);
      if (need !== undefined) {
        changed = true;
        return need;
      }
    }
    return entry;
  });
  return { values: rewritten, changed };
}

function rewriteAuthorityNeedSetLike(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (Value.Check(DeploymentAuthorityNeedsSchema, value)) {
    return { value, changed: false };
  }

  const fromArray = legacyNeedArrayToGroupedNeeds(value);
  if (fromArray !== undefined) return { value: fromArray.needs, changed: true };
  if (!isJsonObject(value)) return { value, changed: false };

  const contracts = readArray(value, "contracts");
  const surfaces = readArray(value, "surfaces");
  const capabilities = readArray(value, "capabilities");
  const resources = readArray(value, "resources");
  if (
    contracts === undefined || surfaces === undefined ||
    capabilities === undefined || resources === undefined
  ) {
    return { value, changed: false };
  }

  const capabilityRewrite = rewriteCapabilityNeedSetArray(capabilities);
  const candidate = {
    contracts,
    surfaces,
    capabilities: capabilityRewrite.values,
    resources,
  };

  if (!capabilityRewrite.changed) return { value, changed: false };
  if (!Value.Check(DeploymentAuthorityNeedsSchema, candidate)) {
    return { value, changed: false };
  }
  return {
    value: Value.Decode(DeploymentAuthorityNeedsSchema, candidate),
    changed: true,
  };
}

function rewritePreviewAuthorityNeeds(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const rewritten = rewritePreviewAuthorityNeeds(item);
      changed = changed || rewritten.changed;
      return rewritten.value;
    });
    return changed ? { value: items, changed } : { value, changed: false };
  }

  if (!isJsonObject(value)) return { value, changed: false };

  let changed = false;
  const rewritten: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "requestedNeeds" || key === "currentNeeds" ||
      key === "targetNeeds" || key === "missingNeeds" ||
      key === "additionalNeeds" || key === "requiredNeeds" ||
      key === "optionalNeeds"
    ) {
      const needs = rewriteAuthorityNeedSetLike(entry);
      rewritten[key] = needs.value;
      changed = changed || needs.changed;
      continue;
    }
    if (key === "desiredState" && isJsonObject(entry)) {
      const desiredState: Record<string, unknown> = { ...entry };
      if ("needs" in desiredState) {
        const needs = rewriteAuthorityNeedSetLike(desiredState.needs);
        desiredState.needs = needs.value;
        changed = changed || needs.changed;
      }
      rewritten[key] = desiredState;
      continue;
    }

    const nested = rewritePreviewAuthorityNeeds(entry);
    rewritten[key] = nested.value;
    changed = changed || nested.changed;
  }

  return changed ? { value: rewritten, changed } : { value, changed: false };
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

async function runMaterializedAuthorityGroupedGrantsUpgrade(
  db: TrellisStorageDb,
): Promise<UpgradeSummary> {
  const rows = await db.select({
    deploymentId: materializedAuthority.deploymentId,
    grantsJson: materializedAuthority.grantsJson,
  }).from(materializedAuthority).orderBy(materializedAuthority.deploymentId);
  let scanned = 0;
  let unchanged = 0;
  let rewritten = 0;
  let markedPending = 0;
  let droppedResourceGrants = 0;
  let droppedUnknownGrants = 0;
  let invalidJson = 0;

  for (const row of rows) {
    scanned += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.grantsJson);
    } catch {
      invalidJson += 1;
      await db.update(materializedAuthority).set({
        grantsJson: JSON.stringify(emptyMaterializedAuthorityGrants()),
        status: "pending",
        error:
          "Materialized authority grants were invalid JSON and require reconciliation.",
      }).where(eq(materializedAuthority.deploymentId, row.deploymentId));
      rewritten += 1;
      markedPending += 1;
      continue;
    }

    if (Value.Check(MaterializedAuthorityGrantsSchema, parsed)) {
      const sanitized = sanitizeGroupedMaterializedGrants(parsed);
      if (!sanitized.changed) {
        unchanged += 1;
        continue;
      }
      await db.update(materializedAuthority).set({
        grantsJson: JSON.stringify(sanitized.value),
        ...(sanitized.shouldMarkPending
          ? {
            status: "pending",
            error:
              "Materialized authority grants contained obsolete grouped child metadata and require reconciliation.",
          }
          : {}),
      }).where(eq(materializedAuthority.deploymentId, row.deploymentId));
      rewritten += 1;
      if (sanitized.shouldMarkPending) markedPending += 1;
      continue;
    }

    const legacy = decodeLegacyMaterializedGrants(parsed);
    if (legacy === undefined) {
      await db.update(materializedAuthority).set({
        grantsJson: JSON.stringify(emptyMaterializedAuthorityGrants()),
        status: "pending",
        error:
          "Materialized authority grants used an unsupported legacy shape and require reconciliation.",
      }).where(eq(materializedAuthority.deploymentId, row.deploymentId));
      rewritten += 1;
      markedPending += 1;
      continue;
    }

    droppedResourceGrants += legacy.droppedResourceGrants;
    droppedUnknownGrants += legacy.droppedUnknownGrants;
    await db.update(materializedAuthority).set({
      grantsJson: JSON.stringify(legacy.grants),
      status: "pending",
      error:
        "Materialized authority grants were repaired from a legacy projection and require reconciliation.",
    }).where(eq(materializedAuthority.deploymentId, row.deploymentId));
    rewritten += 1;
    markedPending += 1;
  }

  return {
    scanned,
    unchanged,
    rewritten,
    markedPending,
    droppedResourceGrants,
    droppedUnknownGrants,
    invalidJson,
  };
}

async function runDeploymentAuthorityGroupedNeedsUpgrade(
  db: TrellisStorageDb,
): Promise<UpgradeSummary> {
  const rows = await db.select({
    planId: deploymentAuthorityPlans.planId,
    proposalJson: deploymentAuthorityPlans.proposalJson,
    desiredChangeJson: deploymentAuthorityPlans.desiredChangeJson,
    materializationPreviewJson:
      deploymentAuthorityPlans.materializationPreviewJson,
  }).from(deploymentAuthorityPlans).orderBy(deploymentAuthorityPlans.planId);
  let scanned = 0;
  let unchanged = 0;
  let rewritten = 0;
  let invalidJson = 0;
  let skippedInvalidJson = 0;

  for (const row of rows) {
    scanned += 1;
    let proposal: unknown;
    let desiredChange: unknown;
    let materializationPreview: unknown;
    try {
      proposal = JSON.parse(row.proposalJson);
      desiredChange = JSON.parse(row.desiredChangeJson);
      materializationPreview = JSON.parse(row.materializationPreviewJson);
    } catch {
      invalidJson += 1;
      skippedInvalidJson += 1;
      continue;
    }

    let changed = false;
    let nextProposal = proposal;
    if (isJsonObject(proposal) && "requestedNeeds" in proposal) {
      const requestedNeeds = rewriteAuthorityNeedSetLike(
        proposal.requestedNeeds,
      );
      if (requestedNeeds.changed) {
        nextProposal = {
          ...proposal,
          requestedNeeds: requestedNeeds.value,
        };
        changed = true;
      }
    }

    const nextDesiredChange = rewriteAuthorityNeedSetLike(desiredChange);
    if (nextDesiredChange.changed) changed = true;

    const nextPreview = rewritePreviewAuthorityNeeds(materializationPreview);
    if (nextPreview.changed) changed = true;

    if (!changed) {
      unchanged += 1;
      continue;
    }

    await db.update(deploymentAuthorityPlans).set({
      proposalJson: JSON.stringify(nextProposal),
      desiredChangeJson: JSON.stringify(nextDesiredChange.value),
      materializationPreviewJson: JSON.stringify(nextPreview.value),
    }).where(eq(deploymentAuthorityPlans.planId, row.planId));
    rewritten += 1;
  }

  return {
    scanned,
    unchanged,
    rewritten,
    invalidJson,
    skippedInvalidJson,
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
  {
    upgradeId: MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID,
    run: runMaterializedAuthorityGroupedGrantsUpgrade,
  },
  {
    upgradeId: DEPLOYMENT_AUTHORITY_GROUPED_NEEDS_UPGRADE_ID,
    run: runDeploymentAuthorityGroupedNeedsUpgrade,
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
  DEPLOYMENT_AUTHORITY_GROUPED_NEEDS_UPGRADE_ID,
  MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID,
  SERVICE_SESSION_CONTRACT_FIELDS_UPGRADE_ID,
};
