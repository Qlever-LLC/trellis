import type { AuthCapabilitiesListOutput } from "@qlever-llc/trellis/sdk/auth";
import type {
  AuthDeploymentAuthorityGetResponse,
  DeploymentAuthority,
  DeploymentAuthorityNeed,
  DeploymentAuthorityPlan,
  DeploymentAuthoritySurface,
} from "@qlever-llc/trellis/auth";

type ImplementationOffer = {
  deploymentKind: "service" | "device";
  deploymentId: string;
  contractId: string;
  contractDigest: string;
  status: "offered" | "accepted" | "stale" | "expired" | "withdrawn";
  staleAt: string | null;
  expiresAt: string | null;
};

type AuthorityState = DeploymentAuthority["desiredState"];
type AuthorityPlanState = "pending" | "accepted" | "rejected" | "expired";
type AuthorityNeedSet = {
  contracts: Array<{ contractId: string; required: boolean }>;
  surfaces: Array<DeploymentAuthoritySurface & { required: boolean }>;
  capabilities: string[];
  resources: Array<AuthorityNeedResource["resource"] & { required: boolean }>;
};
type AuthorityNeedSurface = Extract<
  DeploymentAuthorityNeed,
  { kind: "surface" }
>;
type AuthorityNeedResource = Extract<
  DeploymentAuthorityNeed,
  { kind: "resource" }
>;
type AuthorityNeedContract = Extract<
  DeploymentAuthorityNeed,
  { kind: "contract" }
>;
type AuthorityNeedCapability = Extract<
  DeploymentAuthorityNeed,
  { kind: "capability" }
>;
type AuthorityDetailBinding = NonNullable<
  AuthDeploymentAuthorityGetResponse["materializedAuthority"]
>["resourceBindings"][number];
type AuthorityMaterialization = NonNullable<
  AuthDeploymentAuthorityGetResponse["materializedAuthority"]
>;
type MaterializedAuthorityGrant = AuthorityMaterialization["grants"][number];
type MaterializedCapabilityGrant = Extract<
  MaterializedAuthorityGrant,
  { kind: "capability" }
>;
export type AuthorityCapabilityDefinition =
  AuthCapabilitiesListOutput["entries"][number];

export type DeltaContractRow = {
  id: string;
  contractId: string;
  availability: "required" | "optional";
};

export type DeltaSurfaceRow = {
  id: string;
  contractId: string;
  kind: DeploymentAuthoritySurface["kind"];
  name: string;
  action: DeploymentAuthoritySurface["action"] | "—";
  availability: "required" | "optional";
};

export type DeltaResourceRow = {
  id: string;
  kind: AuthorityNeedResource["resource"]["kind"];
  alias: string;
  availability: "required" | "optional";
};

export type DeltaCapabilityRow = {
  id: string;
  capability: string;
  availability: "required" | "optional";
};

export type CreatesCapabilityRow = {
  id: string;
  capability: string;
  displayName: string;
  description: string;
  consequence: string | null;
  source: AuthorityCapabilityDefinition["source"];
  contractId: string | null;
  contractDigest: string | null;
  contractDisplayName: string | null;
};

export type GivenCapabilityRow = {
  id: string;
  capability: string;
  displayName: string;
  description: string;
  consequence: string | null;
  availability: "required" | "optional" | "materialized-only";
  materializedStatus:
    | "granted"
    | "pending"
    | "not-materialized"
    | "unknown";
  materializedGrantCount: number;
  source: AuthorityCapabilityDefinition["source"] | "authority";
  contractId: string | null;
  contractDigest: string | null;
  contractDisplayName: string | null;
};

export type AuthorityCounts = {
  requiredContracts: number;
  optionalContracts: number;
  requiredSurfaces: number;
  optionalSurfaces: number;
  requiredResources: number;
  optionalResources: number;
  requiredCapabilities: number;
  optionalCapabilities: number;
  capabilities: number;
};

