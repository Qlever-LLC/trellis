import { assert, assertEquals } from "@std/assert";

import type { ContractRecord } from "../../catalog/schemas.ts";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { deviceInstanceId } from "../admin/shared.ts";
import type {
  AuthorityNeedSet,
  DeploymentAuthority,
  DeploymentAuthorityMaterialization,
} from "../schemas.ts";
import { __testing__ } from "./callout.ts";

const PUBLIC_IDENTITY_KEY = "A".repeat(43);
const INSTANCE_ID = deviceInstanceId(PUBLIC_IDENTITY_KEY);
const TEST_NOW = "2026-01-01T00:00:00.000Z";

const DEVICE_CONTRACT: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "example.device@v1",
  displayName: "Example Device",
  description: "Example device contract",
  kind: "device",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Example.Read": {
      version: "v1",
      subject: "rpc.v1.Example.Read",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
      capabilities: { call: ["example.read"] },
    },
  },
};

const FITTING_NEEDS: AuthorityNeedSet = {
  contracts: [{ contractId: "example.device@v1", required: true }],
  surfaces: [{
    contractId: "example.device@v1",
    kind: "rpc",
    name: "Example.Read",
    action: "call",
    required: true,
  }],
  capabilities: [{ capability: "example.read", required: true }],
  resources: [],
};

const FITTING_AUTHORITY: DeploymentAuthority = {
  deploymentId: "reader.default",
  kind: "device",
  disabled: false,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
  version: TEST_NOW,
  desiredState: {
    needs: FITTING_NEEDS,
    capabilities: FITTING_NEEDS.capabilities.map((need) => need.capability),
    resources: FITTING_NEEDS.resources,
    surfaces: FITTING_NEEDS.surfaces.map((
      { required: _required, ...surface },
    ) => surface),
  },
};

function materializedDeviceAuthority(
  overrides: Partial<DeploymentAuthorityMaterialization> = {},
): DeploymentAuthorityMaterialization {
  return {
    deploymentId: "reader.default",
    desiredVersion: FITTING_AUTHORITY.version,
    status: "current",
    resourceBindings: [],
    grants: {
      capabilities: [{ capability: "example.read" }],
      surfaces: [],
      nats: [{
        direction: "publish",
        subject: "rpc.v1.Example.Narrow",
        requiredCapabilities: ["example.read"],
        grantSource: "used-surface",
      }],
    },
    reconciledAt: TEST_NOW,
    ...overrides,
  };
}

function makeContractRecord(
  overrides: Partial<ContractRecord> = {},
): ContractRecord {
  return {
    digest: "digest-a",
    id: "example.device@v1",
    displayName: "Example Device",
    description: "Example device contract",
    installedAt: new Date("2026-01-01T00:00:00.000Z"),
    contract: JSON.stringify(DEVICE_CONTRACT),
    analysisSummary: {
      namespaces: ["example"],
      rpcMethods: 1,
      operations: 0,
      operationControls: 0,
      events: 0,
      natsPublish: 0,
      natsSubscribe: 1,
      kvResources: 0,
      storeResources: 0,
      jobsQueues: 0,
    },
    analysis: {
      namespaces: ["example"],
      rpc: {
        methods: [{
          key: "Example.Read",
          subject: "rpc.v1.Example.Read",
          wildcardSubject: "rpc.v1.Example.Read",
          callerCapabilities: ["example.read"],
        }],
      },
      operations: { operations: [], control: [] },
      events: { events: [] },
      nats: {
        publish: [],
        subscribe: [{
          kind: "rpc",
          subject: "rpc.v1.Example.Read",
          wildcardSubject: "rpc.v1.Example.Read",
          requiredCapabilities: ["example.read"],
        }],
      },
      resources: { kv: [], store: [], jobs: [] },
    },
    ...overrides,
  };
}

