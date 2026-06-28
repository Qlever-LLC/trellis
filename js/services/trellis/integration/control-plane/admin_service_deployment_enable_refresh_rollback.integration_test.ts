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
  "control-plane.admin-service-deployment-enable-refresh-rollback" as const;
const deploymentId = caseScopedName("admin-service-enable-refresh", CASE_ID);
const refreshHook = "auth.admin.serviceDeployments.refreshActiveContracts";

const adminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-service-deployment-enable-refresh-admin",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Service Deployment Enable Rollback Admin",
  description:
    "Exercises Auth service deployment enable refresh rollback through live Trellis.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.Deployments.Disable",
            "Auth.Deployments.Enable",
            "Auth.Deployments.List",
          ],
        },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.admin-service-deployment-enable-refresh-rollback rolls back failed service deployment enable refresh",
  scope: runtimeScopeIsolated(),
  async fn(runtime) {
    const admin = await runtime.connectClient({
      name: caseScopedName("admin-service-enable-refresh-client", CASE_ID),
      contract: adminContract,
    });
    try {
      await admin.rpc.auth.deploymentsCreate({
        kind: "service",
        deploymentId,
        namespaces: ["admin", "rollback"],
        contractCompatibilityMode: "mutable-dev",
      }).orThrow();
      await admin.rpc.auth.deploymentsDisable({
        kind: "service",
        deploymentId,
      }).orThrow();
    } finally {
      await admin.connection.close().catch(() => undefined);
    }

    await restartWithFailOnceHook(runtime, refreshHook);

    const restartedAdmin = await runtime.connectClient({
      name: caseScopedName(
        "admin-service-enable-refresh-retry-client",
        CASE_ID,
      ),
      contract: adminContract,
    });
    try {
      const deploymentDisabled = async () => {
        const page = await restartedAdmin.rpc.auth.deploymentsList({
          kind: "service",
          limit: 500,
        }).orThrow();
        return page.entries.find((deployment) =>
          deployment.deploymentId === deploymentId
        )?.disabled;
      };

      const failedEnable = await restartedAdmin.rpc.auth.deploymentsEnable({
        kind: "service",
        deploymentId,
      });
      assertRefreshHookFailure(failedEnable, refreshHook);
      assertEquals(await deploymentDisabled(), true);
    } finally {
      await restartedAdmin.connection.close().catch(() => undefined);
    }
  },
});
