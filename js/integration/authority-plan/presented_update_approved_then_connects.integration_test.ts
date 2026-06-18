import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthorityPlanFixture } from "./_fixture.ts";

const CASE_ID =
  "authority-plan.presented-update-approved-then-connects" as const;
const fixture = createAuthorityPlanFixture(CASE_ID);

liveTrellisTest({
  name:
    "authority-plan.presented-update-approved-then-connects accepts update and unblocks service",
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
      const plan = await fixture.waitForPendingPlan(runtime, {
        deploymentId: fixture.strictDeployment,
        classification: "update",
        contractDigest: fixture.compatibleAdditiveContract.CONTRACT_DIGEST,
      });
      await fixture.acceptPlan(runtime, plan);

      await runtime.deployments.waitReady(fixture.strictDeployment);

      const connectedService = await connectPromise;
      const accepted = await fixture.findAcceptedPlan(runtime, {
        deploymentId: fixture.strictDeployment,
        classification: "update",
        contractDigest: fixture.compatibleAdditiveContract.CONTRACT_DIGEST,
      });
      assertEquals(accepted.planId, plan.planId);

      await connectedService.handle.rpc.plan.addedPing(({ input }) =>
        Result.ok({
          message: fixture.pingMessage(input),
          variant: "additive",
          added: true,
        })
      );

      const client = await runtime.connectClient({
        name: fixture.additiveClientName,
        contract: fixture.additiveClientContract,
      });
      const result = await client.rpc.plan.addedPing({ message: "approved" })
        .orThrow();
      assertEquals(result, {
        message: "approved",
        variant: "additive",
        added: true,
      });
    } finally {
      await service?.stop();
    }
  },
});
