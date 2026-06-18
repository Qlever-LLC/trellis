import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createServiceApprovalFixture } from "./_fixture.ts";

const CASE_ID =
  "service-approval.startup-blocks-before-authority-approval" as const;
const fixture = createServiceApprovalFixture(CASE_ID);

liveTrellisTest({
  name:
    "service-approval.startup-blocks-before-authority-approval blocks service startup before approval",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.deployments.create({ id: fixture.deploymentId });
    const { seed } = await fixture.provisionServiceInstance(runtime);
    const connectPromise = fixture.connectServicePending(runtime, seed);

    await fixture.expectPromisePending(
      connectPromise,
      "service startup resolved before deployment authority approval",
    );
  },
});
