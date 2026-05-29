import type {
  AuthorityNeedSet,
  AuthorityNeedSetContract,
  AuthorityNeedSetResource,
  AuthorityNeedSetSurface,
  CapabilityGroup,
  DeploymentAuthorityGrantOverride,
} from "./schemas.ts";
import { resolveCapabilities } from "./capability_groups.ts";

export type GrantOverrideCapabilityGroupLoader = {
  get(groupKey: string): Promise<CapabilityGroup | undefined>;
};

const EMPTY_AUTHORITY_NEEDS: AuthorityNeedSet = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

export type AuthorityNeedsFitEvaluation = {
  fits: boolean;
  missingAvailability: AuthorityNeedSet;
  missingCapabilities: string[];
};

export type AuthorityIdentityAnchor =
  | { kind: "web"; contractId: string; origin: string }
  | { kind: "cli"; contractId: string; sessionPublicKey: string }
  | { kind: "native"; contractId: string; sessionPublicKey: string }
  | { kind: "device-user"; contractId: string; devicePublicKey: string };

export type DeploymentAuthorityRows = {
  contracts: Array<AuthorityNeedSetContract & { deploymentId: string }>;
  surfaces: Array<{
    deploymentId: string;
    contractId: string;
    kind: AuthorityNeedSetSurface["kind"];
    name: string;
    action: AuthorityNeedSetSurface["action"];
    required: boolean;
  }>;
  capabilities: Array<{ deploymentId: string; capability: string }>;
  resources: Array<{
    deploymentId: string;
    kind: AuthorityNeedSetResource["kind"];
    alias: string;
    required: boolean;
  }>;
};

export type AuthorityReductionDependent = {
  kind: string;
  id: string;
  needs: AuthorityNeedSet;
};

export type AuthorityReductionPendingProposal = {
  requestId: string;
  delta: AuthorityNeedSet;
};

export type AuthorityReductionResourceBinding = {
  kind: AuthorityNeedSetResource["kind"];
  alias: string;
};

export type AuthorityReductionImpact = {
  removed: AuthorityNeedSet;
  impactedDependents: Array<{
    kind: string;
    id: string;
    missing: AuthorityNeedSet;
  }>;
  orphanedResources: AuthorityReductionResourceBinding[];
  impactedPendingRequests: Array<{
    requestId: string;
    missing: AuthorityNeedSet;
  }>;
};

function contractKey(contract: AuthorityNeedSetContract): string {
  return contract.contractId;
}

function surfaceKey(surface: AuthorityNeedSetSurface): string {
  return [
    surface.contractId,
    surface.kind,
    surface.name,
    surface.action,
  ].join("\u001f");
}

function resourceKey(resource: AuthorityNeedSetResource): string {
  return [resource.kind, resource.alias].join("\u001f");
}

function coversRequired(existingRequired: boolean, requestedRequired: boolean) {
  return existingRequired || !requestedRequired;
}

function normalizeAuthorityNeeds(needs: AuthorityNeedSet): AuthorityNeedSet {
  const contracts = new Map<string, AuthorityNeedSetContract>();
  for (const contract of needs.contracts) {
    const key = contractKey(contract);
    const existing = contracts.get(key);
    contracts.set(key, {
      ...contract,
      required: (existing?.required ?? false) || contract.required,
    });
  }

  const surfaces = new Map<string, AuthorityNeedSetSurface>();
  for (const surface of needs.surfaces) {
    const key = surfaceKey(surface);
    const existing = surfaces.get(key);
    surfaces.set(key, {
      ...surface,
      required: (existing?.required ?? false) || surface.required,
    });
  }

  const resources = new Map<string, AuthorityNeedSetResource>();
  for (const resource of needs.resources) {
    const key = resourceKey(resource);
    const existing = resources.get(key);
    resources.set(key, {
      ...resource,
      required: (existing?.required ?? false) || resource.required,
    });
  }

  return {
    contracts: [...contracts.values()].sort((left, right) =>
      left.contractId.localeCompare(right.contractId) ||
      String(left.required).localeCompare(String(right.required))
    ),
    surfaces: [...surfaces.values()].sort((left, right) =>
      left.contractId.localeCompare(right.contractId) ||
      left.kind.localeCompare(right.kind) ||
      left.name.localeCompare(right.name) ||
      (left.action ?? "").localeCompare(right.action ?? "") ||
      String(left.required).localeCompare(String(right.required))
    ),
    capabilities: [...new Set(needs.capabilities)].sort(),
    resources: [...resources.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.alias.localeCompare(right.alias) ||
      String(left.required).localeCompare(String(right.required))
    ),
  };
}

function hasContract(
  desired: AuthorityNeedSet,
  requested: AuthorityNeedSetContract,
): boolean {
  return desired.contracts.some((contract) =>
    contract.contractId === requested.contractId &&
    coversRequired(contract.required, requested.required)
  );
}

function hasSurface(
  desired: AuthorityNeedSet,
  requested: AuthorityNeedSetSurface,
): boolean {
  return desired.surfaces.some((surface) =>
    surface.contractId === requested.contractId &&
    surface.kind === requested.kind &&
    surface.name === requested.name &&
    surface.action === requested.action &&
    coversRequired(surface.required, requested.required)
  );
}

function hasResource(
  desired: AuthorityNeedSet,
  requested: AuthorityNeedSetResource,
): boolean {
  return desired.resources.some((resource) =>
    resource.kind === requested.kind &&
    resource.alias === requested.alias &&
    coversRequired(resource.required, requested.required)
  );
}

function isEmptyAuthorityNeeds(needs: AuthorityNeedSet): boolean {
  return needs.contracts.length === 0 && needs.surfaces.length === 0 &&
    needs.capabilities.length === 0 && needs.resources.length === 0;
}

