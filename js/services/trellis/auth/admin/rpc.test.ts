import { assert, assertEquals } from "@std/assert";
import { AsyncResult, isErr, Result } from "@qlever-llc/result";
import type { OperationSnapshot } from "@qlever-llc/trellis";
import {
  digestContractManifest,
  type TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import Value from "typebox/value";
import {
  AuthListConnectionsResponseSchema,
} from "../../../../packages/trellis/models/auth/rpc/ListConnections.ts";
import {
  AuthListSessionsResponseSchema,
} from "../../../../packages/trellis/models/auth/rpc/ListSessions.ts";
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
  validateDevicePortalSelectionRequest,
  validateDeviceProvisionRequest,
  validateInstanceGrantPolicyRequest,
  validateLoginPortalSelectionRequest,
  validatePortalDefaultRequest,
  validatePortalProfileRequest,
  validatePortalRequest,
  validateServiceDeploymentRequest,
} from "./shared.ts";
import { type AdminRpcDeps, createDeviceAdminHandlers } from "./rpc.ts";
import {
  createAuthApplyServiceDeploymentContractHandler,
  createAuthCreateServiceDeploymentHandler,
  createAuthDisableServiceDeploymentHandler,
  createAuthDisableServiceInstanceHandler,
  createAuthEnableServiceDeploymentHandler,
  createAuthEnableServiceInstanceHandler,
  createAuthListServiceDeploymentsHandler,
  createAuthListServiceInstancesHandler,
  createAuthProvisionServiceInstanceHandler,
  createAuthRemoveServiceDeploymentHandler,
  createAuthRemoveServiceInstanceHandler,
  createAuthUnapplyServiceDeploymentContractHandler,
  type ServiceAdminRpcDeps,
} from "./service_rpc.ts";
import { ContractStore } from "../../catalog/store.ts";

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
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => throwingStoreAccess(),
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

  async list(): Promise<ServiceDeployment[]> {
    await Promise.resolve();
    return [...this.#deployments.values()];
  }
}

const serviceContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "acme.billing@v1",
  displayName: "Billing",
  description: "Billing service",
  kind: "service",
};

const adminContext = {
  caller: { type: "user", id: "admin", capabilities: ["admin"] },
};

function kickDeps(serviceDeps: ServiceAdminRpcDeps) {
  return {
    ...serviceDeps,
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
    operation: "Auth.ActivateDevice",
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

Deno.test("auth contract exposes service, portal, and device admin RPCs", () => {
  const methods = Object.keys(TRELLIS_AUTH_RPC);
  assert(methods.includes("Auth.CreatePortal"));
  assert(methods.includes("Auth.ListPortals"));
  assert(methods.includes("Auth.DisablePortal"));
  assert(methods.includes("Auth.ListPortalProfiles"));
  assert(methods.includes("Auth.SetPortalProfile"));
  assert(methods.includes("Auth.DisablePortalProfile"));
  assert(methods.includes("Auth.GetLoginPortalDefault"));
  assert(methods.includes("Auth.SetLoginPortalDefault"));
  assert(methods.includes("Auth.ListInstanceGrantPolicies"));
  assert(methods.includes("Auth.UpsertInstanceGrantPolicy"));
  assert(methods.includes("Auth.DisableInstanceGrantPolicy"));
  assert(methods.includes("Auth.ListLoginPortalSelections"));
  assert(methods.includes("Auth.SetLoginPortalSelection"));
  assert(methods.includes("Auth.ClearLoginPortalSelection"));
  assert(methods.includes("Auth.GetDevicePortalDefault"));
  assert(methods.includes("Auth.SetDevicePortalDefault"));
  assert(methods.includes("Auth.ListDevicePortalSelections"));
  assert(methods.includes("Auth.SetDevicePortalSelection"));
  assert(methods.includes("Auth.ClearDevicePortalSelection"));
  assert(methods.includes("Auth.CreateDeviceDeployment"));
  assert(methods.includes("Auth.ApplyDeviceDeploymentContract"));
  assert(methods.includes("Auth.UnapplyDeviceDeploymentContract"));
  assert(methods.includes("Auth.ListDeviceDeployments"));
  assert(methods.includes("Auth.DisableDeviceDeployment"));
  assert(methods.includes("Auth.EnableDeviceDeployment"));
  assert(methods.includes("Auth.RemoveDeviceDeployment"));
  assert(methods.includes("Auth.ProvisionDeviceInstance"));
  assert(methods.includes("Auth.ListDeviceInstances"));
  assert(methods.includes("Auth.DisableDeviceInstance"));
  assert(methods.includes("Auth.EnableDeviceInstance"));
  assert(methods.includes("Auth.RemoveDeviceInstance"));
  assert(methods.includes("Auth.ListDeviceActivations"));
  assert(methods.includes("Auth.RevokeDeviceActivation"));
  assert(methods.includes("Auth.ListDeviceActivationReviews"));
  assert(methods.includes("Auth.DecideDeviceActivationReview"));
  assert(methods.includes("Auth.CreateServiceDeployment"));
  assert(methods.includes("Auth.ApplyServiceDeploymentContract"));
  assert(methods.includes("Auth.UnapplyServiceDeploymentContract"));
  assert(methods.includes("Auth.ListServiceDeployments"));
  assert(methods.includes("Auth.DisableServiceDeployment"));
  assert(methods.includes("Auth.EnableServiceDeployment"));
  assert(methods.includes("Auth.RemoveServiceDeployment"));
  assert(methods.includes("Auth.ProvisionServiceInstance"));
  assert(methods.includes("Auth.ListServiceInstances"));
  assert(methods.includes("Auth.DisableServiceInstance"));
  assert(methods.includes("Auth.EnableServiceInstance"));
  assert(methods.includes("Auth.RemoveServiceInstance"));
  assert(methods.includes("Auth.ListUserGrants"));
  assert(methods.includes("Auth.RevokeUserGrant"));
  assert(!methods.includes("Auth.CreatePortalRoute"));
  assert(!methods.includes("Auth.ListPortalRoutes"));
  assert(!methods.includes("Auth.DisablePortalRoute"));
  assert(!methods.includes("Auth.InstallService"));
  assert(!methods.includes("Auth.UpgradeServiceContract"));
  assert(!methods.includes("Auth.RemoveService"));

  const operations = Object.keys(TRELLIS_AUTH_OPERATIONS);
  assertEquals(operations, ["Auth.ActivateDevice"]);
});

Deno.test("production auth registration does not configure mutable auth/admin globals", async () => {
  const [rpcSource, registerSource, portalSource, deviceSource] = await Promise
    .all([
      Deno.readTextFile(new URL("./rpc.ts", import.meta.url)),
      Deno.readTextFile(new URL("../register.ts", import.meta.url)),
      Deno.readTextFile(
        new URL("../registration/portal_policy_admin.ts", import.meta.url),
      ),
      Deno.readTextFile(
        new URL("../registration/device_admin_activation.ts", import.meta.url),
      ),
    ]);

  assert(!rpcSource.includes("AsyncLocalStorage"));
  assert(!registerSource.includes("setAuthRuntimeDeps("));
  assert(!portalSource.includes("setAdminRpcDeps("));
  assert(!deviceSource.includes("setAdminRpcDeps("));
});

Deno.test("service admin RPC handlers require admin before touching dependencies", async () => {
  const serviceDeps = serviceAdminDeps();
  const runtimeDeps = kickDeps(serviceDeps);
  const caller = { type: "user", id: "not-admin", capabilities: [] };
  const context = { caller };

  const actions: Array<() => Promise<unknown>> = [
    () =>
      createAuthCreateServiceDeploymentHandler(serviceDeps)({
        input: { deploymentId: "billing.default", namespaces: ["billing"] },
        context,
      }),
    () =>
      createAuthListServiceDeploymentsHandler(serviceDeps)({
        input: {},
        context,
      }),
    () =>
      createAuthApplyServiceDeploymentContractHandler({
        installServiceContract: async () => throwingStoreAccess(),
        refreshActiveContracts: async () => throwingStoreAccess(),
        serviceDeploymentStorage: serviceDeps.serviceDeploymentStorage,
        logger: serviceDeps.logger,
      })({
        input: {
          deploymentId: "billing.default",
          contract: {},
          expectedDigest: "digest-a",
        },
        context,
      }),
    () =>
      createAuthUnapplyServiceDeploymentContractHandler(runtimeDeps)({
        input: { deploymentId: "billing.default", contractId: "billing@v1" },
        context,
      }),
    () =>
      createAuthDisableServiceDeploymentHandler(runtimeDeps)({
        input: { deploymentId: "billing.default" },
        context,
      }),
    () =>
      createAuthEnableServiceDeploymentHandler(runtimeDeps)({
        input: { deploymentId: "billing.default" },
        context,
      }),
    () =>
      createAuthRemoveServiceDeploymentHandler(runtimeDeps)({
        input: { deploymentId: "billing.default" },
        context,
      }),
    () =>
      createAuthProvisionServiceInstanceHandler(serviceDeps)({
        input: { deploymentId: "billing.default", instanceKey: "instance-key" },
        context,
      }),
    () =>
      createAuthListServiceInstancesHandler(serviceDeps)({
        input: {},
        context,
      }),
    () =>
      createAuthDisableServiceInstanceHandler(runtimeDeps)({
        input: { instanceId: "svc_123" },
        context,
      }),
    () =>
      createAuthEnableServiceInstanceHandler(runtimeDeps)({
        input: { instanceId: "svc_123" },
        context,
      }),
    () =>
      createAuthRemoveServiceInstanceHandler(runtimeDeps)({
        input: { instanceId: "svc_123" },
        context,
      }),
  ];

  for (const action of actions) {
    await assertInsufficientPermissions(action);
  }
});

Deno.test("Auth.ApplyServiceDeploymentContract refreshes active contracts after persisting deployment", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  serviceDeploymentStorage.seed({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  });
  const observedDeployments: ServiceDeployment[] = [];

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: "acme.billing@v1",
      digest: "digest-a",
      displayName: "Billing",
      description: "Billing service",
      contract: serviceContract,
      usedNamespaces: ["billing", "audit"],
    }),
    refreshActiveContracts: async () => {
      const deployment = serviceDeploymentStorage.getValue("billing.default");
      assert(deployment !== undefined);
      observedDeployments.push(deployment);
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: {},
      expectedDigest: "digest-a",
    },
    context: adminContext,
  });
  assert(!result.isErr());
  const value = result.take() as {
    deployment: ServiceDeployment;
    contract: { digest: string };
  };

  assertEquals(observedDeployments.length, 1);
  assertEquals(observedDeployments[0], value.deployment);
  assertEquals(value.deployment.namespaces, ["audit", "billing"]);
  assertEquals(value.deployment.appliedContracts, [{
    contractId: "acme.billing@v1",
    compatibilityPolicy: "exact",
    allowedDigests: ["digest-a"],
    resourceBindingsByDigest: { "digest-a": {} },
  }]);
});

