import { and, count, eq, inArray, type SQL } from "drizzle-orm";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import {
  deploymentContractEvidence,
  deploymentEnvelopeCapabilities,
  deploymentEnvelopeContracts,
  deploymentEnvelopeResources,
  deploymentEnvelopes,
  deploymentEnvelopeSurfaces,
  deploymentGrantOverrides,
  deploymentPortalRoutes,
  deploymentResourceBindings,
  envelopeExpansionRequestCapabilities,
  envelopeExpansionRequestContracts,
  envelopeExpansionRequestResources,
  envelopeExpansionRequests,
  envelopeExpansionRequestSurfaces,
  envelopeHistoryEntries,
} from "../../storage/schema.ts";
import {
  type DeploymentContractEvidence,
  DeploymentContractEvidenceSchema,
  type DeploymentEnvelope,
  DeploymentEnvelopeSchema,
  type DeploymentGrantOverride,
  DeploymentGrantOverrideSchema,
  type DeploymentPortalRoute,
  DeploymentPortalRouteSchema,
  type DeploymentResourceBinding,
  DeploymentResourceBindingSchema,
  type EnvelopeBoundary,
  EnvelopeBoundarySchema,
  type EnvelopeExpansionRequest,
  EnvelopeExpansionRequestSchema,
  type EnvelopeExpansionRequestStateUpdate,
  EnvelopeExpansionRequestStateUpdateSchema,
  type EnvelopeHistoryEntry,
  EnvelopeHistoryEntrySchema,
} from "../schemas.ts";
import {
  type BoundedListQuery,
  boundedListQuery,
  type ListPage,
  listPage,
  parseJsonField,
} from "./shared.ts";

type EnvelopeHeaderRow = typeof deploymentEnvelopes.$inferSelect;
type EnvelopeHeaderInsert = typeof deploymentEnvelopes.$inferInsert;
type PortalRouteRow = typeof deploymentPortalRoutes.$inferSelect;
type PortalRouteInsert = typeof deploymentPortalRoutes.$inferInsert;
type GrantOverrideRow = typeof deploymentGrantOverrides.$inferSelect;
type GrantOverrideInsert = typeof deploymentGrantOverrides.$inferInsert;
type ResourceBindingRow = typeof deploymentResourceBindings.$inferSelect;
type ResourceBindingInsert = typeof deploymentResourceBindings.$inferInsert;
type ContractEvidenceRow = typeof deploymentContractEvidence.$inferSelect;
type ContractEvidenceInsert = typeof deploymentContractEvidence.$inferInsert;
type ExpansionRequestRow = typeof envelopeExpansionRequests.$inferSelect;
type ExpansionRequestInsert = typeof envelopeExpansionRequests.$inferInsert;
type HistoryEntryRow = typeof envelopeHistoryEntries.$inferSelect;
type HistoryEntryInsert = typeof envelopeHistoryEntries.$inferInsert;
type BoundaryParts = {
  contracts: Array<{ contractId: string; required: boolean }>;
  surfaces: Array<{
    contractId: string;
    kind: string;
    name: string;
    action: string;
    required: boolean;
  }>;
  resources: Array<{ kind: string; alias: string; required: boolean }>;
  capabilities: string[];
};

function decodeEnvelope(
  row: EnvelopeHeaderRow,
  boundary: EnvelopeBoundary,
): DeploymentEnvelope {
  return Value.Decode(DeploymentEnvelopeSchema, {
    deploymentId: row.deploymentId,
    kind: row.kind,
    disabled: row.disabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    boundary,
  });
}

function encodeEnvelopeHeader(
  record: DeploymentEnvelope,
): EnvelopeHeaderInsert {
  const decoded = Value.Decode(DeploymentEnvelopeSchema, record);
  return {
    deploymentId: decoded.deploymentId,
    kind: decoded.kind,
    disabled: decoded.disabled,
    createdAt: decoded.createdAt,
    updatedAt: decoded.updatedAt,
  };
}

function decodePortalRouteRow(row: PortalRouteRow): DeploymentPortalRoute {
  return Value.Decode(DeploymentPortalRouteSchema, {
    deploymentId: row.deploymentId,
    portalId: row.portalId,
    entryUrl: row.entryUrl,
    disabled: row.disabled,
    updatedAt: row.updatedAt,
  });
}

function encodePortalRoute(record: DeploymentPortalRoute): PortalRouteInsert {
  return Value.Decode(DeploymentPortalRouteSchema, record);
}