export type AuthorityRow = {
  deploymentId: string;
  kind: DeploymentAuthority["kind"];
  status: "Active" | "Disabled";
  desiredVersion: string;
  requiredContracts: number;
  optionalContracts: number;
  surfaces: number;
  resources: number;
  capabilities: number;
  updatedAt: string;
};

export type AuthorityPlanRow = {
  planId: string;
  deploymentId: string;
  state: AuthorityPlanState;
  classification: DeploymentAuthorityPlan["classification"];
  contractId: string;
  contractDigest: string;
  requiredContracts: number;
  optionalContracts: number;
  requiredSurfaces: number;
  optionalSurfaces: number;
  requiredResources: number;
  optionalResources: number;
  resources: number;
  capabilities: number;
  createdAt: string;
  searchableText: string;
};

export type RuntimeDeployment = {
  deploymentId: string;
  contractId?: string;
  contractDigest?: string;
  disabled?: boolean;
};

export type ServiceRuntimeInstance = {
  deploymentId: string;
  disabled: boolean;
};

export type DeviceRuntimeInstance = {
  deploymentId: string;
  state: "registered" | "activated" | "revoked" | "disabled";
};

export type LivenessRow = {
  id: string;
  contractId: string;
  surface: string;
  kind: DeploymentAuthoritySurface["kind"];
  action: DeploymentAuthoritySurface["action"] | "—";
  availability: "required" | "optional";
  runtime: "live" | "disabled" | "no_live_implementer";
};

export function authorityCounts(state: AuthorityState): AuthorityCounts {
  const contracts = contractNeeds(state);
  const surfaces = surfaceNeeds(state);
  const resources = resourceNeeds(state);
  const capabilities = capabilityNeeds(state);
  return {
    requiredContracts: contracts.filter((need) => need.required).length,
    optionalContracts: contracts.filter((need) => !need.required).length,
    requiredSurfaces: surfaces.filter((need) => need.required).length,
    optionalSurfaces: surfaces.filter((need) => !need.required).length,
    requiredResources: resources.filter((need) => need.required).length,
    optionalResources: resources.filter((need) => !need.required).length,
    requiredCapabilities: capabilities.filter((need) => need.required).length,
    optionalCapabilities: capabilities.filter((need) => !need.required).length,
    capabilities: capabilities.length,
  };
}

export function deploymentAuthorityRows(
  authorities: DeploymentAuthority[],
): AuthorityRow[] {
  return authorities.map((authority) => {
    const counts = authorityCounts(authority.desiredState);
    return {
      deploymentId: authority.deploymentId,
      kind: authority.kind,
      status: authority.disabled ? "Disabled" : "Active",
      desiredVersion: authority.version,
      requiredContracts: counts.requiredContracts,
      optionalContracts: counts.optionalContracts,
      surfaces: authority.desiredState.surfaces.length,
      resources: authority.desiredState.resources.length,
      capabilities: counts.capabilities,
      updatedAt: authority.updatedAt,
    };
  });
}

export function authorityPlanRows(
  plans: DeploymentAuthorityPlan[],
): AuthorityPlanRow[] {
  return plans.map((plan) => {
    const changeState = authorityPlanChangeState(plan);
    const counts = authorityCounts(changeState);
    return {
      planId: plan.planId,
      deploymentId: plan.deploymentId,
      state: planState(plan),
      classification: plan.classification,
      contractId: plan.proposal.contractId,
      contractDigest: plan.proposal.contractDigest,
      requiredContracts: counts.requiredContracts,
      optionalContracts: counts.optionalContracts,
      requiredSurfaces: counts.requiredSurfaces,
      optionalSurfaces: counts.optionalSurfaces,
      requiredResources: counts.requiredResources,
      optionalResources: counts.optionalResources,
      resources: counts.requiredResources + counts.optionalResources,
      capabilities: counts.capabilities,
      createdAt: plan.createdAt,
      searchableText: [
        plan.planId,
        plan.deploymentId,
        plan.classification,
        plan.proposal.contractId,
        plan.proposal.contractDigest,
        ...changeState.needs.map(needSearchText),
      ].join(" ").toLowerCase(),
    };
  });
}

