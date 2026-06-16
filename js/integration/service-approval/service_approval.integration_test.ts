import { assert, assertEquals } from "@std/assert";
import {
  createAuth,
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { sdk as authSdk } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";

const serviceApprovalSchemas = {
  StartupPingInput: Type.Object({ message: Type.String() }),
  StartupPingOutput: Type.Object({
    message: Type.String(),
    approved: Type.Boolean(),
  }),
} as const;

const serviceApprovalServiceContract = defineServiceContract(
  { schemas: serviceApprovalSchemas },
  (ref) => ({
    id: "trellis.integration.service-approval-service@v1",
    displayName: "Trellis Integration Service Approval Service",
    description:
      "Exercises service startup waiting for deployment authority approval.",
    capabilities: {
      ping: {
        displayName: "Ping approval service",
        description: "Call the service after startup approval completes.",
      },
    },
    rpc: {
      "Startup.Ping": {
        version: "v1",
        input: ref.schema("StartupPingInput"),
        output: ref.schema("StartupPingOutput"),
        capabilities: { call: ["ping"] },
        errors: [],
      },
    },
  }),
);

const serviceApprovalClientContract = defineAppContract(() => ({
  id: "trellis.integration.service-approval-client@v1",
  displayName: "Trellis Integration Service Approval Client",
  description: "App/client participant for the service approval fixture.",
  uses: {
    required: {
      approvalService: serviceApprovalServiceContract.use({
        rpc: { call: ["Startup.Ping"] },
      }),
    },
  },
}));

const serviceApprovalAdminContract = defineAppContract(() => ({
  id: "trellis.integration.service-approval-admin@v1",
  displayName: "Trellis Integration Service Approval Admin",
  description:
    "Test admin participant that provisions service instance keys through public Auth RPCs.",
  uses: {
    required: {
      auth: authSdk.use({
        rpc: { call: ["Auth.ServiceInstances.Provision"] },
      }),
    },
  },
}));

Deno.test("service-approval.service-startup-awaits-approval blocks service startup until authority approval", async () => {
  await withTrellisRuntime(async (runtime) => {
    await runtime.deployments.create({});

    const seed = randomSessionSeed();
    const serviceAuth = await createAuth({ sessionKeySeed: seed });
    const admin = await runtime.connectClient({
      name: "service-approval-fixture-admin",
      contract: serviceApprovalAdminContract,
    });
    await admin.rpc.auth.serviceInstancesProvision({
      deploymentId: "test",
      instanceKey: serviceAuth.sessionKey,
    }).orThrow();

    let service: Awaited<ReturnType<typeof connectApprovalService>> | undefined;
    const connectPromise = connectApprovalService(runtime.trellisUrl, seed)
      .then((connected) => {
        service = connected;
        return connected;
      });

    assert(
      await remainsPending(connectPromise, 750),
      "service startup resolved before deployment authority approval",
    );

    await runtime.contracts.approve({
      contract: serviceApprovalServiceContract,
      allowPlanClassifications: ["update", "migration"],
    });

    const connectedService = await connectPromise;
    try {
      await connectedService.handle.rpc.startup.ping(({ input }) =>
        Result.ok({ message: input.message, approved: true })
      );

      const client = await runtime.connectClient({
        name: "service-approval-fixture-client",
        contract: serviceApprovalClientContract,
      });

      const result = await client.rpc.startup.ping({
        message: "approved-startup",
      }).orThrow();
      assertEquals(result, { message: "approved-startup", approved: true });
    } finally {
      await service?.stop();
    }
  });
});

async function connectApprovalService(trellisUrl: string, seed: string) {
  return await TrellisService.connect({
    trellisUrl,
    contract: serviceApprovalServiceContract,
    name: "service-approval-fixture-service",
    sessionKeySeed: seed,
    telemetry: false,
    server: {},
  }).orThrow();
}

async function remainsPending(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  const sentinel = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      () => "resolved" as const,
      (error) => {
        throw error;
      },
    ),
    new Promise<typeof sentinel>((resolve) =>
      setTimeout(() => resolve(sentinel), timeoutMs)
    ),
  ]);
  return result === sentinel;
}

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
