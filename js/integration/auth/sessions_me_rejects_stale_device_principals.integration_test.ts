import { assert } from "@std/assert";
import { TrellisDevice } from "@qlever-llc/trellis";
import { waitForDeviceActivation } from "@qlever-llc/trellis/auth";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createDeviceActivationFixture } from "../device-activation/_fixture.ts";

type ControlPlaneSqlite = NonNullable<
  LiveTrellisRuntime["controlPlane"]
>["sqlite"];

const CASE_ID = "auth.sessions-me-rejects-stale-device-principals" as const;
const fixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "auth.sessions-me-rejects-stale-device-principals rejects missing and mismatched device state",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = requireControlPlaneSqlite(runtime);
    const { admin, deploymentId } = await fixture.setupDeviceDeployment(
      runtime,
    );
    const { identity, rootSecret, provisioned } = await fixture
      .setupProvisionedDevice(admin, deploymentId);
    const { nonce, flowId } = await fixture.setupActivationRequest(
      runtime,
      identity,
    );
    await fixture.setupResolveActivation(
      admin,
      flowId,
      deploymentId,
      provisioned.instance.instanceId,
    );
    await waitForDeviceActivation({
      trellisUrl: runtime.trellisUrl,
      flowId,
      publicIdentityKey: identity.publicIdentityKey,
      nonce,
      identitySeed: identity.identitySeed,
      contractDigest: fixture.deviceContract.CONTRACT_DIGEST,
      pollIntervalMs: 25,
    });

    const device = await TrellisDevice.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.deviceContract,
      rootSecret,
      log: false,
    }).orThrow();
    try {
      await device.request("Auth.Sessions.Me", {}).orThrow();

      const session = await sqlite.takeSession(identity.publicIdentityKey);
      assert(session !== null, "expected live device session row");
      assert((await device.request("Auth.Sessions.Me", {})).isErr());
      await session.restore();

      await sqlite.execute(
        "UPDATE device_instances SET deployment_id = ? WHERE instance_id = ?",
        [`${deploymentId}.stale`, provisioned.instance.instanceId],
      );
      const staleDeployment = await device.request("Auth.Sessions.Me", {});
      assert(staleDeployment.isErr());

      await sqlite.execute(
        "UPDATE device_instances SET deployment_id = ? WHERE instance_id = ?",
        [deploymentId, provisioned.instance.instanceId],
      );
      await sqlite.execute(
        "UPDATE device_activations SET public_identity_key = ? WHERE instance_id = ?",
        [
          `B${identity.publicIdentityKey.slice(1)}`,
          provisioned.instance.instanceId,
        ],
      );
      const staleIdentity = await device.request("Auth.Sessions.Me", {});
      assert(staleIdentity.isErr());
    } finally {
      await device.connection.close().catch(() => undefined);
      await admin.connection.close().catch(() => undefined);
    }
  },
});

function requireControlPlaneSqlite(
  runtime: LiveTrellisRuntime,
): ControlPlaneSqlite {
  const sqlite = runtime.controlPlane?.sqlite;
  assert(sqlite, "live runtime must expose control-plane SQLite");
  return sqlite;
}
