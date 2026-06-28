import { assertEquals } from "@std/assert";
import { createAuth, defineAppContract } from "@qlever-llc/trellis";
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
  "control-plane.admin-service-instance-remove-refresh-rollback" as const;
const deploymentId = caseScopedName("admin-service-instance-remove", CASE_ID);
const refreshHook = "auth.admin.serviceInstances.refreshActiveContracts";

const adminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-service-instance-remove-refresh-admin",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Service Instance Remove Rollback Admin",
  description:
    "Exercises Auth service instance remove refresh rollback through live Trellis.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.ServiceInstances.List",
            "Auth.ServiceInstances.Provision",
            "Auth.ServiceInstances.Remove",
          ],
        },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.admin-service-instance-remove-refresh-rollback rolls back failed service instance remove refresh",
  scope: runtimeScopeIsolated(),
  async fn(runtime) {
    await restartWithFailOnceHook(runtime, refreshHook);
    const admin = await runtime.connectClient({
      name: caseScopedName("admin-service-instance-remove-client", CASE_ID),
      contract: adminContract,
    });

    try {
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

      const failedRemove = await admin.rpc.auth.serviceInstancesRemove({
        instanceId: provisioned.instance.instanceId,
      });
      assertRefreshHookFailure(failedRemove, refreshHook);

      const page = await admin.rpc.auth.serviceInstancesList({
        deploymentId,
        limit: 500,
      }).orThrow();
      assertEquals(
        page.entries.some((instance) =>
          instance.instanceId === provisioned.instance.instanceId
        ),
        true,
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
