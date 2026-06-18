import { assert } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createServiceApprovalFixture } from "./_fixture.ts";

const CASE_ID =
  "service-approval.startup-completes-after-authority-approval" as const;
const fixture = createServiceApprovalFixture(CASE_ID);

liveTrellisTest({
  name:
    "service-approval.startup-completes-after-authority-approval connects after authority approval",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.deployments.create({ id: fixture.deploymentId });
    const { seed } = await fixture.provisionServiceInstance(runtime);
    let service: Awaited<ReturnType<typeof fixture.connectService>> | undefined;
    const connectPromise = fixture.connectService(runtime, seed).then(
      (connected) => {
        service = connected;
        return connected;
      },
    );

    await fixture.expectPromisePending(
      connectPromise,
      "service startup resolved before deployment authority approval",
    );

    await runtime.contracts.approve({
      deployment: fixture.deploymentId,
      contract: fixture.serviceContract,
      allowPlanClassifications: ["update", "migration"],
    });

    const connectedService = await connectPromise;
    try {
      assert(connectedService !== undefined, "service should be connected");
    } finally {
      await service?.stop();
    }
  },
});
