import type {
  CapabilityGroup,
  DeploymentGrantOverride,
  EnvelopeBoundary,
  EnvelopeBoundaryContract,
  EnvelopeBoundaryResource,
  EnvelopeBoundarySurface,
} from "./schemas.ts";
import { resolveCapabilities } from "./capability_groups.ts";

export type GrantOverrideCapabilityGroupLoader = {
  get(groupKey: string): Promise<CapabilityGroup | undefined>;
};

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

export type EnvelopeFitEvaluation = {
  fits: boolean;
  missingAvailability: EnvelopeBoundary;
  missingCapabilities: string[];
};

export type EnvelopeIdentityAnchor =
  | { kind: "web"; contractId: string; origin: string }
  | { kind: "cli"; contractId: string; sessionPublicKey: string }
  | { kind: "native"; contractId: string; sessionPublicKey: string }
  | { kind: "device-user"; contractId: string; devicePublicKey: string };

export type DeploymentEnvelopeRows = {
  contracts: Array<EnvelopeBoundaryContract & { deploymentId: string }>;
  surfaces: Array<{
    deploymentId: string;
    contractId: string;
    kind: EnvelopeBoundarySurface["kind"];
    name: string;
    action: EnvelopeBoundarySurface["action"];
    required: boolean;
  }>;
  capabilities: Array<{ deploymentId: string; capability: string }>;
  resources: Array<{
    deploymentId: string;
    kind: EnvelopeBoundaryResource["kind"];
    alias: string;
    required: boolean;
  }>;
};

export type ShrinkDependent = {
  kind: string;
  id: string;
  boundary: EnvelopeBoundary;
};

export type ShrinkPendingRequest = {
  requestId: string;
  delta: EnvelopeBoundary;
};

export type ShrinkResourceBinding = {
  kind: EnvelopeBoundaryResource["kind"];
  alias: string;
};

export type EnvelopeShrinkImpact = {
  removed: EnvelopeBoundary;
  impactedDependents: Array<{
    kind: string;
    id: string;
    missing: EnvelopeBoundary;
  }>;
  orphanedResources: ShrinkResourceBinding[];
  impactedPendingRequests: Array<{
    requestId: string;
    missing: EnvelopeBoundary;
  }>;
};

function contractKey(contract: EnvelopeBoundaryContract): string {
  return contract.contractId;
}

function surfaceKey(surface: EnvelopeBoundarySurface): string {
  return [
    surface.contractId,
    surface.kind,
    surface.name,
    surface.action,
  ].join("\u001f");
}

function resourceKey(resource: EnvelopeBoundaryResource): string {
  return [resource.kind, resource.alias].join("\u001f");
}

function coversRequired(existingRequired: boolean, requestedRequired: boolean) {
  return existingRequired || !requestedRequired;
}

function normalizeBoundary(boundary: EnvelopeBoundary): EnvelopeBoundary {
  const contracts = new Map<string, EnvelopeBoundaryContract>();
  for (const contract of boundary.contracts) {
    const key = contractKey(contract);
    const existing = contracts.get(key);
    contracts.set(key, {
      ...contract,
      required: (existing?.required ?? false) || contract.required,
    });
  }

  const surfaces = new Map<string, EnvelopeBoundarySurface>();
  for (const surface of boundary.surfaces) {
    const key = surfaceKey(surface);
    const existing = surfaces.get(key);
    surfaces.set(key, {
      ...surface,
      required: (existing?.required ?? false) || surface.required,
    });
  }

  const resources = new Map<string, EnvelopeBoundaryResource>();
  for (const resource of boundary.resources) {
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
      left.action.localeCompare(right.action) ||
      String(left.required).localeCompare(String(right.required))
    ),
    capabilities: [...new Set(boundary.capabilities)].sort(),
    resources: [...resources.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.alias.localeCompare(right.alias) ||
      String(left.required).localeCompare(String(right.required))
    ),
  };
}

function hasContract(
  envelope: EnvelopeBoundary,
  requested: EnvelopeBoundaryContract,
): boolean {
  return envelope.contracts.some((contract) =>
    contract.contractId === requested.contractId &&
    coversRequired(contract.required, requested.required)
  );
}

function hasSurface(
  envelope: EnvelopeBoundary,
  requested: EnvelopeBoundarySurface,
): boolean {
  return envelope.surfaces.some((surface) =>
    surface.contractId === requested.contractId &&
    surface.kind === requested.kind &&
    surface.name === requested.name &&
    surface.action === requested.action &&
    coversRequired(surface.required, requested.required)
  );
}

