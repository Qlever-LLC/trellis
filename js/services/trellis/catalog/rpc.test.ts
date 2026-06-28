import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { isErr } from "@qlever-llc/result";
import { assert, assertEquals } from "@std/assert";
import type {
  DeploymentAuthority,
  DeploymentAuthorityMaterialization,
} from "../auth/schemas.ts";
import { createTrellisBindingsGetHandler } from "./rpc.ts";
import {
  type ContractEntry,
  getActiveCapabilityDefinitions,
  validateContractManifest,
} from "./store.ts";

// Retained unit coverage: stale-authority binding hiding and capability helper
// projection are deterministic catalog internals. Runtime-observable
// active/provider behavior is covered by TS/Rust live service-matrix rows.

function emptyAuthorityNeeds(): DeploymentAuthority["desiredState"]["needs"] {
  return { contracts: [], surfaces: [], capabilities: [], resources: [] };
}

function emptyMaterializedGrants(): DeploymentAuthorityMaterialization[
  "grants"
] {
  return { capabilities: [], surfaces: [], nats: [] };
}

const capabilityContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "capabilities@v1",
  displayName: "Capabilities",
  description: "Declares capabilities.",
  kind: "service",
  capabilities: {
    "capabilities::items.read": {
      displayName: "Read items",
      description: "Read item records.",
      consequence: "Operators can inspect item metadata.",
    },
  },
};

type TestServiceInstance = {
  instanceId: string;
  deploymentId: string;
  instanceKey: string;
  disabled: boolean;
  capabilities: string[];
  resourceBindings?: Record<string, unknown>;
  createdAt: string;
};

class InMemoryServiceInstanceStorage {
  #instances: TestServiceInstance[] = [];

  seed(instance: TestServiceInstance): void {
    this.#instances.push(instance);
  }

  async list(): Promise<TestServiceInstance[]> {
    return [...this.#instances];
  }

  async getByInstanceKey(
    instanceKey: string,
  ): Promise<TestServiceInstance | undefined> {
    return this.#instances.find((instance) =>
      instance.instanceKey === instanceKey
    );
  }
}

type TestImplementationOffer = {
  offerId: string;
  deploymentKind: "service" | "device";
  deploymentId: string;
  instanceId: string | null;
  contractId: string;
  contractDigest: string;
  lineageKey: string;
  status: "accepted";
  liveness: "healthy";
  firstOfferedAt: string;
  acceptedAt: string;
  lastRefreshedAt: string;
  staleAt: null;
  expiresAt: null;
};

class InMemoryImplementationOfferStorage {
  #offers: TestImplementationOffer[] = [];

  seed(offer: TestImplementationOffer): void {
    this.#offers.push(offer);
  }

  async listActiveByContractId(
    contractId: string,
  ): Promise<TestImplementationOffer[]> {
    return this.#offers.filter((offer) => offer.contractId === contractId);
  }

  async listByInstance(instanceId: string): Promise<TestImplementationOffer[]> {
    return this.#offers.filter((offer) => offer.instanceId === instanceId);
  }
}

class InMemoryDeploymentAuthorityStorage {
  #authorities = new Map<string, DeploymentAuthority>();

  seed(authority: DeploymentAuthority): void {
    this.#authorities.set(authority.deploymentId, authority);
  }

  async list(): Promise<DeploymentAuthority[]> {
    return [...this.#authorities.values()];
  }

  async get(deploymentId: string): Promise<DeploymentAuthority | undefined> {
    return this.#authorities.get(deploymentId);
  }

  async listEnabledByContractId(
    contractId: string,
  ): Promise<DeploymentAuthority[]> {
    return [...this.#authorities.values()].filter((authority) =>
      !authority.disabled &&
      (authority.desiredState.needs.contracts.some((need) =>
        need.contractId === contractId
      ) || authority.desiredState.needs.surfaces.some((need) =>
        need.contractId === contractId
      ) ||
        authority.desiredState.surfaces.some((surface) =>
          surface.contractId === contractId
        ))
    );
  }

  async listEnabledBySurface(args: {
    contractId: string;
    kind: "rpc" | "operation" | "event" | "feed";
    name: string;
    action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
  }): Promise<DeploymentAuthority[]> {
    return [...this.#authorities.values()].filter((authority) =>
      !authority.disabled &&
      authority.desiredState.surfaces.some((surface) =>
        surface.contractId === args.contractId &&
        surface.kind === args.kind &&
        surface.name === args.name &&
        surface.action === args.action
      )
    );
  }
}

class InMemoryMaterializedAuthorityStorage {
  #authorities = new Map<string, DeploymentAuthorityMaterialization>();

