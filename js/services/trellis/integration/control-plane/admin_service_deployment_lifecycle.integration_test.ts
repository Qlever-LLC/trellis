import { assert, assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID = "control-plane.admin-service-deployment-lifecycle" as const;
const deploymentId = caseScopedName("admin-service-deployment", CASE_ID);

const adminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-service-deployment-lifecycle-admin",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Service Deployment Admin Client",
  description:
    "Exercises generated Auth.Deployments admin RPCs through live Trellis.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.Deployments.List",
            "Auth.Deployments.Disable",
            "Auth.Deployments.Enable",
            "Auth.Deployments.Remove",
          ],
        },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.admin-service-deployment-lifecycle manages service deployments through generated Auth RPCs",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const admin = await runtime.connectClient({
      name: caseScopedName("admin-service-deployment-client", CASE_ID),
      contract: adminContract,
    });

    try {
      const created = await admin.rpc.auth.deploymentsCreate({
        kind: "service",
        deploymentId,
        namespaces: ["admin", "admin", "ops"],
        contractCompatibilityMode: "mutable-dev",
      }).orThrow();
      assertEquals(created.deployment, {
        kind: "service",
        deploymentId,
        namespaces: ["admin", "ops"],
        contractCompatibilityMode: "mutable-dev",
        disabled: false,
      });

      assertEquals(
        findDeployment(
          await admin.rpc.auth.deploymentsList({ kind: "service", limit: 500 })
            .orThrow(),
        )?.disabled,
        false,
      );

      const disabled = await admin.rpc.auth.deploymentsDisable({
        kind: "service",
        deploymentId,
      }).orThrow();
      assertEquals(disabled.deployment.disabled, true);
      assertEquals(
        findDeployment(
          await admin.rpc.auth.deploymentsList({
            kind: "service",
            disabled: true,
            limit: 500,
          }).orThrow(),
        )?.deploymentId,
        deploymentId,
      );

      const enabled = await admin.rpc.auth.deploymentsEnable({
        kind: "service",
        deploymentId,
      }).orThrow();
      assertEquals(enabled.deployment.disabled, false);

      assertEquals(
        await admin.rpc.auth.deploymentsRemove({
          kind: "service",
          deploymentId,
        }).orThrow(),
        { success: true },
      );
      assertEquals(
        findDeployment(
          await admin.rpc.auth.deploymentsList({ kind: "service", limit: 500 })
            .orThrow(),
        ),
        undefined,
      );

      const missingRemove = await admin.rpc.auth.deploymentsRemove({
        kind: "service",
        deploymentId,
      });
      assert(missingRemove.isErr());
    } finally {
      await admin.connection.close().catch(() => undefined);
    }
  },
});

function findDeployment(
  page: { entries: Array<{ deploymentId: string; disabled: boolean }> },
) {
  return page.entries.find((deployment) =>
    deployment.deploymentId === deploymentId
  );
}
