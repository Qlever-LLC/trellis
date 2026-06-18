import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthorityPlanFixture } from "./_fixture.ts";

const CASE_ID =
  "authority-plan.mutable-dev-rejected-explicit-update-still-blocks" as const;
const fixture = createAuthorityPlanFixture(CASE_ID);

liveTrellisTest({
  name:
    "authority-plan.mutable-dev-rejected-explicit-update-still-blocks keeps rejected update blocked in mutable dev",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.deployments.create({
      id: fixture.mutableDeployment,
      mutableDev: true,
    });
    await runtime.contracts.approve({
      deployment: fixture.mutableDeployment,
      contract: fixture.baseContract,
      allowPlanClassifications: ["update"],
    });
    const serviceKey = await runtime.services.provisionInstanceOnly({
      deployment: fixture.mutableDeployment,
    });

    let service:
      | Awaited<ReturnType<typeof fixture.connectService>>
      | undefined;
    const connectPromise = fixture.connectServicePending({
      runtime,
      contract: fixture.compatibleAdditiveContract,
      name: fixture.additiveServiceName,
      seed: serviceKey.seed,
    }).then((connected) => {
      service = connected;
      return connected;
    });
    connectPromise.catch(() => undefined);

    try {
      const plan = await fixture.waitForPendingPlan(runtime, {
        deploymentId: fixture.mutableDeployment,
        classification: "update",
        contractDigest: fixture.compatibleAdditiveContract.CONTRACT_DIGEST,
      });
      assertEquals(plan.classification, "update");
      const rejected = await fixture.rejectPlan(runtime, plan);
      assertEquals(rejected.state, "rejected");
      await fixture.expectPromisePending(
        connectPromise,
        "mutable-dev rejected update service connect resolved",
      );
    } finally {
      await service?.stop();
    }
  },
});
