import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthorityPlanFixture } from "./_fixture.ts";

const CASE_ID =
  "authority-plan.presented-update-is-pending-at-connect" as const;
const fixture = createAuthorityPlanFixture(CASE_ID);

liveTrellisTest({
  name:
    "authority-plan.presented-update-is-pending-at-connect creates pending update and blocks connect",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.deployments.create({
      id: fixture.strictDeployment,
      mutableDev: false,
    });
    await runtime.contracts.approve({
      deployment: fixture.strictDeployment,
      contract: fixture.baseContract,
      allowPlanClassifications: ["update"],
    });
    const serviceKey = await runtime.services.provisionInstanceOnly({
      deployment: fixture.strictDeployment,
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
      await fixture.expectPromisePending(
        connectPromise,
        "additive service connect resolved before update approval",
      );
      const plan = await fixture.waitForPendingPlan(runtime, {
        deploymentId: fixture.strictDeployment,
        classification: "update",
        contractDigest: fixture.compatibleAdditiveContract.CONTRACT_DIGEST,
      });

      assertEquals(plan.classification, "update");
      assertEquals(
        plan.proposal.contractId,
        fixture.compatibleAdditiveContract.CONTRACT.id,
      );
      assertEquals(
        plan.proposal.contractDigest,
        fixture.compatibleAdditiveContract.CONTRACT_DIGEST,
      );
      assertEquals(service, undefined);
    } finally {
      await service?.stop();
    }
  },
});
