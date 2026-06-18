import { assert, assertEquals } from "@std/assert";
import { TrellisDevice } from "@qlever-llc/trellis";
import { waitForDeviceActivation } from "@qlever-llc/trellis/auth";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  createDeviceActivationFixture,
  requireDeviceAuthorityList,
} from "./_fixture.ts";

const CASE_ID =
  "device-activation.activated-device-authority-is-listed" as const;
const fixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "device-activation.activated-device-authority-is-listed appears in authority list",
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
    } finally {
      await device.connection.close();
    }

    const activations = requireDeviceAuthorityList(
      await admin.rpc.auth.deviceUserAuthoritiesList({
        deploymentId,
        instanceId: provisioned.instance.instanceId,
        state: "activated",
        limit: 20,
      }).orThrow(),
    );
    assert(
      activations.entries.some((entry) =>
        entry.instanceId === provisioned.instance.instanceId &&
        entry.publicIdentityKey === identity.publicIdentityKey &&
        entry.deploymentId === deploymentId &&
        entry.state === "activated"
      ),
      "activated device should be listed by Auth.DeviceUserAuthorities.List",
    );
  },
});
