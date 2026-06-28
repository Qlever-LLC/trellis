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
  "control-plane.admin-device-instance-remove-refresh-rollback" as const;
const deploymentId = caseScopedName("admin-device-instance-remove", CASE_ID);
const refreshHook = "auth.admin.deviceInstances.refreshActiveContracts";

const adminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-device-instance-remove-refresh-admin",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Device Instance Remove Rollback Admin",
  description:
    "Exercises Auth device instance remove refresh rollback through live Trellis.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.Devices.List",
            "Auth.Devices.Provision",
            "Auth.Devices.Remove",
          ],
        },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.admin-device-instance-remove-refresh-rollback rolls back failed device instance remove refresh",
  scope: runtimeScopeIsolated(),
  async fn(runtime) {
    await restartWithFailOnceHook(runtime, refreshHook);
    const admin = await runtime.connectClient({
      name: caseScopedName("admin-device-instance-remove-client", CASE_ID),
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
        publicIdentityKey: caseScopedName("remove-device-key", CASE_ID),
        activationKey: caseScopedName("remove-activation-key", CASE_ID),
        metadata: { name: caseScopedName("remove-device", CASE_ID) },
      }).orThrow();

      const failedRemove = await admin.rpc.auth.devicesRemove({
        instanceId: provisioned.instance.instanceId,
      });
      assertRefreshHookFailure(failedRemove, refreshHook);

      const page = await admin.rpc.auth.devicesList({
        deploymentId,
        limit: 500,
      }).orThrow();
      assertEquals(
        page.entries.some((device) =>
          device.instanceId === provisioned.instance.instanceId
        ),
        true,
      );
    } finally {
      await admin.connection.close().catch(() => undefined);
    }
  },
});
