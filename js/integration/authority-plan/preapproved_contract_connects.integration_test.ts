import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthorityPlanFixture } from "./_fixture.ts";

const CASE_ID = "authority-plan.preapproved-contract-connects" as const;
const fixture = createAuthorityPlanFixture(CASE_ID);

liveTrellisTest({
  name:
    "authority-plan.preapproved-contract-connects connects pre-approved contract without pending plan",
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

    const serviceKey = await runtime.services.createInstance({
      deployment: fixture.strictDeployment,
      name: fixture.baseServiceName,
      contract: fixture.baseContract,
    });
    const service = await fixture.connectService({
      runtime,
      contract: fixture.baseContract,
      name: fixture.baseServiceName,
      seed: serviceKey.seed,
    });

    try {
      await service.handle.rpc.plan.ping(({ input }) =>
        Result.ok({ message: fixture.pingMessage(input), variant: "base" })
      );

      const result = await fixture.connectClientAndPing(runtime, "preapproved");
      assertEquals(result, { message: "preapproved", variant: "base" });

      const pending = await fixture.listPlans(runtime, {
        deploymentId: fixture.strictDeployment,
        state: "pending",
      });
      assertEquals(pending, []);
    } finally {
      await service.stop();
    }
  },
});
