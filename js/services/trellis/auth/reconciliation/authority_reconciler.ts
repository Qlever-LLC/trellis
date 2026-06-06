import { ulid } from "ulid";

import {
  type AuthorityPhysicalResourceManager,
  materializeAuthorityResourceBindings,
  type ResourceProvisioningOptions,
} from "../../catalog/resources.ts";
import type {
  DeploymentAuthority,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityReconciliationStatus,
  DeploymentAuthorityResource,
  DeploymentAuthoritySurface,
  DeploymentResourceBinding,
  MaterializedAuthorityGrant,
  MaterializedAuthorityNatsGrant,
} from "../schemas.ts";

type DeploymentAuthorityStorage = {
  get(deploymentId: string): Promise<DeploymentAuthority | undefined>;
  listEnabled(): Promise<DeploymentAuthority[]>;
};

type MaterializedAuthorityStorage = {
  get(
    deploymentId: string,
  ): Promise<DeploymentAuthorityMaterialization | undefined>;
  put(record: DeploymentAuthorityMaterialization): Promise<void>;
};

type AuthorityReconciliationStorage = {
  getStatus(
    deploymentId: string,
  ): Promise<DeploymentAuthorityReconciliationStatus | undefined>;
  putStatus(record: DeploymentAuthorityReconciliationStatus): Promise<void>;
  appendEvent(record: {
    eventId: string;
    deploymentId: string;
    desiredVersion: string;
    state: "running" | "succeeded" | "failed";
    message: string | null;
    detailsJson: string | null;
    createdAt: string;
  }): Promise<void>;
};

export type AuthorityResourceMaterializerInput = {
  authority: DeploymentAuthority;
  existingBindings: DeploymentResourceBinding[];
};

export type AuthorityResourceMaterializer = {
  materialize(
    input: AuthorityResourceMaterializerInput,
  ): Promise<DeploymentResourceBinding[]>;
};

export type AuthorityNatsGrantMaterializerInput = {
  authority: DeploymentAuthority;
  resourceBindings: DeploymentResourceBinding[];
};

export type AuthorityNatsGrantMaterializer = {
  materialize(
    input: AuthorityNatsGrantMaterializerInput,
  ): Promise<MaterializedAuthorityNatsGrant[]>;
};

export type PhysicalAuthorityResourceMaterializerOptions = {
  manager: AuthorityPhysicalResourceManager;
  provisioning?: ResourceProvisioningOptions;
};

export type AuthorityReconciliationResult = {
  authority: DeploymentAuthority;
  materializedAuthority: DeploymentAuthorityMaterialization;
  reconciliation: DeploymentAuthorityReconciliationStatus;
};

export class AuthorityReconciliationError extends Error {
  readonly code: "not_found" | "desired_version_mismatch";
  readonly context: Record<string, unknown>;

