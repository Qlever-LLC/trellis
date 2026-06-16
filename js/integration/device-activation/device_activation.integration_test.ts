import { assert, assertEquals } from "@std/assert";
import {
  type ConnectedTrellisClient,
  defineAppContract,
  defineDeviceContract,
  TrellisDevice,
} from "@qlever-llc/trellis";
import {
  buildDeviceActivationPayload,
  deriveDeviceIdentity,
  startDeviceActivationRequest,
  waitForDeviceActivation,
} from "@qlever-llc/trellis/auth";
import { assertOperationCompleted } from "@qlever-llc/trellis-test";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import type { AuthDeviceUserAuthoritiesListOutput } from "@qlever-llc/trellis/sdk/auth";
import type { TrellisTestRuntime } from "@qlever-llc/trellis-test";
import { withTrellisRuntime } from "../_support/runtime.ts";

const deviceActivationAdminContract = defineAppContract(() => ({
  id: "trellis.integration.device-activation-admin@v1",
  displayName: "Trellis Integration Device Activation Admin",
  description:
    "Admin participant for the device activation integration fixture.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.DeploymentAuthority.AcceptMigration",
            "Auth.DeploymentAuthority.AcceptUpdate",
            "Auth.DeploymentAuthority.Get",
            "Auth.DeploymentAuthority.Plan",
            "Auth.DeploymentAuthority.Reconcile",
            "Auth.Devices.Provision",
            "Auth.DeviceUserAuthorities.List",
            "Auth.Sessions.Me",
          ],
        },
        operations: { call: ["Auth.DeviceUserAuthorities.Resolve"] },
      }),
    },
  },
}));

const deviceActivationDeviceContract = defineDeviceContract(() => ({
  id: "trellis.integration.device-activation-device@v1",
  displayName: "Trellis Integration Activated Device",
  description:
    "Activated device participant for the device activation integration fixture.",
}));

type DeviceActivationAdmin = ConnectedTrellisClient<
  typeof deviceActivationAdminContract
>;

async function setupDeviceDeployment(runtime: TrellisTestRuntime) {
  const admin = await runtime.connectClient({
    name: "device-activation-fixture-admin",
    contract: deviceActivationAdminContract,
  });
  const deploymentId = `device-activation-${crypto.randomUUID()}`;

  await admin.rpc.auth.deploymentsCreate({
    deploymentId,
    kind: "device",
    reviewMode: "none",
  }).orThrow();
  await approveDeviceContract(admin, deploymentId);

  return { admin, deploymentId };
}

async function setupProvisionedDevice(
  admin: DeviceActivationAdmin,
  deploymentId: string,
) {
  const rootSecret = crypto.getRandomValues(new Uint8Array(32));
  const identity = await deriveDeviceIdentity(rootSecret);
  const provisioned = await admin.rpc.auth.devicesProvision({
    deploymentId,
    publicIdentityKey: identity.publicIdentityKey,
    activationKey: identity.activationKeyBase64url,
    metadata: { name: "Integration Activated Device" },
  }).orThrow();
  assertEquals(provisioned.instance.deploymentId, deploymentId);
  assertEquals(
    provisioned.instance.publicIdentityKey,
    identity.publicIdentityKey,
  );

  return { rootSecret, identity, provisioned };
}

async function setupActivationRequest(
  runtime: TrellisTestRuntime,
  identity: Awaited<ReturnType<typeof deriveDeviceIdentity>>,
) {
  const nonce = crypto.randomUUID();
  const payload = await buildDeviceActivationPayload({
    activationKey: identity.activationKey,
    publicIdentityKey: identity.publicIdentityKey,
    nonce,
  });
  const activation = await startDeviceActivationRequest({
    trellisUrl: runtime.trellisUrl,
    payload,
  });
  const flowId = new URL(activation.activationUrl, runtime.trellisUrl)
    .searchParams.get("flowId");
  assert(flowId !== null, "activation URL should contain a flowId");

  return { nonce, payload, activation, flowId: flowId! };
}