Deno.test("Auth.ApplyServiceDeploymentContract uses canonical digest including top-level capabilities", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  serviceDeploymentStorage.seed({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  });
  const contractStore = new ContractStore();
  const capabilityContract: TrellisContractV1 = {
    ...serviceContract,
    capabilities: {
      "acme.billing::admin.read": {
        displayName: "Read billing admin data",
        description: "View billing administrative state.",
      },
    },
  };
  const expectedDigest = digestContractManifest(capabilityContract);

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async (contract) => {
      const validated = await contractStore.validate(contract);
      return {
        id: validated.contract.id,
        digest: validated.digest,
        displayName: validated.contract.displayName,
        description: validated.contract.description,
        contract: validated.contract,
        usedNamespaces: ["billing"],
      };
    },
    refreshActiveContracts: async () => {},
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: capabilityContract,
      expectedDigest,
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = result.take() as {
    deployment: ServiceDeployment;
    contract: { digest: string };
  };
  assertEquals(value.contract.digest, expectedDigest);
  assertEquals(value.deployment.appliedContracts, [{
    contractId: "acme.billing@v1",
    compatibilityPolicy: "exact",
    allowedDigests: [expectedDigest],
    resourceBindingsByDigest: { [expectedDigest]: {} },
  }]);
});

Deno.test("Auth.ApplyServiceDeploymentContract rejects mismatched expected digest", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  const deployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  };
  serviceDeploymentStorage.seed(deployment);
  let provisioned = false;
  let validated = false;

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: serviceContract.id,
      digest: "digest-a",
      displayName: serviceContract.displayName,
      description: serviceContract.description,
      contract: serviceContract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async () => {
      provisioned = true;
      return {};
    },
    validateActiveCatalog: async () => {
      validated = true;
    },
    refreshActiveContracts: async () => {
      throw new Error("should not refresh");
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: {},
      expectedDigest: "digest-reviewed",
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(provisioned, false);
  assertEquals(validated, false);
  assertEquals(serviceDeploymentStorage.putCount, 0);
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default"),
    deployment,
  );
});

Deno.test("Auth.ApplyServiceDeploymentContract provisions resources and persists bindings", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  serviceDeploymentStorage.seed({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  });

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: serviceContract.id,
      digest: "digest-a",
      displayName: serviceContract.displayName,
      description: serviceContract.description,
      contract: serviceContract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async (_nats, provisioned, deploymentId) => {
      assertEquals(provisioned, serviceContract);
      assertEquals(deploymentId, "billing.default");
      return {
        kv: {
          cache: { bucket: "svc_billing_cache", history: 1, ttlMs: 0 },
        },
      };
    },
    refreshActiveContracts: async () => {},
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: {},
      expectedDigest: "digest-a",
    },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(serviceDeploymentStorage.getValue("billing.default"), {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: serviceContract.id,
      compatibilityPolicy: "exact",
      allowedDigests: ["digest-a"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: {
            cache: { bucket: "svc_billing_cache", history: 1, ttlMs: 0 },
          },
        },
      },
    }],
  });
});

Deno.test("Auth.ApplyServiceDeploymentContract preserves bindings for multiple same-lineage digests", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  serviceDeploymentStorage.seed({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: serviceContract.id,
      allowedDigests: ["digest-a"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: {
            cache: { bucket: "svc_billing_cache_a", history: 1, ttlMs: 0 },
          },
        },
      },
    }],
  });

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: serviceContract.id,
      digest: "digest-b",
      displayName: serviceContract.displayName,
      description: serviceContract.description,
      contract: serviceContract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async () => ({
      kv: { cache: { bucket: "svc_billing_cache_b", history: 2, ttlMs: 1000 } },
    }),
    refreshActiveContracts: async () => {},
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: {},
      expectedDigest: "digest-b",
    },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default")?.appliedContracts,
    [{
      contractId: serviceContract.id,
      compatibilityPolicy: "exact",
      allowedDigests: ["digest-a", "digest-b"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: {
            cache: { bucket: "svc_billing_cache_a", history: 1, ttlMs: 0 },
          },
        },
        "digest-b": {
          kv: {
            cache: { bucket: "svc_billing_cache_b", history: 2, ttlMs: 1000 },
          },
        },
      },
    }],
  );
});

Deno.test("Auth.ApplyServiceDeploymentContract replaces same-lineage digests when requested", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  serviceDeploymentStorage.seed({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: serviceContract.id,
      allowedDigests: ["digest-a"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: {
            cache: { bucket: "svc_billing_cache_a", history: 1, ttlMs: 0 },
          },
        },
      },
    }],
  });
  const stagedDeployments: ServiceDeployment[] = [];

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: serviceContract.id,
      digest: "digest-b",
      displayName: serviceContract.displayName,
      description: serviceContract.description,
      contract: serviceContract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async () => ({
      kv: { cache: { bucket: "svc_billing_cache_b", history: 2, ttlMs: 1000 } },
    }),
    validateActiveCatalog: async (
      { extraActiveDigests, stagedServiceDeployments },
    ) => {
      assertEquals(extraActiveDigests, undefined);
      stagedDeployments.push(...stagedServiceDeployments ?? []);
    },
    refreshActiveContracts: async () => {},
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: {},
      expectedDigest: "digest-b",
      replaceExisting: true,
    },
    context: adminContext,
  });

  assert(!result.isErr());
  const expectedDeployment: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: serviceContract.id,
      compatibilityPolicy: "exact",
      allowedDigests: ["digest-b"],
      resourceBindingsByDigest: {
        "digest-b": {
          kv: {
            cache: { bucket: "svc_billing_cache_b", history: 2, ttlMs: 1000 },
          },
        },
      },
    }],
  };
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default"),
    expectedDeployment,
  );
  assertEquals(stagedDeployments, [expectedDeployment]);
});