  constructor(input: {
    code: AuthorityReconciliationError["code"];
    message: string;
    context?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "AuthorityReconciliationError";
    this.code = input.code;
    this.context = input.context ?? {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resourceKey(resource: DeploymentAuthorityResource): string {
  return `${resource.kind}:${resource.alias}`;
}

function surfaceKey(surface: DeploymentAuthoritySurface): string {
  return JSON.stringify([
    surface.contractId,
    surface.kind,
    surface.name,
    surface.action ?? "",
  ]);
}

function desiredResources(
  authority: DeploymentAuthority,
): DeploymentAuthorityResource[] {
  const resources = new Map<string, DeploymentAuthorityResource>();
  for (const resource of authority.desiredState.resources) {
    resources.set(resourceKey(resource), resource);
  }
  for (const need of authority.desiredState.needs) {
    if (need.kind === "resource") {
      resources.set(resourceKey(need.resource), need.resource);
    }
  }
  return [...resources.values()].sort((left, right) =>
    resourceKey(left).localeCompare(resourceKey(right))
  );
}

function materializedGrants(
  authority: DeploymentAuthority,
  natsGrants: MaterializedAuthorityNatsGrant[] = [],
): MaterializedAuthorityGrant[] {
  const capabilities = new Set(authority.desiredState.capabilities);
  const surfaces = new Map<string, DeploymentAuthoritySurface>();
  for (const surface of authority.desiredState.surfaces) {
    surfaces.set(surfaceKey(surface), surface);
  }
  for (const need of authority.desiredState.needs) {
    if (need.kind === "capability") capabilities.add(need.capability);
    if (need.kind === "surface") {
      surfaces.set(surfaceKey(need.surface), need.surface);
    }
  }
  return [
    ...[...capabilities].sort().map((capability) => ({
      kind: "capability" as const,
      capability,
    })),
    ...[...surfaces.values()].sort((left, right) =>
      surfaceKey(left).localeCompare(surfaceKey(right))
    ).map((surface) => ({
      kind: "surface" as const,
      contractId: surface.contractId,
      surfaceKind: surface.kind,
      name: surface.name,
      ...(surface.action === undefined ? {} : { action: surface.action }),
    })),
    ...natsGrants,
  ];
}

function eventId(deploymentId: string, state: string, at: string): string {
  return `${deploymentId}:${state}:${at}:${ulid()}`;
}

function status(input: {
  authority: DeploymentAuthority;
  state: DeploymentAuthorityReconciliationStatus["state"];
  startedAt: string | null;
  finishedAt: string | null;
  message?: string;
}): DeploymentAuthorityReconciliationStatus {
  return {
    deploymentId: input.authority.deploymentId,
    desiredVersion: input.authority.version,
    state: input.state,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    ...(input.message === undefined ? {} : { message: input.message }),
  };
}

/** Materializes explicit desired resource bindings without provisioning. */
export const explicitBindingAuthorityResourceMaterializer:
  AuthorityResourceMaterializer = {
    async materialize({ authority }) {
      const now = new Date().toISOString();
      return desiredResources(authority).map((resource) => {
        const definition = resource.definition ?? {};
        const binding = definition.binding;
        if (!isRecord(binding)) {
          throw new Error(
            `Resource ${resource.kind}:${resource.alias} cannot be materialized without definition.binding`,
          );
        }
        const limits = definition.limits;
        return {
          deploymentId: authority.deploymentId,
          kind: resource.kind,
          alias: resource.alias,
          binding,
          limits: isRecord(limits) ? limits : null,
          createdAt: now,
          updatedAt: now,
        };
      });
    },
  };

/** Materializes authority resources by creating, adopting, updating, or deleting physical resources. */
export function createPhysicalAuthorityResourceMaterializer(
  options: PhysicalAuthorityResourceMaterializerOptions,
): AuthorityResourceMaterializer {
  return {
    async materialize({ authority, existingBindings }) {
      return await materializeAuthorityResourceBindings({
        deploymentId: authority.deploymentId,
        resources: desiredResources(authority),
        existingBindings,
        manager: options.manager,
        provisioning: options.provisioning,
      });
    },
  };
}

/** Creates a deployment authority reconciler. */
export function createAuthorityReconciler(deps: {
  deploymentAuthorityStorage: DeploymentAuthorityStorage;
  materializedAuthorityStorage: MaterializedAuthorityStorage;
  authorityReconciliationStorage: AuthorityReconciliationStorage;
  resourceMaterializer?: AuthorityResourceMaterializer;
  natsGrantMaterializer?: AuthorityNatsGrantMaterializer;
  physicalResources?: PhysicalAuthorityResourceMaterializerOptions;
}) {
  const resourceMaterializer = deps.resourceMaterializer ??
    (deps.physicalResources
      ? createPhysicalAuthorityResourceMaterializer(deps.physicalResources)
      : undefined) ??
    explicitBindingAuthorityResourceMaterializer;

  async function reconcileDeployment(
    deploymentId: string,
    opts: { desiredVersion?: string } = {},
  ): Promise<AuthorityReconciliationResult> {
    const authority = await deps.deploymentAuthorityStorage.get(deploymentId);
    if (!authority) {
      throw new AuthorityReconciliationError({
        code: "not_found",
        message: "deployment authority not found",
        context: { deploymentId },
      });
    }
    if (
      opts.desiredVersion !== undefined &&
      opts.desiredVersion !== authority.version
    ) {
      throw new AuthorityReconciliationError({
        code: "desired_version_mismatch",
        message: "desired version does not match deployment authority",
        context: {
          deploymentId,
          desiredVersion: opts.desiredVersion,
          actualDesiredVersion: authority.version,
        },
      });
    }

    const startedAt = new Date().toISOString();
    const running = status({
      authority,
      state: "running",
      startedAt,
      finishedAt: null,
      message: "reconciliation started",
    });
    await deps.authorityReconciliationStorage.putStatus(running);
    await deps.authorityReconciliationStorage.appendEvent({
      eventId: eventId(deploymentId, "running", startedAt),
      deploymentId,
      desiredVersion: authority.version,
      state: "running",
      message: running.message ?? null,
      detailsJson: null,
      createdAt: startedAt,
    });

    const existingMaterialized = await deps.materializedAuthorityStorage.get(
      deploymentId,
    );
    const existingBindings = existingMaterialized?.resourceBindings ?? [];

    try {
      const resourceBindings = await resourceMaterializer.materialize({
        authority,
        existingBindings,
      });
      const natsGrants = await (deps.natsGrantMaterializer?.materialize({
        authority,
        resourceBindings,
      }) ?? Promise.resolve([]));
      const finishedAt = new Date().toISOString();
      const materializedAuthority: DeploymentAuthorityMaterialization = {
        deploymentId,
        desiredVersion: authority.version,
        status: "current",
        resourceBindings,
        grants: materializedGrants(authority, natsGrants),
        reconciledAt: finishedAt,
      };
      const reconciliation = status({
        authority,
        state: "succeeded",
        startedAt,
        finishedAt,
        message: "reconciliation succeeded",
      });
      await deps.materializedAuthorityStorage.put(materializedAuthority);
      await deps.authorityReconciliationStorage.putStatus(reconciliation);
      await deps.authorityReconciliationStorage.appendEvent({
        eventId: eventId(deploymentId, "succeeded", finishedAt),
        deploymentId,
        desiredVersion: authority.version,
        state: "succeeded",
        message: reconciliation.message ?? null,
        detailsJson: JSON.stringify({
          resourceBindings: resourceBindings.length,
        }),
        createdAt: finishedAt,
      });
      return { authority, materializedAuthority, reconciliation };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date().toISOString();
      const materializedAuthority: DeploymentAuthorityMaterialization = {
        deploymentId,
        desiredVersion: authority.version,
        status: "failed",
        resourceBindings: existingBindings,
        grants: [],
        reconciledAt: null,
        error: message,
      };
      const reconciliation = status({
        authority,
        state: "failed",
        startedAt,
        finishedAt,
        message,
      });
      await deps.materializedAuthorityStorage.put(materializedAuthority);
      await deps.authorityReconciliationStorage.putStatus(reconciliation);
      await deps.authorityReconciliationStorage.appendEvent({
        eventId: eventId(deploymentId, "failed", finishedAt),
        deploymentId,
        desiredVersion: authority.version,
        state: "failed",
        message,
        detailsJson: JSON.stringify({ error: message }),
        createdAt: finishedAt,
      });
      return { authority, materializedAuthority, reconciliation };
    }
  }

  async function reconcileAllEnabled(): Promise<
    AuthorityReconciliationResult[]
  > {
    const authorities = await deps.deploymentAuthorityStorage.listEnabled();
    const results: AuthorityReconciliationResult[] = [];
    for (const authority of authorities) {
      results.push(await reconcileDeployment(authority.deploymentId));
    }
    return results;
  }

  return { reconcileDeployment, reconcileAllEnabled };
}