function decodeGrantOverrideRow(
  row: GrantOverrideRow,
): DeploymentGrantOverride {
  return Value.Decode(DeploymentGrantOverrideSchema, {
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

function encodeGrantOverride(
  record: DeploymentGrantOverride,
): GrantOverrideInsert {
  const decoded = Value.Decode(DeploymentGrantOverrideSchema, record);
  return {
    deploymentId: decoded.deploymentId,
    grantKey: grantOverrideKey(decoded),
    identityKind: decoded.identityKind,
    grantKind: decoded.grantKind,
    contractId: decoded.contractId,
    origin: decoded.origin,
    sessionPublicKey: decoded.sessionPublicKey,
    capability: decoded.capability,
    capabilityGroupKey: decoded.capabilityGroupKey,
  };
}

function grantOverrideKey(record: DeploymentGrantOverride): string {
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

function decodeResourceBindingRow(
  row: ResourceBindingRow,
): DeploymentResourceBinding {
  return Value.Decode(DeploymentResourceBindingSchema, {
    deploymentId: row.deploymentId,
    kind: row.resourceKind,
    alias: row.resourceAlias,
    binding: parseJsonField("deployment resource binding", row.bindingJson),
    limits: row.limitsJson === null
      ? null
      : parseJsonField("deployment resource binding limits", row.limitsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function encodeResourceBinding(
  record: DeploymentResourceBinding,
): ResourceBindingInsert {
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

function decodeContractEvidenceRow(
  row: ContractEvidenceRow,
): DeploymentContractEvidence {
  return Value.Decode(DeploymentContractEvidenceSchema, {
    deploymentId: row.deploymentId,
    contractId: row.contractId,
    contractDigest: row.contractDigest,
    contract: parseJsonField("deployment contract evidence", row.contractJson),
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    ignoredAt: row.ignoredAt,
    ignoredBy: row.ignoredByJson === null ? null : parseJsonField(
      "deployment contract evidence ignored_by",
      row.ignoredByJson,
    ),
    ignoreReason: row.ignoreReason,
  });
}

function encodeContractEvidence(
  record: DeploymentContractEvidence,
): ContractEvidenceInsert {
  const decoded = Value.Decode(DeploymentContractEvidenceSchema, record);
  return {
    deploymentId: decoded.deploymentId,
    contractId: decoded.contractId,
    contractDigest: decoded.contractDigest,
    contractJson: JSON.stringify(decoded.contract),
    firstSeenAt: decoded.firstSeenAt,
    lastSeenAt: decoded.lastSeenAt,
    ignoredAt: decoded.ignoredAt ?? null,
    ignoredByJson: decoded.ignoredBy === undefined || decoded.ignoredBy === null
      ? null
      : JSON.stringify(decoded.ignoredBy),
    ignoreReason: decoded.ignoreReason ?? null,
  };
}

function decodeExpansionRequest(
  row: ExpansionRequestRow,
  delta: EnvelopeBoundary,
): EnvelopeExpansionRequest {
  return Value.Decode(EnvelopeExpansionRequestSchema, {
    requestId: row.requestId,
    deploymentId: row.deploymentId,
    requestedByKind: row.requestedByKind,
    requestedBy: parseJsonField(
      "envelope expansion requester",
      row.requestedByJson,
    ),
    contractId: row.contractId,
    contractDigest: row.contractDigest,
    contract: parseJsonField("envelope expansion contract", row.contractJson),
    state: row.state,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedByJson === null
      ? null
      : parseJsonField("envelope expansion decider", row.decidedByJson),
    decisionReason: row.decisionReason,
    delta,
  });
}

function encodeExpansionRequest(
  record: EnvelopeExpansionRequest,
): ExpansionRequestInsert {
  const decoded = Value.Decode(EnvelopeExpansionRequestSchema, record);
  return {
    requestId: decoded.requestId,
    pendingKey: decoded.state === "pending"
      ? expansionPendingKey(decoded)
      : null,
    deploymentId: decoded.deploymentId,
    requestedByKind: decoded.requestedByKind,
    requestedByJson: JSON.stringify(decoded.requestedBy),
    contractId: decoded.contractId,
    contractDigest: decoded.contractDigest,
    contractJson: JSON.stringify(decoded.contract),
    state: decoded.state,
    createdAt: decoded.createdAt,
    decidedAt: decoded.decidedAt,
    decidedByJson: decoded.decidedBy === null
      ? null
      : JSON.stringify(decoded.decidedBy),
    decisionReason: decoded.decisionReason,
  };
}

function decodeHistoryEntry(row: HistoryEntryRow): EnvelopeHistoryEntry {
  return Value.Decode(EnvelopeHistoryEntrySchema, {
    entryId: row.entryId,
    scopeKind: row.scopeKind,
    scopeId: row.scopeId,
    action: row.action,
    delta: parseJsonField("envelope history delta", row.deltaJson),
    resultingUpdatedAt: row.resultingUpdatedAt,
    actor: row.actorJson === null
      ? null
      : parseJsonField("envelope history actor", row.actorJson),
    reason: row.reason,
    source: {
      ...(row.sourceContractId === null
        ? {}
        : { contractId: row.sourceContractId }),
      ...(row.sourceContractDigest === null
        ? {}
        : { contractDigest: row.sourceContractDigest }),
      ...(row.sourceRequestId === null
        ? {}
        : { requestId: row.sourceRequestId }),
    },
    createdAt: row.createdAt,
  });
}

function encodeHistoryEntry(record: EnvelopeHistoryEntry): HistoryEntryInsert {
  const decoded = Value.Decode(EnvelopeHistoryEntrySchema, record);
  return {
    entryId: decoded.entryId,
    scopeKind: decoded.scopeKind,
    scopeId: decoded.scopeId,
    action: decoded.action,
    deltaJson: JSON.stringify(decoded.delta),
    resultingUpdatedAt: decoded.resultingUpdatedAt,
    actorJson: decoded.actor === null ? null : JSON.stringify(decoded.actor),
    reason: decoded.reason,
    sourceContractId: decoded.source.contractId ?? null,
    sourceContractDigest: decoded.source.contractDigest ?? null,
    sourceRequestId: decoded.source.requestId ?? null,
    createdAt: decoded.createdAt,
  };
}

function keyField(value: string | boolean): string {
  const text = typeof value === "boolean" ? (value ? "1" : "0") : value;
  return `${text.length}:${text}`;
}

function keyPart(kind: string, ...fields: Array<string | boolean>): string {
  return [keyField(kind), ...fields.map((field) => keyField(field))].join("");
}

function boundaryPartKey(boundary: EnvelopeBoundary): string {
  const contracts = boundary.contracts
    .map((contract) =>
      keyPart("contract", contract.contractId, contract.required)
    )
    .sort();
  const surfaces = boundary.surfaces
    .map((surface) =>
      keyPart(
        "surface",
        surface.contractId,
        surface.kind,
        surface.name,
        surface.action,
        surface.required,
      )
    )
    .sort();
  const resources = boundary.resources
    .map((resource) =>
      keyPart("resource", resource.kind, resource.alias, resource.required)
    )
    .sort();
  const capabilities = [...boundary.capabilities]
    .map((capability) => keyPart("capability", capability))
    .sort();
  return [...contracts, ...surfaces, ...resources, ...capabilities].join("");
}

function expansionPendingKey(record: EnvelopeExpansionRequest): string {
  return keyPart(
    "pending-expansion",
    record.deploymentId,
    record.contractId,
    record.contractDigest,
    boundaryPartKey(record.delta),
  );
}

/** Stores normalized deployment envelope authority rows in SQL. */
export class SqlDeploymentEnvelopeRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a deployment envelope repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a deployment envelope by deployment id, or undefined when absent. */
  async get(deploymentId: string): Promise<DeploymentEnvelope | undefined> {
    const rows = await this.#db.select().from(deploymentEnvelopes).where(
      eq(deploymentEnvelopes.deploymentId, deploymentId),
    ).limit(1);
    const row = rows[0];
    if (row === undefined) return undefined;
    return decodeEnvelope(row, await this.#boundaryForDeployment(deploymentId));
  }

  /** Inserts or replaces an envelope and all child boundary rows atomically. */
  async put(record: DeploymentEnvelope): Promise<void> {
    const decoded = Value.Decode(DeploymentEnvelopeSchema, record);
    const header = encodeEnvelopeHeader(decoded);

    await this.#db.transaction(async (tx) => {
      await tx.insert(deploymentEnvelopes).values(header).onConflictDoUpdate({
        target: deploymentEnvelopes.deploymentId,
        set: {
          kind: header.kind,
          disabled: header.disabled,
          updatedAt: header.updatedAt,
        },
      });
      await tx.delete(deploymentEnvelopeContracts).where(
        eq(deploymentEnvelopeContracts.deploymentId, decoded.deploymentId),
      );
      await tx.delete(deploymentEnvelopeSurfaces).where(
        eq(deploymentEnvelopeSurfaces.deploymentId, decoded.deploymentId),
      );
      await tx.delete(deploymentEnvelopeResources).where(
        eq(deploymentEnvelopeResources.deploymentId, decoded.deploymentId),
      );
      await tx.delete(deploymentEnvelopeCapabilities).where(
        eq(deploymentEnvelopeCapabilities.deploymentId, decoded.deploymentId),
      );
      if (decoded.boundary.contracts.length > 0) {
        await tx.insert(deploymentEnvelopeContracts).values(
          decoded.boundary.contracts.map((contract) => ({
            deploymentId: decoded.deploymentId,
            contractId: contract.contractId,
            required: contract.required,
          })),
        );
      }
      if (decoded.boundary.surfaces.length > 0) {
        await tx.insert(deploymentEnvelopeSurfaces).values(
          decoded.boundary.surfaces.map((surface) => ({
            deploymentId: decoded.deploymentId,
            contractId: surface.contractId,
            surfaceKind: surface.kind,
            surfaceName: surface.name,
            action: surface.action,
            required: surface.required,
          })),
        );
      }
      if (decoded.boundary.resources.length > 0) {
        await tx.insert(deploymentEnvelopeResources).values(
          decoded.boundary.resources.map((resource) => ({
            deploymentId: decoded.deploymentId,
            resourceKind: resource.kind,
            resourceAlias: resource.alias,
            required: resource.required,
          })),
        );
      }
      if (decoded.boundary.capabilities.length > 0) {
        await tx.insert(deploymentEnvelopeCapabilities).values(
          decoded.boundary.capabilities.map((capability) => ({
            deploymentId: decoded.deploymentId,
            capability,
          })),
        );
      }
    });
  }

  /** Updates an envelope and all child boundary rows atomically. */
  async update(record: DeploymentEnvelope): Promise<void> {
    await this.put(record);
  }

  /**
   * Stores an expanded envelope, deployment-owned resource bindings, and
   * contract evidence in one transaction.
   */
  async putExpansion(record: {
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
    contractEvidence: DeploymentContractEvidence;
    history?: EnvelopeHistoryEntry;
  }): Promise<void> {
    const envelope = Value.Decode(DeploymentEnvelopeSchema, record.envelope);
    const delta = Value.Decode(EnvelopeBoundarySchema, record.delta);
    const header = encodeEnvelopeHeader(envelope);
    const resourceBindings = record.resourceBindings.map((binding) =>
      encodeResourceBinding(binding)
    );
    const contractEvidence = encodeContractEvidence(record.contractEvidence);
    const history = record.history === undefined
      ? undefined
      : encodeHistoryEntry(record.history);

    await this.#db.transaction(async (tx) => {
      await tx.insert(deploymentEnvelopes).values(header).onConflictDoUpdate({
        target: deploymentEnvelopes.deploymentId,
        set: {
          updatedAt: header.updatedAt,
        },
      });
      for (const contract of delta.contracts) {
        const row = {
          deploymentId: envelope.deploymentId,
          contractId: contract.contractId,
          required: contract.required,
        };
        const conflict = {
          target: [
            deploymentEnvelopeContracts.deploymentId,
            deploymentEnvelopeContracts.contractId,
          ],
          set: { required: row.required },
        };
        if (row.required) {
          await tx.insert(deploymentEnvelopeContracts).values(row)
            .onConflictDoUpdate(conflict);
        } else {
          await tx.insert(deploymentEnvelopeContracts).values(row)
            .onConflictDoNothing();
        }
      }
      for (const surface of delta.surfaces) {
        const row = {
          deploymentId: envelope.deploymentId,
          contractId: surface.contractId,
          surfaceKind: surface.kind,
          surfaceName: surface.name,
          action: surface.action,
          required: surface.required,
        };
        const conflict = {
          target: [
            deploymentEnvelopeSurfaces.deploymentId,
            deploymentEnvelopeSurfaces.contractId,
            deploymentEnvelopeSurfaces.surfaceKind,
            deploymentEnvelopeSurfaces.surfaceName,
            deploymentEnvelopeSurfaces.action,
          ],
          set: { required: row.required },
        };
        if (row.required) {
          await tx.insert(deploymentEnvelopeSurfaces).values(row)
            .onConflictDoUpdate(conflict);
        } else {
          await tx.insert(deploymentEnvelopeSurfaces).values(row)
            .onConflictDoNothing();
        }
      }
      for (const resource of delta.resources) {
        const row = {
          deploymentId: envelope.deploymentId,
          resourceKind: resource.kind,
          resourceAlias: resource.alias,
          required: resource.required,
        };
        const conflict = {
          target: [
            deploymentEnvelopeResources.deploymentId,
            deploymentEnvelopeResources.resourceKind,
            deploymentEnvelopeResources.resourceAlias,
          ],
          set: { required: row.required },
        };
        if (row.required) {
          await tx.insert(deploymentEnvelopeResources).values(row)
            .onConflictDoUpdate(conflict);
        } else {
          await tx.insert(deploymentEnvelopeResources).values(row)
            .onConflictDoNothing();
        }
      }
      if (delta.capabilities.length > 0) {
        await tx.insert(deploymentEnvelopeCapabilities).values(
          delta.capabilities.map((capability) => ({
            deploymentId: envelope.deploymentId,
            capability,
          })),
        ).onConflictDoNothing();
      }

      for (const binding of resourceBindings) {
        await tx.insert(deploymentResourceBindings).values(binding)
          .onConflictDoUpdate({
            target: [
              deploymentResourceBindings.deploymentId,
              deploymentResourceBindings.resourceKind,
              deploymentResourceBindings.resourceAlias,
            ],
            set: {
              bindingJson: binding.bindingJson,
              limitsJson: binding.limitsJson,
              updatedAt: binding.updatedAt,
            },
          });
      }

      await tx.insert(deploymentContractEvidence).values(contractEvidence)
        .onConflictDoUpdate({
          target: [
            deploymentContractEvidence.deploymentId,
            deploymentContractEvidence.contractDigest,
          ],
          set: {
            contractId: contractEvidence.contractId,
            contractJson: contractEvidence.contractJson,
            lastSeenAt: contractEvidence.lastSeenAt,
          },
        });
      if (history !== undefined) {
        await tx.insert(envelopeHistoryEntries).values(history);
      }
    });
  }

  /**
   * Atomically expands an envelope and marks the originating expansion request
   * approved, so a successful expansion cannot leave a pending request behind.
   */
  async approveExpansion(record: {
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
    contractEvidence: DeploymentContractEvidence;
    history?: EnvelopeHistoryEntry;
    request: {
      requestId: string;
      state: "approved";
      decidedAt: string;
      decidedBy: Record<string, unknown>;
      decisionReason: string | null;
    };
  }): Promise<boolean> {
    const envelope = Value.Decode(DeploymentEnvelopeSchema, record.envelope);
    const delta = Value.Decode(EnvelopeBoundarySchema, record.delta);
    const header = encodeEnvelopeHeader(envelope);
    const resourceBindings = record.resourceBindings.map((binding) =>
      encodeResourceBinding(binding)
    );
    const contractEvidence = encodeContractEvidence(record.contractEvidence);
    const history = record.history === undefined
      ? undefined
      : encodeHistoryEntry(record.history);

    return await this.#db.transaction(async (tx) => {
      const updated = await tx.update(envelopeExpansionRequests).set({
        pendingKey: null,
        state: record.request.state,
        decidedAt: record.request.decidedAt,
        decidedByJson: JSON.stringify(record.request.decidedBy),
        decisionReason: record.request.decisionReason,
      }).where(
        and(
          eq(envelopeExpansionRequests.requestId, record.request.requestId),
          eq(envelopeExpansionRequests.state, "pending"),
        ),
      ).returning({ requestId: envelopeExpansionRequests.requestId });
      if (updated.length === 0) return false;

      await tx.insert(deploymentEnvelopes).values(header).onConflictDoUpdate({
        target: deploymentEnvelopes.deploymentId,
        set: {
          updatedAt: header.updatedAt,
        },
      });
      for (const contract of delta.contracts) {
        const row = {
          deploymentId: envelope.deploymentId,
          contractId: contract.contractId,
          required: contract.required,
        };
        if (row.required) {
          await tx.insert(deploymentEnvelopeContracts).values(row)
            .onConflictDoUpdate({
              target: [
                deploymentEnvelopeContracts.deploymentId,
                deploymentEnvelopeContracts.contractId,
              ],
              set: { required: row.required },
            });
        } else {
          await tx.insert(deploymentEnvelopeContracts).values(row)
            .onConflictDoNothing();
        }
      }
      for (const surface of delta.surfaces) {
        const row = {
          deploymentId: envelope.deploymentId,
          contractId: surface.contractId,
          surfaceKind: surface.kind,
          surfaceName: surface.name,
          action: surface.action,
          required: surface.required,
        };
        if (row.required) {
          await tx.insert(deploymentEnvelopeSurfaces).values(row)
            .onConflictDoUpdate({
              target: [
                deploymentEnvelopeSurfaces.deploymentId,
                deploymentEnvelopeSurfaces.contractId,
                deploymentEnvelopeSurfaces.surfaceKind,
                deploymentEnvelopeSurfaces.surfaceName,
                deploymentEnvelopeSurfaces.action,
              ],
              set: { required: row.required },
            });
        } else {
          await tx.insert(deploymentEnvelopeSurfaces).values(row)
            .onConflictDoNothing();
        }
      }
      for (const resource of delta.resources) {
        const row = {
          deploymentId: envelope.deploymentId,
          resourceKind: resource.kind,
          resourceAlias: resource.alias,
          required: resource.required,
        };
        if (row.required) {
          await tx.insert(deploymentEnvelopeResources).values(row)
            .onConflictDoUpdate({
              target: [
                deploymentEnvelopeResources.deploymentId,
                deploymentEnvelopeResources.resourceKind,
                deploymentEnvelopeResources.resourceAlias,
              ],
              set: { required: row.required },
            });
        } else {
          await tx.insert(deploymentEnvelopeResources).values(row)
            .onConflictDoNothing();
        }
      }
      if (delta.capabilities.length > 0) {
        await tx.insert(deploymentEnvelopeCapabilities).values(
          delta.capabilities.map((capability) => ({
            deploymentId: envelope.deploymentId,
            capability,
          })),
        ).onConflictDoNothing();
      }

      for (const binding of resourceBindings) {
        await tx.insert(deploymentResourceBindings).values(binding)
          .onConflictDoUpdate({
            target: [
              deploymentResourceBindings.deploymentId,
              deploymentResourceBindings.resourceKind,
              deploymentResourceBindings.resourceAlias,
            ],
            set: {
              bindingJson: binding.bindingJson,
              limitsJson: binding.limitsJson,
              updatedAt: binding.updatedAt,
            },
          });
      }

      await tx.insert(deploymentContractEvidence).values(contractEvidence)
        .onConflictDoUpdate({
          target: [
            deploymentContractEvidence.deploymentId,
            deploymentContractEvidence.contractDigest,
          ],
          set: {
            contractId: contractEvidence.contractId,
            contractJson: contractEvidence.contractJson,
            lastSeenAt: contractEvidence.lastSeenAt,
          },
        });

      if (history !== undefined) {
        await tx.insert(envelopeHistoryEntries).values(history);
      }

      return true;
    });
  }

  /** Returns a bounded page of deployment envelopes ordered by deployment id. */
  async listPage(query: BoundedListQuery): Promise<DeploymentEnvelope[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deploymentEnvelopes).orderBy(
      deploymentEnvelopes.deploymentId,
    ).limit(limit).offset(offset);
    return await this.#decodeEnvelopeRows(rows);
  }

  /** Returns enabled deployment envelopes ordered by deployment id. */
  async listEnabled(): Promise<DeploymentEnvelope[]> {
    const rows = await this.#db.select().from(deploymentEnvelopes).where(
      eq(deploymentEnvelopes.disabled, false),
    ).orderBy(deploymentEnvelopes.deploymentId);
    return await this.#decodeEnvelopeRows(rows);
  }

  /** Returns deployment envelopes matching indexed header filters. */
  async listFiltered(filters: {
    kind?: string;
    disabled?: boolean;
  }, query: BoundedListQuery): Promise<DeploymentEnvelope[]> {
    const { offset, limit } = boundedListQuery(query);
    const conditions: SQL[] = [];
    if (filters.kind !== undefined) {
      conditions.push(eq(deploymentEnvelopes.kind, filters.kind));
    }
    if (filters.disabled !== undefined) {
      conditions.push(eq(deploymentEnvelopes.disabled, filters.disabled));
    }
    if (conditions.length === 0) return await this.listPage(query);
    const rows = await this.#db.select().from(deploymentEnvelopes).where(
      and(...conditions),
    ).orderBy(deploymentEnvelopes.deploymentId).limit(limit).offset(offset);
    return await this.#decodeEnvelopeRows(rows);
  }

  /** Returns a counted page of deployment envelopes matching indexed header filters. */
  async listFilteredPage(filters: {
    kind?: string;
    disabled?: boolean;
  }, query: BoundedListQuery): Promise<ListPage<DeploymentEnvelope>> {
    const conditions: SQL[] = [];
    if (filters.kind !== undefined) {
      conditions.push(eq(deploymentEnvelopes.kind, filters.kind));
    }
    if (filters.disabled !== undefined) {
      conditions.push(eq(deploymentEnvelopes.disabled, filters.disabled));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      deploymentEnvelopes,
    ).where(where);
    const rows = await this.#db.select().from(deploymentEnvelopes).where(where)
      .orderBy(deploymentEnvelopes.deploymentId).limit(limit).offset(offset);
    return listPage(
      await this.#decodeEnvelopeRows(rows),
      countRow?.count ?? 0,
      query,
    );
  }

  /** Returns enabled envelopes where the boundary references a contract id. */
  async listEnabledByContractId(
    contractId: string,
  ): Promise<DeploymentEnvelope[]> {
    const [contractRows, surfaceRows] = await Promise.all([
      this.#db.select({
        deploymentId: deploymentEnvelopeContracts.deploymentId,
      })
        .from(deploymentEnvelopeContracts).where(
          eq(deploymentEnvelopeContracts.contractId, contractId),
        ),
      this.#db.select({ deploymentId: deploymentEnvelopeSurfaces.deploymentId })
        .from(deploymentEnvelopeSurfaces).where(
          eq(deploymentEnvelopeSurfaces.contractId, contractId),
        ),
    ]);
    const deploymentIds = [
      ...new Set([
        ...contractRows.map((row) => row.deploymentId),
        ...surfaceRows.map((row) => row.deploymentId),
      ]),
    ];
    return await this.#listEnabledByDeploymentIds(deploymentIds);
  }

  /** Returns enabled envelopes exposing a specific contract surface. */
  async listEnabledBySurface(args: {
    contractId: string;
    kind: string;
    name: string;
    action: string;
  }): Promise<DeploymentEnvelope[]> {
    const rows = await this.#db.select({
      deploymentId: deploymentEnvelopeSurfaces.deploymentId,
    }).from(deploymentEnvelopeSurfaces).where(
      and(
        eq(deploymentEnvelopeSurfaces.contractId, args.contractId),
        eq(deploymentEnvelopeSurfaces.surfaceKind, args.kind),
        eq(deploymentEnvelopeSurfaces.surfaceName, args.name),
        eq(deploymentEnvelopeSurfaces.action, args.action),
      ),
    );
    return await this.#listEnabledByDeploymentIds(
      rows.map((row) => row.deploymentId),
    );
  }

  async #boundaryForDeployment(
    deploymentId: string,
  ): Promise<EnvelopeBoundary> {
    const boundaries = await this.#boundariesForDeployments([deploymentId]);
    const boundary = boundaries.get(deploymentId);
    if (boundary === undefined) {
      return Value.Decode(EnvelopeBoundarySchema, {
        contracts: [],
        surfaces: [],
        capabilities: [],
        resources: [],
      });
    }
    return boundary;
  }

  async #listEnabledByDeploymentIds(
    deploymentIds: Iterable<string>,
  ): Promise<DeploymentEnvelope[]> {
    const requested = [...new Set(deploymentIds)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select().from(deploymentEnvelopes).where(
      and(
        inArray(deploymentEnvelopes.deploymentId, requested),
        eq(deploymentEnvelopes.disabled, false),
      ),
    ).orderBy(deploymentEnvelopes.deploymentId);
    return await this.#decodeEnvelopeRows(rows);
  }

  async #decodeEnvelopeRows(
    rows: EnvelopeHeaderRow[],
  ): Promise<DeploymentEnvelope[]> {
    const boundaries = await this.#boundariesForDeployments(
      rows.map((row) => row.deploymentId),
    );
    return rows.map((row) =>
      decodeEnvelope(
        row,
        boundaries.get(row.deploymentId) ??
          Value.Decode(EnvelopeBoundarySchema, {
            contracts: [],
            surfaces: [],
            capabilities: [],
            resources: [],
          }),
      )
    );
  }

  async #boundariesForDeployments(
    deploymentIds: Iterable<string>,
  ): Promise<Map<string, EnvelopeBoundary>> {
    const requested = [...new Set(deploymentIds)];
    const boundaries = new Map<string, BoundaryParts>();
    const getBoundary = (deploymentId: string): BoundaryParts => {
      let boundary = boundaries.get(deploymentId);
      if (boundary === undefined) {
        boundary = {
          contracts: [],
          surfaces: [],
          capabilities: [],
          resources: [],
        };
        boundaries.set(deploymentId, boundary);
      }
      return boundary;
    };
    for (const deploymentId of requested) getBoundary(deploymentId);
    if (requested.length === 0) return new Map();

    const [contracts, surfaces, resources, capabilities] = await Promise.all([
      this.#db.select().from(deploymentEnvelopeContracts).where(
        inArray(deploymentEnvelopeContracts.deploymentId, requested),
      ).orderBy(
        deploymentEnvelopeContracts.deploymentId,
        deploymentEnvelopeContracts.contractId,
      ),
      this.#db.select().from(deploymentEnvelopeSurfaces).where(
        inArray(deploymentEnvelopeSurfaces.deploymentId, requested),
      ).orderBy(
        deploymentEnvelopeSurfaces.deploymentId,
        deploymentEnvelopeSurfaces.contractId,
        deploymentEnvelopeSurfaces.surfaceKind,
        deploymentEnvelopeSurfaces.surfaceName,
        deploymentEnvelopeSurfaces.action,
      ),
      this.#db.select().from(deploymentEnvelopeResources).where(
        inArray(deploymentEnvelopeResources.deploymentId, requested),
      ).orderBy(
        deploymentEnvelopeResources.deploymentId,
        deploymentEnvelopeResources.resourceKind,
        deploymentEnvelopeResources.resourceAlias,
      ),
      this.#db.select().from(deploymentEnvelopeCapabilities).where(
        inArray(deploymentEnvelopeCapabilities.deploymentId, requested),
      ).orderBy(
        deploymentEnvelopeCapabilities.deploymentId,
        deploymentEnvelopeCapabilities.capability,
      ),
    ]);

    for (const contract of contracts) {
      getBoundary(contract.deploymentId).contracts.push({
        contractId: contract.contractId,
        required: contract.required,
      });
    }
    for (const surface of surfaces) {
      getBoundary(surface.deploymentId).surfaces.push({
        contractId: surface.contractId,
        kind: surface.surfaceKind,
        name: surface.surfaceName,
        action: surface.action,
        required: surface.required,
      });
    }
    for (const resource of resources) {
      getBoundary(resource.deploymentId).resources.push({
        kind: resource.resourceKind,
        alias: resource.resourceAlias,
        required: resource.required,
      });
    }
    for (const capability of capabilities) {
      getBoundary(capability.deploymentId).capabilities.push(
        capability.capability,
      );
    }

    const decoded = new Map<string, EnvelopeBoundary>();
    for (const [deploymentId, boundary] of boundaries) {
      decoded.set(deploymentId, Value.Decode(EnvelopeBoundarySchema, boundary));
    }
    return decoded;
  }
}

