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
} from "../../../../packages/trellis/models/auth/rpc/ListConnections.ts";
import {
  AuthSessionsListResponseSchema,
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
  validateDeviceProvisionRequest,
  validateServiceDeploymentRequest,
} from "./shared.ts";
import { type AdminRpcDeps, createDeviceAdminHandlers } from "./rpc.ts";
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
import type {
  DeploymentEnvelope,
  DeploymentResourceBinding,
} from "../schemas.ts";

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
      listFiltered: async () => throwingStoreAccess(),
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => throwingStoreAccess(),
      listFiltered: async () => throwingStoreAccess(),
      listByDeployment: async () => throwingStoreAccess(),
    },
    deploymentEnvelopeStorage: {
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
    const deployments = await this.listPage(query);
    return deployments.filter((deployment) =>
      filters.disabled === undefined || deployment.disabled === filters.disabled
    );
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
    deploymentEnvelopeStorage: serviceDeps.deploymentEnvelopeStorage ?? {
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
type DeploymentContractEvidenceRecord = Awaited<
  ReturnType<
    NonNullable<AdminRpcDeps["deploymentContractEvidenceStorage"]>["list"]
  >
>[number];

function deploymentEvidence(
  deploymentId: string,
  contractDigest: string,
  contractId = "reader@v1",
): DeploymentContractEvidenceRecord {
  return {
    deploymentId,
    contractId,
    contractDigest,
    contract: {},
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  };
}

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
  assert(methods.includes("Auth.Envelopes.List"));
  assert(methods.includes("Auth.Envelopes.Get"));
  assert(methods.includes("Auth.Envelopes.Expand"));
  assert(methods.includes("Auth.EnvelopeExpansions.List"));
  assert(methods.includes("Auth.Envelopes.Changes.Preview"));
  assert(methods.includes("Auth.Envelopes.Shrink"));
  assert(methods.includes("Auth.ServiceInstances.Provision"));
  assert(methods.includes("Auth.ServiceInstances.List"));
  assert(methods.includes("Auth.ServiceInstances.Disable"));
  assert(methods.includes("Auth.ServiceInstances.Enable"));
  assert(methods.includes("Auth.ServiceInstances.Remove"));
  assert(methods.includes("Auth.Identities.Grants.List"));
  assert(methods.includes("Auth.IdentityEnvelopes.Revoke"));

  const operations = Object.keys(TRELLIS_AUTH_OPERATIONS);
  assertEquals(operations, ["Auth.DeviceUserAuthorities.Resolve"]);
});

Deno.test("production auth registration does not configure mutable auth/admin globals", async () => {
  const [rpcSource, registerSource, deviceSource] = await Promise
    .all([
      Deno.readTextFile(new URL("./rpc.ts", import.meta.url)),
      Deno.readTextFile(new URL("../register.ts", import.meta.url)),
      Deno.readTextFile(
        new URL("../registration/device_admin_activation.ts", import.meta.url),
      ),
    ]);

  assert(!rpcSource.includes("AsyncLocalStorage"));
  assert(!registerSource.includes("setAuthRuntimeDeps("));
  assert(!deviceSource.includes("setAdminRpcDeps("));
});