function makeGrantDeps(args: {
  instanceState?: "registered" | "activated" | "revoked" | "disabled";
  instanceDeploymentId?: string;
  activationDeploymentId?: string;
  deploymentDisabled?: boolean;
  authority?: DeploymentAuthority;
  materializedAuthority?: DeploymentAuthorityMaterialization | null;
  activation?: "activated" | "revoked" | null;
}) {
  const contractRecord = makeContractRecord();
  return {
    deviceInstanceStorage: {
      get: async () => ({
        instanceId: INSTANCE_ID,
        publicIdentityKey: PUBLIC_IDENTITY_KEY,
        deploymentId: args.instanceDeploymentId ?? "reader.default",
        state: args.instanceState ?? "registered",
        createdAt: "2026-01-01T00:00:00.000Z",
        activatedAt: null,
        revokedAt: null,
      }),
    },
    deviceActivationStorage: {
      get: async () =>
        args.activation === null ? undefined : {
          instanceId: INSTANCE_ID,
          publicIdentityKey: PUBLIC_IDENTITY_KEY,
          deploymentId: args.activationDeploymentId ?? "reader.default",
          state: args.activation ?? "activated",
          activatedAt: "2026-01-01T00:01:00.000Z",
          revokedAt: args.activation === "revoked"
            ? "2026-01-01T00:02:00.000Z"
            : null,
        },
      put: async () => undefined,
    },
    deviceDeploymentStorage: {
      get: async () => {
        const deployment = {
          deploymentId: "reader.default",
          disabled: args.deploymentDisabled ?? false,
        };
        return deployment;
      },
    },
    contractStorage: {
      get: async (digest: string) =>
        digest === "digest-a" ? contractRecord : undefined,
    },
    deploymentAuthorityStorage: {
      get: async () => args.authority ?? FITTING_AUTHORITY,
    },
    materializedAuthorityStorage: {
      get: async () =>
        args.materializedAuthority === undefined
          ? materializedDeviceAuthority({
            desiredVersion: (args.authority ?? FITTING_AUTHORITY).version,
          })
          : args.materializedAuthority ?? undefined,
      listByDeployment: async () => [],
    },
  };
}

Deno.test("resolveDeviceRuntimeGrant allows registered device runtime authority when desired state fits", async () => {
  const deps = makeGrantDeps({ activation: null });
  const result = await __testing__.resolveDeviceRuntimeGrant(
    deps,
    PUBLIC_IDENTITY_KEY,
    deps.contractStorage,
    "digest-a",
  );

  assert(result.ok);
  assertEquals(result.value.authority, "admin_reviewed");
  assertEquals(result.value.activation, null);
  assertEquals(result.value.instance.instanceId, INSTANCE_ID);
  assertEquals(result.value.publishSubjects, ["rpc.v1.Example.Narrow"]);
});

Deno.test("resolveDeviceRuntimeGrant uses materialized grants instead of contract-derived subjects", async () => {
  const deps = makeGrantDeps({
    activation: null,
  });
  const result = await __testing__.resolveDeviceRuntimeGrant(
    deps,
    PUBLIC_IDENTITY_KEY,
    deps.contractStorage,
    "digest-a",
  );

  assert(result.ok);
  assertEquals(
    result.value.publishSubjects.includes("rpc.v1.Example.Read"),
    false,
  );
  assertEquals(result.value.publishSubjects, ["rpc.v1.Example.Narrow"]);
  assertEquals(result.value.subscribeSubjects, []);
});

Deno.test("resolveDeviceRuntimeGrant keeps activated devices user delegated", async () => {
  const deps = makeGrantDeps({ activation: "activated" });
  const result = await __testing__.resolveDeviceRuntimeGrant(
    deps,
    PUBLIC_IDENTITY_KEY,
    deps.contractStorage,
    "digest-a",
  );

  assert(result.ok);
  assertEquals(result.value.authority, "user_delegated");
  assertEquals(result.value.activation?.state, "activated");
});

Deno.test("resolveDeviceRuntimeGrant rejects stale activation deployment", async () => {
  const deps = makeGrantDeps({
    activation: "activated",
    instanceDeploymentId: "reader.next",
    activationDeploymentId: "reader.default",
  });
  const result = await __testing__.resolveDeviceRuntimeGrant(
    deps,
    PUBLIC_IDENTITY_KEY,
    deps.contractStorage,
    "digest-a",
  );

  assertEquals(result, { ok: false, denial: "device_activation_revoked" });
});

Deno.test("resolveDeviceRuntimeGrant denies pre-activation disabled deployment and authority miss", async () => {
  const disabled = makeGrantDeps({
    activation: null,
    deploymentDisabled: true,
  });
  assertEquals(
    await __testing__.resolveDeviceRuntimeGrant(
      disabled,
      PUBLIC_IDENTITY_KEY,
      disabled.contractStorage,
      "digest-a",
    ),
    { ok: false, denial: "device_deployment_disabled" },
  );

  const disallowed = makeGrantDeps({
    activation: null,
    materializedAuthority: null,
  });
  assertEquals(
    await __testing__.resolveDeviceRuntimeGrant(
      disallowed,
      PUBLIC_IDENTITY_KEY,
      disallowed.contractStorage,
      "digest-a",
    ),
    { ok: false, denial: "device_authority_miss" },
  );
});

Deno.test("resolveDeviceRuntimeGrant denies pre-activation disabled and revoked devices", async () => {
  for (const instanceState of ["disabled", "revoked"] as const) {
    const deps = makeGrantDeps({
      activation: null,
      instanceState,
    });

    assertEquals(
      await __testing__.resolveDeviceRuntimeGrant(
        deps,
        PUBLIC_IDENTITY_KEY,
        deps.contractStorage,
        "digest-a",
      ),
      { ok: false, denial: "unknown_device" },
    );
  }
});