Deno.test("Auth.ApplyServiceDeploymentContract allows same-lineage digest resource setting changes", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  serviceDeploymentStorage.seed({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: serviceContract.id,
      allowedDigests: ["digest-a"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: {
            cache: { bucket: "svc_billing_cache", history: 1, ttlMs: 0 },
          },
        },
      },
    }],
  });
  let provisionedContract: TrellisContractV1 | undefined;

  const changedResourceContract: TrellisContractV1 = {
    ...serviceContract,
    schemas: { CacheEntry: { type: "object" } },
    resources: {
      kv: {
        cache: {
          purpose: "Cache billing data",
          schema: { schema: "CacheEntry" },
          required: true,
          history: 2,
          ttlMs: 30_000,
        },
      },
    },
  };

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: serviceContract.id,
      digest: "digest-b",
      displayName: serviceContract.displayName,
      description: serviceContract.description,
      contract: changedResourceContract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async (_nats, provisioned) => {
      provisionedContract = provisioned;
      return {
        kv: {
          cache: { bucket: "svc_billing_cache", history: 2, ttlMs: 30_000 },
        },
      };
    },
    validateActiveCatalog: async () => {},
    refreshActiveContracts: async () => {},
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: {},
      expectedDigest: "digest-b",
    },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(provisionedContract, changedResourceContract);
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default")?.appliedContracts,
    [{
      contractId: serviceContract.id,
      compatibilityPolicy: "exact",
      allowedDigests: ["digest-a", "digest-b"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: {
            cache: { bucket: "svc_billing_cache", history: 1, ttlMs: 0 },
          },
        },
        "digest-b": {
          kv: {
            cache: { bucket: "svc_billing_cache", history: 2, ttlMs: 30_000 },
          },
        },
      },
    }],
  );
});

Deno.test("Auth.ApplyServiceDeploymentContract does not mutate deployment when active catalog validation fails", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  const deployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  };
  serviceDeploymentStorage.seed(deployment);
  let refreshed = false;
  let provisioned = false;
  let validationCalls = 0;

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: serviceContract.id,
      digest: "digest-a",
      displayName: serviceContract.displayName,
      description: serviceContract.description,
      contract: serviceContract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async () => {
      provisioned = true;
      return {};
    },
    validateActiveCatalog: async (
      { extraActiveDigests, stagedServiceDeployments },
    ) => {
      validationCalls += 1;
      if (extraActiveDigests) {
        assertEquals([...extraActiveDigests], ["digest-a"]);
        return;
      }
      assertEquals([...stagedServiceDeployments ?? []], [{
        deploymentId: "billing.default",
        namespaces: ["billing"],
        disabled: false,
        appliedContracts: [{
          contractId: serviceContract.id,
          allowedDigests: ["digest-a"],
          resourceBindingsByDigest: { "digest-a": {} },
        }],
      }]);
      throw new Error("incompatible active catalog");
    },
    refreshActiveContracts: async () => {
      refreshed = true;
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: {},
      expectedDigest: "digest-a",
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(validationCalls, 2);
  assertEquals(provisioned, true);
  assertEquals(refreshed, false);
  assertEquals(serviceDeploymentStorage.putCount, 0);
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default"),
    deployment,
  );
});

Deno.test("Auth.ApplyServiceDeploymentContract restores deployment when active refresh fails", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  const deployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  };
  serviceDeploymentStorage.seed(deployment);

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: serviceContract.id,
      digest: "digest-a",
      displayName: serviceContract.displayName,
      description: serviceContract.description,
      contract: serviceContract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async () => ({}),
    validateActiveCatalog: async () => {},
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: {},
      expectedDigest: "digest-a",
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default"),
    deployment,
  );
});

Deno.test("Auth.ApplyServiceDeploymentContract does not mutate deployment when resource provisioning fails", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  const deployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  };
  serviceDeploymentStorage.seed(deployment);

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: serviceContract.id,
      digest: "digest-a",
      displayName: serviceContract.displayName,
      description: serviceContract.description,
      contract: serviceContract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async () => {
      throw new Error("cannot create bucket");
    },
    refreshActiveContracts: async () => {
      throw new Error("should not refresh");
    },
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: {},
      expectedDigest: "digest-a",
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(serviceDeploymentStorage.putCount, 0);
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default"),
    deployment,
  );
});

Deno.test("session and connection admin schemas expose explicit participant metadata", () => {
  assert(Value.Check(AuthListSessionsResponseSchema, {
    sessions: [
      {
        key: "github.123.sk_agent",
        sessionKey: "sk_agent",
        participantKind: "agent",
        principal: {
          type: "user",
          origin: "github",
          id: "123",
          trellisId: "tid_123",
          name: "Ada",
        },
        contractId: "trellis.agent@v1",
        contractDisplayName: "Trellis Agent",
        createdAt: new Date().toISOString(),
        lastAuth: new Date().toISOString(),
      },
    ],
  }));

  assert(Value.Check(AuthListConnectionsResponseSchema, {
    connections: [
      {
        key: "github.123.sk_agent.user_nkey",
        userNkey: "user_nkey",
        sessionKey: "sk_agent",
        participantKind: "agent",
        principal: {
          type: "user",
          origin: "github",
          id: "123",
          trellisId: "tid_123",
          name: "Ada",
        },
        contractId: "trellis.agent@v1",
        contractDisplayName: "Trellis Agent",
        serverId: "n1",
        clientId: 7,
        connectedAt: new Date().toISOString(),
      },
    ],
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
      firstConnectPolicy: "reject",
      disabled: false,
      appliedContracts: [],
    },
  );

  const explicit = validateServiceDeploymentRequest({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    firstConnectPolicy: "auto-accept-compatible",
  });
  assert(!explicit.isErr());
  assertEquals(
    (explicit.take() as { deployment: Record<string, unknown> }).deployment
      .firstConnectPolicy,
    "auto-accept-compatible",
  );

  assert(
    validateServiceDeploymentRequest({ deploymentId: "", namespaces: [] })
      .isErr(),
  );
  assert(
    validateServiceDeploymentRequest({
      deploymentId: "billing.default",
      namespaces: [],
      firstConnectPolicy: "allow",
    }).isErr(),
  );
});

Deno.test("Auth.UnapplyServiceDeploymentContract removes only bindings for removed digests", async () => {
  let stored: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a", "digest-b"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: { cache: { bucket: "cache-a", history: 1, ttlMs: 0 } },
        },
        "digest-b": {
          kv: { cache: { bucket: "cache-b", history: 2, ttlMs: 0 } },
        },
      },
    }],
  };
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => stored,
      put: async (deployment) => {
        stored = deployment;
      },
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthUnapplyServiceDeploymentContractHandler(
    kickDeps(serviceDeps),
  )({
    input: {
      deploymentId: "billing.default",
      contractId: "billing@v1",
      digests: ["digest-a"],
    },
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(stored.appliedContracts, [{
    contractId: "billing@v1",
    compatibilityPolicy: "exact",
    allowedDigests: ["digest-b"],
    resourceBindingsByDigest: {
      "digest-b": {
        kv: { cache: { bucket: "cache-b", history: 2, ttlMs: 0 } },
      },
    },
  }]);
});

