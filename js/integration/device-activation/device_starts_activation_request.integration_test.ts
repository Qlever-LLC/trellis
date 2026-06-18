import { assert } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createDeviceActivationFixture } from "./_fixture.ts";

const CASE_ID = "device-activation.device-starts-activation-request" as const;
const fixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "device-activation.device-starts-activation-request builds payload and receives flow URL",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const { admin, deploymentId } = await fixture.setupDeviceDeployment(
      runtime,
    );
    const { identity } = await fixture.setupProvisionedDevice(
      admin,
      deploymentId,
    );
    const { activation, flowId } = await fixture.setupActivationRequest(
      runtime,
      identity,
    );
    assert(
      activation.activationUrl.length > 0,
      "activation URL should be present",
    );
    assert(flowId.length > 0, "flowId should be present");
  },
});
