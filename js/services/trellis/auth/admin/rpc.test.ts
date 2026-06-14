import { assert, assertEquals } from "@std/assert";
import { AsyncResult, isErr, Result } from "@qlever-llc/result";
import type { OperationSnapshot } from "@qlever-llc/trellis";
import {
  digestContractManifest,
  type TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import Value from "typebox/value";
import {
  AuthConnectionsListResponseSchema,
  AuthSessionsListResponseSchema,
} from "@qlever-llc/trellis/sdk/auth";
import {
  TRELLIS_AUTH_EVENTS,
  TRELLIS_AUTH_OPERATIONS,
  TRELLIS_AUTH_RPC,
} from "../../contracts/trellis_auth.ts";

import {
  type DeviceDeployment,
  type DeviceInstance,
  normalizeStringList,
  type ServiceDeployment,
  type ServiceInstance,
  validateDeviceDeploymentRequest,
  validateDeviceProvisionRequest,
  validateServiceDeploymentRequest,
} from "./shared.ts";
import { type AdminRpcDeps, createDeviceAdminHandlers } from "./rpc.ts";
import type { ActiveCatalogIssue } from "../../catalog/runtime.ts";
import {
  createAuthDeploymentsServiceCreateHandler,
  createAuthDeploymentsServiceDisableHandler,
  createAuthDeploymentsServiceEnableHandler,
  createAuthDeploymentsServiceListHandler,
  createAuthDeploymentsServiceRemoveHandler,
  createAuthServiceInstancesDisableHandler,
  createAuthServiceInstancesEnableHandler,
  createAuthServiceInstancesListHandler,
  createAuthServiceInstancesProvisionHandler,
  createAuthServiceInstancesRemoveHandler,
  type ServiceAdminRpcDeps,
} from "./service_rpc.ts";
import {
  createAuthDeploymentAuthorityAcceptMigrationHandler,
  createAuthDeploymentAuthorityAcceptUpdateHandler,
  createAuthDeploymentAuthorityPlansGetHandler,
  createAuthDeploymentAuthorityPlansListHandler,
  createAuthDeploymentAuthorityRejectHandler,
} from "./authority_rpc.ts";
import { classifyDeploymentAuthorityPlan } from "../deployment_authority_plan.ts";
import type {
  AuthorityNeedSet,
  DeploymentAuthority,
  DeploymentAuthorityCapabilityDefinition,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityPlan,
  DeploymentAuthorityUpdate,
} from "../schemas.ts";

type AuthorityCapabilityNeed = AuthorityNeedSet["capabilities"][number];
type AuthorityContractNeed = AuthorityNeedSet["contracts"][number];
type AuthorityResourceNeed = AuthorityNeedSet["resources"][number];
type AuthoritySurfaceNeed = AuthorityNeedSet["surfaces"][number];
type MaterializedAuthorityGrants = DeploymentAuthorityMaterialization["grants"];
type LegacyAuthorityNeed =
  | ({ kind: "contract" } & AuthorityContractNeed)
  | { kind: "capability"; capability: string; required: boolean }
  | { kind: "resource"; resource: AuthorityResourceNeed; required: boolean }
  | {
    kind: "surface";
    surface: Omit<AuthoritySurfaceNeed, "required">;
    required: boolean;
  };
type AuthorityNeedSetOverrides =
  & Omit<Partial<AuthorityNeedSet>, "capabilities">
  & {
    capabilities?: Array<string | AuthorityCapabilityNeed>;
  };
type DeploymentAuthorityOverrides =
  & Omit<Partial<DeploymentAuthority>, "desiredState">
  & {
    desiredState?:
      & Omit<Partial<DeploymentAuthority["desiredState"]>, "needs">
      & {
        needs?: AuthorityNeedSet | LegacyAuthorityNeed[];
      };
  };
type DeploymentAuthorityPlanOverrides =
  & Omit<
    Partial<DeploymentAuthorityUpdate>,
    "proposal" | "desiredChange"
  >
  & {
    proposal?:
      & Omit<Partial<DeploymentAuthorityUpdate["proposal"]>, "requestedNeeds">
      & {
        requestedNeeds?: AuthorityNeedSet | LegacyAuthorityNeed[];
      };
    desiredChange?:
      | AuthorityNeedSet
      | AuthorityNeedSetOverrides
      | LegacyAuthorityNeed[];
  };

const page = <T>(entries: T[], limit = 10) => ({
  entries,
  count: entries.length,
  offset: 0,
  limit,
});

const pageFromQuery = <T>(
  entries: T[],
  query: { offset?: number; limit: number },
) => {
  const offset = query.offset ?? 0;
  return {
    entries: entries.slice(offset, offset + query.limit),
    count: entries.length,
    offset,
    limit: query.limit,
    nextOffset: query.limit <= 0 || offset + query.limit >= entries.length
      ? undefined
      : offset + query.limit,
  };
};

async function* emptyKeys(): AsyncIterable<string> {}

async function* oneConnectionKey(): AsyncIterable<string> {
  yield "connection-1";
}

function throwingStoreAccess(): never {
  throw new Error("service admin storage should not be touched");
}

function throwingKvAccess(): never {
  throw new Error("service admin connection KV should not be touched");
}

function serviceAdminDeps(): ServiceAdminRpcDeps {
  return {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
      listFiltered: async () => throwingStoreAccess(),
      listFilteredPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
      listFiltered: async () => throwingStoreAccess(),
      listFilteredPage: async () => throwingStoreAccess(),
      listByDeployment: async () => throwingStoreAccess(),
    },
    deploymentAuthorityStorage: {
      get: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
    },
  };
}

class InMemoryServiceDeploymentStorage {
  #deployments = new Map<string, ServiceDeployment>();
  putCount = 0;

  seed(deployment: ServiceDeployment): void {
    this.#deployments.set(deployment.deploymentId, deployment);
  }

  getValue(deploymentId: string): ServiceDeployment | undefined {
    return this.#deployments.get(deploymentId);
  }

  async get(deploymentId: string): Promise<ServiceDeployment | undefined> {
    await Promise.resolve();
    return this.#deployments.get(deploymentId);
  }

  async put(deployment: ServiceDeployment): Promise<void> {
    await Promise.resolve();
    this.putCount += 1;
    this.#deployments.set(deployment.deploymentId, deployment);
  }

  async delete(deploymentId: string): Promise<void> {
    await Promise.resolve();
    this.#deployments.delete(deploymentId);
  }

  async listPage(
    query: { offset?: number; limit: number },
  ): Promise<ServiceDeployment[]> {
    await Promise.resolve();
    return [...this.#deployments.values()].slice(
      query.offset ?? 0,
      (query.offset ?? 0) + query.limit,
    );
  }

  async listFiltered(
    filters: { disabled?: boolean },
    query: { offset?: number; limit: number },
  ): Promise<ServiceDeployment[]> {
    await Promise.resolve();
    return [...this.#deployments.values()].filter((deployment) =>
      filters.disabled === undefined || deployment.disabled === filters.disabled
    );
  }

  async listFilteredPage(
    filters: { disabled?: boolean },
    query: { offset?: number; limit: number },
  ) {
    return pageFromQuery(await this.listFiltered(filters, query), query);
  }
}

const serviceContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "acme.billing@v1",
  displayName: "Billing",
  description: "Billing service",
  kind: "service",
};

const adminCaller = {
  type: "user" as const,
  participantKind: "app" as const,
  userId: "admin",
  identity: {
    identityId: "idn_admin",
    provider: "github",
    subject: "admin",
  },
  active: true,
  name: "Admin",
  email: "admin@example.com",
  capabilities: ["admin"],
  lastAuth: new Date().toISOString(),
};

const nonAdminCaller = {
  ...adminCaller,
  userId: "not-admin",
  identity: {
    identityId: "idn_not_admin",
    provider: "github",
    subject: "not-admin",
  },
  capabilities: [],
};

const adminContext = { caller: adminCaller };
const adminActivationActor = {
  participantKind: adminCaller.participantKind,
  userId: adminCaller.userId,
  identity: adminCaller.identity,
};
const userActivationActor = {
  participantKind: "app" as const,
  userId: "user_1",
  identity: {
    identityId: "idn_github_user_1",
    provider: "github",
    subject: "user_1",
  },
};
const portalActivationActor = {
  participantKind: "app" as const,
  userId: "main",
  identity: {
    identityId: "idn_portal_main",
    provider: "portal",
    subject: "main",
  },
};

class InMemoryDeploymentAuthorityStorage {
  #authority: DeploymentAuthority | undefined;

  constructor(authority?: DeploymentAuthority) {
    this.#authority = authority;
  }

  async get(deploymentId: string): Promise<DeploymentAuthority | undefined> {
    await Promise.resolve();
    return this.#authority?.deploymentId === deploymentId
      ? this.#authority
      : undefined;
  }

  async put(authority: DeploymentAuthority): Promise<void> {
    await Promise.resolve();
    this.#authority = authority;
  }

  getValue(): DeploymentAuthority | undefined {
    return this.#authority;
  }
}

class InMemoryDeploymentAuthorityPlanStorage {
  #plans = new Map<string, DeploymentAuthorityPlan>();

  constructor(plans: DeploymentAuthorityPlan[] = []) {
    for (const plan of plans) this.#plans.set(plan.planId, plan);
  }

  async get(planId: string): Promise<DeploymentAuthorityPlan | undefined> {
    await Promise.resolve();
    return this.#plans.get(planId);
  }

  async put(plan: DeploymentAuthorityPlan): Promise<void> {
    await Promise.resolve();
    this.#plans.set(plan.planId, plan);
  }

  async listFilteredPage(
    filters: {
      deploymentId?: string;
      state?: DeploymentAuthorityPlan["state"];
      classification?: DeploymentAuthorityPlan["classification"];
      kind?: DeploymentAuthority["kind"];
    },
    query: { offset?: number; limit: number },
  ) {
    await Promise.resolve();
    const entries = [...this.#plans.values()]
      .filter((plan) =>
        (filters.deploymentId === undefined ||
          plan.deploymentId === filters.deploymentId) &&
        (filters.state === undefined || plan.state === filters.state) &&
        (filters.classification === undefined ||
          plan.classification === filters.classification) &&
        (filters.kind === undefined ||
          plan.deploymentId.startsWith(filters.kind))
      )
      .sort((left, right) =>
        left.deploymentId.localeCompare(right.deploymentId) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.planId.localeCompare(right.planId)
      );
    return pageFromQuery(entries, query);
  }

  getValue(planId: string): DeploymentAuthorityPlan | undefined {
    return this.#plans.get(planId);
  }
}

class InMemoryCapabilityDefinitionStorage {
  writes: Array<{
    deploymentId: string;
    definitions: DeploymentAuthorityCapabilityDefinition[];
  }> = [];

