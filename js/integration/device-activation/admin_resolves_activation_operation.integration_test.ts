import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createDeviceActivationFixture } from "./_fixture.ts";

const CASE_ID =
  "device-activation.admin-resolves-activation-operation" as const;
const fixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "device-activation.admin-resolves-activation-operation completes resolve with activated status",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const { admin, deploymentId } = await fixture.setupDeviceDeployment(
      runtime,
    );
    const { identity, provisioned } = await fixture.setupProvisionedDevice(
      admin,
      deploymentId,
    );
    const { flowId } = await fixture.setupActivationRequest(runtime, identity);
    await fixture.setupResolveActivation(
      admin,
      flowId,
      deploymentId,
      provisioned.instance.instanceId,
    );
    assertEquals(provisioned.instance.deploymentId, deploymentId);
  },
});
