import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
} from "drizzle-orm";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import {
  authorityReconciliationEvents,
  authorityReconciliationStatus,
  deploymentAuthorities,
  deploymentAuthorityCapabilities,
  deploymentAuthorityCapabilityDefinitions,
  deploymentAuthorityContracts,
  deploymentAuthorityGrantOverrides,
  deploymentAuthorityPlans,
  deploymentAuthorityResources,
  deploymentAuthoritySurfaces,
  deploymentPortalRoutes,
  implementationOffers,
  materializedAuthority,
  materializedResourceBindings,
} from "../../storage/schema.ts";
import {
  type DeploymentAuthority,
  type DeploymentAuthorityCapabilityDefinition,
  DeploymentAuthorityCapabilityDefinitionSchema,
  type DeploymentAuthorityGrantOverride,
  DeploymentAuthorityGrantOverrideSchema,
  type DeploymentAuthorityMaterialization,
  DeploymentAuthorityMaterializationSchema,
  type DeploymentAuthorityPlan,
  DeploymentAuthorityPlanSchema,
  type DeploymentAuthorityReconciliationStatus,
  DeploymentAuthorityReconciliationStatusSchema,
  DeploymentAuthorityResourceSchema,
  DeploymentAuthoritySchema,
  DeploymentAuthoritySurfaceSchema,
  type DeploymentPortalRoute,
  DeploymentPortalRouteSchema,
  type DeploymentResourceBinding,
  DeploymentResourceBindingSchema,
  type ImplementationOffer,
  ImplementationOfferSchema,
} from "../schemas.ts";
import {
  type BoundedListQuery,
  boundedListQuery,
  type ListPage,
  listPage,
  parseJsonField,
} from "./shared.ts";

type AuthorityRow = typeof deploymentAuthorities.$inferSelect;
type AuthorityInsert = typeof deploymentAuthorities.$inferInsert;
type AuthorityPlanRow = typeof deploymentAuthorityPlans.$inferSelect;
type AuthorityPlanInsert = typeof deploymentAuthorityPlans.$inferInsert;
type AuthorityPlanFilters = {
  deploymentId?: string;
  state?: string;
  classification?: string;
  kind?: string;
};
type MaterializedAuthorityRow = typeof materializedAuthority.$inferSelect;
type MaterializedAuthorityInsert = typeof materializedAuthority.$inferInsert;
type MaterializedBindingRow = typeof materializedResourceBindings.$inferSelect;
type MaterializedBindingInsert =
  typeof materializedResourceBindings.$inferInsert;
type ReconciliationStatusRow =
  typeof authorityReconciliationStatus.$inferSelect;
type ReconciliationStatusInsert =
  typeof authorityReconciliationStatus.$inferInsert;
type ReconciliationEventInsert =
  typeof authorityReconciliationEvents.$inferInsert;
type PortalRouteRow = typeof deploymentPortalRoutes.$inferSelect;
type PortalRouteInsert = typeof deploymentPortalRoutes.$inferInsert;
type GrantOverrideRow = typeof deploymentAuthorityGrantOverrides.$inferSelect;
type GrantOverrideInsert =
  typeof deploymentAuthorityGrantOverrides.$inferInsert;
type ImplementationOfferRow = typeof implementationOffers.$inferSelect;
type ImplementationOfferInsert = typeof implementationOffers.$inferInsert;
type CapabilityDefinitionRow =
  typeof deploymentAuthorityCapabilityDefinitions.$inferSelect;
type CapabilityDefinitionInsert =
  typeof deploymentAuthorityCapabilityDefinitions.$inferInsert;

function emptyDesiredState(): DeploymentAuthority["desiredState"] {
  return { needs: [], capabilities: [], resources: [], surfaces: [] };
}

function decodeAuthority(
  row: AuthorityRow,
  desiredState: DeploymentAuthority["desiredState"],
): DeploymentAuthority {
  return Value.Decode(DeploymentAuthoritySchema, {
    deploymentId: row.deploymentId,
    kind: row.kind,
    disabled: row.disabled,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    desiredState,
  });
}

function encodeAuthorityHeader(record: DeploymentAuthority): AuthorityInsert {
  const decoded = Value.Decode(DeploymentAuthoritySchema, record);
  return {
    deploymentId: decoded.deploymentId,
    kind: decoded.kind,
    disabled: decoded.disabled,
    version: decoded.version,
    createdAt: decoded.createdAt,
    updatedAt: decoded.updatedAt,
  };
}

function decodePlan(row: AuthorityPlanRow): DeploymentAuthorityPlan {
  return Value.Decode(DeploymentAuthorityPlanSchema, {
    planId: row.planId,
    deploymentId: row.deploymentId,
    classification: row.classification,
    proposal: parseJsonField(
      "deployment authority plan proposal",
      row.proposalJson,
    ),
    desiredChange: parseJsonField(
      "deployment authority desired change",
      row.desiredChangeJson,
    ),
    materializationPreview: parseJsonField(
      "deployment authority materialization preview",
      row.materializationPreviewJson,
    ),
    warnings: parseJsonField(
      "deployment authority plan warnings",
      row.warningsJson,
    ),
    ...(row.acknowledgementRequired === null ? {} : {
      acknowledgementRequired: row.acknowledgementRequired,
    }),
    createdAt: row.createdAt,
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
    state: row.state,
    decisionAt: row.decisionAt,
    decisionBy: row.decisionByJson === null
      ? null
      : parseJsonField("deployment authority plan decider", row.decisionByJson),
    decisionReason: row.decisionReason,
  });
}

