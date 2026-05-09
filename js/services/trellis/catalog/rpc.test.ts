import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { AsyncResult, UnexpectedError } from "@qlever-llc/result";
import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { ValidationError } from "@qlever-llc/trellis";
import type { DeploymentEnvelope } from "../auth/schemas.ts";

import {
  createTrellisCatalogHandler,
  createTrellisContractGetHandler,
  createTrellisSurfaceStatusHandler,
} from "./rpc.ts";
import { type ContractEntry, getActiveCapabilityDefinitions } from "./store.ts";
import { connectionKey } from "../auth/session/connections.ts";

const exportedSchemaContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "exports@v1",
  displayName: "Exports",
  description: "Exports public schemas.",
  kind: "service",
  schemas: {
    PublicValue: { type: "object" },
  },
  exports: {
    schemas: ["PublicValue"],
  },
};

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
  currentContractId?: string;
  currentContractDigest?: string;
  capabilities: string[];
  createdAt: string;
};

type TestServiceDeployment = {
  deploymentId: string;
  namespaces: string[];
  disabled: boolean;
  firstConnectPolicy: "reject" | "quarantine" | "auto-accept-compatible";
  appliedContracts: Array<{
    contractId: string;
    compatibilityPolicy: "exact" | "compatible-additive" | "manual";
    allowedDigests: string[];
  }>;
};

type TestDeviceInstance = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  state: "registered" | "activated" | "revoked" | "disabled";
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
};

type TestDeviceDeployment = {
  deploymentId: string;
  disabled: boolean;
  firstConnectPolicy: "reject" | "quarantine" | "auto-accept-compatible";
  appliedContracts: Array<{
    contractId: string;
    compatibilityPolicy: "exact" | "compatible-additive" | "manual";
    allowedDigests: string[];
  }>;
  preActivationPolicy: "reject" | "device-owned";
};

type TestDeploymentContractEvidence = {
  deploymentId: string;
  contractId: string;
  contractDigest: string;
  contract: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
};

class InMemoryServiceInstanceStorage {
  #instances: TestServiceInstance[] = [];

  seed(instance: TestServiceInstance): void {
    this.#instances.push(instance);
  }

  async list(): Promise<TestServiceInstance[]> {
    return [...this.#instances];
  }

  async listByDeploymentAndDigest(
    deploymentIds: Iterable<string>,
    contractDigests: Iterable<string>,
  ): Promise<TestServiceInstance[]> {
    const requestedDeployments = new Set(deploymentIds);
    const requestedDigests = new Set(contractDigests);
    return this.#instances.filter((instance) =>
      requestedDeployments.has(instance.deploymentId) &&
      instance.currentContractDigest !== undefined &&
      requestedDigests.has(instance.currentContractDigest)
    );
  }
}

class InMemoryServiceDeploymentStorage {
  #deployments = new Map<string, TestServiceDeployment>();

  seed(deployment: TestServiceDeployment): void {
    this.#deployments.set(deployment.deploymentId, deployment);
  }

  async get(deploymentId: string): Promise<TestServiceDeployment | undefined> {
    return this.#deployments.get(deploymentId);
  }
}

class InMemoryDeviceInstanceStorage {
  #instances: TestDeviceInstance[] = [];

  seed(instance: TestDeviceInstance): void {
    this.#instances.push(instance);
  }

  async list(): Promise<TestDeviceInstance[]> {
    return [...this.#instances];
  }

  async listByDeploymentsAndStates(
    deploymentIds: Iterable<string>,
    states: Iterable<string>,
  ): Promise<TestDeviceInstance[]> {
    const requestedDeployments = new Set(deploymentIds);
    const requestedStates = new Set(states);
    return this.#instances.filter((instance) =>
      requestedDeployments.has(instance.deploymentId) &&
      requestedStates.has(instance.state)
    );
  }
}

class InMemoryDeviceDeploymentStorage {
  #deployments = new Map<string, TestDeviceDeployment>();

  seed(deployment: TestDeviceDeployment): void {
    this.#deployments.set(deployment.deploymentId, deployment);
  }

  async get(deploymentId: string): Promise<TestDeviceDeployment | undefined> {
    return this.#deployments.get(deploymentId);
  }
}

class InMemoryDeploymentContractEvidenceStorage {
  #evidence: TestDeploymentContractEvidence[] = [];

  seed(record: TestDeploymentContractEvidence): void {
    this.#evidence.push(record);
  }

