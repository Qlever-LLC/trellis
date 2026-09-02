import type { AuthCapabilitiesListOutput } from "@trellis/apis/trellis.auth";
import type {
  AuthDeploymentAuthorityGetResponse,
  DeploymentAuthority,
  DeploymentAuthorityCapabilityNeed,
  DeploymentAuthorityContractNeed,
  DeploymentAuthorityNeeds,
  DeploymentAuthorityPlan,
  DeploymentAuthorityPlanBreakingChange,
  DeploymentAuthorityResourceNeed,
  DeploymentAuthoritySurface,
  DeploymentAuthoritySurfaceNeed,
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
type AuthorityPlanState =
  | "pending"
  | "accepted"
  | "rejected"
  | "expired"
  | "superseded";
type AuthorityNeedSet = {
  contracts: Array<{ contractId: string; required: boolean }>;
  surfaces: Array<DeploymentAuthoritySurface & { required: boolean }>;
  capabilities: Array<{ capability: string; required: boolean }>;
  resources: Array<DeploymentAuthorityResourceNeed>;
};
type AuthorityNeedSurface = DeploymentAuthoritySurfaceNeed;
type AuthorityNeedResource = DeploymentAuthorityResourceNeed;
type AuthorityNeedContract = DeploymentAuthorityContractNeed;
type AuthorityNeedCapability = DeploymentAuthorityCapabilityNeed;
type AuthorityDetailBinding = NonNullable<
  AuthDeploymentAuthorityGetResponse["materializedAuthority"]
>["resourceBindings"][number];
type AuthorityMaterialization = NonNullable<
  AuthDeploymentAuthorityGetResponse["materializedAuthority"]
>;
type MaterializedCapabilityGrant = AuthorityMaterialization["grants"][
  "capabilities"
][number];
export type AuthorityCapabilityDefinition = {
  allows?: AuthCapabilitiesListOutput["entries"][number]["allows"];
  capability?: string;
  displayName: string;
  description: string;
  sourceApi?: string | null;
  key?: string;
  consequence?: string | null;
  source?: "platform" | "contract" | "deployment";
  contractId?: string | null;
  contractDigest?: string | null;
  contractDisplayName?: string | null;
  deploymentId?: string | null;
  direction?: "creates" | "given";
};

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
  kind: AuthorityNeedResource["kind"];
  alias: string;
  availability: "required" | "optional";
};

export type DeltaCapabilityRow = {
  id: string;
  capability: string;
  availability: "required" | "optional";
};

export type ContractChangeKind = "Add" | "Change" | "Remove";

export type ContractDiffRow = {
  id: string;
  change: ContractChangeKind;
  kind: string;
  name: string;
  detail: string;
  before: unknown;
  after: unknown;
};

export type ContractDiffRows = {
  contracts: ContractDiffRow[];
  surfaces: ContractDiffRow[];
  schemas: ContractDiffRow[];
  resources: ContractDiffRow[];
  capabilities: ContractDiffRow[];
};

export type PlanSummaryKind =
  | "permission"
  | "api"
  | "data-shape"
  | "background-job"
  | "storage"
  | "metadata";

export type PlanSummaryField =
  | {
    kind: "scalar";
    label: string;
    before: string;
    after: string;
    mono?: boolean;
    breaking?: boolean;
    details?: Array<
      { label: string; before: string; after: string; breaking?: boolean }
    >;
  }
  | {
    kind: "set";
    label: string;
    added: string[];
    removed: string[];
    kept: string[];
    mono?: boolean;
    breaking?: boolean;
    details?: Array<
      { label: string; before: string; after: string; breaking?: boolean }
    >;
  };

export type PlanSummaryEntry = {
  id: string;
  change: ContractChangeKind;
  kind: PlanSummaryKind;
  name: string;
  summary: string;
  fields: PlanSummaryField[];
  breaking: boolean;
};

export type PlanSummaryGroup = {
  kind: PlanSummaryKind;
  label: string;
  entries: PlanSummaryEntry[];
};