  async replaceForDeployment(
    deploymentId: string,
    definitions: DeploymentAuthorityCapabilityDefinition[],
  ): Promise<void> {
    await Promise.resolve();
    this.writes.push({ deploymentId, definitions });
  }
}

function deploymentAuthority(
  overrides: DeploymentAuthorityOverrides = {},
): DeploymentAuthority {
  const { desiredState: desiredStateOverride, ...authorityOverrides } =
    overrides;
  const desiredState: DeploymentAuthority["desiredState"] = {
    needs: authorityNeedSet(desiredStateOverride?.needs),
    capabilities: desiredStateOverride?.capabilities ?? [],
    resources: desiredStateOverride?.resources ?? [],
    surfaces: desiredStateOverride?.surfaces ?? [],
  };
  return {
    deploymentId: "svc-a",
    kind: "service",
    disabled: false,
    desiredState,
    version: "v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...authorityOverrides,
  };
}

function deploymentAuthorityPlan(
  overrides: DeploymentAuthorityPlanOverrides = {},
): DeploymentAuthorityPlan {
  const {
    desiredChange: desiredChangeOverride,
    proposal: proposalOverride,
    ...planOverrides
  } = overrides;
  return {
    classification: "update",
    planId: "plan-a",
    deploymentId: "svc-a",
    proposal: {
      deploymentId: "svc-a",
      contractId: "svc.contract@v1",
      contractDigest: "sha256-a",
      providedSurfaces: [],
      summary: { desiredVersion: "v1" },
      ...proposalOverride,
      requestedNeeds: authorityNeedSet(proposalOverride?.requestedNeeds),
    },
    desiredChange: authorityNeedSet(
      desiredChangeOverride ?? {
        contracts: [{ contractId: "svc.contract@v1", required: true }],
        capabilities: [{ capability: "svc.use", required: true }],
      },
    ),
    materializationPreview: {},
    warnings: [],
    createdAt: "2026-01-01T00:00:01.000Z",
    state: "pending",
    ...planOverrides,
  };
}

function authorityNeedSet(
  overrides?:
    | AuthorityNeedSet
    | AuthorityNeedSetOverrides
    | LegacyAuthorityNeed[],
): AuthorityNeedSet {
  if (overrides === undefined) {
    return { contracts: [], surfaces: [], capabilities: [], resources: [] };
  }
  if (Array.isArray(overrides)) return legacyAuthorityNeeds(overrides);
  return {
    contracts: [],
    surfaces: [],
    resources: [],
    ...overrides,
    capabilities: (overrides.capabilities ?? []).map((capability) =>
      typeof capability === "string"
        ? { capability, required: true }
        : capability
    ),
  };
}

function legacyAuthorityNeeds(needs: LegacyAuthorityNeed[]): AuthorityNeedSet {
  const grouped: AuthorityNeedSet = {
    contracts: [],
    surfaces: [],
    capabilities: [],
    resources: [],
  };
  for (const need of needs) {
    if (need.kind === "contract") {
      grouped.contracts.push({
        contractId: need.contractId,
        required: need.required,
      });
    } else if (need.kind === "capability") {
      grouped.capabilities.push({
        capability: need.capability,
        required: need.required,
      });
    } else if (need.kind === "resource") {
      grouped.resources.push({ ...need.resource, required: need.required });
    } else {
      grouped.surfaces.push({ ...need.surface, required: need.required });
    }
  }
  return grouped;
}

function emptyMaterializedGrants(): MaterializedAuthorityGrants {
  return { capabilities: [], surfaces: [], nats: [] };
}

function kickDeps(serviceDeps: ServiceAdminRpcDeps) {
  return {
    ...serviceDeps,
    deploymentAuthorityStorage: serviceDeps.deploymentAuthorityStorage ?? {
      get: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
    },
    kick: async () => {},
    refreshActiveContracts: async () => {},
    validateActiveCatalog: async () => {},
    connectionsKV: {
      get: () => throwingKvAccess(),
      put: () => throwingKvAccess(),
      create: () => throwingKvAccess(),
      delete: () => throwingKvAccess(),
      keys: () => throwingKvAccess(),
    },
    sessionStorage: {
      deleteByInstanceKey: async () => throwingStoreAccess(),
    },
  };
}

async function assertInsufficientPermissions(action: () => Promise<unknown>) {
  const result = await action();
  assert(isErr(result));
  assert("reason" in result.error);
  assertEquals(result.error.reason, "insufficient_permissions");
}

type DeviceActivationReviewRecord = Parameters<
  AdminRpcDeps["deviceActivationReviewStorage"]["put"]
>[0];
type DeviceActivationRecord = Parameters<
  AdminRpcDeps["deviceActivationStorage"]["put"]
>[0];

function operationSnapshot(
  operationId: string,
  output: unknown,
): OperationSnapshot {
  return {
    id: operationId,
    service: "trellis",
    operation: "Auth.DeviceUserAuthorities.Resolve",
    revision: 2,
    state: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    output,
  };
}

Deno.test("normalizeStringList preserves order and removes duplicates", () => {
  assertEquals(
    normalizeStringList(["b", "a", "b", "c", "a"]),
    ["b", "a", "c"],
  );
});

Deno.test("auth contract exposes deployment and device admin RPCs", () => {
  const methods = Object.keys(TRELLIS_AUTH_RPC);
  assert(methods.includes("Auth.Deployments.Create"));
  assert(methods.includes("Auth.Deployments.List"));
  assert(methods.includes("Auth.Deployments.Disable"));
  assert(methods.includes("Auth.Deployments.Enable"));
  assert(methods.includes("Auth.Deployments.Remove"));
  assert(methods.includes("Auth.Devices.Provision"));
  assert(methods.includes("Auth.Devices.List"));
  assert(methods.includes("Auth.Devices.Disable"));
  assert(methods.includes("Auth.Devices.Enable"));
  assert(methods.includes("Auth.Devices.Remove"));
  assert(methods.includes("Auth.DeviceUserAuthorities.List"));
  assert(methods.includes("Auth.DeviceUserAuthorities.Revoke"));
  assert(methods.includes("Auth.DeviceUserAuthorities.Reviews.List"));
  assert(methods.includes("Auth.DeviceUserAuthorities.Reviews.Decide"));
  assert(methods.includes("Auth.DeploymentAuthority.List"));
  assert(methods.includes("Auth.DeploymentAuthority.Get"));
  assert(methods.includes("Auth.DeploymentAuthority.Plans.List"));
  assert(methods.includes("Auth.DeploymentAuthority.Plans.Get"));
  assert(methods.includes("Auth.DeploymentAuthority.Plan"));
  assert(methods.includes("Auth.DeploymentAuthority.AcceptUpdate"));
  assert(methods.includes("Auth.DeploymentAuthority.AcceptMigration"));
  assert(methods.includes("Auth.DeploymentAuthority.Reject"));
  assert(methods.includes("Auth.DeploymentAuthority.Reconcile"));
  assert(methods.includes("Auth.DeploymentAuthority.GrantOverrides.List"));
  assert(methods.includes("Auth.DeploymentAuthority.GrantOverrides.Put"));
  assert(methods.includes("Auth.DeploymentAuthority.GrantOverrides.Remove"));
  assert(methods.includes("Auth.ServiceInstances.Provision"));
  assert(methods.includes("Auth.ServiceInstances.List"));
  assert(methods.includes("Auth.ServiceInstances.Disable"));
  assert(methods.includes("Auth.ServiceInstances.Enable"));
  assert(methods.includes("Auth.ServiceInstances.Remove"));
  assert(methods.includes("Auth.IdentityGrants.List"));
  assert(methods.includes("Auth.IdentityGrants.Revoke"));
  assert(!methods.includes("Auth.Identities.Grants.List"));

  const operations = Object.keys(TRELLIS_AUTH_OPERATIONS);
  assertEquals(operations, ["Auth.DeviceUserAuthorities.Resolve"]);
});

Deno.test("Auth.DeploymentAuthority.Plans.List filters pending and historical plans", async () => {
  const migrationPlan: DeploymentAuthorityPlan = {
    ...deploymentAuthorityPlan({
      planId: "plan-migration",
      deploymentId: "device-a",
      state: "accepted",
      createdAt: "2026-01-01T00:00:03.000Z",
    }),
    classification: "migration",
    acknowledgementRequired: true,
  };
  const plans = new InMemoryDeploymentAuthorityPlanStorage([
    deploymentAuthorityPlan({
      planId: "plan-pending",
      deploymentId: "service-a",
      state: "pending",
      createdAt: "2026-01-01T00:00:01.000Z",
    }),
    deploymentAuthorityPlan({
      planId: "plan-rejected",
      deploymentId: "service-a",
      state: "rejected",
      createdAt: "2026-01-01T00:00:02.000Z",
      decisionAt: "2026-01-01T00:01:00.000Z",
      decisionReason: "not now",
    }),
    migrationPlan,
  ]);
  const handler = createAuthDeploymentAuthorityPlansListHandler({
    deploymentAuthorityPlanStorage: plans,
    logger: { trace: () => {} },
  });

  const pending = await handler({
    input: { state: "pending", limit: 10 },
    context: adminContext,
  });
  assert(!pending.isErr());
  const pendingValue = pending.take();
  if (isErr(pendingValue)) throw pendingValue.error;
  assertEquals(pendingValue.entries.map((plan) => plan.planId), [
    "plan-pending",
  ]);

  const historical = await handler({
    input: { deploymentId: "service-a", limit: 10 },
    context: adminContext,
  });
  assert(!historical.isErr());
  const historicalValue = historical.take();
  if (isErr(historicalValue)) throw historicalValue.error;
  assertEquals(historicalValue.entries.map((plan) => plan.planId), [
    "plan-pending",
    "plan-rejected",
  ]);

  const migrations = await handler({
    input: { classification: "migration", kind: "device", limit: 10 },
    context: adminContext,
  });
  assert(!migrations.isErr());
  const migrationsValue = migrations.take();
  if (isErr(migrationsValue)) throw migrationsValue.error;
  assertEquals(migrationsValue.entries.map((plan) => plan.planId), [
    "plan-migration",
  ]);
});

Deno.test("Auth.DeploymentAuthority.Plans.Get returns one plan", async () => {
  const plans = new InMemoryDeploymentAuthorityPlanStorage([
    deploymentAuthorityPlan({ planId: "plan-a" }),
  ]);
  const handler = createAuthDeploymentAuthorityPlansGetHandler({
    deploymentAuthorityPlanStorage: plans,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a" },
    context: adminContext,
  });

  assert(!result.isErr());
  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(value.plan.planId, "plan-a");
});

Deno.test("Auth.DeploymentAuthority.Plans.Get validates missing plan", async () => {
  const handler = createAuthDeploymentAuthorityPlansGetHandler({
    deploymentAuthorityPlanStorage:
      new InMemoryDeploymentAuthorityPlanStorage(),
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "missing-plan" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(result.error.name, "ValidationError");
});

Deno.test("Auth.DeploymentAuthority.AcceptUpdate accepts pending plan without materializing", async () => {
  const capabilityDefinition: DeploymentAuthorityCapabilityDefinition = {
    deploymentId: "svc-a",
    key: "svc.use",
    displayName: "Use service",
    description: "Use service capabilities.",
    source: "contract",
    contractId: "svc.contract@v1",
    contractDigest: "sha256-a",
    contractDisplayName: "Service Contract",
    direction: "creates",
  };
  const authorities = new InMemoryDeploymentAuthorityStorage(
    deploymentAuthority({
      desiredState: {
        needs: authorityNeedSet({
          contracts: [{ contractId: "svc.contract@v1", required: true }],
        }),
        capabilities: [],
        resources: [],
        surfaces: [],
      },
    }),
  );
  const plans = new InMemoryDeploymentAuthorityPlanStorage([
    deploymentAuthorityPlan({
      proposal: {
        deploymentId: "svc-a",
        contractId: "svc.contract@v1",
        contractDigest: "sha256-a",
        requestedNeeds: authorityNeedSet(),
        providedSurfaces: [],
        summary: {
          desiredVersion: "v1",
          authorityCapabilityDefinitions: [capabilityDefinition],
        },
      },
    }),
  ]);
  const capabilityDefinitions = new InMemoryCapabilityDefinitionStorage();
  const reconciliations: Array<
    { deploymentId: string; desiredVersion?: string }
  > = [];
  const handler = createAuthDeploymentAuthorityAcceptUpdateHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    capabilityDefinitionStorage: capabilityDefinitions,
    authorityReconciler: {
      reconcileDeployment: async (deploymentId, opts) => {
        reconciliations.push({
          deploymentId,
          desiredVersion: opts?.desiredVersion,
        });
        return {
          authority: authorities.getValue() ?? deploymentAuthority(),
          materializedAuthority: {
            deploymentId,
            desiredVersion: opts?.desiredVersion ?? "v1",
            status: "current",
            resourceBindings: [],
            grants: emptyMaterializedGrants(),
            reconciledAt: "2026-01-01T00:00:02.000Z",
          },
          reconciliation: {
            deploymentId,
            desiredVersion: opts?.desiredVersion ?? "v1",
            state: "succeeded",
            startedAt: "2026-01-01T00:00:02.000Z",
            finishedAt: "2026-01-01T00:00:03.000Z",
          },
        };
      },
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a", expectedDesiredVersion: "v1" },
    context: adminContext,
  });

  assert(!result.isErr());
  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(
    value.authority.desiredState.needs,
    authorityNeedSet({
      contracts: [{ contractId: "svc.contract@v1", required: true }],
      capabilities: [{ capability: "svc.use", required: true }],
    }),
  );
  assert(value.authority.version !== "v1");
  assertEquals(plans.getValue("plan-a")?.state, "accepted");
  assertEquals(reconciliations, [{
    deploymentId: "svc-a",
    desiredVersion: value.authority.version,
  }]);
  assertEquals(capabilityDefinitions.writes, [{
    deploymentId: "svc-a",
    definitions: [capabilityDefinition],
  }]);
});

Deno.test("Auth.DeploymentAuthority.AcceptUpdate persists normalized resource definitions", async () => {
  const resource = {
    kind: "kv" as const,
    alias: "cache",
    required: true,
    definition: {
      type: "kv",
      history: 3,
      ttlMs: 60000,
      maxValueBytes: 4096,
      schema: { name: "Entry", exported: true },
    },
  };
  const authorities = new InMemoryDeploymentAuthorityStorage(
    deploymentAuthority({
      desiredState: {
        needs: authorityNeedSet({
          contracts: [{ contractId: "svc.contract@v1", required: true }],
        }),
        capabilities: [],
        resources: [],
        surfaces: [],
      },
    }),
  );
  const plans = new InMemoryDeploymentAuthorityPlanStorage([{
    ...deploymentAuthorityPlan(),
    proposal: {
      deploymentId: "svc-a",
      contractId: "svc.contract@v1",
      contractDigest: "sha256-a",
      requestedNeeds: authorityNeedSet({ resources: [resource] }),
      providedSurfaces: [],
      summary: { desiredVersion: "v1" },
    },
    desiredChange: authorityNeedSet({ resources: [resource] }),
  }]);
  const handler = createAuthDeploymentAuthorityAcceptUpdateHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async (deploymentId, opts) => ({
        authority: authorities.getValue() ?? deploymentAuthority(),
        materializedAuthority: {
          deploymentId,
          desiredVersion: opts?.desiredVersion ?? "v1",
          status: "current",
          resourceBindings: [],
          grants: emptyMaterializedGrants(),
          reconciledAt: "2026-01-01T00:00:02.000Z",
        },
        reconciliation: {
          deploymentId,
          desiredVersion: opts?.desiredVersion ?? "v1",
          state: "succeeded",
          startedAt: "2026-01-01T00:00:02.000Z",
          finishedAt: "2026-01-01T00:00:03.000Z",
        },
      }),
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a" },
    context: adminContext,
  });

  assert(!result.isErr());
  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(value.authority.desiredState.resources, [resource]);
  assertEquals(
    value.authority.desiredState.needs,
    authorityNeedSet({
      contracts: [{ contractId: "svc.contract@v1", required: true }],
      resources: [resource],
    }),
  );
});

Deno.test("Auth.DeploymentAuthority.Plan classifies additive missing needs as update", () => {
  const result = classifyDeploymentAuthorityPlan(
    authorityNeedSet({ capabilities: ["svc.read"] }),
    authorityNeedSet({
      capabilities: ["svc.read", "svc.write"],
      resources: [{ kind: "kv", alias: "cache", required: true }],
    }),
  );

  assertEquals(result.classification, "update");
  assertEquals(
    result.desiredChange,
    authorityNeedSet({
      capabilities: ["svc.write"],
      resources: [{ kind: "kv", alias: "cache", required: true }],
    }),
  );
});

Deno.test("Auth.DeploymentAuthority.Plan classifies resource definition changes as migration", () => {
  const result = classifyDeploymentAuthorityPlan(
    authorityNeedSet({
      resources: [{
        kind: "kv",
        alias: "cache",
        required: true,
        definition: { binding: { bucket: "cache-v1" } },
      }],
    }),
    authorityNeedSet({
      resources: [{
        kind: "kv",
        alias: "cache",
        required: true,
        definition: { binding: { bucket: "cache-v2" } },
      }],
    }),
  );

  assertEquals(result.classification, "migration");
  assertEquals(result.desiredChange.resources, [{
    kind: "kv",
    alias: "cache",
    required: true,
    definition: { binding: { bucket: "cache-v2" } },
  }]);
});