function encodePlan(record: DeploymentAuthorityPlan): AuthorityPlanInsert {
  const decoded = Value.Decode(DeploymentAuthorityPlanSchema, record);
  return {
    planId: decoded.planId,
    deploymentId: decoded.deploymentId,
    classification: decoded.classification,
    state: decoded.state ?? "pending",
    proposalJson: JSON.stringify(decoded.proposal),
    desiredChangeJson: JSON.stringify(decoded.desiredChange),
    materializationPreviewJson: JSON.stringify(decoded.materializationPreview),
    warningsJson: JSON.stringify(decoded.warnings),
    acknowledgementRequired: decoded.classification === "migration"
      ? decoded.acknowledgementRequired
      : null,
    decisionAt: decoded.decisionAt ?? null,
    decisionByJson:
      decoded.decisionBy === undefined || decoded.decisionBy === null
        ? null
        : JSON.stringify(decoded.decisionBy),
    decisionReason: decoded.decisionReason ?? null,
    createdAt: decoded.createdAt,
    expiresAt: decoded.expiresAt ?? null,
  };
}

function decodeBindingRow(
  row: MaterializedBindingRow,
): DeploymentResourceBinding {
  return Value.Decode(DeploymentResourceBindingSchema, {
    deploymentId: row.deploymentId,
    kind: row.resourceKind,
    alias: row.resourceAlias,
    binding: parseJsonField("materialized resource binding", row.bindingJson),
    limits: row.limitsJson === null
      ? null
      : parseJsonField("materialized resource binding limits", row.limitsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function encodeBinding(
  record: DeploymentResourceBinding,
): MaterializedBindingInsert {
  const decoded = Value.Decode(DeploymentResourceBindingSchema, record);
  return {
    deploymentId: decoded.deploymentId,
    resourceKind: decoded.kind,
    resourceAlias: decoded.alias,
    bindingJson: JSON.stringify(decoded.binding),
    limitsJson: decoded.limits === null ? null : JSON.stringify(decoded.limits),
    createdAt: decoded.createdAt,
    updatedAt: decoded.updatedAt,
  };
}

function decodeMaterialized(
  row: MaterializedAuthorityRow,
  resourceBindings: DeploymentResourceBinding[],
): DeploymentAuthorityMaterialization {
  return Value.Decode(DeploymentAuthorityMaterializationSchema, {
    deploymentId: row.deploymentId,
    desiredVersion: row.desiredVersion,
    status: row.status,
    resourceBindings,
    grants: parseJsonField("materialized authority grants", row.grantsJson),
    reconciledAt: row.reconciledAt,
    ...(row.error === null ? {} : { error: row.error }),
  });
}

function encodeMaterialized(
  record: DeploymentAuthorityMaterialization,
): MaterializedAuthorityInsert {
  const decoded = Value.Decode(
    DeploymentAuthorityMaterializationSchema,
    record,
  );
  return {
    deploymentId: decoded.deploymentId,
    desiredVersion: decoded.desiredVersion,
    status: decoded.status,
    grantsJson: JSON.stringify(decoded.grants),
    reconciledAt: decoded.reconciledAt,
    error: decoded.error ?? null,
  };
}

function decodeReconciliationStatus(
  row: ReconciliationStatusRow,
): DeploymentAuthorityReconciliationStatus {
  return Value.Decode(DeploymentAuthorityReconciliationStatusSchema, row);
}

function encodeReconciliationStatus(
  record: DeploymentAuthorityReconciliationStatus,
): ReconciliationStatusInsert {
  return Value.Decode(DeploymentAuthorityReconciliationStatusSchema, record);
}

function decodePortalRouteRow(row: PortalRouteRow): DeploymentPortalRoute {
  return Value.Decode(DeploymentPortalRouteSchema, row);
}

function encodePortalRoute(record: DeploymentPortalRoute): PortalRouteInsert {
  return Value.Decode(DeploymentPortalRouteSchema, record);
}

function decodeGrantOverrideRow(
  row: GrantOverrideRow,
): DeploymentAuthorityGrantOverride {
  return Value.Decode(DeploymentAuthorityGrantOverrideSchema, {
    deploymentId: row.deploymentId,
    identityKind: row.identityKind,
    grantKind: row.grantKind,
    contractId: row.contractId,
    origin: row.origin,
    sessionPublicKey: row.sessionPublicKey,
    capability: row.capability,
    capabilityGroupKey: row.capabilityGroupKey,
  });
}

function grantOverrideKey(record: DeploymentAuthorityGrantOverride): string {
  return JSON.stringify([
    record.deploymentId,
    record.identityKind,
    record.grantKind,
    record.contractId,
    record.origin,
    record.sessionPublicKey,
    record.capability,
    record.capabilityGroupKey,
  ]);
}

function encodeGrantOverride(
  record: DeploymentAuthorityGrantOverride,
): GrantOverrideInsert {
  const decoded = Value.Decode(DeploymentAuthorityGrantOverrideSchema, record);
  return { ...decoded, grantKey: grantOverrideKey(decoded) };
}

function decodeImplementationOfferRow(
  row: ImplementationOfferRow,
): ImplementationOffer {
  return Value.Decode(ImplementationOfferSchema, row);
}

function encodeImplementationOffer(
  record: ImplementationOffer,
): ImplementationOfferInsert {
  return Value.Decode(ImplementationOfferSchema, record);
}

function decodeCapabilityDefinitionRow(
  row: CapabilityDefinitionRow,
): DeploymentAuthorityCapabilityDefinition {
  return Value.Decode(DeploymentAuthorityCapabilityDefinitionSchema, {
    deploymentId: row.deploymentId,
    key: row.capability,
    displayName: row.displayName,
    description: row.description,
    ...(row.consequence === null ? {} : { consequence: row.consequence }),
    source: row.source,
    ...(row.contractId === "" ? {} : { contractId: row.contractId }),
    ...(row.contractDigest === ""
      ? {}
      : { contractDigest: row.contractDigest }),
    ...(row.contractDisplayName === null
      ? {}
      : { contractDisplayName: row.contractDisplayName }),
    direction: row.direction,
  });
}

function encodeCapabilityDefinition(
  record: DeploymentAuthorityCapabilityDefinition,
): CapabilityDefinitionInsert {
  const decoded = Value.Decode(
    DeploymentAuthorityCapabilityDefinitionSchema,
    record,
  );
  return {
    deploymentId: decoded.deploymentId,
    capability: decoded.key,
    displayName: decoded.displayName,
    description: decoded.description,
    consequence: decoded.consequence ?? null,
    source: decoded.source,
    contractId: decoded.contractId ?? "",
    contractDigest: decoded.contractDigest ?? "",
    contractDisplayName: decoded.contractDisplayName ?? null,
    direction: decoded.direction,
  };
}

type AuthorityWriteTarget = Pick<TrellisStorageDb, "delete" | "insert">;
type AuthorityPlanWriteTarget = Pick<TrellisStorageDb, "insert">;

class AuthorityPlanAcceptConflict extends Error {}

async function putAuthorityRows(
  target: AuthorityWriteTarget,
  decoded: DeploymentAuthority,
): Promise<void> {
  const header = encodeAuthorityHeader(decoded);
  await target.insert(deploymentAuthorities).values(header).onConflictDoUpdate({
    target: deploymentAuthorities.deploymentId,
    set: {
      kind: header.kind,
      disabled: header.disabled,
      version: header.version,
      updatedAt: header.updatedAt,
    },
  });
  await replaceAuthorityDesiredStateRows(target, decoded);
}

async function replaceAuthorityDesiredStateRows(
  target: AuthorityWriteTarget,
  decoded: DeploymentAuthority,
): Promise<void> {
  await target.delete(deploymentAuthorityContracts).where(
    eq(deploymentAuthorityContracts.deploymentId, decoded.deploymentId),
  );
  await target.delete(deploymentAuthoritySurfaces).where(
    eq(deploymentAuthoritySurfaces.deploymentId, decoded.deploymentId),
  );
  await target.delete(deploymentAuthorityResources).where(
    eq(deploymentAuthorityResources.deploymentId, decoded.deploymentId),
  );
  await target.delete(deploymentAuthorityCapabilities).where(
    eq(deploymentAuthorityCapabilities.deploymentId, decoded.deploymentId),
  );
  const contracts = decoded.desiredState.needs.flatMap((need) =>
    need.kind === "contract"
      ? [{
        deploymentId: decoded.deploymentId,
        contractId: need.contractId,
        required: need.required,
      }]
      : []
  );
  const needSurfaces = decoded.desiredState.needs.flatMap((need) =>
    need.kind === "surface"
      ? [{
        deploymentId: decoded.deploymentId,
        contractId: need.surface.contractId,
        surfaceKind: need.surface.kind,
        surfaceName: need.surface.name,
        action: need.surface.action ?? "",
        required: need.required,
        source: "need" as const,
      }]
      : []
  );
  const surfaces = decoded.desiredState.surfaces.map((surface) => ({
    deploymentId: decoded.deploymentId,
    contractId: surface.contractId,
    surfaceKind: surface.kind,
    surfaceName: surface.name,
    action: surface.action ?? "",
    required: true,
    source: "surface" as const,
  }));
  const needResources = decoded.desiredState.needs.flatMap((need) =>
    need.kind === "resource"
      ? [{
        deploymentId: decoded.deploymentId,
        resourceKind: need.resource.kind,
        resourceAlias: need.resource.alias,
        required: need.required,
        definitionJson: need.resource.definition === undefined
          ? null
          : JSON.stringify(need.resource.definition),
      }]
      : []
  );
  const resources = decoded.desiredState.resources.map((resource) => ({
    deploymentId: decoded.deploymentId,
    resourceKind: resource.kind,
    resourceAlias: resource.alias,
    required: resource.required,
    definitionJson: resource.definition === undefined
      ? null
      : JSON.stringify(resource.definition),
  }));
  const capabilities = [
    ...decoded.desiredState.capabilities,
    ...decoded.desiredState.needs.flatMap((need) =>
      need.kind === "capability" ? [need.capability] : []
    ),
  ];
  if (contracts.length > 0) {
    await target.insert(deploymentAuthorityContracts).values(contracts)
      .onConflictDoNothing();
  }
  if (needSurfaces.length + surfaces.length > 0) {
    await target.insert(deploymentAuthoritySurfaces).values([
      ...needSurfaces,
      ...surfaces,
    ]).onConflictDoNothing();
  }
  if (needResources.length + resources.length > 0) {
    await target.insert(deploymentAuthorityResources).values([
      ...needResources,
      ...resources,
    ]).onConflictDoNothing();
  }
  if (capabilities.length > 0) {
    await target.insert(deploymentAuthorityCapabilities).values(
      [...new Set(capabilities)].map((capability) => ({
        deploymentId: decoded.deploymentId,
        capability,
      })),
    );
  }
}

async function putAuthorityPlanRow(
  target: AuthorityPlanWriteTarget,
  record: DeploymentAuthorityPlan,
): Promise<void> {
  const row = encodePlan(record);
  await target.insert(deploymentAuthorityPlans).values(row)
    .onConflictDoUpdate({
      target: deploymentAuthorityPlans.planId,
      set: {
        state: row.state,
        proposalJson: row.proposalJson,
        desiredChangeJson: row.desiredChangeJson,
        materializationPreviewJson: row.materializationPreviewJson,
        warningsJson: row.warningsJson,
        acknowledgementRequired: row.acknowledgementRequired,
        decisionAt: row.decisionAt,
        decisionByJson: row.decisionByJson,
        decisionReason: row.decisionReason,
        expiresAt: row.expiresAt,
      },
    });
}

/** Stores deployment desired authority rows in SQL. */
export class SqlDeploymentAuthorityRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a deployment authority repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a deployment authority by deployment id, or undefined when absent. */
  async get(deploymentId: string): Promise<DeploymentAuthority | undefined> {
    const rows = await this.#db.select().from(deploymentAuthorities).where(
      eq(deploymentAuthorities.deploymentId, deploymentId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeAuthority(
      row,
      await this.#desiredStateForDeployments([deploymentId]).then((map) =>
        map.get(deploymentId) ?? emptyDesiredState()
      ),
    );
  }

  /** Inserts or replaces an authority and all desired-state child rows atomically. */
  async put(record: DeploymentAuthority): Promise<void> {
    const decoded = Value.Decode(DeploymentAuthoritySchema, record);
    await this.#db.transaction(async (tx) => {
      await putAuthorityRows(tx, decoded);
    });
  }

  /** Accepts a pending authority plan when both the plan and authority versions still match. */
  async acceptAuthorityPlan(
    authority: DeploymentAuthority,
    plan: DeploymentAuthorityPlan,
    expectedCurrentAuthorityVersion: string,
  ): Promise<boolean> {
    const decodedAuthority = Value.Decode(DeploymentAuthoritySchema, authority);
    const decodedPlan = Value.Decode(DeploymentAuthorityPlanSchema, plan);
    const authorityHeader = encodeAuthorityHeader(decodedAuthority);
    const planRow = encodePlan(decodedPlan);
    try {
      await this.#db.transaction(async (tx) => {
        const acceptedPlans = await tx.update(deploymentAuthorityPlans).set({
          state: planRow.state,
          proposalJson: planRow.proposalJson,
          desiredChangeJson: planRow.desiredChangeJson,
          materializationPreviewJson: planRow.materializationPreviewJson,
          warningsJson: planRow.warningsJson,
          acknowledgementRequired: planRow.acknowledgementRequired,
          decisionAt: planRow.decisionAt,
          decisionByJson: planRow.decisionByJson,
          decisionReason: planRow.decisionReason,
          expiresAt: planRow.expiresAt,
        }).where(and(
          eq(deploymentAuthorityPlans.planId, decodedPlan.planId),
          eq(deploymentAuthorityPlans.state, "pending"),
        )).returning({ planId: deploymentAuthorityPlans.planId });
        if (acceptedPlans.length !== 1) throw new AuthorityPlanAcceptConflict();

        const updatedAuthorities = await tx.update(deploymentAuthorities).set({
          kind: authorityHeader.kind,
          disabled: authorityHeader.disabled,
          version: authorityHeader.version,
          updatedAt: authorityHeader.updatedAt,
        }).where(and(
          eq(deploymentAuthorities.deploymentId, decodedAuthority.deploymentId),
          eq(deploymentAuthorities.version, expectedCurrentAuthorityVersion),
        )).returning({ deploymentId: deploymentAuthorities.deploymentId });
        if (updatedAuthorities.length !== 1) {
          throw new AuthorityPlanAcceptConflict();
        }
        await replaceAuthorityDesiredStateRows(tx, decodedAuthority);
      });
      return true;
    } catch (error) {
      if (error instanceof AuthorityPlanAcceptConflict) return false;
      throw error;
    }
  }

  /** Updates a deployment authority. */
  async update(record: DeploymentAuthority): Promise<void> {
    await this.put(record);
  }

  /** Returns a bounded page of deployment authorities ordered by deployment id. */
  async listPage(query: BoundedListQuery): Promise<DeploymentAuthority[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deploymentAuthorities).orderBy(
      deploymentAuthorities.deploymentId,
    ).limit(limit).offset(offset);
    return await this.#decodeAuthorityRows(rows);
  }

  /** Returns enabled deployment authorities ordered by deployment id. */
  async listEnabled(): Promise<DeploymentAuthority[]> {
    const rows = await this.#db.select().from(deploymentAuthorities).where(
      eq(deploymentAuthorities.disabled, false),
    ).orderBy(deploymentAuthorities.deploymentId);
    return await this.#decodeAuthorityRows(rows);
  }

  /** Returns deployment authorities matching indexed header filters. */
  async listFiltered(
    filters: { kind?: string; disabled?: boolean },
    query: BoundedListQuery,
  ): Promise<DeploymentAuthority[]> {
    const { offset, limit } = boundedListQuery(query);
    const conditions: SQL[] = [];
    if (filters.kind !== undefined) {
      conditions.push(eq(deploymentAuthorities.kind, filters.kind));
    }
    if (filters.disabled !== undefined) {
      conditions.push(eq(deploymentAuthorities.disabled, filters.disabled));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await this.#db.select().from(deploymentAuthorities).where(
      where,
    ).orderBy(deploymentAuthorities.deploymentId).limit(limit).offset(offset);
    return await this.#decodeAuthorityRows(rows);
  }

  /** Returns a counted page of deployment authorities matching indexed header filters. */
  async listFilteredPage(
    filters: { kind?: string; disabled?: boolean },
    query: BoundedListQuery,
  ): Promise<ListPage<DeploymentAuthority>> {
    const conditions: SQL[] = [];
    if (filters.kind !== undefined) {
      conditions.push(eq(deploymentAuthorities.kind, filters.kind));
    }
    if (filters.disabled !== undefined) {
      conditions.push(eq(deploymentAuthorities.disabled, filters.disabled));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      deploymentAuthorities,
    ).where(where);
    const rows = await this.#db.select().from(deploymentAuthorities).where(
      where,
    ).orderBy(deploymentAuthorities.deploymentId).limit(limit).offset(offset);
    return listPage(
      await this.#decodeAuthorityRows(rows),
      countRow?.count ?? 0,
      query,
    );
  }

  async #decodeAuthorityRows(
    rows: AuthorityRow[],
  ): Promise<DeploymentAuthority[]> {
    const states = await this.#desiredStateForDeployments(
      rows.map((row) => row.deploymentId),
    );
    return rows.map((row) =>
      decodeAuthority(row, states.get(row.deploymentId) ?? emptyDesiredState())
    );
  }

  async #desiredStateForDeployments(
    deploymentIds: Iterable<string>,
  ): Promise<Map<string, DeploymentAuthority["desiredState"]>> {
    const requested = [...new Set(deploymentIds)];
    const states = new Map<string, DeploymentAuthority["desiredState"]>();
    for (const deploymentId of requested) {
      states.set(deploymentId, emptyDesiredState());
    }
    if (requested.length === 0) return states;
    const [contracts, surfaces, resources, capabilities] = await Promise.all([
      this.#db.select().from(deploymentAuthorityContracts).where(
        inArray(deploymentAuthorityContracts.deploymentId, requested),
      ).orderBy(
        deploymentAuthorityContracts.deploymentId,
        deploymentAuthorityContracts.contractId,
      ),
      this.#db.select().from(deploymentAuthoritySurfaces).where(
        inArray(deploymentAuthoritySurfaces.deploymentId, requested),
      ).orderBy(
        deploymentAuthoritySurfaces.deploymentId,
        deploymentAuthoritySurfaces.contractId,
        deploymentAuthoritySurfaces.surfaceKind,
        deploymentAuthoritySurfaces.surfaceName,
        deploymentAuthoritySurfaces.action,
      ),
      this.#db.select().from(deploymentAuthorityResources).where(
        inArray(deploymentAuthorityResources.deploymentId, requested),
      ).orderBy(
        deploymentAuthorityResources.deploymentId,
        deploymentAuthorityResources.resourceKind,
        deploymentAuthorityResources.resourceAlias,
      ),
      this.#db.select().from(deploymentAuthorityCapabilities).where(
        inArray(deploymentAuthorityCapabilities.deploymentId, requested),
      ).orderBy(
        deploymentAuthorityCapabilities.deploymentId,
        deploymentAuthorityCapabilities.capability,
      ),
    ]);
    for (const row of contracts) {
      states.get(row.deploymentId)?.needs.push({
        kind: "contract",
        contractId: row.contractId,
        required: row.required,
      });
    }
    for (const row of surfaces) {
      const surface = Value.Decode(DeploymentAuthoritySurfaceSchema, {
        contractId: row.contractId,
        kind: row.surfaceKind,
        name: row.surfaceName,
        ...(row.action === "" ? {} : { action: row.action }),
      });
      if (row.source === "surface") {
        states.get(row.deploymentId)?.surfaces.push(surface);
      } else {
        states.get(row.deploymentId)?.needs.push({
          kind: "surface",
          surface,
          required: row.required,
        });
      }
    }
    for (const row of resources) {
      const resource = Value.Decode(DeploymentAuthorityResourceSchema, {
        kind: row.resourceKind,
        alias: row.resourceAlias,
        required: row.required,
        ...(row.definitionJson === null ? {} : {
          definition: parseJsonField(
            "deployment authority resource definition",
            row.definitionJson,
          ),
        }),
      });
      states.get(row.deploymentId)?.resources.push(resource);
      states.get(row.deploymentId)?.needs.push({
        kind: "resource",
        resource,
        required: row.required,
      });
    }
    for (const row of capabilities) {
      states.get(row.deploymentId)?.capabilities.push(row.capability);
      states.get(row.deploymentId)?.needs.push({
        kind: "capability",
        capability: row.capability,
        required: true,
      });
    }
    return states;
  }
}