/** Stores append-only envelope authority audit entries in SQL. */
export class SqlEnvelopeHistoryRepository {
  readonly #db: TrellisStorageDb;

  /** Creates an envelope history repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Appends one envelope history entry. */
  async put(record: EnvelopeHistoryEntry): Promise<void> {
    await this.#db.insert(envelopeHistoryEntries).values(
      encodeHistoryEntry(record),
    );
  }

  /** Lists envelope history entries for one scope ordered by append time. */
  async listByScope(
    scopeKind: EnvelopeHistoryEntry["scopeKind"],
    scopeId: string,
    query: BoundedListQuery,
  ): Promise<EnvelopeHistoryEntry[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(envelopeHistoryEntries).where(
      and(
        eq(envelopeHistoryEntries.scopeKind, scopeKind),
        eq(envelopeHistoryEntries.scopeId, scopeId),
      ),
    ).orderBy(
      envelopeHistoryEntries.createdAt,
      envelopeHistoryEntries.entryId,
    ).limit(limit).offset(offset);
    return rows.map(decodeHistoryEntry);
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
    const row = rows[0];
    return row === undefined ? undefined : decodePortalRouteRow(row);
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

  /** Updates a deployment portal route. */
  async update(record: DeploymentPortalRoute): Promise<void> {
    await this.put(record);
  }

  /** Returns a bounded page of portal routes ordered by deployment id. */
  async listPage(query: BoundedListQuery): Promise<DeploymentPortalRoute[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deploymentPortalRoutes).orderBy(
      deploymentPortalRoutes.deploymentId,
    ).limit(limit).offset(offset);
    return rows.map((row) => decodePortalRouteRow(row));
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
    const row = rows[0];
    return row === undefined ? undefined : decodePortalRouteRow(row);
  }
}