export function authorityPlanChangeState(
  plan: DeploymentAuthorityPlan,
): AuthorityState {
  return isAuthorityNeedSet(plan.desiredChange)
    ? stateFromAuthorityNeedSet(plan.desiredChange)
    : stateFromNeeds([]);
}

export function authorityPlanRequestedState(
  plan: DeploymentAuthorityPlan,
): AuthorityState {
  return stateFromNeeds(plan.proposal.requestedNeeds);
}

export function deltaContractRows(state: AuthorityState): DeltaContractRow[] {
  return contractNeeds(state).map((need) => ({
    id: need.contractId,
    contractId: need.contractId,
    availability: need.required ? "required" : "optional",
  }));
}

export function deltaSurfaceRows(state: AuthorityState): DeltaSurfaceRow[] {
  return surfaceNeeds(state).map((need) => ({
    id: surfaceId(need.surface),
    contractId: need.surface.contractId,
    kind: need.surface.kind,
    name: need.surface.name,
    action: need.surface.action ?? "—",
    availability: need.required ? "required" : "optional",
  }));
}

export function deltaResourceRows(state: AuthorityState): DeltaResourceRow[] {
  return resourceNeeds(state).map((need) => ({
    id: `${need.resource.kind}:${need.resource.alias}`,
    kind: need.resource.kind,
    alias: need.resource.alias,
    availability: need.required ? "required" : "optional",
  }));
}

export function deltaCapabilityRows(
  state: AuthorityState,
): DeltaCapabilityRow[] {
  return capabilityNeeds(state).map((need) => ({
    id: need.capability,
    capability: need.capability,
    availability: need.required ? "required" : "optional",
  }));
}

export function createsCapabilityRows(
  authority: DeploymentAuthority,
  definitions: AuthorityCapabilityDefinition[],
): CreatesCapabilityRow[] {
  return capabilityDefinitionsForDeployment(
    definitions,
    authority.deploymentId,
    "creates",
  ).map((definition) => ({
    id: capabilityDefinitionId(definition),
    capability: definition.key,
    displayName: definition.displayName,
    description: definition.description,
    consequence: definition.consequence ?? null,
    source: definition.source,
    contractId: definition.contractId ?? null,
    contractDigest: definition.contractDigest ?? null,
    contractDisplayName: definition.contractDisplayName ?? null,
  }));
}

export function givenCapabilityRows(
  authority: DeploymentAuthority,
  materializedAuthority: AuthorityMaterialization | null,
  definitions: AuthorityCapabilityDefinition[],
): GivenCapabilityRow[] {
  const definitionIndex = capabilityDefinitionIndex(
    definitions,
    authority.deploymentId,
  );
  const grants = materializedAuthority?.grants.filter(
    (grant): grant is MaterializedCapabilityGrant =>
      grant.kind === "capability",
  ) ?? [];
  const grantCounts = new Map<string, number>();
  for (const grant of grants) {
    grantCounts.set(
      grant.capability,
      (grantCounts.get(grant.capability) ?? 0) + 1,
    );
  }

  const desiredCapabilities = deltaCapabilityRows(authority.desiredState);
  const desiredKeys = new Set(desiredCapabilities.map((row) => row.capability));
  const rows = desiredCapabilities.map((row) => {
    const definition = definitionIndex.get(row.capability);
    const materializedGrantCount = grantCounts.get(row.capability) ?? 0;
    return givenCapabilityRowFromParts({
      capability: row.capability,
      availability: row.availability,
      definition,
      materializedGrantCount,
      materializedStatus: materializedCapabilityStatus(
        materializedAuthority,
        materializedGrantCount,
      ),
    });
  });

  for (const grant of grants) {
    if (desiredKeys.has(grant.capability)) continue;
    const definition = definitionIndex.get(grant.capability);
    rows.push(givenCapabilityRowFromParts({
      capability: grant.capability,
      availability: "materialized-only",
      definition,
      materializedGrantCount: grantCounts.get(grant.capability) ?? 0,
      materializedStatus: "granted",
    }));
    desiredKeys.add(grant.capability);
  }

  return rows.toSorted((left, right) =>
    left.capability.localeCompare(right.capability)
  );
}