/** Stores deployment authority update and migration plans in SQL. */
export class SqlDeploymentAuthorityPlanRepository {
  readonly #db: TrellisStorageDb;
  /** Creates a deployment authority plan repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }
  /** Returns one plan by id. */
  async get(planId: string): Promise<DeploymentAuthorityPlan | undefined> {
    const rows = await this.#db.select().from(deploymentAuthorityPlans).where(
      eq(deploymentAuthorityPlans.planId, planId),
    ).limit(1);
    return rows[0] === undefined ? undefined : decodePlan(rows[0]);
  }
  /** Inserts or replaces one plan. */
  async put(record: DeploymentAuthorityPlan): Promise<void> {
    await putAuthorityPlanRow(this.#db, record);
  }
  /** Returns plans for one deployment ordered by creation time and id. */
  async listByDeployment(
    deploymentId: string,
  ): Promise<DeploymentAuthorityPlan[]> {
    const rows = await this.#db.select().from(deploymentAuthorityPlans).where(
      eq(deploymentAuthorityPlans.deploymentId, deploymentId),
    ).orderBy(
      deploymentAuthorityPlans.createdAt,
      deploymentAuthorityPlans.planId,
    );
    return rows.map(decodePlan);
  }
  /** Returns plans matching indexed filters. */
  async listFiltered(
    filters: AuthorityPlanFilters,
    query: BoundedListQuery,
  ): Promise<DeploymentAuthorityPlan[]> {
    const page = await this.listFilteredPage(filters, query);
    return page.entries;
  }

  /** Returns a counted page of plans matching indexed filters. */
  async listFilteredPage(
    filters: AuthorityPlanFilters,
    query: BoundedListQuery,
  ): Promise<ListPage<DeploymentAuthorityPlan>> {
    const { offset, limit } = boundedListQuery(query);
    const conditions: SQL[] = [];
    if (filters.deploymentId !== undefined) {
      conditions.push(
        eq(deploymentAuthorityPlans.deploymentId, filters.deploymentId),
      );
    }
    if (filters.state !== undefined) {
      conditions.push(eq(deploymentAuthorityPlans.state, filters.state));
    }
    if (filters.classification !== undefined) {
      conditions.push(
        eq(deploymentAuthorityPlans.classification, filters.classification),
      );
    }
    if (filters.kind !== undefined) {
      const authorityRows = await this.#db.select({
        deploymentId: deploymentAuthorities.deploymentId,
      }).from(deploymentAuthorities).where(
        eq(deploymentAuthorities.kind, filters.kind),
      );
      const deploymentIds = authorityRows.map((row) => row.deploymentId);
      if (deploymentIds.length === 0) return listPage([], 0, query);
      conditions.push(
        inArray(deploymentAuthorityPlans.deploymentId, deploymentIds),
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [countRow] = await this.#db.select({ count: count() }).from(
      deploymentAuthorityPlans,
    ).where(where);
    const rows = await this.#db.select().from(deploymentAuthorityPlans).where(
      where,
    ).orderBy(
      deploymentAuthorityPlans.deploymentId,
      deploymentAuthorityPlans.createdAt,
      deploymentAuthorityPlans.planId,
    ).limit(limit).offset(offset);
    return listPage(rows.map(decodePlan), countRow?.count ?? 0, query);
  }
}