/** Stores modeled deployment grant overrides in SQL. */
export class SqlDeploymentGrantOverrideRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a grant override repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Replaces all grant overrides for one deployment atomically. */
  async replaceForDeployment(
    deploymentId: string,
    records: DeploymentGrantOverride[],
  ): Promise<void> {
    const rows = records.map((record) => encodeGrantOverride(record));
    for (const row of rows) {
      if (row.deploymentId !== deploymentId) {
        throw new Error("Grant override deployment id mismatch");
      }
    }
    await this.#db.transaction(async (tx) => {
      await tx.delete(deploymentGrantOverrides).where(
        eq(deploymentGrantOverrides.deploymentId, deploymentId),
      );
      if (rows.length > 0) {
        await tx.insert(deploymentGrantOverrides).values(rows);
      }
    });
  }

  /** Updates grant overrides for one deployment atomically. */
  async updateForDeployment(
    deploymentId: string,
    records: DeploymentGrantOverride[],
  ): Promise<void> {
    await this.replaceForDeployment(deploymentId, records);
  }

  /** Returns grant overrides for one deployment in deterministic order. */
  async listByDeployment(
    deploymentId: string,
  ): Promise<DeploymentGrantOverride[]> {
    const rows = await this.#db.select().from(deploymentGrantOverrides).where(
      eq(deploymentGrantOverrides.deploymentId, deploymentId),
    ).orderBy(
      deploymentGrantOverrides.grantKind,
      deploymentGrantOverrides.capability,
      deploymentGrantOverrides.capabilityGroupKey,
      deploymentGrantOverrides.identityKind,
      deploymentGrantOverrides.contractId,
      deploymentGrantOverrides.origin,
      deploymentGrantOverrides.sessionPublicKey,
    );
    return rows.map((row) => decodeGrantOverrideRow(row));
  }

  /** Returns a bounded page of grant overrides in deterministic order. */
  async listPage(query: BoundedListQuery): Promise<DeploymentGrantOverride[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deploymentGrantOverrides).orderBy(
      deploymentGrantOverrides.deploymentId,
      deploymentGrantOverrides.grantKind,
      deploymentGrantOverrides.capability,
      deploymentGrantOverrides.capabilityGroupKey,
      deploymentGrantOverrides.identityKind,
      deploymentGrantOverrides.contractId,
      deploymentGrantOverrides.origin,
      deploymentGrantOverrides.sessionPublicKey,
      deploymentGrantOverrides.grantKey,
    ).limit(limit).offset(offset);
    return rows.map((row) => decodeGrantOverrideRow(row));
  }

  /** Returns a counted bounded page of grant overrides in deterministic order. */
  async listCountedPage(
    query: BoundedListQuery,
  ): Promise<ListPage<DeploymentGrantOverride>> {
    const [countRow, entries] = await Promise.all([
      this.#db.select({ count: count() }).from(deploymentGrantOverrides),
      this.listPage(query),
    ]);
    return listPage(entries, countRow[0]?.count ?? 0, query);
  }
}

