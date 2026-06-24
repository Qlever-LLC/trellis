import { assert, assertEquals, assertRejects } from "@std/assert";
import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import { waitForDeviceActivation } from "@qlever-llc/trellis/auth";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createDeviceActivationFixture } from "./_fixture.ts";

const CASE_ID = "device-activation.review-reject-denies-connect" as const;
const fixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "device-activation.review-reject-denies-connect rejects review and denies device connect",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const rejectionReason = "integration review rejected";
    const { admin, deploymentId } = await fixture.setupDeviceDeployment(
      runtime,
      { reviewMode: "required" },
    );
    const { identity, rootSecret, provisioned } = await fixture
      .setupProvisionedDevice(
        admin,
        deploymentId,
      );
    const { nonce, flowId } = await fixture.setupActivationRequest(
      runtime,
      identity,
    );

    const activationRef = await admin.operation.auth
      .deviceUserAuthoritiesResolve
      .input({ flowId })
      .start()
      .orThrow();

    const review = await runtime.waitFor(async () => {
      const reviews = await admin.rpc.auth.deviceUserAuthoritiesReviewsList({
        deploymentId,
        instanceId: provisioned.instance.instanceId,
        state: "pending",
        limit: 20,
      }).orThrow();
      return reviews.entries.find((entry) =>
        entry.deploymentId === deploymentId &&
        entry.instanceId === provisioned.instance.instanceId &&
        entry.publicIdentityKey === identity.publicIdentityKey
      );
    }, { timeoutMs: 10_000, intervalMs: 25 });

    const decided = await admin.rpc.auth.deviceUserAuthoritiesReviewsDecide({
      reviewId: review.reviewId,
      decision: "reject",
      reason: rejectionReason,
    }).orThrow();
    assertEquals(decided.review.state, "rejected");
    assertEquals(decided.review.reason, rejectionReason);

    const terminal = await activationRef.wait().orThrow();
    assertEquals(terminal.state, "completed");
    assertEquals(terminal.output, {
      status: "rejected",
      reason: rejectionReason,
    });

    await assertRejects(
      () =>
        waitForDeviceActivation({
          trellisUrl: runtime.trellisUrl,
          flowId,
          publicIdentityKey: identity.publicIdentityKey,
          nonce,
          identitySeed: identity.identitySeed,
          contractDigest: fixture.deviceContract.CONTRACT_DIGEST,
          pollIntervalMs: 25,
        }),
      Error,
      `device activation rejected: ${rejectionReason}`,
    );

    const connect = await TrellisDevice.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.deviceContract,
      rootSecret,
      log: false,
    });
    const connectValue = connect.take();
    if (!isErr(connectValue)) {
      await connectValue.connection.close();
    }
    assert(isErr(connectValue), "rejected device should not connect");
  },
});