export function chooseSelectedAuthorityPlan(
  plans: DeploymentAuthorityPlan[],
  selectedPlanId: string | null,
): string | null {
  if (selectedPlanId && plans.some((plan) => plan.planId === selectedPlanId)) {
    return selectedPlanId;
  }
  return plans[0]?.planId ?? null;
}

export function livenessRows(
  state: AuthorityState,
  runtimeDeployments: RuntimeDeployment[],
  deploymentId?: string,
): LivenessRow[] {
  return surfaceNeeds(state).map((need) => {
    const relevantRuntimeDeployments = runtimeDeployments.filter((runtime) =>
      runtimeDeploymentMatchesSurface(runtime, need.surface, deploymentId)
    );
    const hasLiveRuntime = relevantRuntimeDeployments.some((runtime) =>
      !runtime.disabled
    );
    const hasDisabledRuntime = relevantRuntimeDeployments.some((runtime) =>
      runtime.disabled
    );
    const runtime: LivenessRow["runtime"] = hasLiveRuntime
      ? "live"
      : hasDisabledRuntime
      ? "disabled"
      : "no_live_implementer";

    return {
      id: surfaceId(need.surface),
      contractId: need.surface.contractId,
      surface: need.surface.name,
      kind: need.surface.kind,
      action: need.surface.action ?? "—",
      availability: need.required ? "required" : "optional",
      runtime,
    };
  });
}

function runtimeDeploymentMatchesSurface(
  runtime: RuntimeDeployment,
  surface: DeploymentAuthoritySurface,
  deploymentId?: string,
): boolean {
  const sameDeployment = deploymentId !== undefined &&
    runtime.deploymentId === deploymentId;
  const sameSurfaceContract = runtime.contractId === surface.contractId;

  if (!sameDeployment && !sameSurfaceContract) return false;
  if (runtime.contractId === undefined || sameSurfaceContract) return true;

  return sameDeployment && surface.kind === "event" &&
    surface.action === "publish";
}

export function serviceRuntimeDeployments(
  offers: ImplementationOffer[],
  now = Date.now(),
): RuntimeDeployment[] {
  return liveImplementationOfferRuntimeDeployments(offers, "service", now);
}

export function deviceRuntimeDeployments(
  offers: ImplementationOffer[],
  now = Date.now(),
): RuntimeDeployment[] {
  return liveImplementationOfferRuntimeDeployments(offers, "device", now);
}

function liveImplementationOfferRuntimeDeployments(
  offers: ImplementationOffer[],
  deploymentKind: ImplementationOffer["deploymentKind"],
  now: number,
): RuntimeDeployment[] {
  return offers
    .filter((offer) =>
      offer.deploymentKind === deploymentKind &&
      implementationOfferIsLive(offer, now)
    )
    .map((offer) => ({
      deploymentId: offer.deploymentId,
      contractId: offer.contractId,
      contractDigest: offer.contractDigest,
      disabled: false,
    }));
}

function implementationOfferIsLive(
  offer: ImplementationOffer,
  now: number,
): boolean {
  return offer.status === "accepted" &&
    !isElapsedOfferTime(offer.staleAt, now) &&
    !isElapsedOfferTime(offer.expiresAt, now);
}

function isElapsedOfferTime(value: string | null, now: number): boolean {
  return value !== null && Date.parse(value) <= now;
}

export function chooseSelectedDeployment(
  authorities: DeploymentAuthority[],
  selectedDeploymentId: string | null,
): string | null {
  if (
    selectedDeploymentId &&
    authorities.some((authority) =>
      authority.deploymentId === selectedDeploymentId
    )
  ) {
    return selectedDeploymentId;
  }
  return authorities[0]?.deploymentId ?? null;
}

export class AuthoritySelectionGuard {
  #selectedDeploymentId: string | null = null;
  #requestToken = 0;

  get selectedDeploymentId(): string | null {
    return this.#selectedDeploymentId;
  }

