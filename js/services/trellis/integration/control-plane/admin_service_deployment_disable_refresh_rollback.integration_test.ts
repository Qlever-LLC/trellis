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
  "control-plane.admin-service-deployment-disable-refresh-rollback" as const;
const deploymentId = caseScopedName("admin-service-disable-refresh", CASE_ID);
const refreshHook = "auth.admin.serviceDeployments.refreshActiveContracts";

const adminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-service-deployment-disable-refresh-admin",
    CASE_ID,
  ),
  displayName:
    "Trellis Control-Plane Service Deployment Disable Rollback Admin",
  description:
    "Exercises Auth service deployment disable refresh rollback through live Trellis.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.Deployments.Disable",
            "Auth.Deployments.List",
          ],
        },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.admin-service-deployment-disable-refresh-rollback rolls back failed service deployment disable refresh",
  scope: runtimeScopeIsolated(),
  async fn(runtime) {
    await restartWithFailOnceHook(runtime, refreshHook);
    const admin = await runtime.connectClient({
      name: caseScopedName("admin-service-disable-refresh-client", CASE_ID),
      contract: adminContract,
    });

    try {
      const deploymentDisabled = async () => {
        const page = await admin.rpc.auth.deploymentsList({
          kind: "service",
          limit: 500,
        }).orThrow();
        return page.entries.find((deployment) =>
          deployment.deploymentId === deploymentId
        )?.disabled;
      };

      await admin.rpc.auth.deploymentsCreate({
        kind: "service",
        deploymentId,
        namespaces: ["admin", "rollback"],
        contractCompatibilityMode: "mutable-dev",
      }).orThrow();

      const failedDisable = await admin.rpc.auth.deploymentsDisable({
        kind: "service",
        deploymentId,
      });
      assertRefreshHookFailure(failedDisable, refreshHook);
      assertEquals(await deploymentDisabled(), false);
    } finally {
      await admin.connection.close().catch(() => undefined);
    }
  },
});