  seed(authority: DeploymentAuthorityMaterialization): void {
    this.#authorities.set(authority.deploymentId, authority);
  }

  async get(
    deploymentId: string,
  ): Promise<DeploymentAuthorityMaterialization | undefined> {
    return this.#authorities.get(deploymentId);
  }
}

class InMemoryContracts {
  #entries: ContractEntry[] = [];

  add(digest: string, contract: TrellisContractV1): void {
    this.#entries.push({ digest, contract });
  }

  async getKnownEntriesByContractId(
    contractId: string,
  ): Promise<ContractEntry[]> {
    return this.#entries.filter((entry) => entry.contract.id === contractId);
  }

  async getKnownContract(
    digest: string,
  ): Promise<TrellisContractV1 | undefined> {
    return this.#entries.find((entry) => entry.digest === digest)?.contract;
  }

  async getContract(
    digest: string,
  ): Promise<TrellisContractV1 | undefined> {
    return this.getKnownContract(digest);
  }

  validateContract(raw: unknown) {
    return validateContractManifest(raw);
  }

  async getActiveEntries(): Promise<ContractEntry[]> {
    return [...this.#entries];
  }

  async getActiveCatalogState(): Promise<{
    entries: ContractEntry[];
    issues: [];
  }> {
    return { entries: await this.getActiveEntries(), issues: [] };
  }

  async getActiveCatalogIssues(): Promise<[]> {
    return [];
  }
}

const resourceContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "resources@v1",
  displayName: "Resources",
  description: "Uses materialized resources.",
  kind: "service",
  schemas: {
    CacheEntry: { type: "object" },
  },
  resources: {
    kv: {
      cache: {
        purpose: "Store cache entries.",
        schema: { schema: "CacheEntry" },
      },
    },
  },
};

Deno.test("Trellis.Bindings.Get hides bindings while authority is stale", async () => {
  const contracts = new InMemoryContracts();
  contracts.add("digest-resources", resourceContract);
  const serviceInstances = new InMemoryServiceInstanceStorage();
  serviceInstances.seed({
    instanceId: "svc-1",
    deploymentId: "deployment-1",
    instanceKey: "svc-key",
    disabled: false,
    capabilities: ["service"],
    resourceBindings: { kv: { stale: { bucket: "stale" } } },
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const offers = new InMemoryImplementationOfferStorage();
  offers.seed({
    offerId: "offer-1",
    deploymentKind: "service",
    deploymentId: "deployment-1",
    instanceId: "svc-1",
    contractId: "resources@v1",
    contractDigest: "digest-resources",
    lineageKey: "resources@v1",
    status: "accepted",
    liveness: "healthy",
    firstOfferedAt: "2026-01-01T00:00:00.000Z",
    acceptedAt: "2026-01-01T00:00:00.000Z",
    lastRefreshedAt: "2026-01-01T00:00:00.000Z",
    staleAt: null,
    expiresAt: null,
  });
  const authorities = new InMemoryDeploymentAuthorityStorage();
  authorities.seed({
    deploymentId: "deployment-1",
    kind: "service",
    disabled: false,
    desiredState: {
      needs: emptyAuthorityNeeds(),
      capabilities: [],
      resources: [],
      surfaces: [],
    },
    version: "v2",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const materialized = new InMemoryMaterializedAuthorityStorage();
  materialized.seed({
    deploymentId: "deployment-1",
    desiredVersion: "v1",
    status: "current",
    resourceBindings: [{
      deploymentId: "deployment-1",
      kind: "kv",
      alias: "cache",
      binding: { bucket: "cache-current" },
      limits: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    grants: emptyMaterializedGrants(),
    reconciledAt: "2026-01-01T00:00:00.000Z",
  });

  const result = await createTrellisBindingsGetHandler({
    contracts,
    serviceInstanceStorage: serviceInstances as never,
    deploymentAuthorityStorage: authorities,
    materializedAuthorityStorage: materialized,
    implementationOfferStorage: offers as never,
  })(
    { contractId: "resources@v1" },
    { caller: { type: "service" } as never, sessionKey: "svc-key" },
  );

  assert(!result.isErr());
  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(value.binding, undefined);
});

Deno.test("catalog helpers list active contract capability definitions", () => {
  const activeEntries = [{
    digest: "digest-capabilities",
    contract: capabilityContract,
  }];

  assertEquals(getActiveCapabilityDefinitions(activeEntries), [{
    key: "capabilities::items.read",
    displayName: "Read items",
    description: "Read item records.",
    consequence: "Operators can inspect item metadata.",
    contractId: "capabilities@v1",
    contractDigest: "digest-capabilities",
    contractDisplayName: "Capabilities",
  }]);
});
