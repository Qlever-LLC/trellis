import type {
  DeploymentAuthorityCapabilityNeed,
  DeploymentAuthorityContractNeed,
  DeploymentAuthorityDesiredState,
  DeploymentAuthorityNeeds,
  DeploymentAuthorityResourceNeed,
  DeploymentAuthoritySurfaceNeed,
} from "./schemas.ts";

function contractKey(contract: DeploymentAuthorityContractNeed): string {
  return contract.contractId;
}

function surfaceKey(surface: DeploymentAuthoritySurfaceNeed): string {
  return [
    surface.contractId,
    surface.kind,
    surface.name,
    surface.action ?? "",
  ].join("\u001f");
}

function capabilityKey(capability: DeploymentAuthorityCapabilityNeed): string {
  return capability.capability;
}

function resourceKey(resource: DeploymentAuthorityResourceNeed): string {
  return [resource.kind, resource.alias].join("\u001f");
}

/** Returns a new empty grouped authority need set. */
export function emptyAuthorityNeeds(): DeploymentAuthorityNeeds {
  return {
    contracts: [],
    surfaces: [],
    capabilities: [],
    resources: [],
  };
}

/** Normalizes grouped authority needs for deterministic JSON comparison. */
export function normalizeAuthorityNeeds(
  needs: DeploymentAuthorityNeeds,
): DeploymentAuthorityNeeds {
  const contracts = new Map<string, DeploymentAuthorityContractNeed>();
  for (const contract of needs.contracts) {
    const existing = contracts.get(contractKey(contract));
    contracts.set(contractKey(contract), {
      ...contract,
      required: (existing?.required ?? false) || contract.required,
    });
  }

  const surfaces = new Map<string, DeploymentAuthoritySurfaceNeed>();
  for (const surface of needs.surfaces) {
    const existing = surfaces.get(surfaceKey(surface));
    surfaces.set(surfaceKey(surface), {
      ...surface,
      required: (existing?.required ?? false) || surface.required,
    });
  }

  const capabilities = new Map<string, DeploymentAuthorityCapabilityNeed>();
  for (const capability of needs.capabilities) {
    const existing = capabilities.get(capabilityKey(capability));
    capabilities.set(capabilityKey(capability), {
      ...capability,
      required: (existing?.required ?? false) || capability.required,
    });
  }

  const resources = new Map<string, DeploymentAuthorityResourceNeed>();
  for (const resource of needs.resources) {
    const existing = resources.get(resourceKey(resource));
    resources.set(resourceKey(resource), {
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
    capabilities: [...capabilities.values()].sort((left, right) =>
      left.capability.localeCompare(right.capability) ||
      String(left.required).localeCompare(String(right.required))
    ),
    resources: [...resources.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.alias.localeCompare(right.alias) ||
      String(left.required).localeCompare(String(right.required))
    ),
  };
}

/** Merges grouped authority need sets into a normalized set. */
export function mergeAuthorityNeeds(
  ...sets: DeploymentAuthorityNeeds[]
): DeploymentAuthorityNeeds {
  return normalizeAuthorityNeeds({
    contracts: sets.flatMap((set) => set.contracts),
    surfaces: sets.flatMap((set) => set.surfaces),
    capabilities: sets.flatMap((set) => set.capabilities),
    resources: sets.flatMap((set) => set.resources),
  });
}

/** Extracts normalized grouped needs from deployment desired state. */
export function authorityNeedsFromDesiredState(
  desiredState: DeploymentAuthorityDesiredState,
): DeploymentAuthorityNeeds {
  return normalizeAuthorityNeeds(desiredState.needs);
}

/** Returns desired state with normalized grouped needs replaced. */
export function desiredStateWithNeeds(
  desiredState: DeploymentAuthorityDesiredState,
  needs: DeploymentAuthorityNeeds,
): DeploymentAuthorityDesiredState {
  return {
    ...desiredState,
    needs: normalizeAuthorityNeeds(needs),
  };
}