Deno.test("Auth.DeploymentAuthority.Plan classifies resource removals as migration", () => {
  const result = classifyDeploymentAuthorityPlan(
    authorityNeedSet({
      resources: [{ kind: "kv", alias: "cache", required: true }],
    }),
    authorityNeedSet(),
  );

  assertEquals(result.classification, "migration");
  assertEquals(result.desiredChange.resources, []);
});

Deno.test("Auth.DeploymentAuthority.AcceptUpdate rejects desired version mismatch", async () => {
  const original = deploymentAuthority();
  const authorities = new InMemoryDeploymentAuthorityStorage(original);
  const plans = new InMemoryDeploymentAuthorityPlanStorage([
    deploymentAuthorityPlan(),
  ]);
  let reconciliationCount = 0;
  const handler = createAuthDeploymentAuthorityAcceptUpdateHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async () => {
        reconciliationCount += 1;
        throw new Error("should not reconcile");
      },
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a", expectedDesiredVersion: "stale" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(authorities.getValue(), original);
  assertEquals(plans.getValue("plan-a")?.state, "pending");
  assertEquals(reconciliationCount, 0);
});

Deno.test("Auth.DeploymentAuthority.AcceptUpdate rejects expired pending plans", async () => {
  const original = deploymentAuthority();
  const authorities = new InMemoryDeploymentAuthorityStorage(original);
  const plans = new InMemoryDeploymentAuthorityPlanStorage([
    deploymentAuthorityPlan({ expiresAt: "2020-01-01T00:00:00.000Z" }),
  ]);
  const handler = createAuthDeploymentAuthorityAcceptUpdateHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async () => {
        throw new Error("should not reconcile");
      },
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(authorities.getValue(), original);
  assertEquals(plans.getValue("plan-a")?.state, "pending");
});

Deno.test("Auth.DeploymentAuthority.AcceptUpdate rejects stale stored plan version", async () => {
  const original = deploymentAuthority({ version: "v2" });
  const authorities = new InMemoryDeploymentAuthorityStorage(original);
  const plans = new InMemoryDeploymentAuthorityPlanStorage([
    deploymentAuthorityPlan(),
  ]);
  let reconciliationCount = 0;
  const handler = createAuthDeploymentAuthorityAcceptUpdateHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async () => {
        reconciliationCount += 1;
        throw new Error("should not reconcile");
      },
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(authorities.getValue(), original);
  assertEquals(plans.getValue("plan-a")?.state, "pending");
  assertEquals(reconciliationCount, 0);
});

Deno.test("Auth.DeploymentAuthority.AcceptUpdate rejects migration plans", async () => {
  const authorities = new InMemoryDeploymentAuthorityStorage(
    deploymentAuthority({
      desiredState: {
        needs: authorityNeedSet({
          contracts: [{ contractId: "svc.contract@v1", required: true }],
        }),
        capabilities: [],
        resources: [],
        surfaces: [],
      },
    }),
  );
  const plans = new InMemoryDeploymentAuthorityPlanStorage([{
    ...deploymentAuthorityPlan(),
    classification: "migration",
    acknowledgementRequired: true,
  }]);
  const handler = createAuthDeploymentAuthorityAcceptUpdateHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async () => {
        throw new Error("should not reconcile");
      },
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(plans.getValue("plan-a")?.state, "pending");
});

Deno.test("Auth.DeploymentAuthority.AcceptMigration stores acknowledgement as decision reason", async () => {
  const capabilityDefinition: DeploymentAuthorityCapabilityDefinition = {
    deploymentId: "svc-a",
    key: "svc.migrate",
    displayName: "Migrate service",
    description: "Use migrated service capabilities.",
    source: "contract",
    contractId: "svc.contract@v1",
    contractDigest: "sha256-a",
    contractDisplayName: "Service Contract",
    direction: "creates",
  };
  const authorities = new InMemoryDeploymentAuthorityStorage(
    deploymentAuthority({
      desiredState: {
        needs: authorityNeedSet({
          contracts: [{ contractId: "svc.contract@v1", required: true }],
        }),
        capabilities: [],
        resources: [],
        surfaces: [],
      },
    }),
  );
  const plans = new InMemoryDeploymentAuthorityPlanStorage([{
    ...deploymentAuthorityPlan(),
    classification: "migration",
    acknowledgementRequired: true,
    proposal: {
      deploymentId: "svc-a",
      contractId: "svc.contract@v1",
      contractDigest: "sha256-a",
      requestedNeeds: authorityNeedSet(),
      providedSurfaces: [],
      summary: {
        desiredVersion: "v1",
        authorityCapabilityDefinitions: [capabilityDefinition],
      },
    },
  }]);
  const capabilityDefinitions = new InMemoryCapabilityDefinitionStorage();
  const handler = createAuthDeploymentAuthorityAcceptMigrationHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    capabilityDefinitionStorage: capabilityDefinitions,
    authorityReconciler: {
      reconcileDeployment: async (deploymentId, opts) => ({
        authority: authorities.getValue() ?? deploymentAuthority(),
        materializedAuthority: {
          deploymentId,
          desiredVersion: opts?.desiredVersion ?? "v1",
          status: "current",
          resourceBindings: [],
          grants: emptyMaterializedGrants(),
          reconciledAt: "2026-01-01T00:00:02.000Z",
        },
        reconciliation: {
          deploymentId,
          desiredVersion: opts?.desiredVersion ?? "v1",
          state: "succeeded",
          startedAt: "2026-01-01T00:00:02.000Z",
          finishedAt: "2026-01-01T00:00:03.000Z",
        },
      }),
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a", acknowledgement: "I understand." },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(plans.getValue("plan-a")?.state, "accepted");
  assertEquals(plans.getValue("plan-a")?.decisionReason, "I understand.");
  assertEquals(capabilityDefinitions.writes, [{
    deploymentId: "svc-a",
    definitions: [capabilityDefinition],
  }]);
});

Deno.test("Auth.DeploymentAuthority.AcceptMigration replaces desired state from proposal", async () => {
  const authorities = new InMemoryDeploymentAuthorityStorage(
    deploymentAuthority({
      desiredState: {
        needs: authorityNeedSet({
          contracts: [{ contractId: "svc.contract@v1", required: true }],
          resources: [
            { kind: "kv", alias: "cache", required: true },
            { kind: "kv", alias: "secondary", required: true },
          ],
        }),
        capabilities: [],
        resources: [
          { kind: "kv", alias: "cache", required: true },
          { kind: "kv", alias: "secondary", required: true },
        ],
        surfaces: [],
      },
    }),
  );
  const plans = new InMemoryDeploymentAuthorityPlanStorage([{
    ...deploymentAuthorityPlan(),
    classification: "migration",
    acknowledgementRequired: true,
    proposal: {
      deploymentId: "svc-a",
      contractId: "svc.contract@v1",
      contractDigest: "sha256-a",
      requestedNeeds: authorityNeedSet([
        {
          kind: "contract",
          contractId: "svc.contract@v1",
          required: true,
        },
        {
          kind: "resource",
          resource: {
            kind: "kv",
            alias: "cache",
            required: true,
            definition: { type: "kv", history: 2, ttlMs: 30000 },
          },
          required: true,
        },
      ]),
      providedSurfaces: [],
      summary: { desiredVersion: "v1" },
    },
    desiredChange: authorityNeedSet(),
  }]);
  const handler = createAuthDeploymentAuthorityAcceptMigrationHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async (deploymentId, opts) => ({
        authority: authorities.getValue() ?? deploymentAuthority(),
        materializedAuthority: {
          deploymentId,
          desiredVersion: opts?.desiredVersion ?? "v1",
          status: "current",
          resourceBindings: [],
          grants: emptyMaterializedGrants(),
          reconciledAt: "2026-01-01T00:00:02.000Z",
        },
        reconciliation: {
          deploymentId,
          desiredVersion: opts?.desiredVersion ?? "v1",
          state: "succeeded",
          startedAt: "2026-01-01T00:00:02.000Z",
          finishedAt: "2026-01-01T00:00:03.000Z",
        },
      }),
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a", acknowledgement: "I understand." },
    context: adminContext,
  });

  assert(result.isOk());
  assertEquals(authorities.getValue()?.desiredState.resources, [
    {
      kind: "kv",
      alias: "cache",
      required: true,
      definition: { type: "kv", history: 2, ttlMs: 30000 },
    },
  ]);
});

Deno.test("Auth.DeploymentAuthority.AcceptMigration rejects out-of-scope replacement", async () => {
  const authorities = new InMemoryDeploymentAuthorityStorage(
    deploymentAuthority({
      desiredState: {
        needs: authorityNeedSet({
          contracts: [
            { contractId: "svc.contract@v1", required: true },
            { contractId: "other.contract@v1", required: true },
          ],
          resources: [{ kind: "kv", alias: "cache", required: true }],
        }),
        capabilities: [],
        resources: [{ kind: "kv", alias: "cache", required: true }],
        surfaces: [],
      },
    }),
  );
  const original = authorities.getValue();
  const plans = new InMemoryDeploymentAuthorityPlanStorage([{
    ...deploymentAuthorityPlan(),
    classification: "migration",
    acknowledgementRequired: true,
    proposal: {
      deploymentId: "svc-a",
      contractId: "svc.contract@v1",
      contractDigest: "sha256-a",
      requestedNeeds: authorityNeedSet({
        contracts: [{ contractId: "svc.contract@v1", required: true }],
      }),
      providedSurfaces: [],
      summary: { desiredVersion: "v1" },
    },
    desiredChange: authorityNeedSet(),
  }]);
  const handler = createAuthDeploymentAuthorityAcceptMigrationHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async () => {
        throw new Error("should not reconcile");
      },
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a", acknowledgement: "I understand." },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(authorities.getValue(), original);
  assertEquals(plans.getValue("plan-a")?.state, "pending");
});

Deno.test("Auth.DeploymentAuthority.AcceptMigration rejects replacement with out-of-scope surfaces", async () => {
  const authorities = new InMemoryDeploymentAuthorityStorage(
    deploymentAuthority({
      desiredState: {
        needs: authorityNeedSet({
          surfaces: [{
            contractId: "other.contract@v1",
            kind: "rpc",
            name: "Other.Read",
            action: "call",
            required: true,
          }],
        }),
        capabilities: [],
        resources: [],
        surfaces: [{
          contractId: "other.contract@v1",
          kind: "rpc",
          name: "Other.Read",
          action: "call",
        }],
      },
    }),
  );
  const original = authorities.getValue();
  const plans = new InMemoryDeploymentAuthorityPlanStorage([{
    ...deploymentAuthorityPlan(),
    classification: "migration",
    acknowledgementRequired: true,
    proposal: {
      deploymentId: "svc-a",
      contractId: "svc.contract@v1",
      contractDigest: "sha256-a",
      requestedNeeds: authorityNeedSet({
        contracts: [{ contractId: "svc.contract@v1", required: true }],
      }),
      providedSurfaces: [],
      summary: { desiredVersion: "v1" },
    },
    desiredChange: authorityNeedSet(),
  }]);
  const handler = createAuthDeploymentAuthorityAcceptMigrationHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async () => {
        throw new Error("should not reconcile");
      },
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a", acknowledgement: "I understand." },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(authorities.getValue(), original);
  assertEquals(plans.getValue("plan-a")?.state, "pending");
});

Deno.test("Auth.DeploymentAuthority.AcceptMigration rejects missing acknowledgement", async () => {
  const authorities = new InMemoryDeploymentAuthorityStorage(
    deploymentAuthority({
      desiredState: {
        needs: authorityNeedSet({
          contracts: [{ contractId: "svc.contract@v1", required: true }],
        }),
        capabilities: [],
        resources: [],
        surfaces: [],
      },
    }),
  );
  const plans = new InMemoryDeploymentAuthorityPlanStorage([{
    ...deploymentAuthorityPlan(),
    classification: "migration",
    acknowledgementRequired: true,
  }]);
  const handler = createAuthDeploymentAuthorityAcceptMigrationHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async () => {
        throw new Error("should not reconcile");
      },
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(plans.getValue("plan-a")?.state, "pending");
});

Deno.test("Auth.DeploymentAuthority.AcceptMigration warns when reconciliation trigger fails", async () => {
  const authorities = new InMemoryDeploymentAuthorityStorage(
    deploymentAuthority({
      desiredState: {
        needs: authorityNeedSet({
          contracts: [{ contractId: "svc.contract@v1", required: true }],
        }),
        capabilities: [],
        resources: [],
        surfaces: [],
      },
    }),
  );
  const plans = new InMemoryDeploymentAuthorityPlanStorage([{
    ...deploymentAuthorityPlan(),
    classification: "migration",
    acknowledgementRequired: true,
  }]);
  const warnings: Array<{ deploymentId?: unknown; err?: unknown }> = [];
  const handler = createAuthDeploymentAuthorityAcceptMigrationHandler({
    deploymentAuthorityStorage: authorities,
    deploymentAuthorityPlanStorage: plans,
    authorityReconciler: {
      reconcileDeployment: async () => {
        throw new Error("temporary reconciliation failure");
      },
    },
    logger: {
      trace: () => {},
      warn: (entry) => warnings.push(entry),
    },
  });

  const result = await handler({
    input: { planId: "plan-a", acknowledgement: "I understand." },
    context: adminContext,
  });

  assert(result.isOk());
  assertEquals(plans.getValue("plan-a")?.state, "accepted");
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0]?.deploymentId, "svc-a");
  assert(warnings[0]?.err instanceof Error);
});

Deno.test("Auth.DeploymentAuthority.Reject marks pending plan without authority mutation or reconcile", async () => {
  const plans = new InMemoryDeploymentAuthorityPlanStorage([
    deploymentAuthorityPlan(),
  ]);
  const handler = createAuthDeploymentAuthorityRejectHandler({
    deploymentAuthorityPlanStorage: plans,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a", reason: "not now" },
    context: adminContext,
  });

  assert(!result.isErr());
  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(value, { success: true });
  const plan = plans.getValue("plan-a");
  assertEquals(plan?.state, "rejected");
  assertEquals(plan?.decisionReason, "not now");
});

