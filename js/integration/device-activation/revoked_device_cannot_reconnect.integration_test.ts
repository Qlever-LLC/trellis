import { assert, assertEquals } from "@std/assert";
import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import { waitForDeviceActivation } from "@qlever-llc/trellis/auth";
import { waitFor } from "@qlever-llc/trellis-test";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  createDeviceActivationFixture,
  requireDeviceAuthorityList,
} from "./_fixture.ts";

const CASE_ID = "device-activation.revoked-device-cannot-reconnect" as const;
const fixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "device-activation.revoked-device-cannot-reconnect revokes activation and denies device reuse",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const { admin, deploymentId } = await fixture.setupDeviceDeployment(
      runtime,
    );
    const { identity, rootSecret, provisioned } = await fixture
      .setupProvisionedDevice(
        admin,
        deploymentId,
      );
    const { nonce, flowId } = await fixture.setupActivationRequest(
      runtime,
      identity,
    );
    await fixture.setupResolveActivation(
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
      contractDigest: fixture.deviceContract.CONTRACT_DIGEST,
      pollIntervalMs: 25,
    });

    const device = await TrellisDevice.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.deviceContract,
      rootSecret,
      log: false,
    }).orThrow();
    try {
      const me = await device.request("Auth.Sessions.Me", {}).orThrow();
      assertEquals(me.participantKind, "device");
      assertEquals(me.device?.deploymentId, deploymentId);
      assertEquals(me.device?.runtimePublicKey, identity.publicIdentityKey);

      const revoked = await admin.rpc.auth.deviceUserAuthoritiesRevoke({
        instanceId: provisioned.instance.instanceId,
      }).orThrow();
      assertEquals(revoked.success, true);

      await waitFor(async () => {
        const activations = requireDeviceAuthorityList(
          await admin.rpc.auth.deviceUserAuthoritiesList({
            deploymentId,
            instanceId: provisioned.instance.instanceId,
            state: "revoked",
            limit: 20,
          }).orThrow(),
        );
        return activations.entries.some((entry) =>
          entry.instanceId === provisioned.instance.instanceId &&
          entry.publicIdentityKey === identity.publicIdentityKey &&
          entry.deploymentId === deploymentId &&
          entry.state === "revoked"
        );
      });

      await waitFor(async () => {
        const result = await device.request("Auth.Sessions.Me", {});
        return result.isErr();
      });
    } finally {
      await device.connection.close().catch(() => undefined);
    }

    const reconnect = await TrellisDevice.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.deviceContract,
      rootSecret,
      log: false,
    });
    const reconnectValue = reconnect.take();
    if (!isErr(reconnectValue)) {
      await reconnectValue.connection.close();
    }
    assert(isErr(reconnectValue), "revoked device should not reconnect");
  },
});