/** Stores authority-backed capability definition projections in SQL. */
export class SqlDeploymentAuthorityCapabilityDefinitionRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a capability definition repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Replaces all capability definitions for one deployment. */
  async replaceForDeployment(
    deploymentId: string,
    definitions: DeploymentAuthorityCapabilityDefinition[],
  ): Promise<void> {
    const rows = definitions
      .map((definition) =>
        encodeCapabilityDefinition({
          ...definition,
          deploymentId,
        })
      )
      .sort((left, right) =>
        left.capability.localeCompare(right.capability) ||
        left.deploymentId.localeCompare(right.deploymentId) ||
        (left.contractId ?? "").localeCompare(right.contractId ?? "") ||
        (left.contractDigest ?? "").localeCompare(right.contractDigest ?? "") ||
        left.direction.localeCompare(right.direction)
      );
    await this.#db.transaction(async (tx) => {
      await tx.delete(deploymentAuthorityCapabilityDefinitions).where(
        eq(deploymentAuthorityCapabilityDefinitions.deploymentId, deploymentId),
      );
      if (rows.length > 0) {
        await tx.insert(deploymentAuthorityCapabilityDefinitions).values(rows);
      }
    });
  }

  /** Returns capability definitions for enabled deployment authorities. */
  async listEnabled(): Promise<DeploymentAuthorityCapabilityDefinition[]> {
    const rows = await this.#db
      .select({
        deploymentId: deploymentAuthorityCapabilityDefinitions.deploymentId,
        capability: deploymentAuthorityCapabilityDefinitions.capability,
        displayName: deploymentAuthorityCapabilityDefinitions.displayName,
        description: deploymentAuthorityCapabilityDefinitions.description,
        consequence: deploymentAuthorityCapabilityDefinitions.consequence,
        source: deploymentAuthorityCapabilityDefinitions.source,
        contractId: deploymentAuthorityCapabilityDefinitions.contractId,
        contractDigest: deploymentAuthorityCapabilityDefinitions.contractDigest,
        contractDisplayName:
          deploymentAuthorityCapabilityDefinitions.contractDisplayName,
        direction: deploymentAuthorityCapabilityDefinitions.direction,
      })
      .from(deploymentAuthorityCapabilityDefinitions)
      .innerJoin(
        deploymentAuthorities,
        eq(
          deploymentAuthorities.deploymentId,
          deploymentAuthorityCapabilityDefinitions.deploymentId,
        ),
      )
      .where(eq(deploymentAuthorities.disabled, false))
      .orderBy(
        deploymentAuthorityCapabilityDefinitions.capability,
        deploymentAuthorityCapabilityDefinitions.deploymentId,
        deploymentAuthorityCapabilityDefinitions.contractId,
        deploymentAuthorityCapabilityDefinitions.contractDigest,
        deploymentAuthorityCapabilityDefinitions.direction,
      );
    return rows.map(decodeCapabilityDefinitionRow);
  }
}

