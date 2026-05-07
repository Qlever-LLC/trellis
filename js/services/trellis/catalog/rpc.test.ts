import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { AsyncResult, UnexpectedError } from "@qlever-llc/result";
import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { ValidationError } from "@qlever-llc/trellis";

import {
  createTrellisCatalogHandler,
  createTrellisContractGetHandler,
  createTrellisSurfaceStatusHandler,
} from "./rpc.ts";
import { ContractStore } from "./store.ts";
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
  firstConnectPolicy: "reject" | "quarantine" | "auto-accept-compatible";
  disabled: boolean;
  appliedContracts: Array<{
    contractId: string;
    compatibilityPolicy: "exact" | "compatible-additive" | "manual";
    allowedDigests: string[];
  }>;
};

class InMemoryServiceInstanceStorage {
  #instances: TestServiceInstance[] = [];

  seed(instance: TestServiceInstance): void {
    this.#instances.push(instance);
  }

  async list(): Promise<TestServiceInstance[]> {
    return [...this.#instances];
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

function makeStatusHandler(contractStore: ContractStore) {
  const serviceInstanceStorage = new InMemoryServiceInstanceStorage();
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  const connectionsKV = new InMemoryConnectionsKV();

  const handler = createTrellisSurfaceStatusHandler({
    contractStore,
    serviceInstanceStorage,
    serviceDeploymentStorage,
    connectionsKV,
  });

  return {
    handler,
    serviceInstanceStorage,
    serviceDeploymentStorage,
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
    firstConnectPolicy: "reject",
    disabled: false,
    appliedContracts: [],
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
  const store = new ContractStore();
  store.activate("digest-exports", exportedSchemaContract);

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

Deno.test("Trellis.Catalog lists active contracts only", async () => {
  const store = new ContractStore();
  const appContract: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "app@v1",
    displayName: "App",
    description: "Known app contract",
    kind: "app",
  };
  store.add("digest-app", appContract);
  store.activate("digest-exports", exportedSchemaContract);

  const result = await createTrellisCatalogHandler(store)();

  assertEquals(result.take(), {
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

Deno.test("ContractStore lists active contract capability definitions", () => {
  const store = new ContractStore();
  store.add("digest-inactive", {
    ...capabilityContract,
    capabilities: {
      "capabilities::inactive": {
        displayName: "Inactive",
        description: "Inactive capability.",
      },
    },
  });
  store.activate("digest-capabilities", capabilityContract);

  assertEquals(store.getActiveCapabilityDefinitions(), [{
    key: "capabilities::items.read",
    displayName: "Read items",
    description: "Read item records.",
    consequence: "Operators can inspect item metadata.",
    contractId: "capabilities@v1",
    contractDigest: "digest-capabilities",
    contractDisplayName: "Capabilities",
  }]);
});

Deno.test("Trellis.Surface.Status reports unknown active contract", async () => {
  const store = new ContractStore();
  const { handler } = makeStatusHandler(store);

  const result = await handler({
    contractId: "missing@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(result.take(), {
    status: { state: "unknown_contract", contractId: "missing@v1" },
  });
});

Deno.test("Trellis.Surface.Status reports unknown surface", async () => {
  const store = new ContractStore();
  store.activate("digest-surface", surfaceContract);
  const { handler } = makeStatusHandler(store);

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Missing",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });

  assertEquals(result.take(), {
    status: {
      state: "unknown_surface",
      contractId: "surface@v1",
      kind: "rpc",
      surface: "Surface.Missing",
    },
  });
});

Deno.test("Trellis.Surface.Status checks authorization before availability", async () => {
  const store = new ContractStore();
  store.activate("digest-surface", surfaceContract);
  const { handler, connectionsKV } = makeStatusHandler(store);

  const result = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
  }, { caller: { type: "user", capabilities: [] }, sessionKey: "sk" });

  assertEquals(result.take(), {
    status: { state: "unauthorized", missingCapabilities: ["surface.read"] },
  });
  assertEquals(connectionsKV.lookupCount, 0);
});

Deno.test("Trellis.Surface.Status reports no live implementing service", async () => {
  const store = new ContractStore();
  store.activate("digest-surface", surfaceContract);
  const { handler, serviceDeploymentStorage, serviceInstanceStorage } =
    makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
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

  assertEquals(result.take(), {
    status: { state: "unavailable", reason: "no_live_implementer" },
  });
});

Deno.test("Trellis.Surface.Status reports available live implementing service", async () => {
  const store = new ContractStore();
  store.activate("digest-surface", surfaceContract);
  const {
    handler,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    connectionsKV,
  } = makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
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

  assertEquals(result.take(), {
    status: { state: "available" },
  });
});

Deno.test("Trellis.Surface.Status ignores live service for another contract", async () => {
  const store = new ContractStore();
  store.activate("digest-surface", surfaceContract);
  store.activate("digest-other", otherContract);
  const {
    handler,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    connectionsKV,
  } = makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
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

  assertEquals(result.take(), {
    status: { state: "unavailable", reason: "no_live_implementer" },
  });
});

Deno.test("Trellis.Surface.Status ignores live same-lineage digest without the surface", async () => {
  const store = new ContractStore();
  store.activate("digest-old", surfaceContractWithoutRead);
  store.activate("digest-surface", surfaceContract);
  const {
    handler,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    connectionsKV,
  } = makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
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

  assertEquals(result.take(), {
    status: { state: "unavailable", reason: "no_live_implementer" },
  });
});

Deno.test("Trellis.Surface.Status reports disabled service instance", async () => {
  const store = new ContractStore();
  store.activate("digest-surface", surfaceContract);
  const { handler, serviceDeploymentStorage, serviceInstanceStorage } =
    makeStatusHandler(store);
  seedEnabledDeployment(serviceDeploymentStorage);
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

  assertEquals(result.take(), {
    status: { state: "unavailable", reason: "disabled" },
  });
});

Deno.test("Trellis.Surface.Status validates event action", async () => {
  const store = new ContractStore();
  store.activate("digest-surface", surfaceContract);
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
  const store = new ContractStore();
  store.activate("digest-surface", surfaceContract);
  const { handler } = makeStatusHandler(store);

  const rpcCallResult = await handler({
    contractId: "surface@v1",
    kind: "rpc",
    surface: "Surface.Read",
    action: "call",
  }, {
    caller: { type: "user", capabilities: ["surface.read"] },
    sessionKey: "sk",
  });
  assertEquals(rpcCallResult.take(), {
    status: { state: "unavailable", reason: "no_live_implementer" },
  });

  const feedSubscribeResult = await handler({
    contractId: "surface@v1",
    kind: "feed",
    surface: "Surface.Feed",
    action: "subscribe",
  }, {
    caller: { type: "user", capabilities: ["surface.subscribe"] },
    sessionKey: "sk",
  });
  assertEquals(feedSubscribeResult.take(), {
    status: { state: "unavailable", reason: "no_live_implementer" },
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
  assertEquals(eventPublishResult.take(), {
    status: { state: "unavailable", reason: "no_live_implementer" },
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
