import { assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
  TrellisClient,
} from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeIsolated } from "../_support/runtime.ts";
import {
  assertRefreshHookFailure,
  restartWithFailOnceHook,
} from "./_auth_admin_refresh_rollback.ts";

const CASE_ID =
  "control-plane.admin-service-deployment-validate-before-persist-kick" as const;
const deploymentId = caseScopedName("admin-service-validate", CASE_ID);
const serviceName = caseScopedName("admin-service-validate-service", CASE_ID);
const clientName = caseScopedName("admin-service-validate-client", CASE_ID);
const validateHook = "auth.admin.serviceDeployments.validateActiveCatalog";

const schemas = {
  PingInput: Type.Object({ message: Type.String() }),
  PingOutput: Type.Object({ message: Type.String() }),
} as const;

const serviceContract = defineServiceContract({ schemas }, (ref) => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-service-validate-service",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Admin Service Validate Probe",
  description:
    "Verifies failed deployment-disable validation does not disable or kick a live service.",
  capabilities: {
    ping: {
      displayName: "Call validation probe ping",
      description: "Call the validation-before-persist probe RPC.",
    },
  },
  rpc: {
    "ValidateKick.Ping": {
      version: "v1",
      subject: caseScopedSubject(
        "rpc.v1.integration.control-plane.admin-service-validate",
        CASE_ID,
        "ValidateKick.Ping",
      ),
      input: ref.schema("PingInput"),
      output: ref.schema("PingOutput"),
      capabilities: { call: ["ping"] },
      errors: [],
    },
  },
}));

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-service-validate-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Admin Service Validate Client",
  description:
    "Calls the live service after a failed deployment-disable validation.",
  uses: {
    required: {
      validateService: serviceContract.use({
        rpc: { call: ["ValidateKick.Ping"] },
      }),
    },
  },
}));

const adminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-service-validate-admin",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Service Deployment Validate Admin",
  description:
    "Exercises Auth.Deployments.Disable staged validation failure through live Trellis.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: ["Auth.Deployments.Disable", "Auth.Deployments.List"],
        },
      }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.admin-service-deployment-validate-before-persist-kick validates before persisting disabled state or kicking service",
  scope: runtimeScopeIsolated(),
  async fn(runtime) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
      deployment: deploymentId,
    });
    const clientKey = await runtime.registerClient({
      name: clientName,
      contract: clientContract,
    });
    const clientAuth = runtime.clientAuth(clientKey);

    const service = await connectService(runtime.trellisUrl, serviceKey.seed);
    const client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: clientName,
      contract: clientContract,
      auth: clientAuth.auth,
      onAuthRequired: clientAuth.onAuthRequired,
    }).orThrow();

    try {
      assertEquals(
        await client.rpc.validateKick.ping({ message: "before" }).orThrow(),
        { message: "before" },
      );

      await restartWithFailOnceHook(runtime, validateHook);
      const admin = await runtime.connectClient({
        name: caseScopedName("admin-service-validate-admin", CASE_ID),
        contract: adminContract,
      });
      try {
        const failedDisable = await admin.rpc.auth.deploymentsDisable({
          kind: "service",
          deploymentId,
        });
        assertRefreshHookFailure(failedDisable, validateHook);

        const page = await admin.rpc.auth.deploymentsList({
          kind: "service",
          limit: 500,
        }).orThrow();
        assertEquals(
          page.entries.find((deployment) =>
            deployment.deploymentId === deploymentId
          )?.disabled,
          false,
        );
        assertEquals(
          await client.rpc.validateKick.ping({ message: "after" }).orThrow(),
          { message: "after" },
        );
      } finally {
        await admin.connection.close().catch(() => undefined);
      }
    } finally {
      await client.connection.close().catch(() => undefined);
      await service.stop().catch(() => undefined);
    }
  },
});

async function connectService(trellisUrl: string, sessionKeySeed: string) {
  const service = await TrellisService.connect({
    trellisUrl,
    contract: serviceContract,
    name: serviceName,
    sessionKeySeed,
    telemetry: false,
    server: { log: false },
  }).orThrow();
  service.handle.rpc.validateKick.ping(({ input }) =>
    Result.ok({ message: input.message })
  );
  return service;
}