Deno.test("service admin RPC handlers require admin before touching dependencies", async () => {
  const serviceDeps = serviceAdminDeps();
  const runtimeDeps = kickDeps(serviceDeps);
  const caller = { type: "user", id: "not-admin", capabilities: [] };
  const context = { caller };

  const actions: Array<() => Promise<unknown>> = [
    () =>
      createAuthDeploymentsServiceCreateHandler(serviceDeps)({
        input: { deploymentId: "billing.default", namespaces: ["billing"] },
        context,
      }),
    () =>
      createAuthDeploymentsServiceListHandler(serviceDeps)({
        input: {},
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
        input: {},
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

  assert(Value.Check(AuthConnectionsListResponseSchema, {
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
      disabled: false,
    },
  );

  assert(
    validateServiceDeploymentRequest({ deploymentId: "", namespaces: [] })
      .isErr(),
  );
});

Deno.test("Auth.Deployments.Create service initializes an empty service envelope", async () => {
  const deployments = new InMemoryServiceDeploymentStorage();
  const envelopes: Array<{
    deploymentId: string;
    kind: string;
    disabled: boolean;
    boundary: unknown;
  }> = [];
  const result = await createAuthDeploymentsServiceCreateHandler({
    logger: { trace: () => {} },
    serviceDeploymentStorage: deployments,
    serviceInstanceStorage: serviceAdminDeps().serviceInstanceStorage,
    deploymentEnvelopeStorage: {
      get: async () => undefined,
      put: async (record) => {
        envelopes.push(record);
      },
    },
  })({
    input: { deploymentId: "demo-js", namespaces: [] },
    context: adminContext,
  });

  assert(!result.isErr());
  assertEquals(envelopes.length, 1);
  assertEquals(envelopes[0]?.deploymentId, "demo-js");
  assertEquals(envelopes[0]?.kind, "service");
  assertEquals(envelopes[0]?.disabled, false);
  assertEquals(
    envelopes[0]?.boundary,
    {
      contracts: [],
      surfaces: [],
      capabilities: [],
      resources: [],
    },
  );
  assertEquals(deployments.getValue("demo-js")?.deploymentId, "demo-js");
});

Deno.test("Auth.Deployments.Disable service validates staged deployment before persisting or kicking", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(putCount, 0);
  assertEquals(refreshCount, 0);
  assertEquals(kicked, []);
  assertEquals(stored, original);
});

Deno.test("Auth.Deployments.Disable service updates the deployment envelope disabled state", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const deployments = new InMemoryServiceDeploymentStorage();
  deployments.seed(original);
  let envelope: DeploymentEnvelope = {
    deploymentId: "billing.default",
    kind: "service",
    disabled: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    boundary: { contracts: [], surfaces: [], capabilities: [], resources: [] },
  };
  const serviceDeps: ServiceAdminRpcDeps = {
    logger: { trace: () => {} },
    serviceDeploymentStorage: deployments,
    serviceInstanceStorage: {
      ...serviceAdminDeps().serviceInstanceStorage,
      listByDeployment: async () => [],
    },
    deploymentEnvelopeStorage: {
      get: async () => envelope,
      put: async (record) => {
        envelope = record;
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
  assertEquals(envelope.disabled, true);
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

  const result = await createAuthDeploymentsServiceRemoveHandler({
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

Deno.test("Auth.Deployments.Remove service rejects resource purge without cascade before deleting", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
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

  const result = await createAuthDeploymentsServiceRemoveHandler({
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

Deno.test("Auth.Deployments.Remove service rejects contract purge without cascade before deleting", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
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

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    contractStorage: {
      delete: async (digest) => {
        deletedContracts.push(digest);
      },
    },
    deviceDeploymentStorage: { list: async () => [] },
    deploymentContractEvidenceStorage: {
      list: async () => [
        deploymentEvidence("billing.default", "digest-unused", "billing@v1"),
        deploymentEvidence(
          "billing.default",
          "digest-referenced",
          "billing@v1",
        ),
        deploymentEvidence("billing.default", "digest-builtin", "billing@v1"),
        deploymentEvidence("billing.other", "digest-referenced", "billing@v1"),
      ],
      listByDeployment: async () => [
        deploymentEvidence("billing.default", "digest-unused", "billing@v1"),
        deploymentEvidence(
          "billing.default",
          "digest-referenced",
          "billing@v1",
        ),
        deploymentEvidence("billing.default", "digest-builtin", "billing@v1"),
      ],
    },
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

Deno.test("Auth.Deployments.Remove service preflights contract purge dependencies before revocation", async () => {
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(storedDeployment, original);
  assertEquals(storedInstances, instances);
  assertEquals(deletedSessions, []);
  assertEquals(kicked, []);
  assertEquals(refreshCount, 0);
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
      }],
      listByDeploymentIds: async () => [],
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
      listByCurrentContractDigests: async (digests) => {
        const requested = new Set(digests);
        return [{
          instanceId: "svc_other",
          deploymentId: "billing.other",
          instanceKey: "session-key-other",
          disabled: false,
          currentContractId: "billing@v1",
          currentContractDigest: "digest-referenced",
          capabilities: ["service"],
          createdAt: "2026-01-01T00:00:00.000Z",
        }].filter((entry) =>
          entry.currentContractDigest &&
          requested.has(entry.currentContractDigest)
        );
      },
      listByDeployment: async () => [],
    },
  };

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    contractStorage: {
      delete: async (digest) => {
        calls.push(`delete-contract:${digest}`);
      },
    },
    deviceDeploymentStorage: {
      list: async () => [],
      listByDeploymentIds: async () => [],
    },
    deploymentContractEvidenceStorage: {
      list: async () => [
        deploymentEvidence("billing.default", "digest-unused", "billing@v1"),
      ],
      listByDigests: async (digests) => {
        const requested = new Set(digests);
        return [
          deploymentEvidence("billing.default", "digest-unused", "billing@v1"),
        ].filter((record) => requested.has(record.contractDigest));
      },
      listByDeployment: async () => [
        deploymentEvidence("billing.default", "digest-unused", "billing@v1"),
      ],
    },
    contractApprovalStorage: {
      list: async () => [],
      listByApprovalEvidenceContractDigests: async () => [],
    },
    sessionStorage: {
      deleteByInstanceKey: async () => {},
      listEntries: async () => [],
      listEntriesByContractDigests: async () => [],
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
      get: async () => storedDeployment,
      put: async (deployment) => {
        storedDeployment = deployment;
      },
      delete: async () => {
        calls.push("delete-deployment");
        storedDeployment = undefined;
      },
      list: async () => [],
      listByDeploymentIds: async () => [],
    },
    serviceInstanceStorage: {
      get: async () => throwingStoreAccess(),
      getByInstanceKey: async () => throwingStoreAccess(),
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => [],
      listByCurrentContractDigests: async () => [],
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
    contractStorage: {
      delete: async (digest) => {
        calls.push(`delete-contract:${digest}`);
        throw new Error("contract cleanup failed");
      },
    },
    deviceDeploymentStorage: {
      list: async () => [],
      listByDeploymentIds: async () => [],
    },
    deploymentContractEvidenceStorage: {
      list: async () => [
        deploymentEvidence("billing.default", "digest-unused", "billing@v1"),
      ],
      listByDigests: async (digests) => {
        const requested = new Set(digests);
        return [
          deploymentEvidence("billing.default", "digest-unused", "billing@v1"),
        ].filter((record) => requested.has(record.contractDigest));
      },
      listByDeployment: async () => [
        deploymentEvidence("billing.default", "digest-unused", "billing@v1"),
      ],
    },
    contractApprovalStorage: {
      list: async () => [],
      listByApprovalEvidenceContractDigests: async () => [],
    },
    sessionStorage: {
      deleteByInstanceKey: async () => {},
      listEntries: async () => [],
      listEntriesByContractDigests: async () => [],
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

Deno.test("Auth.Deployments.Remove service purges applied contract resources before durable deletion", async () => {
  const original: ServiceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const resourceBindings: DeploymentResourceBinding[] = [{
    deploymentId: "billing.default",
    kind: "kv",
    alias: "cache",
    binding: { bucket: "cache-a", history: 1, ttlMs: 0 },
    limits: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }, {
    deploymentId: "billing.default",
    kind: "store",
    alias: "uploads",
    binding: { name: "uploads-b", ttlMs: 0 },
    limits: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
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

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    purgeResourceBindings: async (bindings) => {
      calls.push("purge");
      purgedBindings.push(...bindings);
    },
    deploymentResourceBindingStorage: {
      listByDeployment: async () => resourceBindings,
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
    {
      kv: { cache: { bucket: "cache-a", history: 1, ttlMs: 0 } },
      store: { uploads: { name: "uploads-b", ttlMs: 0 } },
    },
  ]);
  assertEquals(storedDeployment, undefined);
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

  const result = await createAuthDeploymentsServiceRemoveHandler({
    ...kickDeps(serviceDeps),
    purgeResourceBindings: async () => {
      throw new Error("purge failed");
    },
    deploymentResourceBindingStorage: {
      listByDeployment: async () => [{
        deploymentId: "billing.default",
        kind: "kv",
        alias: "cache",
        binding: { bucket: "cache-a", history: 1, ttlMs: 0 },
        limits: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
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
    purgeResourceBindings: async () => {
      throw new Error("purge failed");
    },
    deploymentResourceBindingStorage: {
      listByDeployment: async () => [{
        deploymentId: "billing.default",
        kind: "kv",
        alias: "cache",
        binding: { bucket: "cache-a", history: 1, ttlMs: 0 },
        limits: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
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
    purgeResourceBindings: async () => {
      calls.push("purge");
    },
    deploymentResourceBindingStorage: {
      listByDeployment: async () => [{
        deploymentId: "billing.default",
        kind: "kv",
        alias: "cache",
        binding: { bucket: "cache-a", history: 1, ttlMs: 0 },
        limits: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
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
    context: { caller: { type: "user", id: "admin", capabilities: ["admin"] } },
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
  deploymentContractEvidence?: DeploymentContractEvidenceRecord[];
  serviceInstances?: Array<{ currentContractDigest?: string | null }>;
  approvalDigests?: string[];
  envelopePuts?: Array<{
    deploymentId: string;
    kind: string;
    disabled: boolean;
    boundary: unknown;
  }>;
  envelope?: DeploymentEnvelope;
}) {
  let stored: DeviceDeployment | undefined = args.deployment;
  let instances = args.instances ?? [];
  let provisioningSecrets = args.provisioningSecrets ??
    (args.provisioningSecret ? [args.provisioningSecret] : []);
  let activations = args.activations ??
    (args.activation ? [args.activation] : []);
  let activationReviews = args.activationReviews ?? [];
  let envelope = args.envelope;
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
          identityEnvelopeId: `env-${digest}`,
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
      list: async () => activationReviews,
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
      listFiltered: async (filters = {}) =>
        activations.filter((activation) =>
          (filters.instanceId === undefined ||
            activation.instanceId === filters.instanceId) &&
          (filters.deploymentId === undefined ||
            activation.deploymentId === filters.deploymentId) &&
          (filters.state === undefined || activation.state === filters.state)
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
      list: async () => stored ? [stored] : [],
      listFiltered: async (filters = {}) => (stored &&
          (filters.disabled === undefined ||
            stored.disabled === filters.disabled)
        ? [stored]
        : []),
      listByDeploymentIds: async (deploymentIds, filters = {}) => {
        const requested = new Set(deploymentIds);
        return stored && requested.has(stored.deploymentId) &&
            (filters.disabled === undefined ||
              stored.disabled === filters.disabled)
          ? [stored]
          : [];
      },
    },
    deploymentEnvelopeStorage: {
      get: async () => envelope,
      put: async (record) => {
        args.envelopePuts?.push(record);
        envelope = record;
      },
    },
    deploymentContractEvidenceStorage: {
      list: async () => args.deploymentContractEvidence ?? [],
      listByDigests: async (digests) => {
        const requested = new Set(digests);
        return (args.deploymentContractEvidence ?? []).filter((record) =>
          requested.has(record.contractDigest)
        );
      },
      listByDeployment: async (deploymentId: string) =>
        (args.deploymentContractEvidence ?? []).filter((record) =>
          record.deploymentId === deploymentId
        ),
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
    publishSessionRevoked: async () => {},
    sessionStorage: {
      deleteByPublicIdentityKey: async () => {},
      deleteBySessionKey: async () => {},
      listEntries: async () => [],
      listEntriesByContractDigests: async () => [],
    },
    serviceDeploymentStorage: {
      list: async () => args.serviceDeployments ?? [],
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
      list: async () => args.serviceInstances ?? [],
      listByCurrentContractDigests: async (digests) => {
        const requested = new Set(digests);
        return (args.serviceInstances ?? []).filter((instance) =>
          instance.currentContractDigest !== undefined &&
          instance.currentContractDigest !== null &&
          requested.has(instance.currentContractDigest)
        );
      },
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
  };
}

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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(putDeployments, []);
  assertEquals(refreshCount, 0);
  assertEquals(getStored(), original);
});

Deno.test("Auth.Deployments.Enable device updates the deployment envelope disabled state", async () => {
  const original: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: true,
  };
  const envelopePuts: DeploymentEnvelope[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment: original,
    envelope: {
      deploymentId: "reader.default",
      kind: "device",
      disabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      boundary: {
        contracts: [],
        surfaces: [],
        capabilities: [],
        resources: [],
      },
    },
    envelopePuts,
  });

  const result = await createDeviceAdminHandlers(deps).enableDeviceDeployment({
    input: { deploymentId: "reader.default" },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(getStored()?.disabled, false);
  assertEquals(envelopePuts.at(-1)?.disabled, false);
});

Deno.test("Auth.Deployments.Create device initializes an empty device envelope", async () => {
  const envelopePuts: Array<{
    deploymentId: string;
    kind: string;
    disabled: boolean;
    boundary: unknown;
  }> = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment: {
      deploymentId: "reader.old",
      reviewMode: "none",
      disabled: false,
    },
    envelopePuts,
  });

  const result = await createDeviceAdminHandlers(deps).createDeviceDeployment({
    input: { deploymentId: "reader.default", reviewMode: "required" },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(!result.isErr());
  assertEquals(getStored()?.deploymentId, "reader.default");
  assertEquals(envelopePuts.length, 1);
  assertEquals(envelopePuts[0]?.deploymentId, "reader.default");
  assertEquals(envelopePuts[0]?.kind, "device");
  assertEquals(envelopePuts[0]?.disabled, false);
  assertEquals(envelopePuts[0]?.boundary, {
    contracts: [],
    surfaces: [],
    capabilities: [],
    resources: [],
  });
});

Deno.test("Auth.Deployments.Create device rolls back deployment when envelope initialization fails", async () => {
  const { deps, getStored } = deviceAdminDeps({});
  deps.deploymentEnvelopeStorage.put = async () => {
    throw new Error("envelope write failed");
  };

  const result = await createDeviceAdminHandlers(deps).createDeviceDeployment({
    input: { deploymentId: "reader.default", reviewMode: "required" },
    context: { caller: { id: "admin", capabilities: ["admin"] } },
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
  });

  assert(result.isErr());
  assertEquals(getStored(), deployment);
  assertEquals(deletedInstances, []);
  assertEquals(deletedContracts, []);
  assertEquals(refreshCount, 0);
});

Deno.test("Auth.Deployments.Remove device preflights contract purge dependencies before revocation", async () => {
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

Deno.test("Auth.Deployments.Remove device purges only unreferenced non-built-in installed contracts after refresh", async () => {
  const deployment: DeviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };
  const deletedContracts: string[] = [];
  const calls: string[] = [];
  const { deps, getStored } = deviceAdminDeps({
    deployment,
    builtinContractDigests: ["digest-builtin"],
    deletedContracts,
    serviceDeployments: [{ deploymentId: "service.default" }],
    deploymentContractEvidence: [
      deploymentEvidence("reader.default", "digest-unused"),
      deploymentEvidence("reader.default", "digest-referenced"),
      deploymentEvidence("reader.default", "digest-builtin"),
      deploymentEvidence("service.default", "digest-referenced", "service@v1"),
    ],
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

Deno.test("Auth.Deployments.Remove device keeps removal successful when unused contract cleanup fails", async () => {
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
    deploymentContractEvidence: [
      deploymentEvidence("reader.default", "digest-unused"),
    ],
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
    requestedBy: { origin: "portal", id: "main" },
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
    requestedBy: { origin: "portal", id: "main" },
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
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
    requestedBy: { origin: "portal", id: "main" },
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
    context: { caller: { id: "admin", capabilities: ["admin"] } },
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
    requestedBy: { origin: "github", id: "user_1" },
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
      event: "Auth.DeviceUserAuthorities.Approved",
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
      event: "Auth.DeviceUserAuthorities.Resolved",
      payload: {
        instanceId: "device_1",
        publicIdentityKey: "pub_device_1",
        deploymentId: "reader.default",
        resolvedAt: putReviews[0].decidedAt,
        resolvedBy: { origin: "github", id: "user_1" },
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
    requestedBy: { origin: "github", id: "user_1" },
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

Deno.test("Auth.DeviceUserAuthorities.Reviews.Decide retries completion for already-approved review", async () => {
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

Deno.test("Auth.DeviceUserAuthorities.Reviews.Decide retries completion for already-rejected review", async () => {
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

Deno.test("Auth.DeviceUserAuthorities.Reviews.Decide does not mutate when operation completion is missing", async () => {
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