  begin(deploymentId: string): number {
    this.#selectedDeploymentId = deploymentId;
    this.#requestToken += 1;
    return this.#requestToken;
  }

  shouldCommit(deploymentId: string, requestToken: number): boolean {
    return this.#selectedDeploymentId === deploymentId &&
      this.#requestToken === requestToken;
  }
}

export function formatBindingTarget(binding: AuthorityDetailBinding): string {
  const targetKeys = ["bucket", "name", "queue", "stream", "subject"];
  for (const key of targetKeys) {
    const value = binding.binding[key];
    if (typeof value === "string" && value.length > 0) {
      return `${key}: ${value}`;
    }
  }
  return `${binding.kind}: ${binding.alias}`;
}

function contractNeeds(state: AuthorityState): AuthorityNeedContract[] {
  return state.needs.filter((need): need is AuthorityNeedContract =>
    need.kind === "contract"
  );
}

function surfaceNeeds(state: AuthorityState): AuthorityNeedSurface[] {
  return state.needs.filter((need): need is AuthorityNeedSurface =>
    need.kind === "surface"
  );
}

function resourceNeeds(state: AuthorityState): AuthorityNeedResource[] {
  return state.needs.filter((need): need is AuthorityNeedResource =>
    need.kind === "resource"
  );
}

function capabilityNeeds(state: AuthorityState): AuthorityNeedCapability[] {
  return state.needs.filter((need): need is AuthorityNeedCapability =>
    need.kind === "capability"
  );
}

function capabilityDefinitionsForDeployment(
  definitions: AuthorityCapabilityDefinition[],
  deploymentId: string,
  direction: "creates" | "given",
): AuthorityCapabilityDefinition[] {
  return definitions
    .filter((definition) =>
      definition.deploymentId === deploymentId &&
      definition.direction === direction
    )
    .toSorted((left, right) =>
      left.key.localeCompare(right.key) ||
      (left.contractId ?? "").localeCompare(right.contractId ?? "") ||
      (left.contractDigest ?? "").localeCompare(right.contractDigest ?? "")
    );
}

function capabilityDefinitionIndex(
  definitions: AuthorityCapabilityDefinition[],
  deploymentId: string,
): Map<string, AuthorityCapabilityDefinition> {
  const index = new Map<string, AuthorityCapabilityDefinition>();
  for (
    const definition of capabilityDefinitionsForDeployment(
      definitions,
      deploymentId,
      "given",
    )
  ) {
    index.set(definition.key, definition);
  }
  for (const definition of definitions) {
    if (
      definition.deploymentId !== deploymentId ||
      definition.direction !== undefined
    ) {
      continue;
    }
    if (!index.has(definition.key)) index.set(definition.key, definition);
  }
  return index;
}

function capabilityDefinitionId(
  definition: AuthorityCapabilityDefinition,
): string {
  return [
    definition.deploymentId ?? "global",
    definition.direction ?? "unspecified",
    definition.key,
    definition.contractId ?? "platform",
    definition.contractDigest ?? "no-digest",
  ].join(":");
}

function materializedCapabilityStatus(
  materializedAuthority: AuthorityMaterialization | null,
  materializedGrantCount: number,
): GivenCapabilityRow["materializedStatus"] {
  if (materializedGrantCount > 0) return "granted";
  if (!materializedAuthority) return "unknown";
  if (materializedAuthority.status === "pending") return "pending";
  return "not-materialized";
}

function givenCapabilityRowFromParts(args: {
  capability: string;
  availability: GivenCapabilityRow["availability"];
  definition?: AuthorityCapabilityDefinition;
  materializedStatus: GivenCapabilityRow["materializedStatus"];
  materializedGrantCount: number;
}): GivenCapabilityRow {
  return {
    id: `${args.capability}:${args.availability}`,
    capability: args.capability,
    displayName: args.definition?.displayName ?? args.capability,
    description: args.definition?.description ??
      "Accepted deployment authority capability.",
    consequence: args.definition?.consequence ?? null,
    availability: args.availability,
    materializedStatus: args.materializedStatus,
    materializedGrantCount: args.materializedGrantCount,
    source: args.definition?.source ?? "authority",
    contractId: args.definition?.contractId ?? null,
    contractDigest: args.definition?.contractDigest ?? null,
    contractDisplayName: args.definition?.contractDisplayName ?? null,
  };
}

