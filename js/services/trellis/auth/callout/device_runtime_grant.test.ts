import { assert, assertEquals } from "@std/assert";

import type { ContractRecord } from "../../catalog/schemas.ts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { deviceInstanceId } from "../admin/shared.ts";
import type { DeploymentEnvelope } from "../schemas.ts";
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

const FITTING_ENVELOPE: DeploymentEnvelope = {
  deploymentId: "reader.default",
  kind: "device",
  disabled: false,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
  boundary: {
    contracts: [{ contractId: "example.device@v1", required: true }],
    surfaces: [{
      contractId: "example.device@v1",
      kind: "rpc",
      name: "Example.Read",
      action: "call",
      required: true,
    }],
    capabilities: ["example.read"],
    resources: [],
  },
};

const EMPTY_ENVELOPE: DeploymentEnvelope = {
  ...FITTING_ENVELOPE,
  boundary: { contracts: [], surfaces: [], capabilities: [], resources: [] },
};

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
  envelope?: DeploymentEnvelope;
  activation?: "activated" | "revoked" | null;
}) {
  const contractRecord = makeContractRecord();
  const contracts = createTestContracts();
  contracts.addKnownTestContract({
    digest: "digest-a",
    contract: DEVICE_CONTRACT,
  });
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
    contracts,
    deploymentEnvelopeStorage: {
      get: async () => args.envelope ?? FITTING_ENVELOPE,
    },
  };
}

Deno.test("resolveDeviceRuntimeGrant allows registered device runtime authority when envelope fits", async () => {
  const deps = makeGrantDeps({ activation: null });
  const result = await __testing__.resolveDeviceRuntimeGrant(
    deps,
    PUBLIC_IDENTITY_KEY,
    deps.contractStorage,
    "digest-a",
    deps.contracts,
  );

  assert(result.ok);
  assertEquals(result.value.authority, "admin_reviewed");
  assertEquals(result.value.activation, null);
  assertEquals(result.value.instance.instanceId, INSTANCE_ID);
});

Deno.test("resolveDeviceRuntimeGrant uses envelope fit instead of legacy policies", async () => {
  const deps = makeGrantDeps({
    activation: null,
  });
  const result = await __testing__.resolveDeviceRuntimeGrant(
    deps,
    PUBLIC_IDENTITY_KEY,
    deps.contractStorage,
    "digest-a",
    deps.contracts,
  );

  assert(result.ok);
  assertEquals(result.value.authority, "admin_reviewed");
  assertEquals(result.value.activation, null);
  assertEquals(result.value.instance.instanceId, INSTANCE_ID);
});

Deno.test("resolveDeviceRuntimeGrant keeps activated devices user delegated", async () => {
  const deps = makeGrantDeps({ activation: "activated" });
  const result = await __testing__.resolveDeviceRuntimeGrant(
    deps,
    PUBLIC_IDENTITY_KEY,
    deps.contractStorage,
    "digest-a",
    deps.contracts,
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
    deps.contracts,
  );

  assertEquals(result, { ok: false, denial: "device_activation_revoked" });
});

Deno.test("resolveDeviceRuntimeGrant denies pre-activation disabled deployment and envelope miss", async () => {
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
      disabled.contracts,
    ),
    { ok: false, denial: "device_deployment_disabled" },
  );

  const disallowed = makeGrantDeps({
    activation: null,
    envelope: EMPTY_ENVELOPE,
  });
  assertEquals(
    await __testing__.resolveDeviceRuntimeGrant(
      disallowed,
      PUBLIC_IDENTITY_KEY,
      disallowed.contractStorage,
      "digest-a",
      disallowed.contracts,
    ),
    { ok: false, denial: "device_envelope_miss" },
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
        deps.contracts,
      ),
      { ok: false, denial: "unknown_device" },
    );
  }
});