/** Stores deployment-owned resource bindings in SQL. */
export class SqlDeploymentResourceBindingRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a resource binding repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a resource binding by deployment, kind, and alias. */
  async get(
    deploymentId: string,
    kind: string,
    alias: string,
  ): Promise<DeploymentResourceBinding | undefined> {
    const rows = await this.#db.select().from(deploymentResourceBindings).where(
      and(
        eq(deploymentResourceBindings.deploymentId, deploymentId),
        eq(deploymentResourceBindings.resourceKind, kind),
        eq(deploymentResourceBindings.resourceAlias, alias),
      ),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeResourceBindingRow(row);
  }

  /** Inserts or replaces a deployment-owned resource binding. */
  async put(record: DeploymentResourceBinding): Promise<void> {
    const row = encodeResourceBinding(record);
    await this.#db.insert(deploymentResourceBindings).values(row)
      .onConflictDoUpdate({
        target: [
          deploymentResourceBindings.deploymentId,
          deploymentResourceBindings.resourceKind,
          deploymentResourceBindings.resourceAlias,
        ],
        set: {
          bindingJson: row.bindingJson,
          limitsJson: row.limitsJson,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      });
  }

  /** Updates a deployment-owned resource binding. */
  async update(record: DeploymentResourceBinding): Promise<void> {
    await this.put(record);
  }

  /** Returns resource bindings for one deployment in deterministic order. */
  async listByDeployment(
    deploymentId: string,
  ): Promise<DeploymentResourceBinding[]> {
    const rows = await this.#db.select().from(deploymentResourceBindings).where(
      eq(deploymentResourceBindings.deploymentId, deploymentId),
    ).orderBy(
      deploymentResourceBindings.resourceKind,
      deploymentResourceBindings.resourceAlias,
    );
    return rows.map((row) => decodeResourceBindingRow(row));
  }

  /** Returns a bounded page of resource bindings in deterministic order. */
  async listPage(
    query: BoundedListQuery,
  ): Promise<DeploymentResourceBinding[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deploymentResourceBindings)
      .orderBy(
        deploymentResourceBindings.deploymentId,
        deploymentResourceBindings.resourceKind,
        deploymentResourceBindings.resourceAlias,
      ).limit(limit).offset(offset);
    return rows.map((row) => decodeResourceBindingRow(row));
  }
}