function stateFromNeeds(needs: DeploymentAuthorityNeed[]): AuthorityState {
  return {
    needs,
    capabilities: capabilityNeeds({
      needs,
      capabilities: [],
      resources: [],
      surfaces: [],
    }).map((need) => need.capability),
    resources: resourceNeeds({
      needs,
      capabilities: [],
      resources: [],
      surfaces: [],
    }).map((need) => need.resource),
    surfaces: surfaceNeeds({
      needs,
      capabilities: [],
      resources: [],
      surfaces: [],
    }).map((need) => need.surface),
  };
}

function stateFromAuthorityNeedSet(needs: AuthorityNeedSet): AuthorityState {
  return stateFromNeeds([
    ...needs.contracts.map((contract) => ({
      kind: "contract" as const,
      contractId: contract.contractId,
      required: contract.required,
    })),
    ...needs.surfaces.map(({ required, ...surface }) => ({
      kind: "surface" as const,
      surface,
      required,
    })),
    ...needs.resources.map((resource) => ({
      kind: "resource" as const,
      resource,
      required: resource.required,
    })),
    ...needs.capabilities.map((capability) => ({
      kind: "capability" as const,
      capability,
      required: true,
    })),
  ]);
}

function planState(plan: DeploymentAuthorityPlan): AuthorityPlanState {
  if ("state" in plan && isAuthorityPlanState(plan.state)) return plan.state;
  return "pending";
}

function isAuthorityPlanState(value: unknown): value is AuthorityPlanState {
  return value === "pending" || value === "accepted" ||
    value === "rejected" || value === "expired";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuthorityNeedSet(value: unknown): value is AuthorityNeedSet {
  if (!isRecord(value)) return false;
  const contracts = value.contracts;
  const surfaces = value.surfaces;
  const capabilities = value.capabilities;
  const resources = value.resources;
  return Array.isArray(contracts) &&
    contracts.every(isAuthorityNeedSetContract) &&
    Array.isArray(surfaces) && surfaces.every(isAuthorityNeedSetSurface) &&
    Array.isArray(capabilities) &&
    capabilities.every((capability) =>
      typeof capability === "string" && capability.length > 0
    ) &&
    Array.isArray(resources) && resources.every(isAuthorityNeedSetResource);
}

function isAuthorityNeedSetContract(value: unknown): boolean {
  return isRecord(value) && typeof value.contractId === "string" &&
    value.contractId.length > 0 && typeof value.required === "boolean";
}

function isAuthorityNeedSetSurface(value: unknown): boolean {
  return isRecord(value) && typeof value.contractId === "string" &&
    value.contractId.length > 0 && typeof value.kind === "string" &&
    typeof value.name === "string" && value.name.length > 0 &&
    typeof value.required === "boolean" &&
    (value.action === undefined || typeof value.action === "string");
}

function isAuthorityNeedSetResource(value: unknown): boolean {
  return isRecord(value) && typeof value.kind === "string" &&
    typeof value.alias === "string" && value.alias.length > 0 &&
    typeof value.required === "boolean" &&
    (value.definition === undefined || isRecord(value.definition));
}

function surfaceId(surface: DeploymentAuthoritySurface): string {
  return `${surface.contractId}:${surface.kind}:${surface.name}:${
    surface.action ?? "none"
  }`;
}

function needSearchText(need: DeploymentAuthorityNeed): string {
  switch (need.kind) {
    case "contract":
      return `${need.contractId} ${need.required ? "required" : "optional"}`;
    case "surface":
      return `${need.surface.contractId} ${need.surface.kind} ${need.surface.name} ${
        need.surface.action ?? ""
      }`;
    case "resource":
      return `${need.resource.kind} ${need.resource.alias}`;
    case "capability":
      return need.capability;
  }
}
