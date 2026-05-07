import { assert, assertEquals } from "@std/assert";

import type { ContractRecord } from "../../catalog/schemas.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import { __testing__ } from "./callout.ts";

const PUBLIC_IDENTITY_KEY = "A".repeat(43);
const INSTANCE_ID = deviceInstanceId(PUBLIC_IDENTITY_KEY);

function makeContractRecord(
  overrides: Partial<ContractRecord> = {},
): ContractRecord {
  return {
    digest: "digest-a",
    id: "example.device@v1",
    displayName: "Example Device",
    description: "Example device contract",
    installedAt: new Date("2026-01-01T00:00:00.000Z"),
    contract: JSON.stringify({
      id: "example.device@v1",
      displayName: "Example Device",
      description: "Example device contract",
      namespaces: ["example"],
    }),
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
  preActivationPolicy?: "reject" | "device-owned";
  instanceState?: "registered" | "activated" | "revoked" | "disabled";
  instanceDeploymentId?: string;
  activationDeploymentId?: string;
  deploymentDisabled?: boolean;
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
        const firstConnectPolicy: "reject" = "reject";
        const compatibilityPolicy: "exact" = "exact";
        const deployment = {
          deploymentId: "reader.default",
          firstConnectPolicy,
          preActivationPolicy: args.preActivationPolicy ?? "reject",
          disabled: args.deploymentDisabled ?? false,
          appliedContracts: [{
            contractId: "example.device@v1",
            compatibilityPolicy,
            allowedDigests: ["digest-a"],
          }],
        };
        return deployment;
      },
    },
    contractStorage: {
      get: async (digest: string) =>
        digest === "digest-a" ? contractRecord : undefined,
    },
  };
}

Deno.test("resolveDeviceRuntimeGrant denies registered devices by default", async () => {
  const deps = makeGrantDeps({ activation: null });
  const result = await __testing__.resolveDeviceRuntimeGrant(
    deps,
    PUBLIC_IDENTITY_KEY,
    deps.contractStorage,
    "digest-a",
  );

  assertEquals(result, { ok: false, denial: "unknown_device" });
});

Deno.test("resolveDeviceRuntimeGrant allows registered device-owned authority only under policy", async () => {
  const deps = makeGrantDeps({
    activation: null,
    preActivationPolicy: "device-owned",
  });
  const result = await __testing__.resolveDeviceRuntimeGrant(
    deps,
    PUBLIC_IDENTITY_KEY,
    deps.contractStorage,
    "digest-a",
  );

  assert(result.ok);
  assertEquals(result.value.authority, "device_owned");
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

Deno.test("resolveDeviceRuntimeGrant denies pre-activation disabled deployment and disallowed digest", async () => {
  const disabled = makeGrantDeps({
    activation: null,
    preActivationPolicy: "device-owned",
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
    preActivationPolicy: "device-owned",
  });
  assertEquals(
    await __testing__.resolveDeviceRuntimeGrant(
      disallowed,
      PUBLIC_IDENTITY_KEY,
      disallowed.contractStorage,
      "digest-b",
    ),
    { ok: false, denial: "device_digest_not_allowed" },
  );
});

Deno.test("resolveDeviceRuntimeGrant denies pre-activation disabled and revoked devices", async () => {
  for (const instanceState of ["disabled", "revoked"] as const) {
    const deps = makeGrantDeps({
      activation: null,
      preActivationPolicy: "device-owned",
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
