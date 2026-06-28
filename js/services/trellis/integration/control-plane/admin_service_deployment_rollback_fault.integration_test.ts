import { assert, assertEquals } from "@std/assert";
import { createAuth, defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID =
  "control-plane.admin-service-deployment-rollback-fault" as const;
const deploymentId = caseScopedName("admin-service-rollback", CASE_ID);

const adminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-service-deployment-rollback-admin",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Service Deployment Rollback Admin",
  description:
    "Exercises generated Auth service deployment rollback RPCs through live Trellis.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.Deployments.List",
            "Auth.Deployments.Remove",
            "Auth.ServiceInstances.List",
            "Auth.ServiceInstances.Provision",
          ],
        },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.admin-service-deployment-rollback-fault rolls back service admin faults and retries successfully",
  scope: runtimeScopeForCase(CASE_ID),
  runtime: {
    failOnceHooks: [
      "auth.admin.serviceDeployments.createAuthority",
      "auth.admin.serviceDeployments.deleteCascadeRecord",
    ],
  },
  async fn(runtime) {
    const admin = await runtime.connectClient({
      name: caseScopedName("admin-service-rollback-client", CASE_ID),
      contract: adminContract,
    });

    try {
      const findDeployment = async () => {
        const page = await admin.rpc.auth.deploymentsList({
          kind: "service",
          limit: 500,
        }).orThrow();
        return page.entries.find((deployment) =>
          deployment.deploymentId === deploymentId
        );
      };
      const findServiceInstance = async (instanceId: string) => {
        const page = await admin.rpc.auth.serviceInstancesList({
          deploymentId,
          limit: 500,
        }).orThrow();
        return page.entries.find((instance) =>
          instance.instanceId === instanceId
        );
      };

      const failedCreate = await admin.rpc.auth.deploymentsCreate({
        kind: "service",
        deploymentId,
        namespaces: ["admin", "rollback"],
        contractCompatibilityMode: "mutable-dev",
      });
      assert(failedCreate.isErr());
      assertEquals(await findDeployment(), undefined);

      await admin.rpc.auth.deploymentsCreate({
        kind: "service",
        deploymentId,
        namespaces: ["admin", "rollback"],
        contractCompatibilityMode: "mutable-dev",
      }).orThrow();
      const auth = await createAuth({ sessionKeySeed: randomSessionSeed() });
      const provisioned = await admin.rpc.auth.serviceInstancesProvision({
        deploymentId,
        instanceKey: auth.sessionKey,
      }).orThrow();
      const secondAuth = await createAuth({
        sessionKeySeed: randomSessionSeed(),
      });
      const secondProvisioned = await admin.rpc.auth.serviceInstancesProvision({
        deploymentId,
        instanceKey: secondAuth.sessionKey,
      }).orThrow();

      const failedRemove = await admin.rpc.auth.deploymentsRemove({
        kind: "service",
        deploymentId,
        cascade: true,
      });
      assert(failedRemove.isErr());
      assertEquals((await findDeployment())?.deploymentId, deploymentId);
      assertEquals(
        (await findServiceInstance(provisioned.instance.instanceId))
          ?.instanceId,
        provisioned.instance.instanceId,
      );
      assertEquals(
        (await findServiceInstance(secondProvisioned.instance.instanceId))
          ?.instanceId,
        secondProvisioned.instance.instanceId,
      );

      assertEquals(
        await admin.rpc.auth.deploymentsRemove({
          kind: "service",
          deploymentId,
          cascade: true,
        }).orThrow(),
        { success: true },
      );
      assertEquals(await findDeployment(), undefined);
      assertEquals(
        await findServiceInstance(provisioned.instance.instanceId),
        undefined,
      );
      assertEquals(
        await findServiceInstance(secondProvisioned.instance.instanceId),
        undefined,
      );
    } finally {
      await admin.connection.close().catch(() => undefined);
    }
  },
});

function randomSessionSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}