Deno.test("Auth.UnapplyServiceDeploymentContract validates staged deployment before persisting or kicking", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a", "digest-b"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: { cache: { bucket: "cache-a", history: 1, ttlMs: 0 } },
        },
        "digest-b": {
          kv: { cache: { bucket: "cache-b", history: 2, ttlMs: 0 } },
        },
      },
    }],
  };
  let stored = original;
  let putCount = 0;
  let refreshCount = 0;
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => stored,
      put: async (deployment) => {
        putCount += 1;
        stored = deployment;
      },
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => [{
        instanceId: "svc_1",
        deploymentId: "billing.default",
        instanceKey: "session-key-1",
        disabled: false,
        currentContractId: "billing@v1",
        currentContractDigest: "digest-a",
        capabilities: ["service"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    },
  };

  const result = await createAuthUnapplyServiceDeploymentContractHandler({
    ...kickDeps(serviceDeps),
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    validateActiveCatalog: async () => {
      throw new Error("incompatible staged active catalog");
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
  })({
    input: {
      deploymentId: "billing.default",
      contractId: "billing@v1",
      digests: ["digest-a"],
    },
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(putCount, 0);
  assertEquals(refreshCount, 0);
  assertEquals(kicked, []);
  assertEquals(stored, original);
});

Deno.test("Auth.UnapplyServiceDeploymentContract rolls back deployment and does not kick when refresh fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a", "digest-b"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: { cache: { bucket: "cache-a", history: 1, ttlMs: 0 } },
        },
        "digest-b": {
          kv: { cache: { bucket: "cache-b", history: 2, ttlMs: 0 } },
        },
      },
    }],
  };
  let stored = original;
  const putDeployments: ServiceDeployment[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => stored,
      put: async (deployment) => {
        putDeployments.push(deployment);
        stored = deployment;
      },
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => [{
        instanceId: "svc_1",
        deploymentId: "billing.default",
        instanceKey: "session-key-1",
        disabled: false,
        currentContractId: "billing@v1",
        currentContractDigest: "digest-a",
        capabilities: ["service"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    },
  };

  const result = await createAuthUnapplyServiceDeploymentContractHandler({
    ...kickDeps(serviceDeps),
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
  })({
    input: {
      deploymentId: "billing.default",
      contractId: "billing@v1",
      digests: ["digest-a"],
    },
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(putDeployments.length, 2);
  assertEquals(putDeployments[1], original);
  assertEquals(kicked, []);
  assertEquals(stored, original);
});

Deno.test("Auth.DisableServiceDeployment validates staged deployment before persisting or kicking", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a"],
    }],
  };
  let stored = original;
  let putCount = 0;
  let refreshCount = 0;
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => stored,
      put: async (deployment) => {
        putCount += 1;
        stored = deployment;
      },
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => [{
        instanceId: "svc_1",
        deploymentId: "billing.default",
        instanceKey: "session-key-1",
        disabled: false,
        currentContractId: "billing@v1",
        currentContractDigest: "digest-a",
        capabilities: ["service"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    },
  };

  const result = await createAuthDisableServiceDeploymentHandler({
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(putCount, 0);
  assertEquals(refreshCount, 0);
  assertEquals(kicked, []);
  assertEquals(stored, original);
});

Deno.test("Auth.RemoveServiceDeployment without cascade rejects deployments with instances", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  };
  let deletedDeployment = false;
  let refreshCount = 0;
  const deletedInstances: string[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => original,
      put: async () => throwingStoreAccess(),
      delete: async () => {
        deletedDeployment = true;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async (instanceId) => {
        deletedInstances.push(instanceId);
      },
      list: async () => throwingStoreAccess(),
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

  const result = await createAuthRemoveServiceDeploymentHandler({
    ...kickDeps(serviceDeps),
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: { deploymentId: "billing.default" },
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(deletedInstances, []);
  assertEquals(deletedDeployment, false);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.RemoveServiceDeployment rejects resource purge without cascade before deleting", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  };
  let deletedDeployment = false;
  let refreshCount = 0;
  let purgeCount = 0;
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => original,
      put: async () => throwingStoreAccess(),
      delete: async () => {
        deletedDeployment = true;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
    ...kickDeps(serviceDeps),
    purgeResourceBindings: async () => {
      purgeCount += 1;
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: { deploymentId: "billing.default", purgeResources: true },
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(deletedDeployment, false);
  assertEquals(refreshCount, 0);
  assertEquals(purgeCount, 0);
});

Deno.test("Auth.RemoveServiceDeployment rejects contract purge without cascade before deleting", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a"],
    }],
  };
  let deletedDeployment = false;
  let refreshCount = 0;
  const deletedContracts: string[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => original,
      put: async () => throwingStoreAccess(),
      delete: async () => {
        deletedDeployment = true;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
    ...kickDeps(serviceDeps),
    contractStorage: {
      delete: async (digest) => {
        deletedContracts.push(digest);
      },
    },
    deviceDeploymentStorage: { list: async () => [] },
    contractApprovalStorage: { list: async () => [] },
    builtinContractDigests: [],
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
    validateActiveCatalog: async () => {},
  })({
    input: { deploymentId: "billing.default", purgeUnusedContracts: true },
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(deletedDeployment, false);
  assertEquals(refreshCount, 0);
  assertEquals(deletedContracts, []);
});

Deno.test("Auth.RemoveServiceDeployment preflights contract purge dependencies before revocation", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a"],
    }],
  };
  const instances: ServiceInstance[] = [{
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "session-key-1",
    disabled: false,
    currentContractId: "billing@v1",
    currentContractDigest: "digest-a",
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
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (instance) => {
        storedInstances = [instance];
      },
      delete: async () => {
        storedInstances = [];
      },
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => storedInstances,
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(storedDeployment, original);
  assertEquals(storedInstances, instances);
  assertEquals(deletedSessions, []);
  assertEquals(kicked, []);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.RemoveServiceDeployment purges only unreferenced non-built-in installed contracts after refresh", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-unused", "digest-referenced", "digest-builtin"],
    }],
  };
  let storedDeployment: ServiceDeployment | undefined = original;
  const calls: string[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        calls.push("delete-deployment");
        storedDeployment = undefined;
      },
      list: async () => [{
        deploymentId: "billing.other",
        namespaces: ["billing"],
        disabled: false,
        appliedContracts: [{
          contractId: "billing@v1",
          allowedDigests: ["digest-referenced"],
        }],
      }],
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => [{
        instanceId: "svc_other",
        deploymentId: "billing.other",
        instanceKey: "session-key-other",
        disabled: false,
        currentContractId: "billing@v1",
        currentContractDigest: "digest-referenced",
        capabilities: ["service"],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
    ...kickDeps(serviceDeps),
    contractStorage: {
      delete: async (digest) => {
        calls.push(`delete-contract:${digest}`);
      },
    },
    deviceDeploymentStorage: { list: async () => [] },
    contractApprovalStorage: { list: async () => [] },
    sessionStorage: {
      deleteByInstanceKey: async () => {},
      listEntries: async () => [],
    },
    builtinContractDigests: ["digest-builtin"],
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(calls, [
    "delete-deployment",
    "refresh",
    "delete-contract:digest-unused",
  ]);
  assertEquals(storedDeployment, undefined);
});

Deno.test("Auth.RemoveServiceDeployment keeps removal successful when unused contract cleanup fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-unused"],
    }],
  };
  let storedDeployment: ServiceDeployment | undefined = original;
  const calls: string[] = [];
  const warnings: unknown[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        calls.push("delete-deployment");
        storedDeployment = undefined;
      },
      list: async () => [],
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => [],
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
    ...kickDeps(serviceDeps),
    logger: {
      warn: (fields) => {
        warnings.push(fields);
      },
    },
    contractStorage: {
      delete: async (digest) => {
        calls.push(`delete-contract:${digest}`);
        throw new Error("contract cleanup failed");
      },
    },
    deviceDeploymentStorage: { list: async () => [] },
    contractApprovalStorage: { list: async () => [] },
    sessionStorage: {
      deleteByInstanceKey: async () => {},
      listEntries: async () => [],
    },
    builtinContractDigests: [],
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(calls, [
    "delete-deployment",
    "refresh",
    "delete-contract:digest-unused",
  ]);
  assertEquals(warnings.length, 1);
  assertEquals(storedDeployment, undefined);
});

