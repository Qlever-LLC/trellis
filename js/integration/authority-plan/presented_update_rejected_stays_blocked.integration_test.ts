import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthorityPlanFixture } from "./_fixture.ts";

const CASE_ID =
  "authority-plan.presented-update-rejected-stays-blocked" as const;
const fixture = createAuthorityPlanFixture(CASE_ID);

liveTrellisTest({
  name:
    "authority-plan.presented-update-rejected-stays-blocked rejects update and preserves old authority",
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
    const additiveKey = await runtime.services.provisionInstanceOnly({
      deployment: fixture.strictDeployment,
    });

    let additiveService:
      | Awaited<ReturnType<typeof fixture.connectService>>
      | undefined;
    let baseService:
      | Awaited<ReturnType<typeof fixture.connectService>>
      | undefined;
    const connectPromise = fixture.connectServicePending({
      runtime,
      contract: fixture.compatibleAdditiveContract,
      name: fixture.additiveServiceName,
      seed: additiveKey.seed,
    }).then((connected) => {
      additiveService = connected;
      return connected;
    });
    connectPromise.catch(() => undefined);

    try {
      const plan = await fixture.waitForPendingPlan(runtime, {
        deploymentId: fixture.strictDeployment,
        classification: "update",
        contractDigest: fixture.compatibleAdditiveContract.CONTRACT_DIGEST,
      });
      const rejected = await fixture.rejectPlan(
        runtime,
        plan,
        "integration rejection",
      );
      assertEquals(rejected.state, "rejected");
      assertEquals(rejected.decisionReason, "integration rejection");
      await fixture.expectPromisePending(
        connectPromise,
        "rejected additive service connect resolved",
      );

      const baseKey = await runtime.services.provisionInstanceOnly({
        deployment: fixture.strictDeployment,
      });
      baseService = await fixture.connectService({
        runtime,
        contract: fixture.baseContract,
        name: fixture.baseServiceName,
        seed: baseKey.seed,
      });
      await baseService.handle.rpc.plan.ping(({ input }) =>
        Result.ok({ message: fixture.pingMessage(input), variant: "base" })
      );
      const result = await fixture.connectClientAndPing(
        runtime,
        "old-authority",
      );
      assertEquals(result, { message: "old-authority", variant: "base" });
    } finally {
      await additiveService?.stop();
      await baseService?.stop();
    }
  },
});