/** Stores materialized authority and resource bindings in SQL. */
export class SqlMaterializedAuthorityRepository {
  readonly #db: TrellisStorageDb;
  /** Creates a materialized authority repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }
  /** Returns materialized authority by deployment id. */
  async get(
    deploymentId: string,
  ): Promise<DeploymentAuthorityMaterialization | undefined> {
    const rows = await this.#db.select().from(materializedAuthority).where(
      eq(materializedAuthority.deploymentId, deploymentId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeMaterialized(
      row,
      await this.listBindingsByDeployment(deploymentId),
    );
  }
  /** Inserts or replaces materialized authority and bindings atomically. */
  async put(record: DeploymentAuthorityMaterialization): Promise<void> {
    const authority = encodeMaterialized(record);
    const bindings = record.resourceBindings.map(encodeBinding);
    await this.#db.transaction(async (tx) => {
      await tx.insert(materializedAuthority).values(authority)
        .onConflictDoUpdate({
          target: materializedAuthority.deploymentId,
          set: {
            desiredVersion: authority.desiredVersion,
            status: authority.status,
            grantsJson: authority.grantsJson,
            reconciledAt: authority.reconciledAt,
            error: authority.error,
          },
        });
      await tx.delete(materializedResourceBindings).where(
        eq(materializedResourceBindings.deploymentId, authority.deploymentId),
      );
      if (bindings.length > 0) {
        await tx.insert(materializedResourceBindings).values(bindings);
      }
    });
  }
  /** Returns resource bindings for one deployment in deterministic order. */
  async listBindingsByDeployment(
    deploymentId: string,
  ): Promise<DeploymentResourceBinding[]> {
    const rows = await this.#db.select().from(materializedResourceBindings)
      .where(eq(materializedResourceBindings.deploymentId, deploymentId))
      .orderBy(
        materializedResourceBindings.resourceKind,
        materializedResourceBindings.resourceAlias,
      );
    return rows.map(decodeBindingRow);
  }
}

