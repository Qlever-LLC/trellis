import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createServiceApprovalFixture } from "./_fixture.ts";

const CASE_ID = "service-approval.approved-service-handles-client-rpc" as const;
const fixture = createServiceApprovalFixture(CASE_ID);

liveTrellisTest({
  name:
    "service-approval.approved-service-handles-client-rpc handles a client RPC after approval",
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
      await connectedService.handle.rpc.startup.ping(({ input }) =>
        Result.ok({ message: input.message, approved: true })
      );

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const result = await client.rpc.startup.ping({
        message: fixture.pingMessage,
      }).orThrow();
      assertEquals(result, { message: fixture.pingMessage, approved: true });
    } finally {
      await service?.stop();
    }
  },
});
