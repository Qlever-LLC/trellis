import { assert, assertEquals } from "@std/assert";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import {
  createAuthApplyServiceDeploymentContractHandler,
  type ServiceDeploymentStorage,
} from "./service_deployment_apply.ts";
import type { ServiceDeployment } from "./shared.ts";

class InMemoryServiceDeploymentStorage implements ServiceDeploymentStorage {
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
}

const contract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "acme.billing@v1",
  displayName: "Billing",
  description: "Billing service",
  kind: "service",
};

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
      contract,
      usedNamespaces: ["billing", "audit"],
    }),
    refreshActiveContracts: async () => {
      const deployment = serviceDeploymentStorage.getValue("billing.default");
      assert(deployment !== undefined);
      observedDeployments.push(deployment);
    },
  });

  const result = await handler({
    input: { deploymentId: "billing.default", contract: {} },
    context: { caller: { type: "user", id: "admin" } },
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
    allowedDigests: ["digest-a"],
    resourceBindingsByDigest: { "digest-a": {} },
  }]);
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
      id: contract.id,
      digest: "digest-a",
      displayName: contract.displayName,
      description: contract.description,
      contract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async (_nats, provisioned, deploymentId) => {
      assertEquals(provisioned, contract);
      assertEquals(deploymentId, "billing.default");
      return {
        kv: {
          cache: { bucket: "svc_billing_cache", history: 1, ttlMs: 0 },
        },
      };
    },
    refreshActiveContracts: async () => {},
  });

  const result = await handler({
    input: { deploymentId: "billing.default", contract: {} },
    context: { caller: { type: "user", id: "admin" } },
  });

  assert(!result.isErr());
  assertEquals(serviceDeploymentStorage.getValue("billing.default"), {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: contract.id,
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
      contractId: contract.id,
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
      id: contract.id,
      digest: "digest-b",
      displayName: contract.displayName,
      description: contract.description,
      contract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async () => ({
      kv: { cache: { bucket: "svc_billing_cache_b", history: 2, ttlMs: 1000 } },
    }),
    refreshActiveContracts: async () => {},
  });

  const result = await handler({
    input: { deploymentId: "billing.default", contract: {} },
    context: { caller: { type: "user", id: "admin" } },
  });

  assert(!result.isErr());
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default")
      ?.appliedContracts,
    [{
      contractId: contract.id,
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

Deno.test("Auth.ApplyServiceDeploymentContract allows same-lineage digest resource setting changes", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  serviceDeploymentStorage.seed({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [{
      contractId: contract.id,
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
    ...contract,
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
      id: contract.id,
      digest: "digest-b",
      displayName: contract.displayName,
      description: contract.description,
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
  });

  const result = await handler({
    input: { deploymentId: "billing.default", contract: {} },
    context: { caller: { type: "user", id: "admin" } },
  });

  assert(!result.isErr());
  assertEquals(provisionedContract, changedResourceContract);
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default")?.appliedContracts,
    [{
      contractId: contract.id,
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
      id: contract.id,
      digest: "digest-a",
      displayName: contract.displayName,
      description: contract.description,
      contract,
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
          contractId: contract.id,
          allowedDigests: ["digest-a"],
          resourceBindingsByDigest: { "digest-a": {} },
        }],
      }]);
      throw new Error("incompatible active catalog");
    },
    refreshActiveContracts: async () => {
      refreshed = true;
    },
  });

  const result = await handler({
    input: { deploymentId: "billing.default", contract: {} },
    context: { caller: { type: "user", id: "admin" } },
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
      id: contract.id,
      digest: "digest-a",
      displayName: contract.displayName,
      description: contract.description,
      contract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async () => ({}),
    validateActiveCatalog: async () => {},
    refreshActiveContracts: async () => {
      throw new Error("refresh failed");
    },
  });

  const result = await handler({
    input: { deploymentId: "billing.default", contract: {} },
    context: { caller: { type: "user", id: "admin" } },
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
      id: contract.id,
      digest: "digest-a",
      displayName: contract.displayName,
      description: contract.description,
      contract,
      usedNamespaces: ["billing"],
    }),
    provisionResourceBindings: async () => {
      throw new Error("cannot create bucket");
    },
    refreshActiveContracts: async () => {
      throw new Error("should not refresh");
    },
  });

  const result = await handler({
    input: { deploymentId: "billing.default", contract: {} },
    context: { caller: { type: "user", id: "admin" } },
  });

  assert(result.isErr());
  assertEquals(serviceDeploymentStorage.putCount, 0);
  assertEquals(
    serviceDeploymentStorage.getValue("billing.default"),
    deployment,
  );
});