  async list(): Promise<TestDeploymentContractEvidence[]> {
    return [...this.#evidence];
  }

  async listByDeploymentsAndContractId(
    deploymentIds: Iterable<string>,
    contractId: string,
  ): Promise<TestDeploymentContractEvidence[]> {
    const requestedDeployments = new Set(deploymentIds);
    return this.#evidence.filter((record) =>
      requestedDeployments.has(record.deploymentId) &&
      record.contractId === contractId
    );
  }
}

class InMemoryDeploymentEnvelopeStorage {
  #envelopes = new Map<string, DeploymentEnvelope>();

  seed(envelope: DeploymentEnvelope): void {
    this.#envelopes.set(envelope.deploymentId, envelope);
  }

  async list(): Promise<DeploymentEnvelope[]> {
    return [...this.#envelopes.values()];
  }

  async listEnabledByContractId(
    contractId: string,
  ): Promise<DeploymentEnvelope[]> {
    return [...this.#envelopes.values()].filter((envelope) =>
      !envelope.disabled &&
      (envelope.boundary.contracts.some((entry) =>
        entry.contractId === contractId
      ) ||
        envelope.boundary.surfaces.some((entry) =>
          entry.contractId === contractId
        ))
    );
  }

  async listEnabledBySurface(args: {
    contractId: string;
    kind: string;
    name: string;
    action: string;
  }): Promise<DeploymentEnvelope[]> {
    return [...this.#envelopes.values()].filter((envelope) =>
      !envelope.disabled &&
      envelope.boundary.surfaces.some((surface) =>
        surface.contractId === args.contractId &&
        surface.kind === args.kind &&
        surface.name === args.name &&
        surface.action === args.action
      )
    );
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

  async getActiveEntries(): Promise<ContractEntry[]> {
    return [...this.#entries];
  }
}

function matchFilter(filter: string, key: string): boolean {
  const filterParts = filter.split(".");
  const keyParts = key.split(".");

  for (let i = 0; i < filterParts.length; i += 1) {
    const part = filterParts[i];
    if (part === ">") return true;
    if (keyParts[i] === undefined) return false;
    if (part !== "*" && part !== keyParts[i]) return false;
  }

  return keyParts.length === filterParts.length;
}

class InMemoryConnectionsKV {
  lookupCount = 0;
  #keys = new Set<string>();

  seed(key: string): void {
    this.#keys.add(key);
  }

  keys(filter: string): AsyncResult<AsyncIterable<string>, UnexpectedError> {
    this.lookupCount += 1;

    async function* iter(keys: Set<string>) {
      for (const key of keys) {
        if (matchFilter(filter, key)) yield key;
      }
    }

    return AsyncResult.ok(iter(this.#keys));
  }

  get(key: string): AsyncResult<never, UnexpectedError> {
    return AsyncResult.err(new UnexpectedError({ context: { key } }));
  }

  put(_key: string, _value: unknown): AsyncResult<void, UnexpectedError> {
    return AsyncResult.ok(undefined);
  }

  create(_key: string, _value: unknown): AsyncResult<void, UnexpectedError> {
    return AsyncResult.ok(undefined);
  }

  delete(_key: string): AsyncResult<void, UnexpectedError> {
    return AsyncResult.ok(undefined);
  }
}

function takeUnknown(result: { take(): unknown }): unknown {
  return result.take();
}

function makeStatusHandler(
  contracts: Pick<InMemoryContracts, "getKnownEntriesByContractId">,
) {
  const serviceInstanceStorage = new InMemoryServiceInstanceStorage();
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  const deviceInstanceStorage = new InMemoryDeviceInstanceStorage();
  const deviceDeploymentStorage = new InMemoryDeviceDeploymentStorage();
  const deploymentEnvelopeStorage = new InMemoryDeploymentEnvelopeStorage();
  const deploymentContractEvidenceStorage =
    new InMemoryDeploymentContractEvidenceStorage();
  const connectionsKV = new InMemoryConnectionsKV();

  const handler = createTrellisSurfaceStatusHandler({
    contracts,
    serviceInstanceStorage,
    serviceDeploymentStorage,
    deviceInstanceStorage,
    deviceDeploymentStorage,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
    connectionsKV,
  });

  return {
    handler,
    serviceInstanceStorage,
    serviceDeploymentStorage,
    deviceInstanceStorage,
    deviceDeploymentStorage,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
    connectionsKV,
  };
}

function seedEnabledDeployment(
  serviceDeploymentStorage: InMemoryServiceDeploymentStorage,
  deploymentId = "deployment-a",
): void {
  serviceDeploymentStorage.seed({
    deploymentId,
    namespaces: [],
    disabled: false,
    firstConnectPolicy: "auto-accept-compatible",
    appliedContracts: [],
  });
}

function seedSurfaceEnvelope(
  deploymentEnvelopeStorage: InMemoryDeploymentEnvelopeStorage,
  deploymentContractEvidenceStorage: InMemoryDeploymentContractEvidenceStorage,
  deploymentId = "deployment-a",
  disabled = false,
  digest = "digest-surface",
  kind: DeploymentEnvelope["kind"] = "service",
): void {
  deploymentEnvelopeStorage.seed({
    deploymentId,
    kind,
    disabled,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    boundary: {
      contracts: [{ contractId: "surface@v1", required: true }],
      surfaces: [{
        contractId: "surface@v1",
        kind: "rpc",
        name: "Surface.Read",
        action: "call",
        required: true,
      }, {
        contractId: "surface@v1",
        kind: "event",
        name: "Surface.Changed",
        action: "publish",
        required: true,
      }, {
        contractId: "surface@v1",
        kind: "event",
        name: "Surface.Changed",
        action: "subscribe",
        required: true,
      }, {
        contractId: "surface@v1",
        kind: "feed",
        name: "Surface.Feed",
        action: "read",
        required: true,
      }],
      capabilities: [],
      resources: [],
    },
  });
  deploymentContractEvidenceStorage.seed({
    deploymentId,
    contractId: "surface@v1",
    contractDigest: digest,
    contract: {},
    firstSeenAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
  });
}

const surfaceContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "surface@v1",
  displayName: "Surface",
  description: "Exposes runtime surfaces.",
  kind: "service",
  schemas: {
    Empty: { type: "object" },
  },
  rpc: {
    "Surface.Read": {
      version: "v1",
      subject: "rpc.v1.Surface.Read",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
      capabilities: { call: ["surface.read"] },
    },
  },
  events: {
    "Surface.Changed": {
      version: "v1",
      subject: "events.v1.Surface.Changed",
      event: { schema: "Empty" },
      capabilities: {
        publish: ["surface.publish"],
        subscribe: ["surface.subscribe"],
      },
    },
  },
  feeds: {
    "Surface.Feed": {
      version: "v1",
      subject: "feeds.v1.Surface.Feed",
      input: { schema: "Empty" },
      event: { schema: "Empty" },
      capabilities: { subscribe: ["surface.subscribe"] },
    },
  },
};

const otherContract: TrellisContractV1 = {
  ...surfaceContract,
  id: "other@v1",
  displayName: "Other",
  description: "Other runtime surface.",
  rpc: {
    "Other.Read": {
      version: "v1",
      subject: "rpc.v1.Other.Read",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
      capabilities: { call: ["other.read"] },
    },
  },
  events: {},
};

const surfaceContractWithoutRead: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "surface@v1",
  displayName: "Surface",
  description: "Older surface contract without read RPC.",
  kind: "service",
  schemas: {
    Empty: { type: "object" },
  },
};

Deno.test("Trellis.Contract.Get includes canonical exports", async () => {
  const store = new InMemoryContracts();
  store.add("digest-exports", exportedSchemaContract);

  const result = await createTrellisContractGetHandler(store)({
    digest: "digest-exports",
  });

  const value = result.take() as {
    contract: { exports?: { schemas?: string[] } };
  };
  assertEquals(value.contract.exports, {
    schemas: ["PublicValue"],
  });
});

Deno.test("Trellis.Catalog lists envelope-available known contracts", async () => {
  const store = new InMemoryContracts();
  const deploymentEnvelopeStorage = new InMemoryDeploymentEnvelopeStorage();
  const deploymentContractEvidenceStorage =
    new InMemoryDeploymentContractEvidenceStorage();
  const appContract: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "app@v1",
    displayName: "App",
    description: "Known app contract",
    kind: "app",
  };
  store.add("digest-app", appContract);
  store.add("digest-exports", exportedSchemaContract);
  deploymentEnvelopeStorage.seed({
    deploymentId: "deployment-a",
    kind: "service",
    disabled: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    boundary: {
      contracts: [{ contractId: "exports@v1", required: true }],
      surfaces: [],
      capabilities: [],
      resources: [],
    },
  });
  deploymentContractEvidenceStorage.seed({
    deploymentId: "deployment-a",
    contractId: "exports@v1",
    contractDigest: "digest-exports",
    contract: {},
    firstSeenAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
  });

  const result = await createTrellisCatalogHandler(
    store,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  )();

  assertEquals(takeUnknown(result), {
    catalog: {
      format: "trellis.catalog.v1",
      contracts: [{
        id: "exports@v1",
        digest: "digest-exports",
        displayName: "Exports",
        description: "Exports public schemas.",
      }],
    },
  });
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

Deno.test("Trellis.Surface.Status reports unknown contract", async () => {
  const store = new InMemoryContracts();
  const { handler } = makeStatusHandler(store);

  const result = await handler({
    contractId: "missing@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(takeUnknown(result), {
    status: { state: "unknown_contract", contractId: "missing@v1" },
  });
});

Deno.test("Trellis.Surface.Status reports unknown surface", async () => {
  const store = new InMemoryContracts();
  store.add("digest-surface", surfaceContract);
  const { handler } = makeStatusHandler(store);

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Missing",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(takeUnknown(result), {
    status: {
      state: "unknown_surface",
      contractId: "surface@v1",
      kind: "rpc",
      surface: "Surface.Missing",
    },
  });
});

Deno.test("Trellis.Surface.Status reports optional missing surface as envelope unavailable", async () => {
  const store = new InMemoryContracts();
  store.add("digest-surface", surfaceContract);
  const { handler, deploymentEnvelopeStorage } = makeStatusHandler(store);
  deploymentEnvelopeStorage.seed({
    deploymentId: "deployment-a",
    kind: "service",
    disabled: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    boundary: {
      contracts: [{ contractId: "surface@v1", required: true }],
      surfaces: [],
      capabilities: [],
      resources: [],
    },
  });

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(takeUnknown(result), {
    status: { state: "unavailable", reason: "envelope_unavailable" },
  });
});

Deno.test("Trellis.Surface.Status reports unauthorized by envelope", async () => {
  const store = new InMemoryContracts();
  store.add("digest-surface", surfaceContract);
  const {
    handler,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
    connectionsKV,
  } = makeStatusHandler(store);
  seedSurfaceEnvelope(
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  );

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, { caller: { type: "user", capabilities: [] }, sessionKey: "sk" });

  assertEquals(takeUnknown(result), {
    status: { state: "unauthorized", missingCapabilities: ["surface.read"] },
  });
  assertEquals(connectionsKV.lookupCount, 0);
});

Deno.test("Trellis.Surface.Status reports available without live implementer", async () => {
  const store = new InMemoryContracts();
  store.add("digest-surface", surfaceContract);
  const {
    handler,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  } = makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
  seedSurfaceEnvelope(
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  );
  serviceInstanceStorage.seed({
    instanceId: "service-a",
    deploymentId: "deployment-a",
    instanceKey: "sk_service_a",
    disabled: false,
    currentContractId: "surface@v1",
    currentContractDigest: "digest-surface",
    capabilities: ["service"],
    createdAt: new Date(0).toISOString(),
  });

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(takeUnknown(result), {
    status: {
      state: "available",
      liveImplementer: false,
      runtime: "no_live_implementer",
    },
  });
});

Deno.test("Trellis.Surface.Status reports available live implementing service", async () => {
  const store = new InMemoryContracts();
  store.add("digest-surface", surfaceContract);
  const {
    handler,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
    connectionsKV,
  } = makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
  seedSurfaceEnvelope(
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  );
  serviceInstanceStorage.seed({
    instanceId: "service-a",
    deploymentId: "deployment-a",
    instanceKey: "sk_service_a",
    disabled: false,
    currentContractId: "surface@v1",
    currentContractDigest: "digest-surface",
    capabilities: ["service"],
    createdAt: new Date(0).toISOString(),
  });
  connectionsKV.seed(connectionKey("sk_service_a", "service-a", "nkey-a"));

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(takeUnknown(result), {
    status: { state: "available", liveImplementer: true, runtime: "live" },
  });
});

Deno.test("Trellis.Surface.Status ignores live service for another contract", async () => {
  const store = new InMemoryContracts();
  store.add("digest-surface", surfaceContract);
  store.add("digest-other", otherContract);
  const {
    handler,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
    connectionsKV,
  } = makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
  seedSurfaceEnvelope(
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  );
  serviceInstanceStorage.seed({
    instanceId: "service-other",
    deploymentId: "deployment-a",
    instanceKey: "sk_service_other",
    disabled: false,
    currentContractId: "other@v1",
    currentContractDigest: "digest-other",
    capabilities: ["service"],
    createdAt: new Date(0).toISOString(),
  });
  connectionsKV.seed(
    connectionKey("sk_service_other", "service-other", "nkey-other"),
  );

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(takeUnknown(result), {
    status: {
      state: "available",
      liveImplementer: false,
      runtime: "no_live_implementer",
    },
  });
});

Deno.test("Trellis.Surface.Status ignores live same-lineage digest without the surface", async () => {
  const store = new InMemoryContracts();
  store.add("digest-old", surfaceContractWithoutRead);
  store.add("digest-surface", surfaceContract);
  const {
    handler,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
    connectionsKV,
  } = makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
  seedSurfaceEnvelope(
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  );
  serviceInstanceStorage.seed({
    instanceId: "service-old",
    deploymentId: "deployment-a",
    instanceKey: "sk_service_old",
    disabled: false,
    currentContractId: "surface@v1",
    currentContractDigest: "digest-old",
    capabilities: ["service"],
    createdAt: new Date(0).toISOString(),
  });
  connectionsKV.seed(
    connectionKey("sk_service_old", "service-old", "nkey-old"),
  );

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(takeUnknown(result), {
    status: {
      state: "available",
      liveImplementer: false,
      runtime: "no_live_implementer",
    },
  });
});

Deno.test("Trellis.Surface.Status reports disabled service instance", async () => {
  const store = new InMemoryContracts();
  store.add("digest-surface", surfaceContract);
  const {
    handler,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  } = makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
  seedSurfaceEnvelope(
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  );
  serviceInstanceStorage.seed({
    instanceId: "service-a",
    deploymentId: "deployment-a",
    instanceKey: "sk_service_a",
    disabled: true,
    currentContractId: "surface@v1",
    currentContractDigest: "digest-surface",
    capabilities: ["service"],
    createdAt: new Date(0).toISOString(),
  });

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(takeUnknown(result), {
    status: { state: "available", liveImplementer: false, runtime: "disabled" },
  });
});

Deno.test("Trellis.Surface.Status validates event action", async () => {
  const store = new InMemoryContracts();
  store.add("digest-surface", surfaceContract);
  const { handler } = makeStatusHandler(store);

  const result = await handler({
    contractId: "surface@v1",
    kind: "event",
    surface: "Surface.Changed",
  }, {
    caller: { type: "user", capabilities: ["surface.subscribe"] },
    sessionKey: "sk",
  });

  assert(result.isErr());
  assertInstanceOf(result.error, ValidationError);
});

Deno.test("Trellis.Surface.Status validates action by surface kind", async () => {
  const store = new InMemoryContracts();
  store.add("digest-surface", surfaceContract);
  const {
    handler,
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  } = makeStatusHandler(store);
  seedSurfaceEnvelope(
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
  );

  const rpcCallResult = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
    action: "call",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });
  assertEquals(takeUnknown(rpcCallResult), {
    status: {
      state: "available",
      liveImplementer: false,
      runtime: "no_live_implementer",
    },
  });

