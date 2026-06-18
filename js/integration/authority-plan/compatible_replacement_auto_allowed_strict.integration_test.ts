import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthorityPlanFixture } from "./_fixture.ts";

const CASE_ID =
  "authority-plan.compatible-replacement-auto-allowed-strict" as const;
const fixture = createAuthorityPlanFixture(CASE_ID);

liveTrellisTest({
  name:
    "authority-plan.compatible-replacement-auto-allowed-strict connects compatible replacement without manual approval",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.deployments.create({
      id: fixture.strictDeployment,
      mutableDev: false,
    });
    const baseKey = await runtime.services.createInstance({
      deployment: fixture.strictDeployment,
      name: fixture.baseServiceName,
      contract: fixture.baseContract,
    });
    let baseService:
      | Awaited<ReturnType<typeof fixture.connectService>>
      | undefined = await fixture.connectService({
        runtime,
        contract: fixture.baseContract,
        name: fixture.baseServiceName,
        seed: baseKey.seed,
      });
    let replacementService:
      | Awaited<ReturnType<typeof fixture.connectService>>
      | undefined;

    try {
      await baseService.handle.rpc.plan.ping(({ input }) =>
        Result.ok({ message: fixture.pingMessage(input), variant: "base" })
      );
      const before = await fixture.connectClientAndPing(
        runtime,
        "metadata-before",
      );
      assertEquals(before, { message: "metadata-before", variant: "base" });
      await baseService.stop();
      baseService = undefined;

      const replacementKey = await runtime.services.provisionInstanceOnly({
        deployment: fixture.strictDeployment,
      });
      replacementService = await fixture.connectService({
        runtime,
        contract: fixture.compatibleMetadataContract,
        name: fixture.replacementServiceName,
        seed: replacementKey.seed,
      });
      await replacementService.handle.rpc.plan.ping(({ input }) =>
        Result.ok({ message: fixture.pingMessage(input), variant: "metadata" })
      );

      const result = await fixture.connectClientAndPing(
        runtime,
        "metadata-after",
      );
      assertEquals(result, { message: "metadata-after", variant: "metadata" });
      const pending = await fixture.listPlans(runtime, {
        deploymentId: fixture.strictDeployment,
        state: "pending",
      });
      assertEquals(pending, []);
    } finally {
      await replacementService?.stop();
      await baseService?.stop();
    }
  },
});