export type PlanSummaryGroups = PlanSummaryGroup[];

export type AnnotatedPlanSummary = {
  groups: PlanSummaryGroups;
  unmatched: DeploymentAuthorityPlanBreakingChange[];
};

const SURFACE_SECTION_KINDS: Record<string, string> = {
  rpc: "RPC",
  operations: "Operation",
  events: "Event",
  feeds: "Feed",
  jobs: "Job",
};

function entrySurfaceKind(entry: PlanSummaryEntry): string | null {
  if (entry.kind !== "api") return null;
  const prefix = entry.id.split(":", 1)[0];
  return SURFACE_SECTION_KINDS[prefix] ?? null;
}

function surfaceKindLabel(
  kind: "rpc" | "operation" | "event" | "feed" | "job",
): string {
  if (kind === "rpc") return "RPC";
  if (kind === "operation") return "Operation";
  if (kind === "event") return "Event";
  if (kind === "feed") return "Feed";
  return "Job";
}

function matchBreakingChange(
  change: DeploymentAuthorityPlanBreakingChange,
  entry: PlanSummaryEntry,
): boolean {
  const t = change.target;
  if (t.kind === "schema") {
    if (entry.kind !== "data-shape") return false;
    return entry.name === t.schemaName;
  }
  if (t.kind === "surface") {
    if (entry.kind !== "api") return false;
    if (entry.name !== t.surfaceName) return false;
    return surfaceKindLabel(t.surfaceKind) === entrySurfaceKind(entry);
  }
  if (t.kind === "resource") {
    if (entry.kind !== "background-job" && entry.kind !== "storage") {
      return false;
    }
    return entry.name === t.resourceAlias;
  }
  if (t.kind === "capability") {
    if (entry.kind !== "permission") return false;
    return entry.name === t.capability;
  }
  return false;
}

const FIELD_LABEL_BY_PATH: Record<string, string> = {
  type: "type",
  required: "required",
  properties: "properties",
  enum: "enum",
  format: "format",
  pattern: "pattern",
  subject: "subject",
  description: "description",
  purpose: "purpose",
  consequence: "consequence",
  input: "input",
  output: "output",
  event: "event",
  progress: "progress",
  payload: "payload",
  result: "result",
  error: "error",
  request: "request",
  response: "response",
  schema: "schema",
  keySchema: "keySchema",
  valueSchema: "valueSchema",
  maxDeliver: "maxDeliver",
  ttlMs: "ttlMs",
  maxValueSizeBytes: "maxValueSizeBytes",
  history: "history",
};

const CAPABILITY_FIELD_LABEL_BY_PATH: Record<string, string> = {
  description: "description",
  consequence: "consequence",
  displayName: "display name",
};

function pathToFieldLabel(
  change: DeploymentAuthorityPlanBreakingChange,
  entry: PlanSummaryEntry,
): string | null {
  if (!change.path) return null;
  const segments = change.path.split("/").filter((s: string) => s.length > 0);
  if (segments.length === 0) return null;
  const first = segments[0];
  if (entry.kind === "permission") {
    return CAPABILITY_FIELD_LABEL_BY_PATH[first] ?? null;
  }
  if (first === "capabilities") {
    if (entry.kind === "api") return "required caps";
    if (entry.kind === "background-job" || entry.kind === "storage") {
      return "capabilities";
    }
    return null;
  }
  return FIELD_LABEL_BY_PATH[first] ?? null;
}

