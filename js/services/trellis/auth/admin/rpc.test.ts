import { assert, assertEquals } from "@std/assert";
import { AsyncResult, isErr, Result } from "@qlever-llc/result";
import type { OperationSnapshot } from "@qlever-llc/trellis";
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

async function* emptyKeys(): AsyncIterable<string> {}

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
        input: { deploymentId: "billing.default", contract: {} },
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
      createAuthEnableServiceDeploymentHandler({
        refreshActiveContracts: async () => throwingStoreAccess(),
        serviceDeploymentStorage: serviceDeps.serviceDeploymentStorage,
      })({
        input: { deploymentId: "billing.default" },
        context,
      }),
    () =>
      createAuthRemoveServiceDeploymentHandler({
        refreshActiveContracts: async () => throwingStoreAccess(),
        serviceDeploymentStorage: serviceDeps.serviceDeploymentStorage,
        serviceInstanceStorage: serviceDeps.serviceInstanceStorage,
      })({
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
      disabled: false,
      appliedContracts: [],
    },
  );

  assert(
    validateServiceDeploymentRequest({ deploymentId: "", namespaces: [] })
      .isErr(),
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

function deviceAdminDeps(args: {
  deployment: DeviceDeployment;
  putDeployments?: DeviceDeployment[];
  instances?: DeviceInstance[];
  kicked?: Array<{ serverId: string; clientId: number }>;
  installDeviceContract?: (contract: unknown) => Promise<{
    id: string;
    digest: string;
    displayName: string;
    description: string;
  }>;
  refreshActiveContracts?: () => Promise<void>;
  validateActiveCatalog?: (opts: {
    stagedDeviceDeployments?: Iterable<DeviceDeployment>;
    stagedDeviceInstances?: Iterable<DeviceInstance>;
  }) => Promise<unknown>;
}) {
  let stored = args.deployment;
  const kv = {
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
    keys: () => AsyncResult.ok(emptyKeys()),
  };
  const deps: AdminRpcDeps & {
    installDeviceContract: (contract: unknown) => Promise<{
      id: string;
      digest: string;
      displayName: string;
      description: string;
    }>;
    refreshActiveContracts: () => Promise<void>;
    validateActiveCatalog: (opts: {
      stagedDeviceDeployments?: Iterable<DeviceDeployment>;
      stagedDeviceInstances?: Iterable<DeviceInstance>;
    }) => Promise<unknown>;
  } = {
    browserFlowsKV: kv,
    connectionsKV: kv,
    contractApprovalStorage: { get: async () => undefined },
    deviceActivationReviewStorage: {
      get: async () => undefined,
      getByFlowId: async () => undefined,
      put: async () => throwingStoreAccess(),
      list: async () => [],
    },
    deviceActivationStorage: {
      get: async () => undefined,
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => [],
    },
    deviceDeploymentStorage: {
      get: async () => stored,
      put: async (deployment) => {
        args.putDeployments?.push(deployment);
        stored = deployment;
      },
      delete: async () => throwingStoreAccess(),
      list: async () => [stored],
    },
    deviceInstanceStorage: {
      get: async () => undefined,
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => args.instances ?? [],
    },
    devicePortalSelectionStorage: {
      get: async () => undefined,
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
      list: async () => [],
    },
    deviceProvisioningSecretStorage: {
      get: async () => undefined,
      put: async () => throwingStoreAccess(),
      delete: async () => throwingStoreAccess(),
    },
    instanceGrantPolicyStorage: {
      get: async () => undefined,
      put: async () => throwingStoreAccess(),
      list: async () => [],
    },
    kick: async (serverId, clientId) => {
      args.kicked?.push({ serverId, clientId });
    },
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
  return { deps, getStored: () => stored };
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
      input: { deploymentId: "reader.default", contract: {} },
      context: { caller: { id: "admin", capabilities: ["admin"] } },
    });

  assert(result.isErr());
  assertEquals(putDeployments, []);
  assertEquals(refreshCount, 0);
  assertEquals(kicked, []);
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
      input: { deploymentId: "reader.default", contract: {} },
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

Deno.test("auth review event is templated by deployment", () => {
  assertEquals(
    TRELLIS_AUTH_EVENTS["Auth.DeviceActivationReviewRequested"].params,
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
  const { deps } = deviceAdminDeps({ deployment, instances: [instance] });
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
    deployment: { appliedContracts: unknown[] };
  };
  assertEquals(deployment.appliedContracts, []);
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