/** Computes requested needs and capabilities not covered by desired authority. */
export function computeAuthorityNeedsDelta(
  desired: AuthorityNeedSet,
  requested: AuthorityNeedSet,
): AuthorityNeedSet {
  const normalizedDesired = normalizeAuthorityNeeds(desired);
  const normalizedRequested = normalizeAuthorityNeeds(requested);
  const capabilities = new Set(normalizedDesired.capabilities);

  return normalizeAuthorityNeeds({
    contracts: normalizedRequested.contracts.filter((contract) =>
      !hasContract(normalizedDesired, contract)
    ),
    surfaces: normalizedRequested.surfaces.filter((surface) =>
      !hasSurface(normalizedDesired, surface)
    ),
    capabilities: normalizedRequested.capabilities.filter((capability) =>
      !capabilities.has(capability)
    ),
    resources: normalizedRequested.resources.filter((resource) =>
      !hasResource(normalizedDesired, resource)
    ),
  });
}

/** Evaluates whether requested needs fit deployment authority desired state. */
export function evaluateProposalNeedsFit(
  desired: AuthorityNeedSet,
  requested: AuthorityNeedSet,
): AuthorityNeedsFitEvaluation {
  const delta = computeAuthorityNeedsDelta(desired, requested);
  const missingAvailability = normalizeAuthorityNeeds({
    ...EMPTY_AUTHORITY_NEEDS,
    contracts: delta.contracts,
    surfaces: delta.surfaces,
    resources: delta.resources,
  });

  return {
    fits: isEmptyAuthorityNeeds(delta),
    missingAvailability,
    missingCapabilities: delta.capabilities,
  };
}

function overrideMatchesIdentity(
  override: DeploymentAuthorityGrantOverride,
  identity: AuthorityIdentityAnchor,
): boolean {
  if (override.contractId !== identity.contractId) return false;
  if (override.identityKind === "web") {
    return identity.kind === "web" && override.origin === identity.origin;
  }
  return "sessionPublicKey" in identity &&
    override.sessionPublicKey === identity.sessionPublicKey;
}

/** Applies matching deployment grant overrides as capability overlays only. */
export async function applyGrantOverrideAuthorityCapabilities(
  desired: AuthorityNeedSet,
  overrides: DeploymentAuthorityGrantOverride[],
  identity: AuthorityIdentityAnchor,
  capabilityGroupStorage?: GrantOverrideCapabilityGroupLoader,
): Promise<AuthorityNeedSet> {
  const matchingOverrides = overrides.filter((override) =>
    overrideMatchesIdentity(override, identity)
  );
  const concreteCapabilities = matchingOverrides.flatMap((override) =>
    override.grantKind === "capability" ? [override.capability] : []
  );
  const capabilityGroups = matchingOverrides.flatMap((override) =>
    override.grantKind === "capability-group"
      ? [override.capabilityGroupKey]
      : []
  );
  const groupCapabilities = await resolveCapabilities({
    capabilities: [],
    capabilityGroups,
  }, capabilityGroupStorage);
  const capabilities = [
    ...desired.capabilities,
    ...concreteCapabilities,
    ...groupCapabilities,
  ];
  return normalizeAuthorityNeeds({ ...desired, capabilities });
}

/** Converts in-memory authority needs to deterministic modeled child rows. */
export function authorityNeedsToDeploymentAuthorityRows(
  deploymentId: string,
  needs: AuthorityNeedSet,
): DeploymentAuthorityRows {
  const normalized = normalizeAuthorityNeeds(needs);
  return {
    contracts: normalized.contracts.map((contract) => ({
      deploymentId,
      ...contract,
    })),
    surfaces: normalized.surfaces.map((surface) => ({
      deploymentId,
      ...surface,
      action: surface.action,
    })),
    capabilities: normalized.capabilities.map((capability) => ({
      deploymentId,
      capability,
    })),
    resources: normalized.resources.map((resource) => ({
      deploymentId,
      ...resource,
    })),
  };
}

/**
 * Previews which dependent need sets, proposals, and resources a reduction would
 * leave uncovered. Resource bindings are reported as orphaned, not deleted.
 */
export function previewAuthorityReductionImpact(input: {
  current: AuthorityNeedSet;
  proposed: AuthorityNeedSet;
  dependents?: AuthorityReductionDependent[];
  resourceBindings?: AuthorityReductionResourceBinding[];
  pendingRequests?: AuthorityReductionPendingProposal[];
}): AuthorityReductionImpact {
  const removed = computeAuthorityNeedsDelta(input.proposed, input.current);
  const impactedDependents = (input.dependents ?? [])
    .map((dependent) => ({
      kind: dependent.kind,
      id: dependent.id,
      missing: computeAuthorityNeedsDelta(input.proposed, dependent.needs),
    }))
    .filter((impact) => !isEmptyAuthorityNeeds(impact.missing));
  const impactedPendingRequests = (input.pendingRequests ?? [])
    .map((request) => ({
      requestId: request.requestId,
      missing: computeAuthorityNeedsDelta(input.proposed, request.delta),
    }))
    .filter((impact) => !isEmptyAuthorityNeeds(impact.missing));
  const removedResources = new Set(
    removed.resources.map((resource) => resourceKey(resource)),
  );

  return {
    removed,
    impactedDependents,
    orphanedResources: (input.resourceBindings ?? [])
      .filter((resource) =>
        removedResources.has([resource.kind, resource.alias].join("\u001f"))
      )
      .sort((left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.alias.localeCompare(right.alias)
      ),
    impactedPendingRequests,
  };
}