export function applyBreakingChanges(
  groups: PlanSummaryGroups,
  breakingChanges: readonly DeploymentAuthorityPlanBreakingChange[],
): AnnotatedPlanSummary {
  if (breakingChanges.length === 0) return { groups, unmatched: [] };
  const remaining = new Set(breakingChanges);
  const next: PlanSummaryGroups = groups.map((group) => ({
    ...group,
    entries: group.entries.map((entry) => {
      const matching = breakingChanges.filter((c) =>
        matchBreakingChange(c, entry)
      );
      if (matching.length === 0) return entry;
      const fields = entry.fields.map((field) => {
        const fieldBreaking = matching.some(
          (c) => pathToFieldLabel(c, entry) === field.label,
        );
        return fieldBreaking ? { ...field, breaking: true } : field;
      });
      const entryBreaking = entry.breaking || matching.length > 0;
      for (const c of matching) remaining.delete(c);
      return { ...entry, breaking: entryBreaking, fields };
    }),
  }));
  return { groups: next, unmatched: [...remaining] };
}
type ContractDiffGroup = keyof ContractDiffRows;
type ContractDiffSection = {
  group: ContractDiffGroup;
  kind: string;
  path: string[];
};

const CONTRACT_DIFF_SECTIONS: ContractDiffSection[] = [
  { group: "contracts", kind: "Docs", path: ["docs"] },
  { group: "contracts", kind: "Required use", path: ["uses", "required"] },
  { group: "contracts", kind: "Optional use", path: ["uses", "optional"] },
  { group: "surfaces", kind: "RPC", path: ["rpc"] },
  { group: "surfaces", kind: "Operation", path: ["operations"] },
  { group: "surfaces", kind: "Event", path: ["events"] },
  { group: "surfaces", kind: "Feed", path: ["feeds"] },
  { group: "schemas", kind: "Schema", path: ["schemas"] },
  { group: "schemas", kind: "Error", path: ["errors"] },
  { group: "resources", kind: "Job", path: ["jobs"] },
  { group: "resources", kind: "State", path: ["state"] },
  { group: "resources", kind: "KV", path: ["resources", "kv"] },
  { group: "resources", kind: "Store", path: ["resources", "store"] },
  { group: "resources", kind: "Event consumer", path: ["eventConsumers"] },
  { group: "capabilities", kind: "Capability", path: ["capabilities"] },
];

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
        ...needSearchTexts(changeState.needs),
      ].join(" ").toLowerCase(),
    };
  });
}

export function authorityPlanChangeState(
  plan: DeploymentAuthorityPlan,
): AuthorityState {
  return isAuthorityNeedSet(plan.desiredChange)
    ? stateFromAuthorityNeedSet(plan.desiredChange)
    : stateFromNeeds(emptyAuthorityNeeds());
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
    id: surfaceId(need),
    contractId: need.contractId,
    kind: need.kind,
    name: need.name,
    action: need.action ?? "—",
    availability: need.required ? "required" : "optional",
  }));
}