Deno.test("Auth.RemoveServiceDeployment cascades instances, sessions, and runtime access", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a"],
    }],
  };
  const instances: ServiceInstance[] = [
    {
      instanceId: "svc_1",
      deploymentId: "billing.default",
      instanceKey: "session-key-1",
      disabled: false,
      currentContractId: "billing@v1",
      currentContractDigest: "digest-a",
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      instanceId: "svc_2",
      deploymentId: "billing.default",
      instanceKey: "session-key-2",
      disabled: false,
      currentContractId: "billing@v1",
      currentContractDigest: "digest-a",
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
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
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
      list: async () => throwingStoreAccess(),
      listByDeployment: async () =>
        storedInstances.filter((instance) =>
          instance.deploymentId === "billing.default"
        ),
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
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
        appliedContracts: [],
      }]);
      stagedInstances.push(...stagedServiceInstances ?? []);
    },
  })({
    input: { deploymentId: "billing.default", cascade: true },
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
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

Deno.test("Auth.RemoveServiceDeployment purges applied contract resources before durable deletion", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a", "digest-b"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: { cache: { bucket: "cache-a", history: 1, ttlMs: 0 } },
          jobs: {
            namespace: "billing_jobs",
            workStream: "JOBS_WORK",
            queues: {},
          },
        },
        "digest-b": {
          store: { uploads: { name: "uploads-b", ttlMs: 0 } },
        },
      },
    }],
  };
  let storedDeployment: ServiceDeployment | undefined = original;
  const calls: string[] = [];
  const purgedBindings: unknown[] = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        calls.push("delete-deployment");
        storedDeployment = undefined;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
    ...kickDeps(serviceDeps),
    purgeResourceBindings: async (bindings) => {
      calls.push("purge");
      purgedBindings.push(...bindings);
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(calls, ["purge", "delete-deployment", "refresh"]);
  assertEquals(purgedBindings, [
    original.appliedContracts[0].resourceBindingsByDigest?.["digest-a"],
    original.appliedContracts[0].resourceBindingsByDigest?.["digest-b"],
  ]);
  assertEquals(storedDeployment, undefined);
});

Deno.test("Auth.RemoveServiceDeployment does not delete or refresh when resource purge fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: { cache: { bucket: "cache-a", history: 1, ttlMs: 0 } },
        },
      },
    }],
  };
  let storedDeployment: ServiceDeployment | undefined = original;
  let refreshCount = 0;
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
    ...kickDeps(serviceDeps),
    purgeResourceBindings: async () => {
      throw new Error("purge failed");
    },
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(storedDeployment, original);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.RemoveServiceDeployment does not revoke runtime access when resource purge fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: { cache: { bucket: "cache-a", history: 1, ttlMs: 0 } },
        },
      },
    }],
  };
  const instances: ServiceInstance[] = [{
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "session-key-1",
    disabled: false,
    currentContractId: "billing@v1",
    currentContractDigest: "digest-a",
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
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (instance) => {
        storedInstances = [instance];
      },
      delete: async () => {
        storedInstances = [];
      },
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => storedInstances,
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
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
    purgeResourceBindings: async () => {
      throw new Error("purge failed");
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(storedDeployment, original);
  assertEquals(storedInstances, instances);
  assertEquals(deletedSessions, []);
  assertEquals(kicked, []);
});

Deno.test("Auth.RemoveServiceDeployment does not delete or refresh when cascade kick fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a"],
    }],
  };
  const instances: ServiceInstance[] = [
    {
      instanceId: "svc_1",
      deploymentId: "billing.default",
      instanceKey: "session-key-1",
      disabled: false,
      currentContractId: "billing@v1",
      currentContractDigest: "digest-a",
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
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
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
      list: async () => throwingStoreAccess(),
      listByDeployment: async () =>
        storedInstances.filter((instance) =>
          instance.deploymentId === "billing.default"
        ),
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(storedDeployment, original);
  assertEquals(storedInstances, instances);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.RemoveServiceDeployment deletes and refreshes after purge when cascade kick fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a"],
      resourceBindingsByDigest: {
        "digest-a": {
          kv: { cache: { bucket: "cache-a", history: 1, ttlMs: 0 } },
        },
      },
    }],
  };
  const instances: ServiceInstance[] = [{
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "session-key-1",
    disabled: false,
    currentContractId: "billing@v1",
    currentContractDigest: "digest-a",
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
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        calls.push("delete-deployment");
        storedDeployment = undefined;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
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
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => storedInstances,
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
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
    purgeResourceBindings: async () => {
      calls.push("purge");
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(calls, [
    "purge",
    "kick",
    "delete-instance",
    "delete-deployment",
    "refresh",
  ]);
  assertEquals(storedDeployment, undefined);
  assertEquals(storedInstances, []);
  assertEquals(deletedSessions, ["session-key-1"]);
});

Deno.test("Auth.RemoveServiceDeployment rolls back cascade deletes when an instance delete fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: "billing@v1",
      allowedDigests: ["digest-a"],
    }],
  };
  const instances: ServiceInstance[] = [
    {
      instanceId: "svc_1",
      deploymentId: "billing.default",
      instanceKey: "session-key-1",
      disabled: false,
      currentContractId: "billing@v1",
      currentContractDigest: "digest-a",
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      instanceId: "svc_2",
      deploymentId: "billing.default",
      instanceKey: "session-key-2",
      disabled: false,
      currentContractId: "billing@v1",
      currentContractDigest: "digest-a",
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
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        storedDeployment = undefined;
      },
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
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
      list: async () => throwingStoreAccess(),
      listByDeployment: async () =>
        storedInstances.filter((instance) =>
          instance.deploymentId === "billing.default"
        ),
    },
  };

  const result = await createAuthRemoveServiceDeploymentHandler({
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(deletedInstances, ["svc_1", "svc_2"]);
  assertEquals(storedDeployment, original);
  assertEquals(storedInstances, instances);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.EnableServiceInstance rolls back instance and does not kick when refresh fails", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  };
  const instance: ServiceInstance = {
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "session-key-1",
    disabled: true,
    currentContractId: "billing@v1",
    currentContractDigest: "digest-a",
    capabilities: ["service"],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  let stored = instance;
  const putInstances: ServiceInstance[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: {
      get: async () => original,
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => stored,
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async (nextInstance) => {
        putInstances.push(nextInstance);
        stored = nextInstance;
      },
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listByDeployment: async () => throwingStoreAccess(),
    },
  };

  const result = await createAuthEnableServiceInstanceHandler({
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(putInstances.length, 2);
  assertEquals(putInstances[1], instance);
  assertEquals(kicked, []);
  assertEquals(stored, instance);
});

function deviceAdminDeps(args: {
  deployment: DeviceDeployment;
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
  portalSelection?: Parameters<
    AdminRpcDeps["devicePortalSelectionStorage"]["put"]
  >[0];
  deletedPortalSelections?: string[];
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
    { appliedContracts: Array<{ allowedDigests: string[] }> }
  >;
  serviceInstances?: Array<{ currentContractDigest?: string | null }>;
  approvalDigests?: string[];
}) {
  let stored: DeviceDeployment | undefined = args.deployment;
  let instances = args.instances ?? [];
  let provisioningSecrets = args.provisioningSecrets ??
    (args.provisioningSecret ? [args.provisioningSecret] : []);
  let activations = args.activations ??
    (args.activation ? [args.activation] : []);
  let activationReviews = args.activationReviews ?? [];
  let portalSelection = args.portalSelection;
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
      list: async () =>
        (args.approvalDigests ?? []).map((digest) => ({
          userTrellisId: `user-${digest}`,
          origin: "test",
          id: `user-${digest}`,
          answer: "approved" as const,
          answeredAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          approval: {
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
      list: async () => activationReviews,
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
      list: async () => activations,
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
      list: async () => stored ? [stored] : [],
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
      list: async () => instances,
    },
    devicePortalSelectionStorage: {
      get: async (deploymentId) =>
        portalSelection?.deploymentId === deploymentId
          ? portalSelection
          : undefined,
      put: async (selection) => {
        portalSelection = selection;
      },
      delete: async (deploymentId) => {
        args.deletedPortalSelections?.push(deploymentId);
        if (portalSelection?.deploymentId === deploymentId) {
          portalSelection = undefined;
        }
      },
      list: async () => portalSelection ? [portalSelection] : [],
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
    instanceGrantPolicyStorage: {
      get: async () => undefined,
      put: async () => throwingStoreAccess(),
      list: async () => [],
    },
    kick: args.kick ??
      (async (serverId, clientId) => {
        args.kicked?.push({ serverId, clientId });
      }),
    loadEffectiveGrantPolicies: async () => [],
    logger: { trace: () => {}, warn: () => {} },
    operationCompletion: {
      completeOperation: (operationId, output) =>
        AsyncResult.ok(operationSnapshot(operationId, output)),
    },
    loginPortalSelectionStorage: {
      get: async () => undefined,
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => [],
    },
    portalDefaultStorage: {
      getLogin: async () => undefined,
      getDevice: async () => undefined,
      putLogin: async () => throwingStoreAccess(),
      putDevice: async () => throwingStoreAccess(),
    },
    portalProfileStorage: {
      get: async () => undefined,
      put: async () => throwingStoreAccess(),
      list: async () => [],
    },
    portalStorage: {
      get: async () => undefined,
      put: async () => throwingStoreAccess(),
      list: async () => [],
    },
    publishSessionRevoked: async () => {},
    sessionStorage: {
      deleteByPublicIdentityKey: async () => {},
      deleteBySessionKey: async () => {},
      listEntries: async () => [],
    },
    serviceDeploymentStorage: {
      list: async () => args.serviceDeployments ?? [],
    },
    serviceInstanceStorage: {
      list: async () => args.serviceInstances ?? [],
    },
    eventPublisher: {
      publish: (event, payload) => {
        args.publishes?.push({ event, payload });
        return AsyncResult.ok(undefined);
      },
    },
    userStorage: { get: async () => undefined },
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
    getPortalSelection: () => portalSelection,
  };
}

Deno.test("Auth.ApplyDeviceDeploymentContract validates staged deployment before persisting", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a"],
    }],
  };
  const putDeployments: DeviceDeployment[] = [];
  let refreshCount = 0;
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment: original,
    putDeployments,
    kicked,
    validateActiveCatalog: async ({ stagedDeviceDeployments }) => {
      assertEquals([...stagedDeviceDeployments ?? []], [{
        ...original,
        appliedContracts: [{
          contractId: "reader@v1",
          allowedDigests: ["digest-a", "digest-b"],
        }],
      }]);
      throw new Error("incompatible staged active catalog");
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
  });

  const result = await createDeviceAdminHandlers(deps)
    .applyDeviceDeploymentContract({
      input: {
        deploymentId: "reader.default",
        contract: {},
        expectedDigest: "digest-b",
      },
      context: { caller: { id: "admin", capabilities: ["admin"] } },
    });

  assert(result.isErr());
  assertEquals(putDeployments, []);
  assertEquals(refreshCount, 0);
  assertEquals(kicked, []);
  assertEquals(getStored(), original);
});

Deno.test("Auth.ApplyDeviceDeploymentContract replaces same-lineage digests when requested", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a"],
    }],
  };
  const putDeployments: DeviceDeployment[] = [];
  const stagedDeployments: DeviceDeployment[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment: original,
    putDeployments,
    validateActiveCatalog: async ({ stagedDeviceDeployments }) => {
      stagedDeployments.push(...stagedDeviceDeployments ?? []);
    },
  });

  const result = await createDeviceAdminHandlers(deps)
    .applyDeviceDeploymentContract({
      input: {
        deploymentId: "reader.default",
        contract: {},
        expectedDigest: "digest-b",
        replaceExisting: true,
      },
      context: { caller: { id: "admin", capabilities: ["admin"] } },
    });

  const expectedDeployment: DeviceDeployment = {
    ...original,
    appliedContracts: [{
      contractId: "reader@v1",
      compatibilityPolicy: "exact",
      allowedDigests: ["digest-b"],
    }],
  };
  assert(!result.isErr());
  assertEquals(putDeployments, [expectedDeployment]);
  assertEquals(stagedDeployments, [expectedDeployment]);
  assertEquals(getStored(), expectedDeployment);
});

