import { assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeIsolated } from "../_support/runtime.ts";
import {
  assertRefreshHookFailure,
  restartWithFailOnceHook,
} from "./_auth_admin_refresh_rollback.ts";

const CASE_ID =
  "control-plane.admin-device-instance-disable-refresh-rollback" as const;
const deploymentId = caseScopedName("admin-device-instance-disable", CASE_ID);
const refreshHook = "auth.admin.deviceInstances.refreshActiveContracts";

const adminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-device-instance-disable-refresh-admin",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Device Instance Disable Rollback Admin",
  description:
    "Exercises Auth device instance disable refresh rollback through live Trellis.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.Devices.Disable",
            "Auth.Devices.List",
            "Auth.Devices.Provision",
          ],
        },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.admin-device-instance-disable-refresh-rollback rolls back failed device instance disable refresh",
  scope: runtimeScopeIsolated(),
  async fn(runtime) {
    await restartWithFailOnceHook(runtime, refreshHook);
    const admin = await runtime.connectClient({
      name: caseScopedName("admin-device-instance-disable-client", CASE_ID),
      contract: adminContract,
    });

    try {
      await admin.rpc.auth.deploymentsCreate({
        kind: "device",
        deploymentId,
        reviewMode: "none",
      }).orThrow();
      const provisioned = await admin.rpc.auth.devicesProvision({
        deploymentId,
        publicIdentityKey: caseScopedName("disable-device-key", CASE_ID),
        activationKey: caseScopedName("disable-activation-key", CASE_ID),
        metadata: { name: caseScopedName("disable-device", CASE_ID) },
      }).orThrow();

      const failedDisable = await admin.rpc.auth.devicesDisable({
        instanceId: provisioned.instance.instanceId,
      });
      assertRefreshHookFailure(failedDisable, refreshHook);

      const page = await admin.rpc.auth.devicesList({
        deploymentId,
        limit: 500,
      }).orThrow();
      assertEquals(
        page.entries.find((device) =>
          device.instanceId === provisioned.instance.instanceId
        )?.state,
        "registered",
      );
    } finally {
      await admin.connection.close().catch(() => undefined);
    }
  },
});