function hasResource(
  envelope: EnvelopeBoundary,
  requested: EnvelopeBoundaryResource,
): boolean {
  return envelope.resources.some((resource) =>
    resource.kind === requested.kind &&
    resource.alias === requested.alias &&
    coversRequired(resource.required, requested.required)
  );
}

function isEmptyBoundary(boundary: EnvelopeBoundary): boolean {
  return boundary.contracts.length === 0 && boundary.surfaces.length === 0 &&
    boundary.capabilities.length === 0 && boundary.resources.length === 0;
}

/** Computes the boundary rows and capabilities not covered by an envelope. */
export function computeEnvelopeDelta(
  envelope: EnvelopeBoundary,
  requested: EnvelopeBoundary,
): EnvelopeBoundary {
  const normalizedEnvelope = normalizeBoundary(envelope);
  const normalizedRequested = normalizeBoundary(requested);
  const capabilities = new Set(normalizedEnvelope.capabilities);

  return normalizeBoundary({
    contracts: normalizedRequested.contracts.filter((contract) =>
      !hasContract(normalizedEnvelope, contract)
    ),
    surfaces: normalizedRequested.surfaces.filter((surface) =>
      !hasSurface(normalizedEnvelope, surface)
    ),
    capabilities: normalizedRequested.capabilities.filter((capability) =>
      !capabilities.has(capability)
    ),
    resources: normalizedRequested.resources.filter((resource) =>
      !hasResource(normalizedEnvelope, resource)
    ),
  });
}

/** Evaluates whether a requested boundary fits the effective envelope. */
export function evaluateEnvelopeFit(
  envelope: EnvelopeBoundary,
  requested: EnvelopeBoundary,
): EnvelopeFitEvaluation {
  const delta = computeEnvelopeDelta(envelope, requested);
  const missingAvailability = normalizeBoundary({
    ...EMPTY_BOUNDARY,
    contracts: delta.contracts,
    surfaces: delta.surfaces,
    resources: delta.resources,
  });

  return {
    fits: isEmptyBoundary(delta),
    missingAvailability,
    missingCapabilities: delta.capabilities,
  };
}

function overrideMatchesIdentity(
  override: DeploymentGrantOverride,
  identity: EnvelopeIdentityAnchor,
): boolean {
  if (override.contractId !== identity.contractId) return false;
  if (override.identityKind === "web") {
    return identity.kind === "web" && override.origin === identity.origin;
  }
  return "sessionPublicKey" in identity &&
    override.sessionPublicKey === identity.sessionPublicKey;
}

/** Applies matching deployment grant overrides as capability overlays only. */
export async function applyGrantOverrideCapabilities(
  envelope: EnvelopeBoundary,
  overrides: DeploymentGrantOverride[],
  identity: EnvelopeIdentityAnchor,
  capabilityGroupStorage?: GrantOverrideCapabilityGroupLoader,
): Promise<EnvelopeBoundary> {
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
    ...envelope.capabilities,
    ...concreteCapabilities,
    ...groupCapabilities,
  ];
  return normalizeBoundary({ ...envelope, capabilities });
}

/** Converts an in-memory boundary to deterministic modeled child rows. */
export function boundaryToDeploymentEnvelopeRows(
  deploymentId: string,
  boundary: EnvelopeBoundary,
): DeploymentEnvelopeRows {
  const normalized = normalizeBoundary(boundary);
  return {
    contracts: normalized.contracts.map((contract) => ({
      deploymentId,
      ...contract,
    })),
    surfaces: normalized.surfaces.map((surface) => ({
      deploymentId,
      ...surface,
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
 * Previews which dependent boundaries, requests, and resources a shrink would
 * leave uncovered. Resource bindings are reported as orphaned, not deleted.
 */
export function previewEnvelopeShrinkImpact(input: {
  current: EnvelopeBoundary;
  proposed: EnvelopeBoundary;
  dependents?: ShrinkDependent[];
  resourceBindings?: ShrinkResourceBinding[];
  pendingRequests?: ShrinkPendingRequest[];
}): EnvelopeShrinkImpact {
  const removed = computeEnvelopeDelta(input.proposed, input.current);
  const impactedDependents = (input.dependents ?? [])
    .map((dependent) => ({
      kind: dependent.kind,
      id: dependent.id,
      missing: computeEnvelopeDelta(input.proposed, dependent.boundary),
    }))
    .filter((impact) => !isEmptyBoundary(impact.missing));
  const impactedPendingRequests = (input.pendingRequests ?? [])
    .map((request) => ({
      requestId: request.requestId,
      missing: computeEnvelopeDelta(input.proposed, request.delta),
    }))
    .filter((impact) => !isEmptyBoundary(impact.missing));
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