Deno.test("Auth.ApplyDeviceDeploymentContract rejects mismatched expected digest", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [],
  };
  const putDeployments: DeviceDeployment[] = [];
  let validated = false;
  const { deps, getStored } = deviceAdminDeps({
    deployment: original,
    putDeployments,
    validateActiveCatalog: async () => {
      validated = true;
    },
  });

  const result = await createDeviceAdminHandlers(deps)
    .applyDeviceDeploymentContract({
      input: {
        deploymentId: "reader.default",
        contract: {},
        expectedDigest: "digest-reviewed",
      },
      context: { caller: { id: "admin", capabilities: ["admin"] } },
    });

  assert(result.isErr());
  assertEquals(validated, false);
  assertEquals(putDeployments, []);
  assertEquals(getStored(), original);
});

Deno.test("Auth.ApplyDeviceDeploymentContract rolls back deployment and does not kick when refresh fails", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a"],
    }],
  };
  const putDeployments: DeviceDeployment[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment: original,
    putDeployments,
    kicked,
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
  });

  const result = await createDeviceAdminHandlers(deps)
    .applyDeviceDeploymentContract({
      input: {
        deploymentId: "reader.default",
        contract: {},
        expectedDigest: "digest-b",
      },
      context: { caller: { id: "admin", capabilities: ["admin"] } },
    });

  assert(result.isErr());
  assertEquals(putDeployments.length, 2);
  assertEquals(putDeployments[1], original);
  assertEquals(kicked, []);
  assertEquals(getStored(), original);
});

Deno.test("Auth.UnapplyDeviceDeploymentContract validates staged deployment before persisting or kicking", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a", "digest-b"],
    }],
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
  const putDeployments: DeviceDeployment[] = [];
  let refreshCount = 0;
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment: original,
    instances: [instance],
    putDeployments,
    kicked,
    validateActiveCatalog: async ({ stagedDeviceDeployments }) => {
      assertEquals([...stagedDeviceDeployments ?? []], [{
        ...original,
        appliedContracts: [{
          contractId: "reader@v1",
          allowedDigests: ["digest-b"],
        }],
      }]);
      throw new Error("incompatible staged active catalog");
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
  });

  const result = await createDeviceAdminHandlers(deps)
    .unapplyDeviceDeploymentContract({
      input: {
        deploymentId: "reader.default",
        contractId: "reader@v1",
        digests: ["digest-a"],
      },
      context: { caller: { id: "admin", capabilities: ["admin"] } },
    });

  assert(result.isErr());
  assertEquals(putDeployments, []);
  assertEquals(refreshCount, 0);
  assertEquals(kicked, []);
  assertEquals(getStored(), original);
});

Deno.test("Auth.UnapplyDeviceDeploymentContract rolls back deployment and does not kick when refresh fails", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a", "digest-b"],
    }],
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
  const putDeployments: DeviceDeployment[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment: original,
    instances: [instance],
    putDeployments,
    kicked,
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
  });

  const result = await createDeviceAdminHandlers(deps)
    .unapplyDeviceDeploymentContract({
      input: {
        deploymentId: "reader.default",
        contractId: "reader@v1",
        digests: ["digest-a"],
      },
      context: { caller: { id: "admin", capabilities: ["admin"] } },
    });

  assert(result.isErr());
  assertEquals(putDeployments.length, 2);
  assertEquals(putDeployments[1], original);
  assertEquals(kicked, []);
  assertEquals(getStored(), original);
});

Deno.test("Auth.EnableDeviceDeployment validates staged deployment before persisting", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: true,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a"],
    }],
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(putDeployments, []);
  assertEquals(refreshCount, 0);
  assertEquals(getStored(), original);
});