Deno.test("Auth.DeploymentAuthority.Reject rejects non-pending plans", async () => {
  const plans = new InMemoryDeploymentAuthorityPlanStorage([{
    ...deploymentAuthorityPlan(),
    state: "accepted",
  }]);
  const handler = createAuthDeploymentAuthorityRejectHandler({
    deploymentAuthorityPlanStorage: plans,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a", reason: "not now" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(plans.getValue("plan-a")?.state, "accepted");
});

Deno.test("Auth.DeploymentAuthority.Reject rejects expired pending plans", async () => {
  const plans = new InMemoryDeploymentAuthorityPlanStorage([
    deploymentAuthorityPlan({ expiresAt: "2020-01-01T00:00:00.000Z" }),
  ]);
  const handler = createAuthDeploymentAuthorityRejectHandler({
    deploymentAuthorityPlanStorage: plans,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { planId: "plan-a", reason: "not now" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(plans.getValue("plan-a")?.state, "pending");
});

Deno.test({
  name:
    "production auth registration does not configure mutable auth/admin globals",
  permissions: {
    read: [
      new URL("./rpc.ts", import.meta.url).pathname,
      new URL("../register.ts", import.meta.url).pathname,
      new URL("../registration/device_admin_activation.ts", import.meta.url)
        .pathname,
    ],
  },
  async fn() {
    const [rpcSource, registerSource, deviceSource] = await Promise
      .all([
        Deno.readTextFile(new URL("./rpc.ts", import.meta.url)),
        Deno.readTextFile(new URL("../register.ts", import.meta.url)),
        Deno.readTextFile(
          new URL(
            "../registration/device_admin_activation.ts",
            import.meta.url,
          ),
        ),
      ]);

    assert(!rpcSource.includes("AsyncLocalStorage"));
    assert(!registerSource.includes("setAuthRuntimeDeps("));
    assert(!deviceSource.includes("setAdminRpcDeps("));
  },
});

Deno.test("service admin RPC handlers require admin before touching dependencies", async () => {
  const serviceDeps = serviceAdminDeps();
  const runtimeDeps = kickDeps(serviceDeps);
  const caller = nonAdminCaller;
  const context = { caller };

  const actions: Array<() => Promise<unknown>> = [
    () =>
      createAuthDeploymentsServiceCreateHandler(serviceDeps)({
        input: { deploymentId: "billing.default", namespaces: ["billing"] },
        context,
      }),
    () =>
      createAuthDeploymentsServiceListHandler(serviceDeps)({
        input: { limit: 10 },
        context,
      }),
    () =>
      createAuthDeploymentsServiceDisableHandler(runtimeDeps)({
        input: { deploymentId: "billing.default" },
        context,
      }),
    () =>
      createAuthDeploymentsServiceEnableHandler(runtimeDeps)({
        input: { deploymentId: "billing.default" },
        context,
      }),
    () =>
      createAuthDeploymentsServiceRemoveHandler(runtimeDeps)({
        input: { deploymentId: "billing.default" },
        context,
      }),
    () =>
      createAuthServiceInstancesProvisionHandler(serviceDeps)({
        input: { deploymentId: "billing.default", instanceKey: "instance-key" },
        context,
      }),
    () =>
      createAuthServiceInstancesListHandler(serviceDeps)({
        input: { limit: 10 },
        context,
      }),
    () =>
      createAuthServiceInstancesDisableHandler(runtimeDeps)({
        input: { instanceId: "svc_123" },
        context,
      }),
    () =>
      createAuthServiceInstancesEnableHandler(runtimeDeps)({
        input: { instanceId: "svc_123" },
        context,
      }),
    () =>
      createAuthServiceInstancesRemoveHandler(runtimeDeps)({
        input: { instanceId: "svc_123" },
        context,
      }),
  ];

  for (const action of actions) {
    await assertInsufficientPermissions(action);
  }
});

Deno.test("session and connection admin schemas expose explicit participant metadata", () => {
  assert(Value.Check(AuthSessionsListResponseSchema, {
    ...page([
      {
        key: "github.123.sk_agent",
        sessionKey: "sk_agent",
        participantKind: "agent",
        principal: {
          type: "user",
          userId: "user_123",
          identity: {
            identityId: "idn_github_123",
            provider: "github",
            subject: "123",
          },
          name: "Ada",
        },
        contractId: "trellis.agent@v1",
        contractDisplayName: "Trellis Agent",
        createdAt: new Date().toISOString(),
        lastAuth: new Date().toISOString(),
      },
    ]),
  }));

  assert(Value.Check(AuthConnectionsListResponseSchema, {
    ...page([
      {
        key: "github.123.sk_agent.user_nkey",
        userNkey: "user_nkey",
        sessionKey: "sk_agent",
        participantKind: "agent",
        principal: {
          type: "user",
          userId: "user_123",
          identity: {
            identityId: "idn_github_123",
            provider: "github",
            subject: "123",
          },
          name: "Ada",
        },
        contractId: "trellis.agent@v1",
        contractDisplayName: "Trellis Agent",
        serverId: "n1",
        clientId: 7,
        connectedAt: new Date().toISOString(),
      },
    ]),
  }));
});

Deno.test("validateServiceDeploymentRequest normalizes namespaces without display metadata", () => {
  const valid = validateServiceDeploymentRequest({
    deploymentId: "billing.default",
    namespaces: ["billing", "billing", "audit"],
  });
  assert(!valid.isErr());
  assertEquals(
    (valid.take() as { deployment: Record<string, unknown> }).deployment,
    {
      deploymentId: "billing.default",
      namespaces: ["billing", "audit"],
      contractCompatibilityMode: "strict",
      disabled: false,
    },
  );

  const mutableDev = validateServiceDeploymentRequest({
    deploymentId: "catalog.default",
    namespaces: ["catalog"],
    contractCompatibilityMode: "mutable-dev",
  });
  assert(!mutableDev.isErr());
  assertEquals(
    (mutableDev.take() as { deployment: Record<string, unknown> }).deployment
      .contractCompatibilityMode,
    "mutable-dev",
  );

  assert(
    validateServiceDeploymentRequest({ deploymentId: "", namespaces: [] })
      .isErr(),
  );
});

Deno.test("Auth.Deployments.Create service initializes an empty service authority", async () => {
  const deployments = new InMemoryServiceDeploymentStorage();
  const authorities: DeploymentAuthority[] = [];
  const result = await createAuthDeploymentsServiceCreateHandler({
    logger: { trace: () => {} },
    serviceDeploymentStorage: deployments,
    serviceInstanceStorage: serviceAdminDeps().serviceInstanceStorage,
    deploymentAuthorityStorage: {
      get: async () => undefined,
      put: async (record) => {
        authorities.push(record);
      },
    },
  })({
    input: { deploymentId: "demo-js", namespaces: [] },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(authorities.length, 1);
  assertEquals(authorities[0]?.deploymentId, "demo-js");
  assertEquals(authorities[0]?.kind, "service");
  assertEquals(authorities[0]?.disabled, false);
  assertEquals(authorities[0]?.desiredState, {
    needs: authorityNeedSet(),
    capabilities: [],
    resources: [],
    surfaces: [],
  });
  assertEquals(deployments.getValue("demo-js"), {
    deploymentId: "demo-js",
    namespaces: [],
    contractCompatibilityMode: "strict",
    disabled: false,
  });
});

Deno.test("Auth.Deployments.Create service resets an existing disabled authority", async () => {
  const deployments = new InMemoryServiceDeploymentStorage();
  let authority = deploymentAuthority({
    deploymentId: "demo-js",
    kind: "service",
    disabled: true,
    desiredState: {
      needs: authorityNeedSet({
        contracts: [{ contractId: "old@v1", required: true }],
      }),
      capabilities: ["old.use"],
      resources: [],
      surfaces: [],
    },
  });

  const result = await createAuthDeploymentsServiceCreateHandler({
    logger: { trace: () => {} },
    serviceDeploymentStorage: deployments,
    serviceInstanceStorage: serviceAdminDeps().serviceInstanceStorage,
    deploymentAuthorityStorage: {
      get: async () => authority,
      put: async (record) => {
        authority = record;
      },
    },
  })({
    input: { deploymentId: "demo-js", namespaces: [] },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(authority.deploymentId, "demo-js");
  assertEquals(authority.kind, "service");
  assertEquals(authority.disabled, false);
  assertEquals(authority.desiredState, {
    needs: authorityNeedSet(),
    capabilities: [],
    resources: [],
    surfaces: [],
  });
  assert(authority.version !== "v1");
});

Deno.test("Auth.Deployments.Create service returns mutable-dev compatibility mode", async () => {
  const deployments = new InMemoryServiceDeploymentStorage();
  const result = await createAuthDeploymentsServiceCreateHandler({
    logger: { trace: () => {} },
    serviceDeploymentStorage: deployments,
    serviceInstanceStorage: serviceAdminDeps().serviceInstanceStorage,
  })({
    input: {
      deploymentId: "catalog-js",
      namespaces: ["catalog"],
      contractCompatibilityMode: "mutable-dev",
    },
    context: adminContext,
  });

  assert(result.isOk());
  const value = result.take();
  if (!("deployment" in value)) {
    throw new Error("expected service deployment create response");
  }
  assertEquals(value.deployment, {
    deploymentId: "catalog-js",
    namespaces: ["catalog"],
    contractCompatibilityMode: "mutable-dev",
    disabled: false,
  });
  assertEquals(deployments.getValue("catalog-js"), value.deployment);
});

Deno.test("Auth.Deployments.Disable service validates staged deployment before persisting or kicking", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const originalAuthority = deploymentAuthority({
    deploymentId: "billing.default",
    kind: "service",
    disabled: false,
  });
  let stored = original;
  let putCount = 0;
  let refreshCount = 0;
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => stored,
      put: async (deployment) => {
        putCount += 1;
        stored = deployment;
      },
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => [{
        instanceId: "svc_1",
        deploymentId: "billing.default",
        instanceKey: "session-key-1",
        disabled: false,
        capabilities: ["service"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    },
    deploymentAuthorityStorage: {
      get: async () => originalAuthority,
      put: async () => throwingStoreAccess(),
    },
  };

  const result = await createAuthDeploymentsServiceDisableHandler({
    ...kickDeps(serviceDeps),
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    validateActiveCatalog: async ({ stagedServiceDeployments }) => {
      assertEquals([...stagedServiceDeployments ?? []], [{
        ...original,
        disabled: true,
      }]);
      throw new Error("incompatible staged active catalog");
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
  })({
    input: { deploymentId: "billing.default" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(putCount, 0);
  assertEquals(refreshCount, 0);
  assertEquals(kicked, []);
  assertEquals(stored, original);
});

Deno.test("Auth.Deployments.Disable service updates the deployment authority disabled state", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const deployments = new InMemoryServiceDeploymentStorage();
  deployments.seed(original);
  let authority = deploymentAuthority({
    deploymentId: "billing.default",
    kind: "service",
    disabled: false,
  });
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: deployments,
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      listByDeployment: async () => [],
    },
    deploymentAuthorityStorage: {
      get: async () => authority,
      put: async (record) => {
        authority = record;
      },
    },
  };

  const result = await createAuthDeploymentsServiceDisableHandler({
    ...kickDeps(serviceDeps),
    connectionsKV: {
      get: () => throwingKvAccess(),
      put: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok(emptyKeys()),
    },
    sessionStorage: { deleteByInstanceKey: async () => {} },
  })({
    input: { deploymentId: "billing.default" },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(deployments.getValue("billing.default")?.disabled, true);
  assertEquals(authority.disabled, true);
});

Deno.test("Auth.Deployments.Enable service reconciles authority disabled state after refresh", async () => {
  const deployments = new InMemoryServiceDeploymentStorage();
  deployments.seed({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: true,
  });
  let authority = deploymentAuthority({
    deploymentId: "billing.default",
    kind: "service",
    disabled: true,
  });
  let refreshed = false;
  const reconciles: Array<{ deploymentId: string; desiredVersion?: string }> =
    [];

  const result = await createAuthDeploymentsServiceEnableHandler({
    refreshActiveContracts: async () => {
      refreshed = true;
    },
    validateActiveCatalog: async () => {},
    serviceDeploymentStorage: deployments,
    deploymentAuthorityStorage: {
      get: async () => authority,
      put: async (record) => {
        authority = record;
      },
    },
    authorityReconciler: {
      reconcileDeployment: async (deploymentId, opts) => {
        assert(refreshed);
        reconciles.push({ deploymentId, desiredVersion: opts?.desiredVersion });
      },
    },
  })({
    input: { deploymentId: "billing.default" },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(authority.disabled, false);
  assertEquals(reconciles, [{
    deploymentId: "billing.default",
    desiredVersion: authority.version,
  }]);
});

Deno.test("Auth.Deployments.Remove service without cascade rejects deployments with instances", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  let deletedDeployment = false;
  let refreshCount = 0;
  const deletedInstances: string[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => original,
      put: async () => throwingStoreAccess(),
      delete: async () => {
        deletedDeployment = true;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async (instanceId) => {
        deletedInstances.push(instanceId);
      },
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => [{
        instanceId: "svc_1",
        deploymentId: "billing.default",
        instanceKey: "session-key-1",
        disabled: false,
        capabilities: ["service"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: { deploymentId: "billing.default" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(deletedInstances, []);
  assertEquals(deletedDeployment, false);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.Deployments.Remove service rejects resource purge without cascade before deleting", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  let deletedDeployment = false;
  let refreshCount = 0;
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => original,
      put: async () => throwingStoreAccess(),
      delete: async () => {
        deletedDeployment = true;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: { deploymentId: "billing.default", purgeResources: true },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(deletedDeployment, false);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.Deployments.Remove service rejects contract purge without cascade before deleting", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  let deletedDeployment = false;
  let refreshCount = 0;
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => original,
      put: async () => throwingStoreAccess(),
      delete: async () => {
        deletedDeployment = true;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: { deploymentId: "billing.default", purgeUnusedContracts: true },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(deletedDeployment, false);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.Deployments.Remove service skips unused contract purge dependencies", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const instances: ServiceInstance[] = [{
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "session-key-1",
    disabled: false,
    capabilities: ["service"],
    createdAt: "2026-01-01T00:00:00.000Z",
  }];
  let storedDeployment: ServiceDeployment | undefined = original;
  let storedInstances = [...instances];
  const deletedSessions: string[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  let refreshCount = 0;
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (instance) => {
        storedInstances = [instance];
      },
      delete: async () => {
        storedInstances = [];
      },
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => storedInstances,
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    connectionsKV: {
      get: () =>
        AsyncResult.ok({
          value: {
            serverId: "server-1",
            clientId: 1,
            connectedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        }),
      put: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok(oneConnectionKey()),
    },
    sessionStorage: {
      deleteByInstanceKey: async (instanceKey) => {
        deletedSessions.push(instanceKey);
      },
    },
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: {
      deploymentId: "billing.default",
      cascade: true,
      purgeUnusedContracts: true,
    },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(storedDeployment, undefined);
  assertEquals(storedInstances, []);
  assertEquals(deletedSessions, ["session-key-1"]);
  assertEquals(kicked, [{ serverId: "server-1", clientId: 1 }]);
  assertEquals(refreshCount, 1);
});

Deno.test("Auth.Deployments.Remove service purges only unreferenced non-built-in installed contracts after refresh", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  let storedDeployment: ServiceDeployment | undefined = original;
  const calls: string[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        calls.push("delete-deployment");
        storedDeployment = undefined;
      },
      listPage: async () => [{
        deploymentId: "billing.other",
        namespaces: ["billing"],
        disabled: false,
      }],
      listByDeploymentIds: async () => [],
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => [{
        instanceId: "svc_other",
        deploymentId: "billing.other",
        instanceKey: "session-key-other",
        disabled: false,
        capabilities: ["service"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    sessionStorage: {
      deleteByInstanceKey: async () => {},
      listEntries: async () => [],
      listEntriesByContractDigests: async () => [],
    },
    refreshActiveContracts: async () => {
      calls.push("refresh");
    },
    validateActiveCatalog: async () => {},
  })({
    input: {
      deploymentId: "billing.default",
      cascade: true,
      purgeUnusedContracts: true,
    },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(calls, [
    "delete-deployment",
    "refresh",
  ]);
  assertEquals(storedDeployment, undefined);
});

Deno.test("Auth.Deployments.Remove service keeps removal successful when unused contract cleanup fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  let storedDeployment: ServiceDeployment | undefined = original;
  const calls: string[] = [];
  const warnings: unknown[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        calls.push("delete-deployment");
        storedDeployment = undefined;
      },
      listPage: async () => [],
      listByDeploymentIds: async () => [],
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => [],
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    logger: {
      warn: (fields) => {
        warnings.push(fields);
      },
    },
    sessionStorage: {
      deleteByInstanceKey: async () => {},
      listEntries: async () => [],
      listEntriesByContractDigests: async () => [],
    },
    refreshActiveContracts: async () => {
      calls.push("refresh");
    },
    validateActiveCatalog: async () => {},
  })({
    input: {
      deploymentId: "billing.default",
      cascade: true,
      purgeUnusedContracts: true,
    },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(calls, [
    "delete-deployment",
    "refresh",
  ]);
  assertEquals(warnings.length, 1);
  assertEquals(storedDeployment, undefined);
});

Deno.test("Auth.Deployments.Remove service cascades instances, sessions, and runtime access", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const instances: ServiceInstance[] = [
    {
      instanceId: "svc_1",
      deploymentId: "billing.default",
      instanceKey: "session-key-1",
      disabled: false,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      instanceId: "svc_2",
      deploymentId: "billing.default",
      instanceKey: "session-key-2",
      disabled: false,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  let storedDeployment: ServiceDeployment | undefined = original;
  let storedInstances = [...instances];
  const deletedSessions: string[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const stagedInstances: ServiceInstance[] = [];
  const refreshOptions: unknown[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (instance) => {
        storedInstances = [
          ...storedInstances.filter((entry) =>
            entry.instanceId !== instance.instanceId
          ),
          instance,
        ];
      },
      delete: async (instanceId) => {
        storedInstances = storedInstances.filter((entry) =>
          entry.instanceId !== instanceId
        );
      },
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () =>
        storedInstances.filter((instance) =>
          instance.deploymentId === "billing.default"
        ),
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    connectionsKV: {
      get: () =>
        AsyncResult.ok({
          value: {
            serverId: "server-1",
            clientId: 1,
            connectedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        }),
      put: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok(oneConnectionKey()),
    },
    sessionStorage: {
      deleteByInstanceKey: async (instanceKey) => {
        deletedSessions.push(instanceKey);
      },
    },
    refreshActiveContracts: async (opts) => {
      refreshOptions.push(opts);
    },
    validateActiveCatalog: async (
      {
        stagedServiceDeployments,
        stagedServiceInstances,
      },
    ) => {
      assertEquals([...stagedServiceDeployments ?? []], [{
        ...original,
        disabled: true,
      }]);
      stagedInstances.push(...stagedServiceInstances ?? []);
    },
  })({
    input: { deploymentId: "billing.default", cascade: true },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(
    stagedInstances,
    instances.map((instance) => ({
      ...instance,
      disabled: true,
    })),
  );
  assertEquals(storedDeployment, undefined);
  assertEquals(storedInstances, []);
  assertEquals(deletedSessions, ["session-key-1", "session-key-2"]);
  assertEquals(refreshOptions, [undefined]);
  assertEquals(kicked, [
    { serverId: "server-1", clientId: 1 },
    { serverId: "server-1", clientId: 1 },
  ]);
});

Deno.test("Auth.Deployments.Remove service rejects direct resource purge with cascade", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  let storedDeployment: ServiceDeployment | undefined = original;
  const calls: string[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        calls.push("delete-deployment");
        storedDeployment = undefined;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    refreshActiveContracts: async () => {
      calls.push("refresh");
    },
    validateActiveCatalog: async () => {},
  })({
    input: {
      deploymentId: "billing.default",
      cascade: true,
      purgeResources: true,
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(calls, []);
  assertEquals(storedDeployment, original);
});

Deno.test("Auth.Deployments.Remove service does not delete or refresh when resource purge fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  let storedDeployment: ServiceDeployment | undefined = original;
  let refreshCount = 0;
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: {
      deploymentId: "billing.default",
      cascade: true,
      purgeResources: true,
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(storedDeployment, original);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.Deployments.Remove service does not revoke runtime access when resource purge fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const instances: ServiceInstance[] = [{
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "session-key-1",
    disabled: false,
    capabilities: ["service"],
    createdAt: "2026-01-01T00:00:00.000Z",
  }];
  let storedDeployment: ServiceDeployment | undefined = original;
  let storedInstances = [...instances];
  const deletedSessions: string[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (instance) => {
        storedInstances = [instance];
      },
      delete: async () => {
        storedInstances = [];
      },
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => storedInstances,
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    connectionsKV: {
      get: () =>
        AsyncResult.ok({
          value: {
            serverId: "server-1",
            clientId: 1,
            connectedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        }),
      put: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok(oneConnectionKey()),
    },
    sessionStorage: {
      deleteByInstanceKey: async (instanceKey) => {
        deletedSessions.push(instanceKey);
      },
    },
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    refreshActiveContracts: async () => {
      throw new Error("should not refresh");
    },
    validateActiveCatalog: async () => {},
  })({
    input: {
      deploymentId: "billing.default",
      cascade: true,
      purgeResources: true,
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(storedDeployment, original);
  assertEquals(storedInstances, instances);
  assertEquals(deletedSessions, []);
  assertEquals(kicked, []);
});

Deno.test("Auth.Deployments.Remove service does not delete or refresh when cascade kick fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const instances: ServiceInstance[] = [
    {
      instanceId: "svc_1",
      deploymentId: "billing.default",
      instanceKey: "session-key-1",
      disabled: false,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  let storedDeployment: ServiceDeployment | undefined = original;
  let storedInstances = [...instances];
  let refreshCount = 0;
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (instance) => {
        storedInstances = [
          ...storedInstances.filter((entry) =>
            entry.instanceId !== instance.instanceId
          ),
          instance,
        ];
      },
      delete: async (instanceId) => {
        storedInstances = storedInstances.filter((entry) =>
          entry.instanceId !== instanceId
        );
      },
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () =>
        storedInstances.filter((instance) =>
          instance.deploymentId === "billing.default"
        ),
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    kick: async () => {
      throw new Error("kick failed");
    },
    connectionsKV: {
      get: () =>
        AsyncResult.ok({
          value: {
            serverId: "server-1",
            clientId: 1,
            connectedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        }),
      put: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok(oneConnectionKey()),
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: { deploymentId: "billing.default", cascade: true },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(storedDeployment, original);
  assertEquals(storedInstances, instances);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.Deployments.Remove service deletes and refreshes after purge when cascade kick fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const instances: ServiceInstance[] = [{
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "session-key-1",
    disabled: false,
    capabilities: ["service"],
    createdAt: "2026-01-01T00:00:00.000Z",
  }];
  let storedDeployment: ServiceDeployment | undefined = original;
  let storedInstances = [...instances];
  const calls: string[] = [];
  const deletedSessions: string[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        calls.push("delete-deployment");
        storedDeployment = undefined;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (instance) => {
        storedInstances = [instance];
      },
      delete: async (instanceId) => {
        calls.push("delete-instance");
        storedInstances = storedInstances.filter((entry) =>
          entry.instanceId !== instanceId
        );
      },
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => storedInstances,
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    connectionsKV: {
      get: () =>
        AsyncResult.ok({
          value: {
            serverId: "server-1",
            clientId: 1,
            connectedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        }),
      put: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok(oneConnectionKey()),
    },
    sessionStorage: {
      deleteByInstanceKey: async (instanceKey) => {
        deletedSessions.push(instanceKey);
      },
    },
    kick: async () => {
      calls.push("kick");
      throw new Error("kick failed");
    },
    refreshActiveContracts: async () => {
      calls.push("refresh");
    },
    validateActiveCatalog: async () => {},
  })({
    input: {
      deploymentId: "billing.default",
      cascade: true,
      purgeResources: true,
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(calls, []);
  assertEquals(storedDeployment, original);
  assertEquals(storedInstances, instances);
  assertEquals(deletedSessions, []);
});

Deno.test("Auth.Deployments.Remove service rolls back cascade deletes when an instance delete fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const instances: ServiceInstance[] = [
    {
      instanceId: "svc_1",
      deploymentId: "billing.default",
      instanceKey: "session-key-1",
      disabled: false,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      instanceId: "svc_2",
      deploymentId: "billing.default",
      instanceKey: "session-key-2",
      disabled: false,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  let storedDeployment: ServiceDeployment | undefined = original;
  let storedInstances = [...instances];
  const deletedInstances: string[] = [];
  let refreshCount = 0;
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (instance) => {
        storedInstances = [
          ...storedInstances.filter((entry) =>
            entry.instanceId !== instance.instanceId
          ),
          instance,
        ];
      },
      delete: async (instanceId) => {
        deletedInstances.push(instanceId);
        if (instanceId === "svc_2") {
          throw new Error("delete failed");
        }
        storedInstances = storedInstances.filter((entry) =>
          entry.instanceId !== instanceId
        );
      },
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () =>
        storedInstances.filter((instance) =>
          instance.deploymentId === "billing.default"
        ),
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    connectionsKV: {
      get: () =>
        AsyncResult.ok({
          value: {
            serverId: "server-1",
            clientId: 1,
            connectedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        }),
      put: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok(emptyKeys()),
    },
    sessionStorage: {
      deleteByInstanceKey: async () => {},
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: { deploymentId: "billing.default", cascade: true },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(deletedInstances, ["svc_1", "svc_2"]);
  assertEquals(storedDeployment, original);
  assertEquals(storedInstances, instances);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.ServiceInstances.Enable rolls back instance and does not kick when refresh fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const instance: ServiceInstance = {
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "session-key-1",
    disabled: true,
    capabilities: ["service"],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  let stored = instance;
  const putInstances: ServiceInstance[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      ...serviceAdminDeps().serviceDeploymentStorage,
      get: async () => original,
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      get: async () => stored,
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (nextInstance) => {
        putInstances.push(nextInstance);
        stored = nextInstance;
      },
      delete: async () => throwingStoreAccess(),
      listPage: async () => throwingStoreAccess(),
      listByDeployment: async () => throwingStoreAccess(),
    },
  };

  const result = await createAuthServiceInstancesEnableHandler({
    ...kickDeps(serviceDeps),
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    validateActiveCatalog: async ({ stagedServiceInstances }) => {
      assertEquals([...stagedServiceInstances ?? []], [{
        ...instance,
        disabled: false,
      }]);
    },
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
  })({
    input: { instanceId: "svc_1" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(putInstances.length, 2);
  assertEquals(putInstances[1], instance);
  assertEquals(kicked, []);
  assertEquals(stored, instance);
});

function deviceAdminDeps(args: {
  deployment?: DeviceDeployment;
  putDeployments?: DeviceDeployment[];
  instances?: DeviceInstance[];
  putInstances?: DeviceInstance[];
  deletedInstances?: string[];
  provisioningSecret?: Parameters<
    AdminRpcDeps["deviceProvisioningSecretStorage"]["put"]
  >[0];
  provisioningSecrets?: Parameters<
    AdminRpcDeps["deviceProvisioningSecretStorage"]["put"]
  >[0][];
  activation?: DeviceActivationRecord;
  activations?: DeviceActivationRecord[];
  activationReviews?: DeviceActivationReviewRecord[];
  browserFlowDeletes?: string[];
  deletedActivationReviews?: string[];
  publishes?: Array<{ event: string; payload: unknown }>;
  kicked?: Array<{ serverId: string; clientId: number }>;
  installDeviceContract?: (contract: unknown) => Promise<{
    id: string;
    digest: string;
    displayName: string;
    description: string;
  }>;
  refreshActiveContracts?: (opts?: {
    stagedDeviceDeployments?: Iterable<DeviceDeployment>;
    stagedDeviceInstances?: Iterable<DeviceInstance>;
  }) => Promise<void>;
  validateActiveCatalog?: (opts: {
    stagedDeviceDeployments?: Iterable<DeviceDeployment>;
    stagedDeviceInstances?: Iterable<DeviceInstance>;
  }) => Promise<unknown>;
  kick?: (serverId: string, clientId: number) => Promise<void>;
  builtinContractDigests?: string[];
  deletedContracts?: string[];
  serviceDeployments?: Array<
    { deploymentId: string; disabled?: boolean }
  >;
  activeCatalogIssues?: ActiveCatalogIssue[];
  serviceInstances?: Array<Record<string, never>>;
  approvalDigests?: string[];
  authorityPuts?: DeploymentAuthority[];
  authority?: DeploymentAuthority;
  authorityReconciler?: AdminRpcDeps["authorityReconciler"];
}) {
  let stored: DeviceDeployment | undefined = args.deployment;
  let instances = args.instances ?? [];
  let provisioningSecrets = args.provisioningSecrets ??
    (args.provisioningSecret ? [args.provisioningSecret] : []);
  let activations = args.activations ??
    (args.activation ? [args.activation] : []);
  let activationReviews = args.activationReviews ?? [];
  let authority = args.authority ?? (args.deployment
    ? deploymentAuthority({
      deploymentId: args.deployment.deploymentId,
      kind: "device",
      disabled: args.deployment.disabled,
    })
    : undefined);
  const connectionsKV = {
    get: () =>
      AsyncResult.ok({
        value: {
          serverId: "server-1",
          clientId: 1,
          connectedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      }),
    put: () => AsyncResult.ok(undefined),
    create: () => AsyncResult.ok(undefined),
    delete: () => AsyncResult.ok(undefined),
    keys: () =>
      AsyncResult.ok(
        args.kicked || args.kick ? oneConnectionKey() : emptyKeys(),
      ),
  };
  const browserFlowsKV = {
    get: () => AsyncResult.ok({ value: {} }),
    put: () => AsyncResult.ok(undefined),
    create: () => AsyncResult.ok(undefined),
    delete: (flowId: string) => {
      args.browserFlowDeletes?.push(flowId);
      return AsyncResult.ok(undefined);
    },
    keys: () => AsyncResult.ok(emptyKeys()),
  };
  const eventPublisher = (event: string) => ({
    publish: (payload: Record<string, unknown>) => {
      args.publishes?.push({ event, payload });
      return AsyncResult.ok(undefined);
    },
  });
  const deps: AdminRpcDeps & {
    installDeviceContract: (contract: unknown) => Promise<{
      id: string;
      digest: string;
      displayName: string;
      description: string;
    }>;
    refreshActiveContracts: (opts?: {
      stagedDeviceDeployments?: Iterable<DeviceDeployment>;
      stagedDeviceInstances?: Iterable<DeviceInstance>;
    }) => Promise<void>;
    validateActiveCatalog: (opts: {
      stagedDeviceDeployments?: Iterable<DeviceDeployment>;
      stagedDeviceInstances?: Iterable<DeviceInstance>;
    }) => Promise<unknown>;
  } = {
    browserFlowsKV,
    builtinContractDigests: args.builtinContractDigests ?? [],
    connectionsKV,
    contractApprovalStorage: {
      get: async () => undefined,
      listPage: async () =>
        (args.approvalDigests ?? []).map((digest) => ({
          identityGrantId: `env-${digest}`,
          identityAuthorityId: `ida-${digest}`,
          userTrellisId: `user-${digest}`,
          origin: "test",
          id: `user-${digest}`,
          identityAnchor: {
            kind: "cli" as const,
            contractId: "reader@v1",
            sessionPublicKey: `session-${digest}`,
          },
          answer: "approved" as const,
          answeredAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          approvalEvidence: {
            contractDigest: digest,
            contractId: "reader@v1",
            displayName: "Reader",
            description: "Reader device",
            participantKind: "app" as const,
            capabilities: {},
          },
          publishSubjects: [],
          subscribeSubjects: [],
        })),
      listByApprovalEvidenceContractDigests: async (digests) => {
        const requested = new Set(digests);
        return (await deps.contractApprovalStorage.listPage({ limit: 500 }))
          .filter((record) =>
            requested.has(record.approvalEvidence.contractDigest)
          );
      },
    },
    contractStorage: {
      delete: async (digest: string) => {
        args.deletedContracts?.push(digest);
      },
    },
    deviceActivationReviewStorage: {
      get: async (reviewId) =>
        activationReviews.find((review) => review.reviewId === reviewId),
      getByFlowId: async (flowId) =>
        activationReviews.find((review) => review.flowId === flowId),
      put: async (review) => {
        activationReviews = [
          ...activationReviews.filter((entry) =>
            entry.reviewId !== review.reviewId
          ),
          review,
        ];
      },
      delete: async (reviewId) => {
        args.deletedActivationReviews?.push(reviewId);
        activationReviews = activationReviews.filter((review) =>
          review.reviewId !== reviewId
        );
      },
      listPage: async () => activationReviews,
      listFiltered: async (filters = {}) =>
        activationReviews.filter((review) =>
          (filters.instanceId === undefined ||
            review.instanceId === filters.instanceId) &&
          (filters.deploymentId === undefined ||
            review.deploymentId === filters.deploymentId) &&
          (filters.state === undefined || review.state === filters.state) &&
          (filters.deploymentIds === undefined ||
            new Set(filters.deploymentIds).has(review.deploymentId))
        ),
      listFilteredPage: async (filters = {}, query) =>
        pageFromQuery(
          activationReviews.filter((review) =>
            (filters.instanceId === undefined ||
              review.instanceId === filters.instanceId) &&
            (filters.deploymentId === undefined ||
              review.deploymentId === filters.deploymentId) &&
            (filters.state === undefined || review.state === filters.state) &&
            (filters.deploymentIds === undefined ||
              new Set(filters.deploymentIds).has(review.deploymentId))
          ),
          query,
        ),
    },
    deviceActivationStorage: {
      get: async (instanceId) =>
        activations.find((record) => record.instanceId === instanceId),
      put: async (record) => {
        activations = [
          ...activations.filter((entry) =>
            entry.instanceId !== record.instanceId
          ),
          record,
        ];
      },
      delete: async (instanceId) => {
        activations = activations.filter((record) =>
          record.instanceId !== instanceId
        );
      },
      listPage: async () => activations,
      listFiltered: async (filters = {}) =>
        activations.filter((activation) =>
          (filters.instanceId === undefined ||
            activation.instanceId === filters.instanceId) &&
          (filters.deploymentId === undefined ||
            activation.deploymentId === filters.deploymentId) &&
          (filters.state === undefined || activation.state === filters.state)
        ),
      listFilteredPage: async (filters = {}, query) =>
        pageFromQuery(
          activations.filter((activation) =>
            (filters.instanceId === undefined ||
              activation.instanceId === filters.instanceId) &&
            (filters.deploymentId === undefined ||
              activation.deploymentId === filters.deploymentId) &&
            (filters.state === undefined || activation.state === filters.state)
          ),
          query,
        ),
    },
    deviceDeploymentStorage: {
      get: async () => stored,
      put: async (deployment) => {
        args.putDeployments?.push(deployment);
        stored = deployment;
      },
      delete: async () => {
        stored = undefined;
      },
      listPage: async () => stored ? [stored] : [],
      listFiltered: async (filters = {}) => (stored &&
          (filters.disabled === undefined ||
            stored.disabled === filters.disabled)
        ? [stored]
        : []),
      listFilteredPage: async (filters = {}, query) =>
        pageFromQuery(
          stored &&
            (filters.disabled === undefined ||
              stored.disabled === filters.disabled)
            ? [stored]
            : [],
          query,
        ),
      listByDeploymentIds: async (deploymentIds, filters = {}) => {
        const requested = new Set(deploymentIds);
        return stored && requested.has(stored.deploymentId) &&
            (filters.disabled === undefined ||
              stored.disabled === filters.disabled)
          ? [stored]
          : [];
      },
    },
    deploymentAuthorityStorage: {
      get: async (deploymentId) =>
        authority?.deploymentId === deploymentId ? authority : undefined,
      put: async (record) => {
        args.authorityPuts?.push(record);
        authority = record;
      },
    },
    deviceInstanceStorage: {
      get: async (instanceId) =>
        instances.find((instance) => instance.instanceId === instanceId),
      put: async (instance) => {
        args.putInstances?.push(instance);
        instances = [
          ...instances.filter((entry) =>
            entry.instanceId !== instance.instanceId
          ),
          instance,
        ];
      },
      delete: async (instanceId) => {
        args.deletedInstances?.push(instanceId);
        instances = instances.filter((instance) =>
          instance.instanceId !== instanceId
        );
      },
      listPage: async () => instances,
      listByDeployment: async (deploymentId) =>
        instances.filter((instance) => instance.deploymentId === deploymentId),
      listByDeployments: async (deploymentIds) => {
        const requested = new Set(deploymentIds);
        return instances.filter((instance) =>
          requested.has(instance.deploymentId)
        );
      },
      listByDeploymentsAndStates: async (deploymentIds, states) => {
        const requestedDeployments = new Set(deploymentIds);
        const requestedStates = new Set(states);
        return instances.filter((instance) =>
          requestedDeployments.has(instance.deploymentId) &&
          requestedStates.has(instance.state)
        );
      },
      listByStates: async (states) => {
        const requested = new Set(states);
        return instances.filter((instance) => requested.has(instance.state));
      },
      listFilteredPage: async (filters = {}, query) =>
        pageFromQuery(
          instances.filter((instance) =>
            (filters.deploymentId === undefined ||
              instance.deploymentId === filters.deploymentId) &&
            (filters.state === undefined || instance.state === filters.state)
          ),
          query,
        ),
    },
    deviceProvisioningSecretStorage: {
      get: async (instanceId) =>
        provisioningSecrets.find((secret) => secret.instanceId === instanceId),
      put: async (record) => {
        provisioningSecrets = [
          ...provisioningSecrets.filter((entry) =>
            entry.instanceId !== record.instanceId
          ),
          record,
        ];
      },
      delete: async (instanceId) => {
        provisioningSecrets = provisioningSecrets.filter((secret) =>
          secret.instanceId !== instanceId
        );
      },
    },
    kick: args.kick ??
      (async (serverId, clientId) => {
        args.kicked?.push({ serverId, clientId });
      }),
    logger: { trace: () => {}, warn: () => {} },
    operationCompletion: {
      completeOperation: (operationId, output) =>
        AsyncResult.ok(operationSnapshot(operationId, output)),
    },
    authorityReconciler: args.authorityReconciler,
    publishSessionRevoked: async () => {},
    sessionStorage: {
      deleteByPublicIdentityKey: async () => {},
      deleteBySessionKey: async () => {},
      listEntriesByContractDigests: async () => [],
    },
    serviceDeploymentStorage: {
      listPage: async () => args.serviceDeployments ?? [],
      listByDeploymentIds: async (deploymentIds, filters = {}) => {
        const requested = new Set(deploymentIds);
        return (args.serviceDeployments ?? []).filter((deployment) =>
          requested.has(deployment.deploymentId) &&
          (filters.disabled === undefined ||
            deployment.disabled === filters.disabled)
        );
      },
    },
    serviceInstanceStorage: {
      listPage: async () => args.serviceInstances ?? [],
    },
    eventPublisher: {
      event: {
        auth: {
          connectionsClosed: eventPublisher("connectionsClosed"),
          connectionsKicked: eventPublisher("connectionsKicked"),
          connectionsOpened: eventPublisher("connectionsOpened"),
          deviceUserAuthoritiesApproved: eventPublisher(
            "Auth.DeviceUserAuthorities.Approved",
          ),
          deviceUserAuthoritiesRequested: eventPublisher(
            "deviceUserAuthoritiesRequested",
          ),
          deviceUserAuthoritiesResolved: eventPublisher(
            "Auth.DeviceUserAuthorities.Resolved",
          ),
          deviceUserAuthoritiesReviewRequested: eventPublisher(
            "deviceUserAuthoritiesReviewRequested",
          ),
          sessionsRevoked: eventPublisher("sessionsRevoked"),
        },
      },
    },
    userStorage: { get: async () => undefined },
    getActiveCatalogIssues: args.activeCatalogIssues
      ? async () => args.activeCatalogIssues ?? []
      : undefined,
    installDeviceContract: args.installDeviceContract ?? (async () => ({
      id: "reader@v1",
      digest: "digest-b",
      displayName: "Reader",
      description: "Reader device",
    })),
    refreshActiveContracts: args.refreshActiveContracts ?? (async () => {}),
    validateActiveCatalog: args.validateActiveCatalog ?? (async () => {}),
  };
  return {
    deps,
    getStored: () => stored,
    getInstances: () => instances,
    getProvisioningSecret: () => provisioningSecrets[0],
    getProvisioningSecrets: () => provisioningSecrets,
    getActivation: () => activations[0],
    getActivations: () => activations,
    getActivationReviews: () => activationReviews,
  };
}

Deno.test("Auth.CatalogIssues.Resolve applies force-replace without deleting offers", async () => {
  let refreshCount = 0;
  const { deps } = deviceAdminDeps({
    activeCatalogIssues: [{
      issueId: "issue-1",
      kind: "incompatible-active-contract",
      contractId: "billing@v1",
      digest: "digest-proposed",
      message: "forced update pending",
      deploymentIds: ["svc-b"],
      effectiveDigests: ["digest-current"],
      conflictingDigest: "digest-proposed",
      conflictingDigests: ["digest-proposed"],
      effectiveDeploymentIds: ["svc-a"],
      conflictingDeploymentIds: ["svc-b"],
      actions: [{
        action: "force-replace",
        label: "Force replace active implementation",
        description: "Accept the proposed digest.",
        risk: "dangerous",
        deploymentIds: ["svc-a"],
        digests: ["digest-current"],
      }],
    }],
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
  });

  const result = await createDeviceAdminHandlers(deps).resolveCatalogIssue({
    input: { issueId: "issue-1", action: "force-replace" },
    context: adminContext,
  });

  assert(result.isOk());
  const value = result.take();
  assertEquals(value, {
    success: true,
    issueId: "issue-1",
    action: "force-replace",
  });
  assertEquals(refreshCount, 1);
});

Deno.test("Auth.Deployments.Enable device validates staged deployment before persisting", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: true,
  };
  const putDeployments: DeviceDeployment[] = [];
  let refreshCount = 0;
  const { deps, getStored } = deviceAdminDeps({
    deployment: original,
    putDeployments,
    validateActiveCatalog: async ({ stagedDeviceDeployments }) => {
      assertEquals([...stagedDeviceDeployments ?? []], [{
        ...original,
        disabled: false,
      }]);
      throw new Error("incompatible staged active catalog");
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
  });

  const result = await createDeviceAdminHandlers(deps).enableDeviceDeployment({
    input: { deploymentId: "reader.default" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(putDeployments, []);
  assertEquals(refreshCount, 0);
  assertEquals(getStored(), original);
});

Deno.test("Auth.Deployments.Enable device updates the deployment authority disabled state", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: true,
  };
  const authorityPuts: DeploymentAuthority[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment: original,
    authority: deploymentAuthority({
      deploymentId: "reader.default",
      kind: "device",
      disabled: true,
    }),
    authorityPuts,
  });

  const result = await createDeviceAdminHandlers(deps).enableDeviceDeployment({
    input: { deploymentId: "reader.default" },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(getStored()?.disabled, false);
  assertEquals(authorityPuts.at(-1)?.disabled, false);
});

Deno.test("Auth.Deployments.Enable device reconciles authority disabled state after refresh", async () => {
  const authorityPuts: DeploymentAuthority[] = [];
  let refreshed = false;
  const reconciles: Array<{ deploymentId: string; desiredVersion?: string }> =
    [];
  const { deps } = deviceAdminDeps({
    deployment: {
      deploymentId: "reader.default",
      reviewMode: "none",
      disabled: true,
    },
    authority: deploymentAuthority({
      deploymentId: "reader.default",
      kind: "device",
      disabled: true,
    }),
    authorityPuts,
    refreshActiveContracts: async () => {
      refreshed = true;
    },
    authorityReconciler: {
      reconcileDeployment: async (deploymentId, opts) => {
        assert(refreshed);
        reconciles.push({ deploymentId, desiredVersion: opts?.desiredVersion });
      },
    },
  });

  const result = await createDeviceAdminHandlers(deps).enableDeviceDeployment({
    input: { deploymentId: "reader.default" },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(reconciles, [{
    deploymentId: "reader.default",
    desiredVersion: authorityPuts.at(-1)?.version,
  }]);
});

Deno.test("Auth.Deployments.Enable device restores original authority when refresh fails", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: true,
  };
  const originalAuthority = deploymentAuthority({
    deploymentId: "reader.default",
    kind: "device",
    disabled: true,
  });
  const authorityPuts: DeploymentAuthority[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment,
    authority: originalAuthority,
    authorityPuts,
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
    authorityReconciler: {
      reconcileDeployment: async () => {
        throw new Error("should not reconcile");
      },
    },
  });

  const result = await createDeviceAdminHandlers(deps).enableDeviceDeployment({
    input: { deploymentId: "reader.default" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(getStored(), deployment);
  assertEquals(authorityPuts.at(-1), originalAuthority);
});

Deno.test("Auth.Deployments.Create device initializes an empty device authority", async () => {
  const authorityPuts: DeploymentAuthority[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment: {
      deploymentId: "reader.old",
      reviewMode: "none",
      disabled: false,
    },
    authorityPuts,
  });

  const result = await createDeviceAdminHandlers(deps).createDeviceDeployment({
    input: { deploymentId: "reader.default", reviewMode: "required" },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(getStored()?.deploymentId, "reader.default");
  assertEquals(authorityPuts.length, 1);
  assertEquals(authorityPuts[0]?.deploymentId, "reader.default");
  assertEquals(authorityPuts[0]?.kind, "device");
  assertEquals(authorityPuts[0]?.disabled, false);
  assertEquals(authorityPuts[0]?.desiredState, {
    needs: authorityNeedSet(),
    capabilities: [],
    resources: [],
    surfaces: [],
  });
});

Deno.test("Auth.Deployments.Create device resets an existing disabled authority", async () => {
  const authorityPuts: DeploymentAuthority[] = [];
  const { deps, getStored } = deviceAdminDeps({
    authority: deploymentAuthority({
      deploymentId: "reader.default",
      kind: "device",
      disabled: true,
      desiredState: {
        needs: authorityNeedSet({
          contracts: [{ contractId: "old@v1", required: true }],
        }),
        capabilities: ["old.use"],
        resources: [],
        surfaces: [],
      },
    }),
    authorityPuts,
  });

  const result = await createDeviceAdminHandlers(deps).createDeviceDeployment({
    input: { deploymentId: "reader.default", reviewMode: "required" },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(getStored()?.deploymentId, "reader.default");
  assertEquals(authorityPuts.length, 1);
  assertEquals(authorityPuts[0]?.deploymentId, "reader.default");
  assertEquals(authorityPuts[0]?.kind, "device");
  assertEquals(authorityPuts[0]?.disabled, false);
  assertEquals(authorityPuts[0]?.desiredState, {
    needs: authorityNeedSet(),
    capabilities: [],
    resources: [],
    surfaces: [],
  });
  assert(authorityPuts[0]?.version !== "v1");
});

Deno.test("Auth.Deployments.Create device rolls back deployment when authority initialization fails", async () => {
  const { deps, getStored } = deviceAdminDeps({});
  deps.deploymentAuthorityStorage.put = async () => {
    throw new Error("authority write failed");
  };

  const result = await createDeviceAdminHandlers(deps).createDeviceDeployment({
    input: { deploymentId: "reader.default", reviewMode: "required" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(getStored(), undefined);
});

Deno.test("Auth.Deployments.Remove device without cascade rejects deployments with instances", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const instance: DeviceInstance = {
    instanceId: "device_1",
    publicIdentityKey: "public-key-1",
    deploymentId: "reader.default",
    state: "registered",
    createdAt: "2026-01-01T00:00:00.000Z",
    activatedAt: null,
    revokedAt: null,
  };
  const deletedInstances: string[] = [];
  const { deps, getStored, getInstances } = deviceAdminDeps(
    {
      deployment,
      instances: [instance],
      deletedInstances,
      refreshActiveContracts: async () => {
        throw new Error("should not refresh");
      },
      validateActiveCatalog: async () => {
        throw new Error("should not validate");
      },
    },
  );

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: { deploymentId: "reader.default" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(getStored(), deployment);
  assertEquals(getInstances(), [instance]);
  assertEquals(deletedInstances, []);
});

Deno.test("Auth.Deployments.Remove device rejects contract purge without cascade before deleting", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const deletedContracts: string[] = [];
  const deletedInstances: string[] = [];
  let refreshCount = 0;
  const { deps, getStored } = deviceAdminDeps({
    deployment,
    deletedContracts,
    deletedInstances,
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {
      throw new Error("should not validate");
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: { deploymentId: "reader.default", purgeUnusedContracts: true },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(getStored(), deployment);
  assertEquals(deletedInstances, []);
  assertEquals(deletedContracts, []);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.Deployments.Remove device skips unused contract purge dependencies", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const instance: DeviceInstance = {
    instanceId: "device_1",
    publicIdentityKey: "public-key-1",
    deploymentId: "reader.default",
    state: "activated",
    createdAt: "2026-01-01T00:00:00.000Z",
    activatedAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  };
  const deletedInstances: string[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  let refreshCount = 0;
  const { deps, getStored, getInstances } = deviceAdminDeps({
    deployment,
    instances: [instance],
    deletedInstances,
    kicked,
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
  });
  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: {
      deploymentId: "reader.default",
      cascade: true,
      purgeUnusedContracts: true,
    },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(getStored(), undefined);
  assertEquals(getInstances(), []);
  assertEquals(deletedInstances, ["device_1"]);
  assertEquals(kicked, [{ serverId: "server-1", clientId: 1 }]);
  assertEquals(refreshCount, 1);
});

Deno.test("Auth.Deployments.Remove device skips unused contract purge after offer cleanup", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const calls: string[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment,
    serviceDeployments: [{ deploymentId: "service.default" }],
    refreshActiveContracts: async () => {
      calls.push("refresh");
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: {
      deploymentId: "reader.default",
      cascade: true,
      purgeUnusedContracts: true,
    },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(calls, ["refresh"]);
  assertEquals(getStored(), undefined);
});

Deno.test("Auth.Deployments.Remove device remains successful when unused contract purge is requested", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const calls: string[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment,
    refreshActiveContracts: async () => {
      calls.push("refresh");
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: {
      deploymentId: "reader.default",
      cascade: true,
      purgeUnusedContracts: true,
    },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(calls, ["refresh"]);
  assertEquals(getStored(), undefined);
});

Deno.test("Auth.Deployments.Remove device cascades instances and deployment-scoped auth state", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const instances: DeviceInstance[] = [
    {
      instanceId: "device_1",
      publicIdentityKey: "public-key-1",
      deploymentId: "reader.default",
      state: "activated",
      createdAt: "2026-01-01T00:00:00.000Z",
      activatedAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
    },
    {
      instanceId: "device_2",
      publicIdentityKey: "public-key-2",
      deploymentId: "reader.default",
      state: "registered",
      createdAt: "2026-01-01T00:00:00.000Z",
      activatedAt: null,
      revokedAt: null,
    },
  ];
  const provisioningSecrets = instances.map((instance, index) => ({
    instanceId: instance.instanceId,
    activationKey: `activation-key-${index + 1}`,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
  const activations: DeviceActivationRecord[] = [{
    instanceId: "device_1",
    publicIdentityKey: "public-key-1",
    deploymentId: "reader.default",
    state: "activated",
    activatedAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  }];
  const activationReviews: DeviceActivationReviewRecord[] = [{
    reviewId: "review_1",
    operationId: "operation_1",
    flowId: "flow_1",
    instanceId: "device_2",
    publicIdentityKey: "public-key-2",
    deploymentId: "reader.default",
    state: "pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
    requestedBy: portalActivationActor,
  }];
  const browserFlowDeletes: string[] = [];
  const deletedInstances: string[] = [];
  const deletedActivationReviews: string[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const stagedInstances: DeviceInstance[] = [];
  const refreshOptions: unknown[] = [];
  const {
    deps,
    getStored,
    getInstances,
    getProvisioningSecrets,
    getActivations,
    getActivationReviews,
  } = deviceAdminDeps({
    deployment,
    instances,
    provisioningSecrets,
    activations,
    activationReviews,
    browserFlowDeletes,
    deletedInstances,
    deletedActivationReviews,
    kicked,
    refreshActiveContracts: async (opts) => {
      refreshOptions.push(opts);
    },
    validateActiveCatalog: async (
      {
        stagedDeviceDeployments,
        stagedDeviceInstances,
      },
    ) => {
      assertEquals([...stagedDeviceDeployments ?? []], [{
        ...deployment,
        disabled: true,
      }]);
      stagedInstances.push(...stagedDeviceInstances ?? []);
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: { deploymentId: "reader.default", cascade: true },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(
    stagedInstances,
    instances.map((instance) => ({
      ...instance,
      state: "disabled",
    })),
  );
  assertEquals(getStored(), undefined);
  assertEquals(getInstances(), []);
  assertEquals(getProvisioningSecrets(), []);
  assertEquals(getActivations(), []);
  assertEquals(getActivationReviews(), []);
  assertEquals(deletedInstances, ["device_1", "device_2"]);
  assertEquals(deletedActivationReviews, ["review_1"]);
  assertEquals(browserFlowDeletes, ["flow_1"]);
  assertEquals(refreshOptions, [undefined]);
  assertEquals(kicked, [
    { serverId: "server-1", clientId: 1 },
    { serverId: "server-1", clientId: 1 },
  ]);
});

Deno.test("Auth.Deployments.Remove device does not delete auth state or refresh when cascade kick fails", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const instances: DeviceInstance[] = [{
    instanceId: "device_1",
    publicIdentityKey: "public-key-1",
    deploymentId: "reader.default",
    state: "activated",
    createdAt: "2026-01-01T00:00:00.000Z",
    activatedAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  }];
  const provisioningSecrets = [{
    instanceId: "device_1",
    activationKey: "activation-key-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }];
  const activations: DeviceActivationRecord[] = [{
    instanceId: "device_1",
    publicIdentityKey: "public-key-1",
    deploymentId: "reader.default",
    state: "activated",
    activatedAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  }];
  const activationReviews: DeviceActivationReviewRecord[] = [{
    reviewId: "review_1",
    operationId: "operation_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "public-key-1",
    deploymentId: "reader.default",
    state: "pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
    requestedBy: portalActivationActor,
  }];
  const browserFlowDeletes: string[] = [];
  const deletedInstances: string[] = [];
  const deletedActivationReviews: string[] = [];
  let refreshCount = 0;
  const {
    deps,
    getStored,
    getInstances,
    getProvisioningSecrets,
    getActivations,
    getActivationReviews,
  } = deviceAdminDeps({
    deployment,
    instances,
    provisioningSecrets,
    activations,
    activationReviews,
    browserFlowDeletes,
    deletedInstances,
    deletedActivationReviews,
    kick: async () => {
      throw new Error("kick failed");
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: { deploymentId: "reader.default", cascade: true },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(getStored(), deployment);
  assertEquals(getInstances(), instances);
  assertEquals(getProvisioningSecrets(), provisioningSecrets);
  assertEquals(getActivations(), activations);
  assertEquals(getActivationReviews(), activationReviews);
  assertEquals(deletedInstances, []);
  assertEquals(deletedActivationReviews, []);
  assertEquals(browserFlowDeletes, []);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.Deployments.Remove device keeps auth state when refresh fails", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const instance: DeviceInstance = {
    instanceId: "device_1",
    publicIdentityKey: "public-key-1",
    deploymentId: "reader.default",
    state: "registered",
    createdAt: "2026-01-01T00:00:00.000Z",
    activatedAt: null,
    revokedAt: null,
  };
  const activationReviews: DeviceActivationReviewRecord[] = [{
    reviewId: "review_1",
    operationId: "operation_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "public-key-1",
    deploymentId: "reader.default",
    state: "pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
    requestedBy: portalActivationActor,
  }];
  const browserFlowDeletes: string[] = [];
  const { deps } = deviceAdminDeps({
    deployment,
    instances: [instance],
    activationReviews,
    browserFlowDeletes,
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: { deploymentId: "reader.default", cascade: true },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(browserFlowDeletes, []);
});

Deno.test("Auth.Devices.Remove rolls back durable records and does not kick when refresh fails", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const instance: DeviceInstance = {
    instanceId: "device_1",
    publicIdentityKey: "session-key-1",
    deploymentId: "reader.default",
    state: "activated",
    createdAt: "2026-01-01T00:00:00.000Z",
    activatedAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  };
  const provisioningSecret = {
    instanceId: "device_1",
    activationKey: "activation-key",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const activation: DeviceActivationRecord = {
    instanceId: "device_1",
    publicIdentityKey: "session-key-1",
    deploymentId: "reader.default",
    state: "activated",
    activatedAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  };
  const deletedInstances: string[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const {
    deps,
    getInstances,
    getProvisioningSecret,
    getActivation,
  } = deviceAdminDeps({
    deployment,
    instances: [instance],
    provisioningSecret,
    activation,
    deletedInstances,
    kicked,
    validateActiveCatalog: async ({ stagedDeviceInstances }) => {
      assertEquals([...stagedDeviceInstances ?? []], [{
        ...instance,
        state: "disabled",
      }]);
    },
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceInstance({
    input: { instanceId: "device_1" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(deletedInstances, ["device_1"]);
  assertEquals(kicked, []);
  assertEquals(getInstances(), [instance]);
  assertEquals(getProvisioningSecret(), provisioningSecret);
  assertEquals(getActivation(), activation);
});

Deno.test("auth review event is templated by deployment", () => {
  assertEquals(
    TRELLIS_AUTH_EVENTS["Auth.DeviceUserAuthorities.ReviewRequested"].params,
    ["/deploymentId"],
  );
  assertEquals(
    TRELLIS_AUTH_EVENTS["Auth.DeviceUserAuthorities.Requested"].params,
    ["/deploymentId"],
  );
  assertEquals(
    TRELLIS_AUTH_EVENTS["Auth.DeviceUserAuthorities.Approved"].params,
    ["/deploymentId"],
  );
  assertEquals(
    TRELLIS_AUTH_EVENTS["Auth.DeviceUserAuthorities.Resolved"].params,
    ["/deploymentId"],
  );
});

Deno.test("Auth.DeviceUserAuthorities.Reviews.Decide completes approve decision through operation controller", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: userActivationActor,
    state: "pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
  };
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "required",
    disabled: false,
  };
  const instance: DeviceInstance = {
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    state: "registered",
    createdAt: "2026-01-01T00:00:00.000Z",
    activatedAt: null,
    revokedAt: null,
  };
  const completions: Array<{ operationId: string; output: unknown }> = [];
  const putReviews: DeviceActivationReviewRecord[] = [];
  const putInstances: DeviceInstance[] = [];
  const publishes: Array<{ event: string; payload: unknown }> = [];
  const { deps } = deviceAdminDeps({
    deployment,
    instances: [instance],
    publishes,
  });
  const result = await createDeviceAdminHandlers({
    ...deps,
    operationCompletion: {
      completeOperation: (operationId, output) => {
        completions.push({ operationId, output });
        return AsyncResult.ok(operationSnapshot(operationId, output));
      },
    },
    deviceActivationReviewStorage: {
      get: async () => review,
      getByFlowId: async () => review,
      put: async (record) => {
        putReviews.push(record);
      },
      delete: async () => {},
      listPage: async () => [review],
      listFilteredPage: async (_filters, query) =>
        pageFromQuery([review], query),
    },
    deviceActivationStorage: {
      get: async () => undefined,
      put: async () => {},
      delete: async () => {},
      listPage: async () => [],
      listFilteredPage: async (_filters, query) => pageFromQuery([], query),
    },
    deviceInstanceStorage: {
      ...deps.deviceInstanceStorage,
      get: async () => instance,
      put: async (record) => {
        putInstances.push(record);
      },
    },
  }).decideDeviceActivationReview({
    input: { reviewId: "dar_1", decision: "approve" },
    context: adminContext,
  });

  assert(!result.isErr());
  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(completions, [{
    operationId: "op_activate_1",
    output: {
      status: "activated",
      instanceId: "device_1",
      deploymentId: "reader.default",
      activatedAt: putReviews[0].decidedAt,
    },
  }]);
  assertEquals(putReviews[0].state, "approved");
  assertEquals(putInstances[0].state, "activated");
  assertEquals(value.review.state, "approved");
  assertEquals(publishes, [
    {
      event: "Auth.DeviceUserAuthorities.Approved",
      payload: {
        reviewId: "dar_1",
        flowId: "flow_1",
        instanceId: "device_1",
        publicIdentityKey: "pub_device_1",
        deploymentId: "reader.default",
        requestedAt: "2026-01-01T00:00:00.000Z",
        approvedAt: putReviews[0].decidedAt,
        requestedBy: userActivationActor,
        approvedBy: adminActivationActor,
      },
    },
    {
      event: "Auth.DeviceUserAuthorities.Resolved",
      payload: {
        instanceId: "device_1",
        publicIdentityKey: "pub_device_1",
        deploymentId: "reader.default",
        resolvedAt: putReviews[0].decidedAt,
        resolvedBy: userActivationActor,
        flowId: "flow_1",
        reviewId: "dar_1",
      },
    },
  ]);
});

Deno.test("Auth.DeviceUserAuthorities.Reviews.Decide completes reject decision through operation controller", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: userActivationActor,
    state: "pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
  };
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "required",
    disabled: false,
  };
  const completions: Array<{ operationId: string; output: unknown }> = [];
  const putReviews: DeviceActivationReviewRecord[] = [];
  const { deps } = deviceAdminDeps({ deployment });
  const result = await createDeviceAdminHandlers({
    ...deps,
    operationCompletion: {
      completeOperation: (operationId, output) => {
        completions.push({ operationId, output });
        return AsyncResult.ok(operationSnapshot(operationId, output));
      },
    },
    deviceActivationReviewStorage: {
      get: async () => review,
      getByFlowId: async () => review,
      put: async (record) => {
        putReviews.push(record);
      },
      delete: async () => {},
      listPage: async () => [review],
      listFilteredPage: async (_filters, query) =>
        pageFromQuery([review], query),
    },
  }).decideDeviceActivationReview({
    input: { reviewId: "dar_1", decision: "reject", reason: "not expected" },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(putReviews[0].state, "rejected");
  assertEquals(completions, [{
    operationId: "op_activate_1",
    output: { status: "rejected", reason: "not expected" },
  }]);
});

Deno.test("Auth.DeviceUserAuthorities.Reviews.Decide retries completion for already-approved review", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: userActivationActor,
    state: "approved",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: "2026-01-01T00:00:01.000Z",
  };
  const activation: DeviceActivationRecord = {
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    activatedBy: userActivationActor,
    state: "activated" as const,
    activatedAt: "2026-01-01T00:00:01.000Z",
    revokedAt: null,
  };
  const completions: Array<{ operationId: string; output: unknown }> = [];
  const putReviews: DeviceActivationReviewRecord[] = [];
  const putActivations: DeviceActivationRecord[] = [];
  const { deps } = deviceAdminDeps({
    deployment: {
      deploymentId: "reader.default",
      reviewMode: "required",
      disabled: false,
    },
  });

  const result = await createDeviceAdminHandlers({
    ...deps,
    operationCompletion: {
      completeOperation: (operationId, output) => {
        completions.push({ operationId, output });
        return AsyncResult.ok(operationSnapshot(operationId, output));
      },
    },
    deviceActivationReviewStorage: {
      get: async () => review,
      getByFlowId: async () => review,
      put: async (record) => {
        putReviews.push(record);
      },
      delete: async () => {},
      listPage: async () => [review],
      listFilteredPage: async (_filters, query) =>
        pageFromQuery([review], query),
    },
    deviceActivationStorage: {
      get: async () => activation,
      put: async (record) => {
        putActivations.push(record);
      },
      delete: async () => {},
      listPage: async () => [activation],
      listFilteredPage: async (_filters, query) =>
        pageFromQuery([activation], query),
    },
  }).decideDeviceActivationReview({
    input: { reviewId: "dar_1", decision: "approve" },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(putReviews, []);
  assertEquals(putActivations, []);
  assertEquals(completions, [{
    operationId: "op_activate_1",
    output: {
      status: "activated",
      instanceId: "device_1",
      deploymentId: "reader.default",
      activatedAt: "2026-01-01T00:00:01.000Z",
    },
  }]);
});

Deno.test("Auth.DeviceUserAuthorities.Reviews.Decide retries completion for already-rejected review", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: userActivationActor,
    state: "rejected",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: "2026-01-01T00:00:01.000Z",
    reason: "not expected",
  };
  const completions: Array<{ operationId: string; output: unknown }> = [];
  const putReviews: DeviceActivationReviewRecord[] = [];
  const { deps } = deviceAdminDeps({
    deployment: {
      deploymentId: "reader.default",
      reviewMode: "required",
      disabled: false,
    },
  });

  const result = await createDeviceAdminHandlers({
    ...deps,
    operationCompletion: {
      completeOperation: (operationId, output) => {
        completions.push({ operationId, output });
        return AsyncResult.ok(operationSnapshot(operationId, output));
      },
    },
    deviceActivationReviewStorage: {
      get: async () => review,
      getByFlowId: async () => review,
      put: async (record) => {
        putReviews.push(record);
      },
      delete: async () => {},
      listPage: async () => [review],
      listFilteredPage: async (_filters, query) =>
        pageFromQuery([review], query),
    },
  }).decideDeviceActivationReview({
    input: { reviewId: "dar_1", decision: "reject" },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(putReviews, []);
  assertEquals(completions, [{
    operationId: "op_activate_1",
    output: { status: "rejected", reason: "not expected" },
  }]);
});

Deno.test("Auth.DeviceUserAuthorities.Reviews.Decide does not mutate when operation completion is missing", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: userActivationActor,
    state: "pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
  };
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "required",
    disabled: false,
  };
  const instance: DeviceInstance = {
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    state: "registered",
    createdAt: "2026-01-01T00:00:00.000Z",
    activatedAt: null,
    revokedAt: null,
  };
  const putReviews: DeviceActivationReviewRecord[] = [];
  const putActivations: DeviceActivationRecord[] = [];
  const putInstances: DeviceInstance[] = [];
  const { deps } = deviceAdminDeps({ deployment, instances: [instance] });

  const result = await createDeviceAdminHandlers({
    ...deps,
    operationCompletion: undefined,
    deviceActivationReviewStorage: {
      get: async () => review,
      getByFlowId: async () => review,
      put: async (record) => {
        putReviews.push(record);
      },
      delete: async () => {},
      listPage: async () => [review],
      listFilteredPage: async (_filters, query) =>
        pageFromQuery([review], query),
    },
    deviceActivationStorage: {
      get: async () => undefined,
      put: async (record) => {
        putActivations.push(record);
      },
      delete: async () => {},
      listPage: async () => [],
      listFilteredPage: async (_filters, query) => pageFromQuery([], query),
    },
    deviceInstanceStorage: {
      ...deps.deviceInstanceStorage,
      get: async () => instance,
      put: async (record) => {
        putInstances.push(record);
      },
    },
  }).decideDeviceActivationReview({
    input: { reviewId: "dar_1", decision: "approve" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(putReviews, []);
  assertEquals(putActivations, []);
  assertEquals(putInstances, []);
});

Deno.test("validateDeviceDeploymentRequest returns clean deployment shape", () => {
  const valid = validateDeviceDeploymentRequest({
    deploymentId: "reader.default",
    reviewMode: "none",
  });
  if (valid.isErr()) {
    throw new Error("expected valid device deployment request");
  }
  const { deployment } = valid.take() as {
    deployment: Record<string, unknown>;
  };
  assertEquals(deployment, {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  });
});

Deno.test("validateDeviceProvisionRequest builds a preregistered instance", () => {
  const valid = validateDeviceProvisionRequest({
    deploymentId: "reader.default",
    publicIdentityKey: "A".repeat(43),
    activationKey: "B".repeat(43),
    metadata: {
      name: "Front Desk Reader",
      serialNumber: "SN-123",
      modelNumber: "MODEL-9",
      assetTag: "asset-42",
    },
  });
  assert(!valid.isErr());
  const value = valid.take() as { instance: Record<string, unknown> };
  assertEquals(value.instance.deploymentId, "reader.default");
  assertEquals(value.instance.publicIdentityKey, "A".repeat(43));
  assertEquals(value.instance.metadata, {
    name: "Front Desk Reader",
    serialNumber: "SN-123",
    modelNumber: "MODEL-9",
    assetTag: "asset-42",
  });
  assertEquals(value.instance.state, "registered");
});

Deno.test("validateDeviceProvisionRequest rejects empty metadata entries", () => {
  assert(
    validateDeviceProvisionRequest({
      deploymentId: "reader.default",
      publicIdentityKey: "A".repeat(43),
      activationKey: "B".repeat(43),
      metadata: { assetTag: "" },
    }).isErr(),
  );
});
