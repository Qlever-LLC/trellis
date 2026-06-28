import { assert, assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID = "control-plane.admin-device-deployment-rollback-fault" as const;
const deploymentId = caseScopedName("admin-device-rollback", CASE_ID);

const adminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-device-deployment-rollback-admin",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Device Deployment Rollback Admin",
  description:
    "Exercises generated Auth device deployment rollback RPCs through live Trellis.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.Deployments.List",
            "Auth.Deployments.Remove",
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
    "control-plane.admin-device-deployment-rollback-fault rolls back device admin faults and retries successfully",
  scope: runtimeScopeForCase(CASE_ID),
  runtime: {
    failOnceHooks: [
      "auth.admin.deviceDeployments.createAuthority",
      "auth.admin.deviceDeployments.deleteCascadeRecord",
    ],
  },
  async fn(runtime) {
    const admin = await runtime.connectClient({
      name: caseScopedName("admin-device-rollback-client", CASE_ID),
      contract: adminContract,
    });

    try {
      const findDeployment = async () => {
        const page = await admin.rpc.auth.deploymentsList({
          kind: "device",
          limit: 500,
        }).orThrow();
        return page.entries.find((deployment) =>
          deployment.deploymentId === deploymentId
        );
      };
      const findDevice = async (instanceId: string) => {
        const page = await admin.rpc.auth.devicesList({
          deploymentId,
          limit: 500,
        }).orThrow();
        return page.entries.find((device) => device.instanceId === instanceId);
      };

      const failedCreate = await admin.rpc.auth.deploymentsCreate({
        kind: "device",
        deploymentId,
        reviewMode: "none",
      });
      assert(failedCreate.isErr());
      assertEquals(await findDeployment(), undefined);

      await admin.rpc.auth.deploymentsCreate({
        kind: "device",
        deploymentId,
        reviewMode: "none",
      }).orThrow();
      const provisioned = await admin.rpc.auth.devicesProvision({
        deploymentId,
        publicIdentityKey: caseScopedName("rollback-device-key", CASE_ID),
        activationKey: caseScopedName("rollback-activation-key", CASE_ID),
        metadata: { name: caseScopedName("rollback-device", CASE_ID) },
      }).orThrow();
      const secondProvisioned = await admin.rpc.auth.devicesProvision({
        deploymentId,
        publicIdentityKey: caseScopedName("rollback-device-key-2", CASE_ID),
        activationKey: caseScopedName("rollback-activation-key-2", CASE_ID),
        metadata: { name: caseScopedName("rollback-device-2", CASE_ID) },
      }).orThrow();

      const failedRemove = await admin.rpc.auth.deploymentsRemove({
        kind: "device",
        deploymentId,
        cascade: true,
      });
      assert(failedRemove.isErr());
      assertEquals((await findDeployment())?.deploymentId, deploymentId);
      assertEquals(
        (await findDevice(provisioned.instance.instanceId))?.instanceId,
        provisioned.instance.instanceId,
      );
      assertEquals(
        (await findDevice(secondProvisioned.instance.instanceId))?.instanceId,
        secondProvisioned.instance.instanceId,
      );

      assertEquals(
        await admin.rpc.auth.deploymentsRemove({
          kind: "device",
          deploymentId,
          cascade: true,
        }).orThrow(),
        { success: true },
      );
      assertEquals(await findDeployment(), undefined);
      assertEquals(
        await findDevice(provisioned.instance.instanceId),
        undefined,
      );
      assertEquals(
        await findDevice(secondProvisioned.instance.instanceId),
        undefined,
      );
    } finally {
      await admin.connection.close().catch(() => undefined);
    }
  },
});