Deno.test("Auth.RemoveDeviceDeployment without cascade rejects deployments with instances", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [],
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
  const portalSelection = {
    deploymentId: "reader.default",
    portalId: "device-portal",
  };
  const deletedInstances: string[] = [];
  const deletedPortalSelections: string[] = [];
  const { deps, getStored, getInstances, getPortalSelection } = deviceAdminDeps(
    {
      deployment,
      instances: [instance],
      portalSelection,
      deletedInstances,
      deletedPortalSelections,
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(getStored(), deployment);
  assertEquals(getInstances(), [instance]);
  assertEquals(getPortalSelection(), portalSelection);
  assertEquals(deletedInstances, []);
  assertEquals(deletedPortalSelections, []);
});

Deno.test("Auth.RemoveDeviceDeployment rejects contract purge without cascade before deleting", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a"],
    }],
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(getStored(), deployment);
  assertEquals(deletedInstances, []);
  assertEquals(deletedContracts, []);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.RemoveDeviceDeployment preflights contract purge dependencies before revocation", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a"],
    }],
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
  deps.contractStorage = undefined;

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: {
      deploymentId: "reader.default",
      cascade: true,
      purgeUnusedContracts: true,
    },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(getStored(), deployment);
  assertEquals(getInstances(), [instance]);
  assertEquals(deletedInstances, []);
  assertEquals(kicked, []);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.RemoveDeviceDeployment purges only unreferenced non-built-in installed contracts after refresh", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-unused", "digest-referenced", "digest-builtin"],
    }],
  };
  const deletedContracts: string[] = [];
  const calls: string[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment,
    builtinContractDigests: ["digest-builtin"],
    deletedContracts,
    serviceDeployments: [{
      appliedContracts: [{ allowedDigests: ["digest-referenced"] }],
    }],
    serviceInstances: [{ currentContractDigest: "digest-referenced" }],
    refreshActiveContracts: async () => {
      calls.push("refresh");
    },
  });
  deps.contractStorage = {
    delete: async (digest: string) => {
      calls.push(`delete-contract:${digest}`);
      deletedContracts.push(digest);
    },
  };

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: {
      deploymentId: "reader.default",
      cascade: true,
      purgeUnusedContracts: true,
    },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(calls, [
    "refresh",
    "delete-contract:digest-unused",
  ]);
  assertEquals(deletedContracts, ["digest-unused"]);
  assertEquals(getStored(), undefined);
});

Deno.test("Auth.RemoveDeviceDeployment keeps removal successful when unused contract cleanup fails", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-unused"],
    }],
  };
  const calls: string[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment,
    refreshActiveContracts: async () => {
      calls.push("refresh");
    },
  });
  deps.contractStorage = {
    delete: async (digest: string) => {
      calls.push(`delete-contract:${digest}`);
      throw new Error("contract cleanup failed");
    },
  };

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: {
      deploymentId: "reader.default",
      cascade: true,
      purgeUnusedContracts: true,
    },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(calls, [
    "refresh",
    "delete-contract:digest-unused",
  ]);
  assertEquals(getStored(), undefined);
});

Deno.test("Auth.RemoveDeviceDeployment cascades instances and deployment-scoped auth state", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a"],
    }],
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
    requestedBy: { origin: "portal", id: "main" },
  }];
  const portalSelection = {
    deploymentId: "reader.default",
    portalId: "device-portal",
  };
  const browserFlowDeletes: string[] = [];
  const deletedInstances: string[] = [];
  const deletedActivationReviews: string[] = [];
  const deletedPortalSelections: string[] = [];
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
    getPortalSelection,
  } = deviceAdminDeps({
    deployment,
    instances,
    provisioningSecrets,
    activations,
    activationReviews,
    portalSelection,
    browserFlowDeletes,
    deletedInstances,
    deletedActivationReviews,
    deletedPortalSelections,
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
        appliedContracts: [],
      }]);
      stagedInstances.push(...stagedDeviceInstances ?? []);
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: { deploymentId: "reader.default", cascade: true },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
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
  assertEquals(getPortalSelection(), undefined);
  assertEquals(deletedInstances, ["device_1", "device_2"]);
  assertEquals(deletedActivationReviews, ["review_1"]);
  assertEquals(deletedPortalSelections, ["reader.default"]);
  assertEquals(browserFlowDeletes, ["flow_1"]);
  assertEquals(refreshOptions, [undefined]);
  assertEquals(kicked, [
    { serverId: "server-1", clientId: 1 },
    { serverId: "server-1", clientId: 1 },
  ]);
});

Deno.test("Auth.RemoveDeviceDeployment does not delete auth state or refresh when cascade kick fails", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [{
      contractId: "reader@v1",
      allowedDigests: ["digest-a"],
    }],
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
    requestedBy: { origin: "portal", id: "main" },
  }];
  const portalSelection = {
    deploymentId: "reader.default",
    portalId: "device-portal",
  };
  const browserFlowDeletes: string[] = [];
  const deletedInstances: string[] = [];
  const deletedActivationReviews: string[] = [];
  const deletedPortalSelections: string[] = [];
  let refreshCount = 0;
  const {
    deps,
    getStored,
    getInstances,
    getProvisioningSecrets,
    getActivations,
    getActivationReviews,
    getPortalSelection,
  } = deviceAdminDeps({
    deployment,
    instances,
    provisioningSecrets,
    activations,
    activationReviews,
    portalSelection,
    browserFlowDeletes,
    deletedInstances,
    deletedActivationReviews,
    deletedPortalSelections,
    kick: async () => {
      throw new Error("kick failed");
    },
    refreshActiveContracts: async () => {
      refreshCount += 1;
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: { deploymentId: "reader.default", cascade: true },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(getStored(), deployment);
  assertEquals(getInstances(), instances);
  assertEquals(getProvisioningSecrets(), provisioningSecrets);
  assertEquals(getActivations(), activations);
  assertEquals(getActivationReviews(), activationReviews);
  assertEquals(getPortalSelection(), portalSelection);
  assertEquals(deletedInstances, []);
  assertEquals(deletedActivationReviews, []);
  assertEquals(deletedPortalSelections, []);
  assertEquals(browserFlowDeletes, []);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.RemoveDeviceDeployment restores portal selection when refresh fails", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [],
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
    requestedBy: { origin: "portal", id: "main" },
  }];
  const portalSelection = {
    deploymentId: "reader.default",
    portalId: "device-portal",
  };
  const browserFlowDeletes: string[] = [];
  const deletedPortalSelections: string[] = [];
  const { deps, getPortalSelection } = deviceAdminDeps({
    deployment,
    instances: [instance],
    activationReviews,
    portalSelection,
    browserFlowDeletes,
    deletedPortalSelections,
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
  });

  const result = await createDeviceAdminHandlers(deps).removeDeviceDeployment({
    input: { deploymentId: "reader.default", cascade: true },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(deletedPortalSelections, ["reader.default"]);
  assertEquals(getPortalSelection(), portalSelection);
  assertEquals(browserFlowDeletes, []);
});

Deno.test("Auth.RemoveDeviceInstance rolls back durable records and does not kick when refresh fails", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
    appliedContracts: [],
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
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
    TRELLIS_AUTH_EVENTS["Auth.DeviceActivationReviewRequested"].params,
    ["/deploymentId"],
  );
  assertEquals(
    TRELLIS_AUTH_EVENTS["Auth.DeviceActivationRequested"].params,
    ["/deploymentId"],
  );
  assertEquals(
    TRELLIS_AUTH_EVENTS["Auth.DeviceActivationApproved"].params,
    ["/deploymentId"],
  );
  assertEquals(
    TRELLIS_AUTH_EVENTS["Auth.DeviceActivated"].params,
    ["/deploymentId"],
  );
});

Deno.test("Auth.DecideDeviceActivationReview completes approve decision through operation controller", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: { origin: "github", id: "user_1" },
    state: "pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
  };
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "required",
    disabled: false,
    appliedContracts: [{ contractId: "reader@v1", allowedDigests: ["d1"] }],
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
      list: async () => [review],
    },
    deviceActivationStorage: {
      get: async () => undefined,
      put: async () => {},
      delete: async () => {},
      list: async () => [],
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
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
      event: "Auth.DeviceActivationApproved",
      payload: {
        reviewId: "dar_1",
        flowId: "flow_1",
        instanceId: "device_1",
        publicIdentityKey: "pub_device_1",
        deploymentId: "reader.default",
        requestedAt: "2026-01-01T00:00:00.000Z",
        approvedAt: putReviews[0].decidedAt,
        requestedBy: { origin: "github", id: "user_1" },
        approvedBy: { id: "admin" },
      },
    },
    {
      event: "Auth.DeviceActivated",
      payload: {
        instanceId: "device_1",
        publicIdentityKey: "pub_device_1",
        deploymentId: "reader.default",
        activatedAt: putReviews[0].decidedAt,
        activatedBy: { origin: "github", id: "user_1" },
        flowId: "flow_1",
        reviewId: "dar_1",
      },
    },
  ]);
});

