import { assertEquals } from "@std/assert";
import { waitForDeviceActivation } from "@qlever-llc/trellis/auth";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createDeviceActivationFixture } from "./_fixture.ts";

const CASE_ID = "device-activation.device-receives-connect-info" as const;
const fixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "device-activation.device-receives-connect-info waits for and receives connect info",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const { admin, deploymentId } = await fixture.setupDeviceDeployment(
      runtime,
    );
    const { identity, provisioned } = await fixture.setupProvisionedDevice(
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
    const activated = await waitForDeviceActivation({
      trellisUrl: runtime.trellisUrl,
      flowId,
      publicIdentityKey: identity.publicIdentityKey,
      nonce,
      identitySeed: identity.identitySeed,
      contractDigest: fixture.deviceContract.CONTRACT_DIGEST,
      pollIntervalMs: 25,
    });
    assertEquals(activated.status, "activated");
    assertEquals(activated.connectInfo.deploymentId, deploymentId);
    assertEquals(
      activated.connectInfo.contractDigest,
      fixture.deviceContract.CONTRACT_DIGEST,
    );
  },
});