  const feedReadResult = await handler({
    contractId: "surface@v1",
    kind: "feed",
    surface: "Surface.Feed",
    action: "read" as never,
  }, {
    caller: { type: "user", capabilities: ["surface.subscribe"] },
    sessionKey: "sk",
  });
  assertEquals(takeUnknown(feedReadResult), {
    status: {
      state: "available",
      liveImplementer: false,
      runtime: "no_live_implementer",
    },
  });

  const eventPublishResult = await handler({
    contractId: "surface@v1",
    kind: "event",
    surface: "Surface.Changed",
    action: "publish",
  }, {
    caller: { type: "user", capabilities: ["surface.publish"] },
    sessionKey: "sk",
  });
  assertEquals(takeUnknown(eventPublishResult), {
    status: {
      state: "available",
      liveImplementer: false,
      runtime: "no_live_implementer",
    },
  });

  const feedResult = await handler({
    contractId: "surface@v1",
    kind: "feed",
    surface: "Surface.Feed",
    action: "publish",
  }, {
    caller: { type: "user", capabilities: ["surface.subscribe"] },
    sessionKey: "sk",
  });
  assert(feedResult.isErr());
  assertInstanceOf(feedResult.error, ValidationError);

  const rpcResult = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
    action: "subscribe",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });
  assert(rpcResult.isErr());
  assertInstanceOf(rpcResult.error, ValidationError);

  const unknownResult = await handler({
    contractId: "missing@v1",
    kind: "rpc",
    surface: "Surface.Read",
    action: "subscribe",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });
  assert(unknownResult.isErr());
  assertInstanceOf(unknownResult.error, ValidationError);
});