async function setupResolveActivation(
  admin: DeviceActivationAdmin,
  flowId: string,
  deploymentId: string,
  instanceId: string,
) {
  const activationRef = await admin.operation.auth
    .deviceUserAuthoritiesResolve
    .input({ flowId })
    .start()
    .orThrow();
  return await assertOperationCompleted(activationRef, {
    status: "activated",
    deploymentId,
    instanceId,
  });
}

Deno.test(
  "device-activation.admin-provisions-known-device creates deployment and provisions device",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const { admin, deploymentId } = await setupDeviceDeployment(runtime);
      const { identity, provisioned } = await setupProvisionedDevice(
        admin,
        deploymentId,
      );
      assertEquals(provisioned.instance.deploymentId, deploymentId);
      assertEquals(
        provisioned.instance.publicIdentityKey,
        identity.publicIdentityKey,
      );
    });
  },
);

Deno.test(
  "device-activation.device-starts-activation-request builds payload and receives flow URL",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const { admin, deploymentId } = await setupDeviceDeployment(runtime);
      const { identity } = await setupProvisionedDevice(admin, deploymentId);
      const { activation, flowId } = await setupActivationRequest(
        runtime,
        identity,
      );
      assert(
        activation.activationUrl.length > 0,
        "activation URL should be present",
      );
      assert(flowId.length > 0, "flowId should be present");
    });
  },
);

Deno.test(
  "device-activation.admin-resolves-activation-operation completes resolve with activated status",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const { admin, deploymentId } = await setupDeviceDeployment(runtime);
      const { identity, provisioned } = await setupProvisionedDevice(
        admin,
        deploymentId,
      );
      const { flowId } = await setupActivationRequest(runtime, identity);
      const terminal = await setupResolveActivation(
        admin,
        flowId,
        deploymentId,
        provisioned.instance.instanceId,
      );
      if (terminal.output === undefined) {
        throw new Error("device activation resolve completed without output");
      }
      assertEquals(terminal.output.status, "activated");
    });
  },
);

Deno.test(
  "device-activation.device-receives-connect-info waits for and receives connect info",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const { admin, deploymentId } = await setupDeviceDeployment(runtime);
      const { identity, provisioned } = await setupProvisionedDevice(
        admin,
        deploymentId,
      );
      const { nonce, flowId } = await setupActivationRequest(runtime, identity);
      await setupResolveActivation(
        admin,
        flowId,
        deploymentId,
        provisioned.instance.instanceId,
      );
      const activated = await waitForDeviceActivation({
        trellisUrl: runtime.trellisUrl,
        flowId,
        publicIdentityKey: identity.publicIdentityKey,
        nonce,
        identitySeed: identity.identitySeed,
        contractDigest: deviceActivationDeviceContract.CONTRACT_DIGEST,
        pollIntervalMs: 25,
      });
      assertEquals(activated.status, "activated");
      assertEquals(activated.connectInfo.deploymentId, deploymentId);
      assertEquals(
        activated.connectInfo.contractDigest,
        deviceActivationDeviceContract.CONTRACT_DIGEST,
      );
    });
  },
);

Deno.test(
  "device-activation.activated-device-connects-and-authenticates connects and authenticates as device",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const { admin, deploymentId } = await setupDeviceDeployment(runtime);
      const { identity, rootSecret, provisioned } =
        await setupProvisionedDevice(admin, deploymentId);
      const { nonce, flowId } = await setupActivationRequest(runtime, identity);
      await setupResolveActivation(
        admin,
        flowId,
        deploymentId,
        provisioned.instance.instanceId,
      );
      await waitForDeviceActivation({
        trellisUrl: runtime.trellisUrl,
        flowId,
        publicIdentityKey: identity.publicIdentityKey,
        nonce,
        identitySeed: identity.identitySeed,
        contractDigest: deviceActivationDeviceContract.CONTRACT_DIGEST,
        pollIntervalMs: 25,
      });

      const device = await TrellisDevice.connect({
        trellisUrl: runtime.trellisUrl,
        contract: deviceActivationDeviceContract,
        rootSecret,
        log: false,
      }).orThrow();
      try {
        const me = await device.request("Auth.Sessions.Me", {}).orThrow();
        assertEquals(me.participantKind, "device");
        assertEquals(me.device?.deploymentId, deploymentId);
        assertEquals(
          me.device?.runtimePublicKey,
          identity.publicIdentityKey,
        );
      } finally {
        await device.connection.close();
      }
    });
  },
);

