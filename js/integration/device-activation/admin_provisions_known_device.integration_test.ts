import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createDeviceActivationFixture } from "./_fixture.ts";

const CASE_ID = "device-activation.admin-provisions-known-device" as const;
const fixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "device-activation.admin-provisions-known-device creates deployment and provisions device",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const { admin, deploymentId } = await fixture.setupDeviceDeployment(
      runtime,
    );
    const { identity, provisioned } = await fixture.setupProvisionedDevice(
      admin,
      deploymentId,
    );
    assertEquals(provisioned.instance.deploymentId, deploymentId);
    assertEquals(
      provisioned.instance.publicIdentityKey,
      identity.publicIdentityKey,
    );
  },
});
