import { assert, assertEquals } from "@std/assert";
import { TrellisDevice } from "@qlever-llc/trellis";
import { waitForDeviceActivation } from "@qlever-llc/trellis/auth";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createDeviceActivationFixture } from "../device-activation/_fixture.ts";

const CASE_ID = "auth.sessions-me-reports-device-envelope" as const;
const fixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "auth.sessions-me-reports-device-envelope reports the activated device envelope",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const { admin, deploymentId } = await fixture.setupDeviceDeployment(
      runtime,
    );
    const { identity, rootSecret, provisioned } = await fixture
      .setupProvisionedDevice(admin, deploymentId);
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
      assert(me.user !== null, "expected activated device to include user");
      assertEquals(me.device?.deploymentId, deploymentId);
      assertEquals(me.device?.runtimePublicKey, identity.publicIdentityKey);
      assertEquals(me.device?.active, true);
      assertEquals(me.service, null);
    } finally {
      await device.connection.close().catch(() => undefined);
      await admin.connection.close().catch(() => undefined);
    }
  },
});