Deno.test(
  "device-activation.activated-device-authority-is-listed appears in authority list",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const { admin, deploymentId } = await setupDeviceDeployment(runtime);
      const { identity, rootSecret, provisioned } =
        await setupProvisionedDevice(admin, deploymentId);
      const { nonce, flowId } = await setupActivationRequest(runtime, identity);
      await setupResolveActivation(
        admin,
        flowId,
        deploymentId,
        provisioned.instance.instanceId,
      );
      await waitForDeviceActivation({
        trellisUrl: runtime.trellisUrl,
        flowId,
        publicIdentityKey: identity.publicIdentityKey,
        nonce,
        identitySeed: identity.identitySeed,
        contractDigest: deviceActivationDeviceContract.CONTRACT_DIGEST,
        pollIntervalMs: 25,
      });

      const device = await TrellisDevice.connect({
        trellisUrl: runtime.trellisUrl,
        contract: deviceActivationDeviceContract,
        rootSecret,
        log: false,
      }).orThrow();
      try {
        const me = await device.request("Auth.Sessions.Me", {}).orThrow();
        assertEquals(me.participantKind, "device");
      } finally {
        await device.connection.close();
      }

      const activations = await admin.rpc.auth.deviceUserAuthoritiesList({
        deploymentId,
        instanceId: provisioned.instance.instanceId,
        state: "activated",
        limit: 20,
      }).orThrow();
      assert(
        activations.entries.some((
          entry: AuthDeviceUserAuthoritiesListOutput["entries"][number],
        ) =>
          entry.instanceId === provisioned.instance.instanceId &&
          entry.publicIdentityKey === identity.publicIdentityKey &&
          entry.deploymentId === deploymentId &&
          entry.state === "activated"
        ),
        "activated device should be listed by Auth.DeviceUserAuthorities.List",
      );
    });
  },
);

async function approveDeviceContract(
  admin: DeviceActivationAdmin,
  deploymentId: string,
): Promise<void> {
  const planned = await admin.rpc.auth.deploymentAuthorityPlan({
    deploymentId,
    contract: deviceActivationDeviceContract.CONTRACT,
    expectedDigest: deviceActivationDeviceContract.CONTRACT_DIGEST,
  }).orThrow();

  if (planned.plan.classification === "update") {
    await admin.rpc.auth.deploymentAuthorityAcceptUpdate({
      planId: planned.plan.planId,
    }).orThrow();
  } else {
    await admin.rpc.auth.deploymentAuthorityAcceptMigration({
      planId: planned.plan.planId,
      acknowledgement:
        "Approved by isolated device activation integration test.",
    }).orThrow();
  }

  await admin.rpc.auth.deploymentAuthorityReconcile({ deploymentId }).orThrow();
  await waitForDeviceDeploymentAuthority(admin, deploymentId);
}

async function waitForDeviceDeploymentAuthority(
  admin: DeviceActivationAdmin,
  deploymentId: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await admin.rpc.auth.deploymentAuthorityGet({
      deploymentId,
    })
      .orThrow();
    const materialized = current.materializedAuthority;
    if (materialized?.status === "failed") {
      throw new Error(
        `device deployment authority reconciliation failed: ${
          materialized.error ?? "unknown error"
        }`,
      );
    }
    if (
      materialized?.status === "current" &&
      materialized.desiredVersion === current.authority.version &&
      materialized.reconciledAt !== null
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `device deployment authority did not become ready for ${deploymentId}`,
  );
}