export function deltaResourceRows(state: AuthorityState): DeltaResourceRow[] {
  return resourceNeeds(state).map((need) => ({
    id: `${need.kind}:${need.alias}`,
    kind: need.kind,
    alias: need.alias,
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

export function contractManifestDiffRows(
  previous: unknown,
  proposed: unknown,
): ContractDiffRows {
  const oldContract = isRecord(previous) ? previous : null;
  const newContract = isRecord(proposed) ? proposed : null;
  if (!newContract) return emptyContractDiffRows();
  const rows = emptyContractDiffRows();
  rows.contracts.push(...contractIdentityRows(oldContract, newContract));
  for (const section of CONTRACT_DIFF_SECTIONS) {
    rows[section.group].push(
      ...diffRecordRows(
        contractPathRecord(oldContract, section.path),
        contractPathRecord(newContract, section.path),
        section.kind,
        section.path.join("."),
      ),
    );
  }
  return rows;
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
    capability: definition.key ?? definition.capability ?? "",
    displayName: definition.displayName,
    description: definition.description,
    consequence: definition.consequence ?? null,
    source: definition.source ?? "platform",
    contractId: definition.contractId ?? definition.sourceApi ?? null,
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
  const grants = materializedAuthority?.grants.capabilities ?? [];
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
      runtimeDeploymentMatchesSurface(runtime, need, deploymentId)
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
      id: surfaceId(need),
      contractId: need.contractId,
      surface: need.name,
      kind: need.kind,
      action: need.action ?? "—",
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
  return state.needs.contracts;
}

function surfaceNeeds(state: AuthorityState): AuthorityNeedSurface[] {
  return state.needs.surfaces;
}

function resourceNeeds(state: AuthorityState): AuthorityNeedResource[] {
  return state.needs.resources;
}

function capabilityNeeds(state: AuthorityState): AuthorityNeedCapability[] {
  return state.needs.capabilities;
}

function capabilityDefinitionsForDeployment(
  definitions: AuthorityCapabilityDefinition[],
  deploymentId: string,
  direction: "creates" | "given",
): AuthorityCapabilityDefinition[] {
  return definitions
    .filter((definition) =>
      (definition.deploymentId === deploymentId ||
        definition.deploymentId === undefined) &&
      definition.direction === direction
    )
    .toSorted((left, right) =>
      (left.key ?? left.capability ?? "").localeCompare(
        right.key ?? right.capability ?? "",
      ) ||
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
    index.set(definition.key ?? definition.capability ?? "", definition);
  }
  for (const definition of definitions) {
    if (
      (definition.deploymentId !== deploymentId &&
        definition.deploymentId !== undefined) ||
      definition.direction !== undefined
    ) {
      continue;
    }
    const key = definition.key ?? definition.capability ?? "";
    if (!index.has(key)) index.set(key, definition);
  }
  return index;
}

function capabilityDefinitionId(
  definition: AuthorityCapabilityDefinition,
): string {
  return [
    definition.deploymentId ?? "global",
    definition.direction ?? "unspecified",
    definition.key ?? definition.capability ?? "",
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

function emptyAuthorityNeeds(): DeploymentAuthorityNeeds {
  return { contracts: [], surfaces: [], capabilities: [], resources: [] };
}

function stateFromNeeds(needs: DeploymentAuthorityNeeds): AuthorityState {
  return {
    needs,
    capabilities: needs.capabilities.map((need) => need.capability),
    resources: needs.resources,
    surfaces: needs.surfaces.map((need) => {
      const { required: _required, ...surface } = need;
      return surface;
    }),
  };
}

function stateFromAuthorityNeedSet(needs: AuthorityNeedSet): AuthorityState {
  return stateFromNeeds(needs);
}

function planState(plan: DeploymentAuthorityPlan): AuthorityPlanState {
  if ("state" in plan && isAuthorityPlanState(plan.state)) return plan.state;
  return "pending";
}

function isAuthorityPlanState(value: unknown): value is AuthorityPlanState {
  return value === "pending" || value === "accepted" ||
    value === "rejected" || value === "expired" || value === "superseded";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyContractDiffRows(): ContractDiffRows {
  return {
    contracts: [],
    surfaces: [],
    schemas: [],
    resources: [],
    capabilities: [],
  };
}

function contractIdentityRows(
  oldContract: Record<string, unknown> | null,
  newContract: Record<string, unknown>,
): ContractDiffRow[] {
  const oldIdentity = contractIdentity(oldContract);
  const newIdentity = contractIdentity(newContract);
  if (oldContract && unknownEquals(oldIdentity, newIdentity)) return [];
  return [
    {
      id: "contract:manifest",
      change: oldContract ? "Change" : "Add",
      kind: "Contract",
      name: stringProperty(newContract, "id") ?? "Contract",
      detail: stringProperty(newContract, "displayName") ??
        (oldContract ? "Contract metadata changed" : "New contract"),
      before: oldContract,
      after: newContract,
    },
  ];
}

function contractIdentity(
  contract: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!contract) return {};
  const ignored = new Set([
    "capabilities",
    "docs",
    "errors",
    "eventConsumers",
    "events",
    "exports",
    "feeds",
    "jobs",
    "operations",
    "resources",
    "rpc",
    "schemas",
    "state",
    "uses",
  ]);
  return Object.fromEntries(
    Object.entries(contract).filter(([key]) => !ignored.has(key)),
  );
}

function contractPathRecord(
  contract: Record<string, unknown> | null,
  path: string[],
): Record<string, unknown> | null {
  let current: unknown = contract;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return isRecord(current) ? current : null;
}

function diffRecordRows(
  oldRecord: Record<string, unknown> | null,
  newRecord: Record<string, unknown> | null,
  kind: string,
  idPrefix: string,
): ContractDiffRow[] {
  const names = [
    ...new Set([
      ...Object.keys(oldRecord ?? {}),
      ...Object.keys(newRecord ?? {}),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  return names.flatMap((name) => {
    const oldValue = oldRecord?.[name];
    const newValue = newRecord?.[name];
    if (oldValue !== undefined && newValue !== undefined) {
      if (unknownEquals(oldValue, newValue)) return [];
      return [
        contractDiffRow(idPrefix, "Change", kind, name, oldValue, newValue),
      ];
    }
    if (newValue !== undefined) {
      return [contractDiffRow(idPrefix, "Add", kind, name, null, newValue)];
    }
    return [contractDiffRow(idPrefix, "Remove", kind, name, oldValue, null)];
  });
}

function contractDiffRow(
  idPrefix: string,
  change: ContractChangeKind,
  kind: string,
  name: string,
  oldValue: unknown,
  newValue: unknown,
): ContractDiffRow {
  return {
    id: `${idPrefix}:${name}`,
    change,
    kind,
    name,
    detail: contractPartDetail(change, kind, oldValue, newValue),
    before: oldValue,
    after: newValue,
  };
}

function contractPartDetail(
  change: ContractChangeKind,
  kind: string,
  oldValue: unknown,
  newValue: unknown,
): string {
  if (change === "Change") {
    const semantic = semanticContractChange(kind, oldValue, newValue);
    if (semantic.length > 0) return semantic.join("; ");
    const oldDetail = contractPartSummary(oldValue);
    const newDetail = contractPartSummary(newValue);
    return oldDetail === newDetail
      ? changedFieldNames(oldValue, newValue)
      : `${oldDetail} -> ${newDetail}`;
  }
  return change === "Remove"
    ? contractPartSummary(oldValue)
    : contractPartSummary(newValue);
}

function contractPartSummary(value: unknown): string {
  if (typeof value === "boolean") return value ? "true schema" : "false schema";
  if (typeof value === "string") return textSummary(value);
  if (!isRecord(value)) return "—";
  const required = stringArraySummary(value.required);
  const properties = isRecord(value.properties)
    ? `${Object.keys(value.properties).length} properties`
    : null;
  const subject = stringProperty(value, "subject");
  const type = Array.isArray(value.type)
    ? value.type.filter((entry): entry is string => typeof entry === "string")
      .join(" | ")
    : stringProperty(value, "type");
  const title = stringProperty(value, "title");
  const description = stringProperty(value, "description");
  const purpose = stringProperty(value, "purpose");
  const displayName = stringProperty(value, "displayName");
  const refs = [
    labeledSchemaRef("schema", value.schema),
    labeledSchemaRef("input", value.input),
    labeledSchemaRef("output", value.output),
    labeledSchemaRef("event", value.event),
    labeledSchemaRef("payload", value.payload),
    labeledSchemaRef("result", value.result),
    labeledSchemaRef("$ref", value["$ref"]),
  ].filter((entry): entry is string => Boolean(entry));
  const constraints = [
    required ? `required: ${required}` : null,
    properties,
    typeof value.additionalProperties === "boolean"
      ? `additionalProperties: ${value.additionalProperties}`
      : null,
    isRecord(value.items) ? "array items" : null,
    typeof value.minimum === "number" ? `min: ${value.minimum}` : null,
    typeof value.maximum === "number" ? `max: ${value.maximum}` : null,
    typeof value.minLength === "number"
      ? `minLength: ${value.minLength}`
      : null,
    typeof value.maxLength === "number"
      ? `maxLength: ${value.maxLength}`
      : null,
    stringProperty(value, "format")
      ? `format: ${stringProperty(value, "format")}`
      : null,
    stringProperty(value, "pattern")
      ? `pattern: ${stringProperty(value, "pattern")}`
      : null,
    Array.isArray(value.oneOf) ? `oneOf: ${value.oneOf.length} variants` : null,
    Array.isArray(value.anyOf) ? `anyOf: ${value.anyOf.length} variants` : null,
    Array.isArray(value.allOf) ? `allOf: ${value.allOf.length} variants` : null,
  ].filter((entry): entry is string => Boolean(entry));
  return [
    subject,
    ...refs,
    type,
    ...constraints,
    displayName,
    title,
    purpose,
    description,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(" · ") || "changed";
}

function semanticContractChange(
  kind: string,
  oldValue: unknown,
  newValue: unknown,
): string[] {
  if (typeof oldValue === "string" || typeof newValue === "string") {
    return [`${primitiveSummary(oldValue)} -> ${primitiveSummary(newValue)}`];
  }
  if (!isRecord(oldValue) || !isRecord(newValue)) return [];

  return [
    ...new Set([
      ...schemaChanges(kind, oldValue, newValue),
      ...referenceChanges(oldValue, newValue),
      ...stringFieldChanges(oldValue, newValue, [
        "subject",
        "version",
        "displayName",
        "title",
        "description",
        "purpose",
        "consequence",
        "summary",
        "markdown",
      ]),
      ...arrayFieldChanges(oldValue, newValue, ["requiredCapabilities"]),
      ...docsChanges(oldValue, newValue),
    ]),
  ];
}

function schemaChanges(
  kind: string,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
): string[] {
  if (kind !== "Schema" && kind !== "Error") return [];
  return [
    ...stringFieldChanges(oldValue, newValue, ["type", "format", "pattern"]),
    arrayDiffSummary("required fields", oldValue.required, newValue.required),
    arrayDiffSummary("enum", oldValue.enum, newValue.enum),
    recordKeyDiffSummary(
      "properties",
      oldValue.properties,
      newValue.properties,
    ),
    valueChangeSummary(
      "additionalProperties",
      oldValue.additionalProperties,
      newValue.additionalProperties,
    ),
    valueChangeSummary("items", oldValue.items, newValue.items),
  ].filter((entry): entry is string => Boolean(entry));
}

function referenceChanges(
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
): string[] {
  return ["schema", "input", "output", "event", "progress", "payload", "result"]
    .flatMap((key) => {
      const oldRef = schemaRefName(oldValue[key]);
      const newRef = schemaRefName(newValue[key]);
      return oldRef !== newRef
        ? [`${key}: ${oldRef ?? "none"} -> ${newRef ?? "none"}`]
        : [];
    });
}

function docsChanges(
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
): string[] {
  if (!isRecord(oldValue.docs) && !isRecord(newValue.docs)) return [];
  return stringFieldChanges(
    isRecord(oldValue.docs) ? oldValue.docs : {},
    isRecord(newValue.docs) ? newValue.docs : {},
    ["summary", "markdown"],
    "docs ",
  );
}

function stringFieldChanges(
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  keys: string[],
  prefix = "",
): string[] {
  return keys.flatMap((key) => {
    const oldField = stringOrStringArray(oldValue[key]);
    const newField = stringOrStringArray(newValue[key]);
    return oldField !== newField
      ? [
        `${prefix}${key}: ${primitiveSummary(oldField)} -> ${
          primitiveSummary(newField)
        }`,
      ]
      : [];
  });
}

function arrayFieldChanges(
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  keys: string[],
): string[] {
  return keys.flatMap((key) => {
    const summary = arrayDiffSummary(key, oldValue[key], newValue[key]);
    return summary ? [summary] : [];
  });
}

function arrayDiffSummary(
  label: string,
  oldValue: unknown,
  newValue: unknown,
): string | null {
  const oldEntries = stringArray(oldValue);
  const newEntries = stringArray(newValue);
  if (oldEntries.length === 0 && newEntries.length === 0) return null;
  const added = newEntries.filter((entry) => !oldEntries.includes(entry));
  const removed = oldEntries.filter((entry) => !newEntries.includes(entry));
  return added.length || removed.length
    ? `${label}: ${diffTokens(added, removed)}`
    : null;
}

function recordKeyDiffSummary(
  label: string,
  oldValue: unknown,
  newValue: unknown,
): string | null {
  const oldKeys = isRecord(oldValue) ? Object.keys(oldValue).sort() : [];
  const newKeys = isRecord(newValue) ? Object.keys(newValue).sort() : [];
  const added = newKeys.filter((entry) => !oldKeys.includes(entry));
  const removed = oldKeys.filter((entry) => !newKeys.includes(entry));
  return added.length || removed.length
    ? `${label}: ${diffTokens(added, removed)}`
    : null;
}

function valueChangeSummary(
  label: string,
  oldValue: unknown,
  newValue: unknown,
): string | null {
  return unknownEquals(oldValue, newValue)
    ? null
    : `${label}: ${primitiveSummary(oldValue)} -> ${
      primitiveSummary(newValue)
    }`;
}

function diffTokens(added: string[], removed: string[]): string {
  return [
    ...added.map((entry) => `+${entry}`),
    ...removed.map((entry) => `-${entry}`),
  ].join(", ");
}

function primitiveSummary(value: unknown): string {
  if (value === undefined || value === null) return "none";
  if (typeof value === "string") return textSummary(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return stringArray(value).join(", ") || `${value.length} entries`;
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0 ? "changed" : "none";
  }
  return "changed";
}

function textSummary(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 80
    ? `${collapsed.slice(0, 77)}...`
    : collapsed || "empty";
}

function stringOrStringArray(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return stringArray(value).join(" | ");
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").sort()
    : [];
}

function changedFieldNames(oldValue: unknown, newValue: unknown): string {
  if (!isRecord(oldValue) || !isRecord(newValue)) return "changed";
  const changed = [
    ...new Set([
      ...Object.keys(oldValue),
      ...Object.keys(newValue),
    ]),
  ]
    .filter((key) => !unknownEquals(oldValue[key], newValue[key]))
    .sort((left, right) => left.localeCompare(right));
  return changed.length > 0 ? `changed: ${changed.join(", ")}` : "changed";
}

function stringArraySummary(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((entry): entry is string =>
    typeof entry === "string"
  );
  return strings.length > 0 ? strings.join(", ") : "none";
}

function labeledSchemaRef(label: string, value: unknown): string | null {
  const name = schemaRefName(value);
  return name ? `${label}: ${name}` : null;
}

function schemaRefName(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (!isRecord(value)) return null;
  const schema = value.schema;
  return typeof schema === "string" && schema.length > 0 ? schema : null;
}

function stringProperty(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unknownEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => unknownEquals(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && unknownEquals(left[key], right[key])
    );
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
      isRecord(capability) && typeof capability.capability === "string" &&
      capability.capability.length > 0 &&
      typeof capability.required === "boolean"
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

function needSearchTexts(needs: DeploymentAuthorityNeeds): string[] {
  return [
    ...needs.contracts.map((need) =>
      `${need.contractId} ${need.required ? "required" : "optional"}`
    ),
    ...needs.surfaces.map((need) =>
      `${need.contractId} ${need.kind} ${need.name} ${need.action ?? ""}`
    ),
    ...needs.resources.map((need) => `${need.kind} ${need.alias}`),
    ...needs.capabilities.map((need) => need.capability),
  ];
}

// json-schema-diff produces coarse-grained add/remove diffs.
// We use it for type-level and property-level changes; our own
// summarizer fills in field-level details the library doesn't cover.