Deno.test("Auth.DecideDeviceActivationReview completes reject decision through operation controller", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: { origin: "github", id: "user_1" },
    state: "pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
  };
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "required",
    disabled: false,
    appliedContracts: [{ contractId: "reader@v1", allowedDigests: ["d1"] }],
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
      list: async () => [review],
    },
  }).decideDeviceActivationReview({
    input: { reviewId: "dar_1", decision: "reject", reason: "not expected" },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(putReviews[0].state, "rejected");
  assertEquals(completions, [{
    operationId: "op_activate_1",
    output: { status: "rejected", reason: "not expected" },
  }]);
});

Deno.test("Auth.DecideDeviceActivationReview retries completion for already-approved review", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: { origin: "github", id: "user_1" },
    state: "approved",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: "2026-01-01T00:00:01.000Z",
  };
  const activation: DeviceActivationRecord = {
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    activatedBy: { origin: "github", id: "user_1" },
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
      appliedContracts: [],
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
      list: async () => [review],
    },
    deviceActivationStorage: {
      get: async () => activation,
      put: async (record) => {
        putActivations.push(record);
      },
      delete: async () => {},
      list: async () => [activation],
    },
  }).decideDeviceActivationReview({
    input: { reviewId: "dar_1", decision: "approve" },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
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

Deno.test("Auth.DecideDeviceActivationReview retries completion for already-rejected review", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: { origin: "github", id: "user_1" },
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
      appliedContracts: [],
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
      list: async () => [review],
    },
  }).decideDeviceActivationReview({
    input: { reviewId: "dar_1", decision: "reject" },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(putReviews, []);
  assertEquals(completions, [{
    operationId: "op_activate_1",
    output: { status: "rejected", reason: "not expected" },
  }]);
});

Deno.test("Auth.DecideDeviceActivationReview does not mutate when operation completion is missing", async () => {
  const review: DeviceActivationReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "device_1",
    publicIdentityKey: "pub_device_1",
    deploymentId: "reader.default",
    requestedBy: { origin: "github", id: "user_1" },
    state: "pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
  };
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "required",
    disabled: false,
    appliedContracts: [{ contractId: "reader@v1", allowedDigests: ["d1"] }],
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
      list: async () => [review],
    },
    deviceActivationStorage: {
      get: async () => undefined,
      put: async (record) => {
        putActivations.push(record);
      },
      delete: async () => {},
      list: async () => [],
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(putReviews, []);
  assertEquals(putActivations, []);
  assertEquals(putInstances, []);
});

Deno.test("validatePortalRequest requires portal identity and URL", () => {
  const valid = validatePortalRequest({
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { portal: Record<string, unknown> }).portal, {
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    disabled: false,
  });

  assert(
    validatePortalRequest({
      portalId: "main",
      entryUrl: "javascript:alert(1)",
    }).isErr(),
  );
});

Deno.test("validatePortalProfileRequest normalizes origins and allows unrestricted deployments", () => {
  const valid = validatePortalProfileRequest({
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    contractId: "trellis.portal@v1",
    allowedOrigins: [
      "https://portal.example.com/callback",
      "https://alt.example.com/path",
    ],
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { profile: Record<string, unknown> }).profile, {
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    contractId: "trellis.portal@v1",
    allowedOrigins: ["https://portal.example.com", "https://alt.example.com"],
  });

  const unrestricted = validatePortalProfileRequest({
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    contractId: "trellis.portal@v1",
  });
  assert(!unrestricted.isErr());
  assertEquals(
    (unrestricted.take() as { profile: { allowedOrigins?: string[] } })
      .profile
      .allowedOrigins,
    undefined,
  );

  assert(
    validatePortalProfileRequest({
      portalId: "main",
      entryUrl: "javascript:alert(1)",
      contractId: "trellis.portal@v1",
    }).isErr(),
  );
  assert(
    validatePortalProfileRequest({
      portalId: "main",
      entryUrl: "https://portal.example.com/auth",
      contractId: "trellis.portal@v1",
      allowedOrigins: ["javascript:alert(1)"],
    }).isErr(),
  );
});

Deno.test("validatePortalDefaultRequest accepts builtin and custom selections", () => {
  const builtin = validatePortalDefaultRequest({ portalId: null });
  assert(!builtin.isErr());
  assertEquals(
    (builtin.take() as { defaultPortal: Record<string, unknown> })
      .defaultPortal,
    {
      portalId: null,
    },
  );

  const custom = validatePortalDefaultRequest({ portalId: "main" });
  assert(!custom.isErr());
  assertEquals(
    (custom.take() as { defaultPortal: Record<string, unknown> }).defaultPortal,
    {
      portalId: "main",
    },
  );
});

Deno.test("validateInstanceGrantPolicyRequest normalizes origins and dedupes capabilities", () => {
  const valid = validateInstanceGrantPolicyRequest({
    contractId: "trellis.console@v1",
    allowedOrigins: [
      "https://app.example.com/callback",
      "https://app.example.com",
      "https://admin.example.com/path",
    ],
    impliedCapabilities: ["audit", "audit", "admin"],
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { policy: Record<string, unknown> }).policy, {
    contractId: "trellis.console@v1",
    allowedOrigins: ["https://app.example.com", "https://admin.example.com"],
    impliedCapabilities: ["audit", "admin"],
  });

  assert(
    validateInstanceGrantPolicyRequest({
      contractId: "trellis.console@v1",
      allowedOrigins: ["not a url"],
      impliedCapabilities: [],
    }).isErr(),
  );
});

Deno.test("validateLoginPortalSelectionRequest requires contract identity", () => {
  const valid = validateLoginPortalSelectionRequest({
    contractId: "trellis.console@v1",
    portalId: null,
  });
  assert(!valid.isErr());
  assertEquals(
    (valid.take() as { selection: Record<string, unknown> }).selection,
    {
      contractId: "trellis.console@v1",
      portalId: null,
    },
  );

  assert(
    validateLoginPortalSelectionRequest({ contractId: "", portalId: null })
      .isErr(),
  );
});

Deno.test("validateDevicePortalSelectionRequest requires deployment identity", () => {
  const valid = validateDevicePortalSelectionRequest({
    deploymentId: "reader.default",
    portalId: "main",
  });
  assert(!valid.isErr());
  assertEquals(
    (valid.take() as { selection: Record<string, unknown> }).selection,
    {
      deploymentId: "reader.default",
      portalId: "main",
    },
  );

  assert(
    validateDevicePortalSelectionRequest({ deploymentId: "", portalId: null })
      .isErr(),
  );
});

Deno.test("validateDeviceDeploymentRequest dedupes digests and omits preferred digest", () => {
  const valid = validateDeviceDeploymentRequest({
    deploymentId: "reader.default",
    reviewMode: "none",
  });
  if (valid.isErr()) {
    throw new Error("expected valid device deployment request");
  }
  const { deployment } = valid.take() as {
    deployment: {
      appliedContracts: unknown[];
      firstConnectPolicy: string;
      preActivationPolicy: string;
    };
  };
  assertEquals(deployment.firstConnectPolicy, "reject");
  assertEquals(deployment.preActivationPolicy, "reject");
  assertEquals(deployment.appliedContracts, []);

  const explicit = validateDeviceDeploymentRequest({
    deploymentId: "reader.default",
    firstConnectPolicy: "quarantine",
    preActivationPolicy: "device-owned",
  });
  assert(!explicit.isErr());
  assertEquals(
    (explicit.take() as {
      deployment: {
        deploymentId: string;
        reviewMode?: "none" | "required";
        firstConnectPolicy: string;
        preActivationPolicy: string;
        disabled: boolean;
        appliedContracts: unknown[];
      };
    }).deployment,
    {
      deploymentId: "reader.default",
      reviewMode: undefined,
      firstConnectPolicy: "quarantine",
      preActivationPolicy: "device-owned",
      disabled: false,
      appliedContracts: [],
    },
  );

  assert(
    validateDeviceDeploymentRequest({
      deploymentId: "reader.default",
      firstConnectPolicy: "allow",
    }).isErr(),
  );
  assert(
    validateDeviceDeploymentRequest({
      deploymentId: "reader.default",
      preActivationPolicy: "allow",
    }).isErr(),
  );
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