export class SqlMaterializedResourceBindingRepository
  extends SqlMaterializedAuthorityRepository {}

/** Stores deployment authority reconciliation status and events in SQL. */
export class SqlAuthorityReconciliationRepository {
  readonly #db: TrellisStorageDb;
  /** Creates a reconciliation repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }
  /** Returns reconciliation status by deployment id. */
  async getStatus(
    deploymentId: string,
  ): Promise<DeploymentAuthorityReconciliationStatus | undefined> {
    const rows = await this.#db.select().from(authorityReconciliationStatus)
      .where(eq(authorityReconciliationStatus.deploymentId, deploymentId))
      .limit(1);
    return rows[0] === undefined
      ? undefined
      : decodeReconciliationStatus(rows[0]);
  }
  /** Inserts or replaces reconciliation status. */
  async putStatus(
    record: DeploymentAuthorityReconciliationStatus,
  ): Promise<void> {
    const row = encodeReconciliationStatus(record);
    await this.#db.insert(authorityReconciliationStatus).values(row)
      .onConflictDoUpdate({
        target: authorityReconciliationStatus.deploymentId,
        set: {
          desiredVersion: row.desiredVersion,
          state: row.state,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          message: row.message,
        },
      });
  }
  /** Appends a reconciliation event. */
  async appendEvent(record: ReconciliationEventInsert): Promise<void> {
    await this.#db.insert(authorityReconciliationEvents).values(record);
  }
}

