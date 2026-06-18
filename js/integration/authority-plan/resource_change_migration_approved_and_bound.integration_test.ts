import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthorityPlanFixture } from "./_fixture.ts";

const CASE_ID =
  "authority-plan.resource-change-migration-approved-and-bound" as const;
const fixture = createAuthorityPlanFixture(CASE_ID);

liveTrellisTest({
  name:
    "authority-plan.resource-change-migration-approved-and-bound accepts resource migration and binds resource",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.deployments.create({
      id: fixture.strictDeployment,
      mutableDev: false,
    });
    const baseKey = await runtime.services.createInstance({
      deployment: fixture.strictDeployment,
      name: fixture.resourceServiceName,
      contract: fixture.resourceBaseContract,
    });
    let baseService:
      | Awaited<ReturnType<typeof fixture.connectService>>
      | undefined = await fixture.connectService({
        runtime,
        contract: fixture.resourceBaseContract,
        name: fixture.resourceServiceName,
        seed: baseKey.seed,
      });
    let changedService:
      | Awaited<ReturnType<typeof fixture.connectService>>
      | undefined;

    try {
      assertEquals(typeof baseService.kv.records, "object");
      await baseService.stop();
      baseService = undefined;

      const changedKey = await runtime.services.provisionInstanceOnly({
        deployment: fixture.strictDeployment,
      });
      const connectPromise = fixture.connectServicePending({
        runtime,
        contract: fixture.resourceChangedContract,
        name: fixture.resourceServiceName,
        seed: changedKey.seed,
      }).then((connected) => {
        changedService = connected;
        return connected;
      });
      connectPromise.catch(() => undefined);
      const plan = await fixture.waitForPendingPlan(runtime, {
        deploymentId: fixture.strictDeployment,
        classification: "migration",
        contractDigest: fixture.resourceChangedContract.CONTRACT_DIGEST,
      });
      await fixture.acceptPlan(runtime, plan);
      await runtime.deployments.waitReady(fixture.strictDeployment);

      changedService = await connectPromise;
      assertEquals(typeof changedService.kv.records, "object");
      await changedService.handle.rpc.plan.resourcePing(
        async ({ input, client }) => {
          const resourceInput = fixture.resourceInput(input);
          await client.kv.records.create(resourceInput.key, {
            message: resourceInput.message,
          })
            .orThrow();
          await client.kv.records.put(resourceInput.key, {
            message: `bound:${resourceInput.message}`,
          }).orThrow();
          const entry = await client.kv.records.get(resourceInput.key)
            .orThrow();
          await entry.delete(true).orThrow();
          return Result.ok({
            key: resourceInput.key,
            message: fixture.resourceRecordMessage(entry.value),
            history: 2,
          });
        },
      );

      const client = await runtime.connectClient({
        name: fixture.resourceClientName,
        contract: fixture.resourceClientContract,
      });
      const result = await client.rpc.plan.resourcePing({
        key: fixture.resourceKey,
        message: "resource",
      }).orThrow();
      assertEquals(result, {
        key: fixture.resourceKey,
        message: "bound:resource",
        history: 2,
      });
    } finally {
      await changedService?.stop();
      await baseService?.stop();
    }
  },
});
