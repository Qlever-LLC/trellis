import type {
  AuthEnvelopeExpansionsListResponse,
  AuthEnvelopesGetResponse,
  DeploymentEnvelope,
  EnvelopeBoundary,
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

type DeploymentResourceBinding =
  AuthEnvelopesGetResponse["resourceBindings"][number];
type EnvelopeBoundarySurface = EnvelopeBoundary["surfaces"][number];
type EnvelopeExpansionRequest =
  AuthEnvelopeExpansionsListResponse["entries"][number];

export type DeltaContractRow = {
  id: string;
  contractId: string;
  availability: "required" | "optional";
};

export type DeltaSurfaceRow = {
  id: string;
  contractId: string;
  kind: EnvelopeBoundarySurface["kind"];
  name: string;
  action: EnvelopeBoundarySurface["action"];
  availability: "required" | "optional";
};

export type DeltaResourceRow = {
  id: string;
  kind: EnvelopeBoundary["resources"][number]["kind"];
  alias: string;
  availability: "required" | "optional";
};

export type DeltaCapabilityRow = {
  id: string;
  capability: string;
};

export type BoundaryCounts = {
  requiredContracts: number;
  optionalContracts: number;
  requiredSurfaces: number;
  optionalSurfaces: number;
  requiredResources: number;
  optionalResources: number;
  capabilities: number;
};

export type EnvelopeRow = {
  deploymentId: string;
  kind: DeploymentEnvelope["kind"];
  status: "Active" | "Disabled";
  requiredContracts: number;
  optionalContracts: number;
  surfaces: number;
  resources: number;
  capabilities: number;
  updatedAt: string;
};

export type ExpansionRequestRow = {
  requestId: string;
  deploymentId: string;
  state: EnvelopeExpansionRequest["state"];
  requestedByKind: EnvelopeExpansionRequest["requestedByKind"];
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
  kind: EnvelopeBoundarySurface["kind"];
  action: EnvelopeBoundarySurface["action"];
  availability: "required" | "optional";
  runtime: "live" | "disabled" | "no_live_implementer";
};

export function boundaryCounts(boundary: EnvelopeBoundary): BoundaryCounts {
  return {
    requiredContracts:
      boundary.contracts.filter((contract) => contract.required)
        .length,
    optionalContracts:
      boundary.contracts.filter((contract) => !contract.required)
        .length,
    requiredSurfaces: boundary.surfaces.filter((surface) => surface.required)
      .length,
    optionalSurfaces: boundary.surfaces.filter((surface) => !surface.required)
      .length,
    requiredResources:
      boundary.resources.filter((resource) => resource.required)
        .length,
    optionalResources:
      boundary.resources.filter((resource) => !resource.required)
        .length,
    capabilities: boundary.capabilities.length,
  };
}

export function envelopeRows(envelopes: DeploymentEnvelope[]): EnvelopeRow[] {
  return envelopes.map((envelope) => {
    const counts = boundaryCounts(envelope.boundary);
    return {
      deploymentId: envelope.deploymentId,
      kind: envelope.kind,
      status: envelope.disabled ? "Disabled" : "Active",
      requiredContracts: counts.requiredContracts,
      optionalContracts: counts.optionalContracts,
      surfaces: envelope.boundary.surfaces.length,
      resources: envelope.boundary.resources.length,
      capabilities: counts.capabilities,
      updatedAt: envelope.updatedAt,
    };
  });
}

export function expansionRequestRows(
  requests: EnvelopeExpansionRequest[],
): ExpansionRequestRow[] {
  return requests.map((request) => {
    const counts = boundaryCounts(request.delta);
    return {
      requestId: request.requestId,
      deploymentId: request.deploymentId,
      state: request.state,
      requestedByKind: request.requestedByKind,
      contractId: request.contractId,
      contractDigest: request.contractDigest,
      requiredContracts: counts.requiredContracts,
      optionalContracts: counts.optionalContracts,
      requiredSurfaces: counts.requiredSurfaces,
      optionalSurfaces: counts.optionalSurfaces,
      requiredResources: counts.requiredResources,
      optionalResources: counts.optionalResources,
      resources: counts.requiredResources + counts.optionalResources,
      capabilities: counts.capabilities,
      createdAt: request.createdAt,
      searchableText: [
        request.requestId,
        request.deploymentId,
        request.state,
        request.requestedByKind,
        request.contractId,
        request.contractDigest,
        ...request.delta.contracts.map((contract) => contract.contractId),
        ...request.delta.surfaces.map((surface) =>
          `${surface.contractId} ${surface.kind} ${surface.name} ${surface.action}`
        ),
        ...request.delta.resources.map((resource) =>
          `${resource.kind} ${resource.alias}`
        ),
        ...request.delta.capabilities,
      ].join(" ").toLowerCase(),
    };
  });
}

export function deltaContractRows(
  boundary: EnvelopeBoundary,
): DeltaContractRow[] {
  return boundary.contracts.map((contract) => ({
    id: contract.contractId,
    contractId: contract.contractId,
    availability: contract.required ? "required" : "optional",
  }));
}

export function deltaSurfaceRows(
  boundary: EnvelopeBoundary,
): DeltaSurfaceRow[] {
  return boundary.surfaces.map((surface) => ({
    id:
      `${surface.contractId}:${surface.kind}:${surface.name}:${surface.action}`,
    contractId: surface.contractId,
    kind: surface.kind,
    name: surface.name,
    action: surface.action,
    availability: surface.required ? "required" : "optional",
  }));
}

export function deltaResourceRows(
  boundary: EnvelopeBoundary,
): DeltaResourceRow[] {
  return boundary.resources.map((resource) => ({
    id: `${resource.kind}:${resource.alias}`,
    kind: resource.kind,
    alias: resource.alias,
    availability: resource.required ? "required" : "optional",
  }));
}

export function deltaCapabilityRows(
  boundary: EnvelopeBoundary,
): DeltaCapabilityRow[] {
  return boundary.capabilities.map((capability) => ({
    id: capability,
    capability,
  }));
}

export function chooseSelectedExpansionRequest(
  requests: EnvelopeExpansionRequest[],
  selectedRequestId: string | null,
): string | null {
  if (
    selectedRequestId &&
    requests.some((request) => request.requestId === selectedRequestId)
  ) {
    return selectedRequestId;
  }
  return requests[0]?.requestId ?? null;
}

export function livenessRows(
  boundary: EnvelopeBoundary,
  runtimeDeployments: RuntimeDeployment[],
  deploymentId?: string,
): LivenessRow[] {
  return boundary.surfaces.map((surface) => {
    const relevantRuntimeDeployments = runtimeDeployments.filter((runtime) =>
      runtimeDeploymentMatchesSurface(runtime, surface, deploymentId)
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
      id:
        `${surface.contractId}:${surface.kind}:${surface.name}:${surface.action}`,
      contractId: surface.contractId,
      surface: surface.name,
      kind: surface.kind,
      action: surface.action,
      availability: surface.required ? "required" : "optional",
      runtime,
    };
  });
}

function runtimeDeploymentMatchesSurface(
  runtime: RuntimeDeployment,
  surface: EnvelopeBoundarySurface,
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
  envelopes: DeploymentEnvelope[],
  selectedDeploymentId: string | null,
): string | null {
  if (
    selectedDeploymentId &&
    envelopes.some((envelope) => envelope.deploymentId === selectedDeploymentId)
  ) {
    return selectedDeploymentId;
  }
  return envelopes[0]?.deploymentId ?? null;
}

export class EnvelopeSelectionGuard {
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

export function formatBindingTarget(
  binding: DeploymentResourceBinding,
): string {
  const targetKeys = ["bucket", "name", "queue", "stream", "subject"];
  for (const key of targetKeys) {
    const value = binding.binding[key];
    if (typeof value === "string" && value.length > 0) {
      return `${key}: ${value}`;
    }
  }
  return `${binding.kind}: ${binding.alias}`;
}