/** Stores deployment authority grant overrides in SQL. */
export class SqlDeploymentAuthorityGrantOverrideRepository {
  readonly #db: TrellisStorageDb;
  /** Creates a grant override repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }
  /** Replaces all grant overrides for one deployment atomically. */
  async replaceForDeployment(
    deploymentId: string,
    records: DeploymentAuthorityGrantOverride[],
  ): Promise<void> {
    const rows = records.map(encodeGrantOverride);
    for (const row of rows) {
      if (row.deploymentId !== deploymentId) {
        throw new Error("Grant override deployment id mismatch");
      }
    }
    await this.#db.transaction(async (tx) => {
      await tx.delete(deploymentAuthorityGrantOverrides).where(
        eq(deploymentAuthorityGrantOverrides.deploymentId, deploymentId),
      );
      if (rows.length > 0) {
        await tx.insert(deploymentAuthorityGrantOverrides).values(rows);
      }
    });
  }
  /** Updates grant overrides for one deployment atomically. */
  async updateForDeployment(
    deploymentId: string,
    records: DeploymentAuthorityGrantOverride[],
  ): Promise<void> {
    await this.replaceForDeployment(deploymentId, records);
  }
  /** Returns grant overrides for one deployment in deterministic order. */
  async listByDeployment(
    deploymentId: string,
  ): Promise<DeploymentAuthorityGrantOverride[]> {
    const rows = await this.#db.select().from(deploymentAuthorityGrantOverrides)
      .where(eq(deploymentAuthorityGrantOverrides.deploymentId, deploymentId))
      .orderBy(
        deploymentAuthorityGrantOverrides.grantKind,
        deploymentAuthorityGrantOverrides.capability,
        deploymentAuthorityGrantOverrides.capabilityGroupKey,
        deploymentAuthorityGrantOverrides.identityKind,
        deploymentAuthorityGrantOverrides.contractId,
        deploymentAuthorityGrantOverrides.origin,
        deploymentAuthorityGrantOverrides.sessionPublicKey,
      );
    return rows.map(decodeGrantOverrideRow);
  }
  /** Returns a counted bounded page of grant overrides in deterministic order. */
  async listCountedPage(
    query: BoundedListQuery,
  ): Promise<ListPage<DeploymentAuthorityGrantOverride>> {
    const { offset, limit } = boundedListQuery(query);
    const [countRow, rows] = await Promise.all([
      this.#db.select({ count: count() }).from(
        deploymentAuthorityGrantOverrides,
      ),
      this.#db.select().from(deploymentAuthorityGrantOverrides).orderBy(
        deploymentAuthorityGrantOverrides.deploymentId,
        deploymentAuthorityGrantOverrides.grantKey,
      ).limit(limit).offset(offset),
    ]);
    return listPage(
      rows.map(decodeGrantOverrideRow),
      countRow[0]?.count ?? 0,
      query,
    );
  }
}

/** Stores deployment portal route metadata in SQL. */
export class SqlDeploymentPortalRouteRepository {
  readonly #db: TrellisStorageDb;
  /** Creates a portal route repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }
  /** Returns a portal route by deployment id, or undefined when absent. */
  async get(deploymentId: string): Promise<DeploymentPortalRoute | undefined> {
    const rows = await this.#db.select().from(deploymentPortalRoutes).where(
      eq(deploymentPortalRoutes.deploymentId, deploymentId),
    ).limit(1);
    return rows[0] === undefined ? undefined : decodePortalRouteRow(rows[0]);
  }
  /** Inserts or replaces a deployment portal route. */
  async put(record: DeploymentPortalRoute): Promise<void> {
    const row = encodePortalRoute(record);
    await this.#db.insert(deploymentPortalRoutes).values(row)
      .onConflictDoUpdate({
        target: deploymentPortalRoutes.deploymentId,
        set: {
          portalId: row.portalId,
          entryUrl: row.entryUrl,
          disabled: row.disabled,
          updatedAt: row.updatedAt,
        },
      });
  }
  /** Returns a bounded page of portal routes ordered by deployment id. */
  async listPage(query: BoundedListQuery): Promise<DeploymentPortalRoute[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deploymentPortalRoutes).orderBy(
      deploymentPortalRoutes.deploymentId,
    ).limit(limit).offset(offset);
    return rows.map(decodePortalRouteRow);
  }
  /** Returns the first enabled portal route for the requested deployments. */
  async getFirstEnabledForDeployments(
    deploymentIds: Iterable<string>,
  ): Promise<DeploymentPortalRoute | undefined> {
    const requested = [...new Set(deploymentIds)];
    if (requested.length === 0) return undefined;
    const rows = await this.#db.select().from(deploymentPortalRoutes).where(
      and(
        inArray(deploymentPortalRoutes.deploymentId, requested),
        eq(deploymentPortalRoutes.disabled, false),
      ),
    ).orderBy(deploymentPortalRoutes.deploymentId).limit(1);
    return rows[0] === undefined ? undefined : decodePortalRouteRow(rows[0]);
  }
}

