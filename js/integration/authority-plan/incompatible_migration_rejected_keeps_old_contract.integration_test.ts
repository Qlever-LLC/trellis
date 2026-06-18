import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthorityPlanFixture } from "./_fixture.ts";

const CASE_ID =
  "authority-plan.incompatible-migration-rejected-keeps-old-contract" as const;
const fixture = createAuthorityPlanFixture(CASE_ID);

liveTrellisTest({
  name:
    "authority-plan.incompatible-migration-rejected-keeps-old-contract rejects migration and keeps old contract usable",
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
    const baseService = await fixture.connectService({
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
        "before-reject",
      );
      assertEquals(before, { message: "before-reject", variant: "base" });

      const replacementKey = await runtime.services.provisionInstanceOnly({
        deployment: fixture.strictDeployment,
      });
      const connectPromise = fixture.connectServicePending({
        runtime,
        contract: fixture.incompatibleSchemaContract,
        name: fixture.replacementServiceName,
        seed: replacementKey.seed,
      }).then((connected) => {
        replacementService = connected;
        return connected;
      });
      connectPromise.catch(() => undefined);
      const plan = await fixture.waitForPendingPlan(runtime, {
        deploymentId: fixture.strictDeployment,
        classification: "migration",
        contractDigest: fixture.incompatibleSchemaContract.CONTRACT_DIGEST,
      });
      const rejected = await fixture.rejectPlan(runtime, plan);
      assertEquals(rejected.state, "rejected");
      await fixture.expectPromisePending(
        connectPromise,
        "rejected replacement service connect resolved",
      );

      const after = await fixture.connectClientAndPing(runtime, "after-reject");
      assertEquals(after, { message: "after-reject", variant: "base" });
    } finally {
      await replacementService?.stop();
      await baseService.stop();
    }
  },
});