/** Stores deployment contract evidence JSON in SQL. */
export class SqlDeploymentContractEvidenceRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a contract evidence repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns contract evidence by deployment and digest. */
  async get(
    deploymentId: string,
    contractDigest: string,
  ): Promise<DeploymentContractEvidence | undefined> {
    const rows = await this.#db.select().from(deploymentContractEvidence).where(
      and(
        eq(deploymentContractEvidence.deploymentId, deploymentId),
        eq(deploymentContractEvidence.contractDigest, contractDigest),
      ),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeContractEvidenceRow(row);
  }

  /** Returns contract evidence rows for a digest ordered by deployment id. */
  async listByDigest(
    contractDigest: string,
  ): Promise<DeploymentContractEvidence[]> {
    const rows = await this.#db.select().from(deploymentContractEvidence).where(
      eq(deploymentContractEvidence.contractDigest, contractDigest),
    ).orderBy(
      deploymentContractEvidence.deploymentId,
      deploymentContractEvidence.contractId,
    );
    return rows.map((row) => decodeContractEvidenceRow(row));
  }

  /** Returns contract evidence rows for the requested digests. */
  async listByDigests(
    contractDigests: Iterable<string>,
  ): Promise<DeploymentContractEvidence[]> {
    const requested = [...new Set(contractDigests)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select().from(deploymentContractEvidence).where(
      inArray(deploymentContractEvidence.contractDigest, requested),
    ).orderBy(
      deploymentContractEvidence.contractDigest,
      deploymentContractEvidence.deploymentId,
      deploymentContractEvidence.contractId,
    );
    return rows.map((row) => decodeContractEvidenceRow(row));
  }

  /** Returns contract evidence rows for a contract id ordered by digest. */
  async listByContractId(
    contractId: string,
  ): Promise<DeploymentContractEvidence[]> {
    const rows = await this.#db.select().from(deploymentContractEvidence).where(
      eq(deploymentContractEvidence.contractId, contractId),
    ).orderBy(
      deploymentContractEvidence.contractDigest,
      deploymentContractEvidence.deploymentId,
    );
    return rows.map((row) => decodeContractEvidenceRow(row));
  }

  /** Returns evidence for deployments that have seen a contract id. */
  async listByDeploymentsAndContractId(
    deploymentIds: Iterable<string>,
    contractId: string,
  ): Promise<DeploymentContractEvidence[]> {
    const requested = [...new Set(deploymentIds)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select().from(deploymentContractEvidence).where(
      and(
        inArray(deploymentContractEvidence.deploymentId, requested),
        eq(deploymentContractEvidence.contractId, contractId),
      ),
    ).orderBy(
      deploymentContractEvidence.deploymentId,
      deploymentContractEvidence.contractDigest,
    );
    return rows.map((row) => decodeContractEvidenceRow(row));
  }

  /** Returns evidence for requested deployments ordered by deployment and digest. */
  async listByDeployments(
    deploymentIds: Iterable<string>,
  ): Promise<DeploymentContractEvidence[]> {
    const requested = [...new Set(deploymentIds)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select().from(deploymentContractEvidence).where(
      inArray(deploymentContractEvidence.deploymentId, requested),
    ).orderBy(
      deploymentContractEvidence.deploymentId,
      deploymentContractEvidence.contractId,
      deploymentContractEvidence.contractDigest,
    );
    return rows.map((row) => decodeContractEvidenceRow(row));
  }

  /** Inserts or replaces deployment contract evidence. */
  async put(record: DeploymentContractEvidence): Promise<void> {
    const row = encodeContractEvidence(record);
    await this.#db.insert(deploymentContractEvidence).values(row)
      .onConflictDoUpdate({
        target: [
          deploymentContractEvidence.deploymentId,
          deploymentContractEvidence.contractDigest,
        ],
        set: {
          contractId: row.contractId,
          contractJson: row.contractJson,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          ignoredAt: row.ignoredAt,
          ignoredByJson: row.ignoredByJson,
          ignoreReason: row.ignoreReason,
        },
      });
  }

  /** Deletes selected deployment contract evidence rows for one contract id. */
  async deleteEvidence(args: {
    contractId: string;
    contractDigests: Iterable<string>;
  }): Promise<DeploymentContractEvidence[]> {
    const contractDigests = [...new Set(args.contractDigests)];
    if (contractDigests.length === 0) return [];
    const where = and(
      eq(deploymentContractEvidence.contractId, args.contractId),
      inArray(deploymentContractEvidence.contractDigest, contractDigests),
    );
    const rows = await this.#db.select().from(deploymentContractEvidence).where(
      where,
    ).orderBy(
      deploymentContractEvidence.deploymentId,
      deploymentContractEvidence.contractId,
      deploymentContractEvidence.contractDigest,
    );
    await this.#db.delete(deploymentContractEvidence).where(where);
    return rows.map((row) => decodeContractEvidenceRow(row));
  }

  /** Updates deployment contract evidence. */
  async update(record: DeploymentContractEvidence): Promise<void> {
    await this.put(record);
  }

  /** Returns contract evidence for one deployment ordered by contract id and digest. */
  async listByDeployment(
    deploymentId: string,
  ): Promise<DeploymentContractEvidence[]> {
    const rows = await this.#db.select().from(deploymentContractEvidence).where(
      eq(deploymentContractEvidence.deploymentId, deploymentId),
    ).orderBy(
      deploymentContractEvidence.contractId,
      deploymentContractEvidence.contractDigest,
    );
    return rows.map((row) => decodeContractEvidenceRow(row));
  }

  /** Returns a bounded page of contract evidence ordered by deployment, contract id, and digest. */
  async listPage(
    query: BoundedListQuery,
  ): Promise<DeploymentContractEvidence[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deploymentContractEvidence)
      .orderBy(
        deploymentContractEvidence.deploymentId,
        deploymentContractEvidence.contractId,
        deploymentContractEvidence.contractDigest,
      ).limit(limit).offset(offset);
    return rows.map((row) => decodeContractEvidenceRow(row));
  }
}

