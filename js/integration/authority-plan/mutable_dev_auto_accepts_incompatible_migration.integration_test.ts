import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthorityPlanFixture } from "./_fixture.ts";

const CASE_ID =
  "authority-plan.mutable-dev-auto-accepts-incompatible-migration" as const;
const fixture = createAuthorityPlanFixture(CASE_ID);

liveTrellisTest({
  name:
    "authority-plan.mutable-dev-auto-accepts-incompatible-migration auto-accepts migration in mutable dev",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.deployments.create({
      id: fixture.mutableDeployment,
      mutableDev: true,
    });
    const baseKey = await runtime.services.createInstance({
      deployment: fixture.mutableDeployment,
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
        "mutable-before",
      );
      assertEquals(before, { message: "mutable-before", variant: "base" });
      await baseService.stop();
      baseService = undefined;

      const replacementKey = await runtime.services.provisionInstanceOnly({
        deployment: fixture.mutableDeployment,
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
      const accepted = await fixture.findAcceptedPlan(runtime, {
        deploymentId: fixture.mutableDeployment,
        classification: "migration",
        contractDigest: fixture.incompatibleSchemaContract.CONTRACT_DIGEST,
      });
      assertEquals(accepted.state, "accepted");
      await runtime.deployments.waitReady(fixture.mutableDeployment);

      replacementService = await connectPromise;
      await replacementService.handle.rpc.plan.ping(({ input }) =>
        Result.ok({
          count: fixture.pingCount(input),
          variant: "mutable-incompatible",
        })
      );

      const client = await runtime.connectClient({
        name: fixture.incompatibleClientName,
        contract: fixture.incompatibleClientContract,
      });
      const result = await client.rpc.plan.ping({ count: 11 }).orThrow();
      assertEquals(result, { count: 11, variant: "mutable-incompatible" });
    } finally {
      await replacementService?.stop();
      await baseService?.stop();
    }
  },
});