/** Stores implementation offers in SQL. */
export class SqlImplementationOfferRepository {
  readonly #db: TrellisStorageDb;
  /** Creates an implementation offer repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }
  /** Returns an implementation offer by offer id. */
  async get(offerId: string): Promise<ImplementationOffer | undefined> {
    const rows = await this.#db.select().from(implementationOffers).where(
      eq(implementationOffers.offerId, offerId),
    ).limit(1);
    return rows[0] === undefined
      ? undefined
      : decodeImplementationOfferRow(rows[0]);
  }
  /** Returns implementation offers for one deployment ordered by contract and digest. */
  async listByDeployment(
    deploymentKind: ImplementationOffer["deploymentKind"],
    deploymentId: string,
  ): Promise<ImplementationOffer[]> {
    const rows = await this.#db.select().from(implementationOffers).where(
      and(
        eq(implementationOffers.deploymentKind, deploymentKind),
        eq(implementationOffers.deploymentId, deploymentId),
      ),
    ).orderBy(
      implementationOffers.contractId,
      implementationOffers.contractDigest,
    );
    return rows.map(decodeImplementationOfferRow);
  }
  /** Returns implementation offers for one instance ordered by contract and digest. */
  async listByInstance(instanceId: string): Promise<ImplementationOffer[]> {
    const rows = await this.#db.select().from(implementationOffers).where(
      eq(implementationOffers.instanceId, instanceId),
    ).orderBy(
      implementationOffers.contractId,
      implementationOffers.contractDigest,
    );
    return rows.map(decodeImplementationOfferRow);
  }
  /** Returns active offers ordered by contract, digest, and deployment. */
  async listActive(
    evaluationTime: Date = new Date(),
  ): Promise<ImplementationOffer[]> {
    const now = evaluationTime.toISOString();
    const rows = await this.#db.select().from(implementationOffers).where(
      and(
        eq(implementationOffers.status, "accepted"),
        isNotNull(implementationOffers.acceptedAt),
        or(
          isNull(implementationOffers.staleAt),
          gt(implementationOffers.staleAt, now),
        ),
        or(
          isNull(implementationOffers.expiresAt),
          gt(implementationOffers.expiresAt, now),
        ),
      ),
    ).orderBy(
      implementationOffers.contractId,
      implementationOffers.contractDigest,
      implementationOffers.deploymentId,
      implementationOffers.instanceId,
      implementationOffers.offerId,
    );
    return rows.map(decodeImplementationOfferRow);
  }
  /** Returns active offers for a contract id ordered by digest and deployment. */
  async listActiveByContractId(
    contractId: string,
    evaluationTime: Date = new Date(),
  ): Promise<ImplementationOffer[]> {
    const now = evaluationTime.toISOString();
    const rows = await this.#db.select().from(implementationOffers).where(
      and(
        eq(implementationOffers.contractId, contractId),
        eq(implementationOffers.status, "accepted"),
        isNotNull(implementationOffers.acceptedAt),
        or(
          isNull(implementationOffers.staleAt),
          gt(implementationOffers.staleAt, now),
        ),
        or(
          isNull(implementationOffers.expiresAt),
          gt(implementationOffers.expiresAt, now),
        ),
      ),
    ).orderBy(
      implementationOffers.contractDigest,
      implementationOffers.deploymentId,
      implementationOffers.instanceId,
    );
    return rows.map(decodeImplementationOfferRow);
  }
  /** Returns active offers for the requested contract digests. */
  async listActiveByDigests(
    contractDigests: Iterable<string>,
    evaluationTime: Date = new Date(),
  ): Promise<ImplementationOffer[]> {
    const requested = [...new Set(contractDigests)];
    if (requested.length === 0) return [];
    const now = evaluationTime.toISOString();
    const rows = await this.#db.select().from(implementationOffers).where(
      and(
        inArray(implementationOffers.contractDigest, requested),
        eq(implementationOffers.status, "accepted"),
        isNotNull(implementationOffers.acceptedAt),
        or(
          isNull(implementationOffers.staleAt),
          gt(implementationOffers.staleAt, now),
        ),
        or(
          isNull(implementationOffers.expiresAt),
          gt(implementationOffers.expiresAt, now),
        ),
      ),
    ).orderBy(
      implementationOffers.contractDigest,
      implementationOffers.deploymentId,
      implementationOffers.instanceId,
    );
    return rows.map(decodeImplementationOfferRow);
  }
  /** Returns the latest accepted offer for a lineage, if one exists. */
  async latestAcceptedByLineage(
    lineageKey: string,
  ): Promise<ImplementationOffer | undefined> {
    const rows = await this.#db.select().from(implementationOffers).where(
      and(
        eq(implementationOffers.lineageKey, lineageKey),
        eq(implementationOffers.status, "accepted"),
      ),
    ).orderBy(
      desc(implementationOffers.acceptedAt),
      desc(implementationOffers.lastRefreshedAt),
      implementationOffers.offerId,
    ).limit(1);
    return rows[0] === undefined
      ? undefined
      : decodeImplementationOfferRow(rows[0]);
  }
  /** Inserts or replaces an implementation offer by offer id. */
  async put(record: ImplementationOffer): Promise<void> {
    const row = encodeImplementationOffer(record);
    await this.#db.insert(implementationOffers).values(row).onConflictDoUpdate({
      target: implementationOffers.offerId,
      set: {
        deploymentKind: row.deploymentKind,
        deploymentId: row.deploymentId,
        instanceId: row.instanceId,
        contractId: row.contractId,
        status: row.status,
        liveness: row.liveness,
        firstOfferedAt: row.firstOfferedAt,
        acceptedAt: row.acceptedAt,
        lastRefreshedAt: row.lastRefreshedAt,
        staleAt: row.staleAt,
        expiresAt: row.expiresAt,
      },
    });
  }
  /** Returns a bounded page of implementation offers in deterministic order. */
  async listPage(query: BoundedListQuery): Promise<ImplementationOffer[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(implementationOffers).orderBy(
      implementationOffers.deploymentKind,
      implementationOffers.deploymentId,
      implementationOffers.contractId,
      implementationOffers.contractDigest,
      implementationOffers.offerId,
    ).limit(limit).offset(offset);
    return rows.map(decodeImplementationOfferRow);
  }
}