/** Stores envelope expansion requests and modeled delta rows in SQL. */
export class SqlEnvelopeExpansionRequestRepository {
  readonly #db: TrellisStorageDb;

  /** Creates an expansion request repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns an expansion request by request id, or undefined when absent. */
  async get(requestId: string): Promise<EnvelopeExpansionRequest | undefined> {
    const rows = await this.#db.select().from(envelopeExpansionRequests).where(
      eq(envelopeExpansionRequests.requestId, requestId),
    ).limit(1);
    const row = rows[0];
    if (row === undefined) return undefined;
    return decodeExpansionRequest(row, await this.#deltaForRequest(requestId));
  }

  /** Inserts or replaces an expansion request and all modeled delta rows atomically. */
  async put(record: EnvelopeExpansionRequest): Promise<void> {
    const decoded = Value.Decode(EnvelopeExpansionRequestSchema, record);
    const row = encodeExpansionRequest(decoded);
    await this.#db.transaction(async (tx) => {
      await tx.insert(envelopeExpansionRequests).values(row).onConflictDoUpdate(
        {
          target: envelopeExpansionRequests.requestId,
          set: {
            deploymentId: row.deploymentId,
            requestedByKind: row.requestedByKind,
            requestedByJson: row.requestedByJson,
            contractId: row.contractId,
            contractDigest: row.contractDigest,
            contractJson: row.contractJson,
            state: row.state,
            createdAt: row.createdAt,
            decidedAt: row.decidedAt,
            decidedByJson: row.decidedByJson,
            decisionReason: row.decisionReason,
          },
        },
      );
      await tx.delete(envelopeExpansionRequestContracts).where(
        eq(envelopeExpansionRequestContracts.requestId, decoded.requestId),
      );
      await tx.delete(envelopeExpansionRequestSurfaces).where(
        eq(envelopeExpansionRequestSurfaces.requestId, decoded.requestId),
      );
      await tx.delete(envelopeExpansionRequestResources).where(
        eq(envelopeExpansionRequestResources.requestId, decoded.requestId),
      );
      await tx.delete(envelopeExpansionRequestCapabilities).where(
        eq(envelopeExpansionRequestCapabilities.requestId, decoded.requestId),
      );
      if (decoded.delta.contracts.length > 0) {
        await tx.insert(envelopeExpansionRequestContracts).values(
          decoded.delta.contracts.map((contract) => ({
            requestId: decoded.requestId,
            contractId: contract.contractId,
            required: contract.required,
          })),
        );
      }
      if (decoded.delta.surfaces.length > 0) {
        await tx.insert(envelopeExpansionRequestSurfaces).values(
          decoded.delta.surfaces.map((surface) => ({
            requestId: decoded.requestId,
            contractId: surface.contractId,
            surfaceKind: surface.kind,
            surfaceName: surface.name,
            action: surface.action,
            required: surface.required,
          })),
        );
      }
      if (decoded.delta.resources.length > 0) {
        await tx.insert(envelopeExpansionRequestResources).values(
          decoded.delta.resources.map((resource) => ({
            requestId: decoded.requestId,
            resourceKind: resource.kind,
            resourceAlias: resource.alias,
            required: resource.required,
          })),
        );
      }
      if (decoded.delta.capabilities.length > 0) {
        await tx.insert(envelopeExpansionRequestCapabilities).values(
          decoded.delta.capabilities.map((capability) => ({
            requestId: decoded.requestId,
            capability,
          })),
        );
      }
    });
  }

  /** Inserts a pending expansion request or returns the existing equivalent one. */
  async putPending(
    record: EnvelopeExpansionRequest,
  ): Promise<EnvelopeExpansionRequest> {
    const decoded = Value.Decode(EnvelopeExpansionRequestSchema, record);
    if (decoded.state !== "pending") {
      throw new Error("putPending requires a pending expansion request");
    }
    const row = encodeExpansionRequest(decoded);
    await this.#db.transaction(async (tx) => {
      const inserted = await tx.insert(envelopeExpansionRequests).values(row)
        .onConflictDoNothing({
          target: envelopeExpansionRequests.pendingKey,
        }).returning({ requestId: envelopeExpansionRequests.requestId });
      if (inserted.length === 0) return;

      if (decoded.delta.contracts.length > 0) {
        await tx.insert(envelopeExpansionRequestContracts).values(
          decoded.delta.contracts.map((contract) => ({
            requestId: decoded.requestId,
            contractId: contract.contractId,
            required: contract.required,
          })),
        );
      }
      if (decoded.delta.surfaces.length > 0) {
        await tx.insert(envelopeExpansionRequestSurfaces).values(
          decoded.delta.surfaces.map((surface) => ({
            requestId: decoded.requestId,
            contractId: surface.contractId,
            surfaceKind: surface.kind,
            surfaceName: surface.name,
            action: surface.action,
            required: surface.required,
          })),
        );
      }
      if (decoded.delta.resources.length > 0) {
        await tx.insert(envelopeExpansionRequestResources).values(
          decoded.delta.resources.map((resource) => ({
            requestId: decoded.requestId,
            resourceKind: resource.kind,
            resourceAlias: resource.alias,
            required: resource.required,
          })),
        );
      }
      if (decoded.delta.capabilities.length > 0) {
        await tx.insert(envelopeExpansionRequestCapabilities).values(
          decoded.delta.capabilities.map((capability) => ({
            requestId: decoded.requestId,
            capability,
          })),
        );
      }
    });

    if (row.pendingKey === null || row.pendingKey === undefined) {
      throw new Error("pending expansion request key was not derived");
    }
    const rows = await this.#db.select().from(envelopeExpansionRequests).where(
      eq(envelopeExpansionRequests.pendingKey, row.pendingKey),
    ).limit(1);
    const existing = rows[0];
    if (existing === undefined) {
      throw new Error("pending expansion request was not stored");
    }
    return decodeExpansionRequest(
      existing,
      await this.#deltaForRequest(existing.requestId),
    );
  }

  /** Updates an expansion request and all modeled delta rows atomically. */
  async update(record: EnvelopeExpansionRequest): Promise<void> {
    await this.put(record);
  }

  /** Updates only the decision state fields for an expansion request. */
  async updateState(
    record: EnvelopeExpansionRequestStateUpdate,
  ): Promise<boolean> {
    const decoded = Value.Decode(
      EnvelopeExpansionRequestStateUpdateSchema,
      record,
    );
    const updated = await this.#db.update(envelopeExpansionRequests).set({
      pendingKey: null,
      state: decoded.state,
      decidedAt: decoded.decidedAt,
      decidedByJson: decoded.decidedBy === null
        ? null
        : JSON.stringify(decoded.decidedBy),
      decisionReason: decoded.decisionReason,
    }).where(
      and(
        eq(envelopeExpansionRequests.requestId, decoded.requestId),
        eq(envelopeExpansionRequests.state, "pending"),
      ),
    ).returning({ requestId: envelopeExpansionRequests.requestId });
    return updated.length > 0;
  }

  /** Deletes pending service-originated expansion requests for one requester instance. */
  async deletePendingServiceRequestsByRequesterInstanceId(
    instanceId: string,
  ): Promise<number> {
    const pendingServiceRows = await this.#db.select().from(
      envelopeExpansionRequests,
    ).where(
      and(
        eq(envelopeExpansionRequests.requestedByKind, "service"),
        eq(envelopeExpansionRequests.state, "pending"),
      ),
    );
    const requestIds = pendingServiceRows.flatMap((row) => {
      const requestedBy = parseJsonField(
        "envelope expansion requester",
        row.requestedByJson,
      );
      return typeof requestedBy === "object" && requestedBy !== null &&
          "instanceId" in requestedBy && requestedBy.instanceId === instanceId
        ? [row.requestId]
        : [];
    });
    if (requestIds.length === 0) return 0;

    await this.#db.transaction(async (tx) => {
      await tx.delete(envelopeExpansionRequestContracts).where(
        inArray(envelopeExpansionRequestContracts.requestId, requestIds),
      );
      await tx.delete(envelopeExpansionRequestSurfaces).where(
        inArray(envelopeExpansionRequestSurfaces.requestId, requestIds),
      );
      await tx.delete(envelopeExpansionRequestResources).where(
        inArray(envelopeExpansionRequestResources.requestId, requestIds),
      );
      await tx.delete(envelopeExpansionRequestCapabilities).where(
        inArray(envelopeExpansionRequestCapabilities.requestId, requestIds),
      );
      await tx.delete(envelopeExpansionRequests).where(
        inArray(envelopeExpansionRequests.requestId, requestIds),
      );
    });

    return requestIds.length;
  }

  /** Returns expansion requests for one deployment ordered by creation time and id. */
  async listByDeployment(
    deploymentId: string,
  ): Promise<EnvelopeExpansionRequest[]> {
    const rows = await this.#db.select().from(envelopeExpansionRequests).where(
      eq(envelopeExpansionRequests.deploymentId, deploymentId),
    ).orderBy(
      envelopeExpansionRequests.createdAt,
      envelopeExpansionRequests.requestId,
    );
    const requests: EnvelopeExpansionRequest[] = [];
    for (const row of rows) {
      requests.push(
        decodeExpansionRequest(row, await this.#deltaForRequest(row.requestId)),
      );
    }
    return requests;
  }

  /** Returns expansion requests matching indexed filters. */
  async listFiltered(filters: {
    deploymentId?: string;
    state?: string;
  }, query: BoundedListQuery): Promise<EnvelopeExpansionRequest[]> {
    const { offset, limit } = boundedListQuery(query);
    const conditions: SQL[] = [];
    if (filters.deploymentId !== undefined) {
      conditions.push(
        eq(envelopeExpansionRequests.deploymentId, filters.deploymentId),
      );
    }
    if (filters.state !== undefined) {
      conditions.push(eq(envelopeExpansionRequests.state, filters.state));
    }
    if (conditions.length === 0) return await this.listPage(query);
    const rows = await this.#db.select().from(envelopeExpansionRequests).where(
      and(...conditions),
    ).orderBy(
      envelopeExpansionRequests.deploymentId,
      envelopeExpansionRequests.createdAt,
      envelopeExpansionRequests.requestId,
    ).limit(limit).offset(offset);
    const requests: EnvelopeExpansionRequest[] = [];
    for (const row of rows) {
      requests.push(
        decodeExpansionRequest(row, await this.#deltaForRequest(row.requestId)),
      );
    }
    return requests;
  }

  /** Returns a counted page of expansion requests matching indexed filters. */
  async listFilteredPage(filters: {
    deploymentId?: string;
    state?: string;
  }, query: BoundedListQuery): Promise<ListPage<EnvelopeExpansionRequest>> {
    const conditions: SQL[] = [];
    if (filters.deploymentId !== undefined) {
      conditions.push(
        eq(envelopeExpansionRequests.deploymentId, filters.deploymentId),
      );
    }
    if (filters.state !== undefined) {
      conditions.push(eq(envelopeExpansionRequests.state, filters.state));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      envelopeExpansionRequests,
    ).where(where);
    const rows = await this.#db.select().from(envelopeExpansionRequests).where(
      where,
    )
      .orderBy(
        envelopeExpansionRequests.deploymentId,
        envelopeExpansionRequests.createdAt,
        envelopeExpansionRequests.requestId,
      ).limit(limit).offset(offset);
    const requests: EnvelopeExpansionRequest[] = [];
    for (const row of rows) {
      requests.push(
        decodeExpansionRequest(row, await this.#deltaForRequest(row.requestId)),
      );
    }
    return listPage(requests, countRow?.count ?? 0, query);
  }

  /** Returns a bounded page of expansion requests ordered by deployment, creation time, and id. */
  async listPage(query: BoundedListQuery): Promise<EnvelopeExpansionRequest[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(envelopeExpansionRequests)
      .orderBy(
        envelopeExpansionRequests.deploymentId,
        envelopeExpansionRequests.createdAt,
        envelopeExpansionRequests.requestId,
      ).limit(limit).offset(offset);
    const requests: EnvelopeExpansionRequest[] = [];
    for (const row of rows) {
      requests.push(
        decodeExpansionRequest(row, await this.#deltaForRequest(row.requestId)),
      );
    }
    return requests;
  }

  async #deltaForRequest(requestId: string): Promise<EnvelopeBoundary> {
    const [contracts, surfaces, resources, capabilities] = await Promise.all([
      this.#db.select().from(envelopeExpansionRequestContracts).where(
        eq(envelopeExpansionRequestContracts.requestId, requestId),
      ).orderBy(envelopeExpansionRequestContracts.contractId),
      this.#db.select().from(envelopeExpansionRequestSurfaces).where(
        eq(envelopeExpansionRequestSurfaces.requestId, requestId),
      ).orderBy(
        envelopeExpansionRequestSurfaces.contractId,
        envelopeExpansionRequestSurfaces.surfaceKind,
        envelopeExpansionRequestSurfaces.surfaceName,
        envelopeExpansionRequestSurfaces.action,
      ),
      this.#db.select().from(envelopeExpansionRequestResources).where(
        eq(envelopeExpansionRequestResources.requestId, requestId),
      ).orderBy(
        envelopeExpansionRequestResources.resourceKind,
        envelopeExpansionRequestResources.resourceAlias,
      ),
      this.#db.select().from(envelopeExpansionRequestCapabilities).where(
        eq(envelopeExpansionRequestCapabilities.requestId, requestId),
      ).orderBy(envelopeExpansionRequestCapabilities.capability),
    ]);
    return Value.Decode(EnvelopeBoundarySchema, {
      contracts: contracts.map((contract) => ({
        contractId: contract.contractId,
        required: contract.required,
      })),
      surfaces: surfaces.map((surface) => ({
        contractId: surface.contractId,
        kind: surface.surfaceKind,
        name: surface.surfaceName,
        action: surface.action,
        required: surface.required,
      })),
      capabilities: capabilities.map((capability) => capability.capability),
      resources: resources.map((resource) => ({
        kind: resource.resourceKind,
        alias: resource.resourceAlias,
        required: resource.required,
      })),
    });
  }
}
