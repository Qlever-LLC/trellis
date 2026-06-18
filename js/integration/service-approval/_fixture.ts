import { assert } from "@std/assert";
import {
  createAuth,
  defineAppContract,
  defineServiceContract,
} from "@qlever-llc/trellis";
import { sdk as authSdk } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "../_support/names.ts";

export function createServiceApprovalFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const schemas = {
    StartupPingInput: Type.Object({ message: Type.String() }),
    StartupPingOutput: Type.Object({
      message: Type.String(),
      approved: Type.Boolean(),
    }),
  } as const;

  const serviceContract = defineServiceContract({ schemas }, (ref) => ({
    id: caseScopedContractId(
      "trellis.integration.service-approval-service",
      caseId,
    ),
    displayName: `Trellis Integration Service Approval Service (${slug})`,
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
        subject: caseScopedSubject(
          "rpc.v1.Integration.ServiceApproval",
          caseId,
          "Startup.Ping",
        ),
        input: ref.schema("StartupPingInput"),
        output: ref.schema("StartupPingOutput"),
        capabilities: { call: ["ping"] },
        errors: [],
      },
    },
  }));

  const adminContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.service-approval-admin",
      caseId,
    ),
    displayName: `Trellis Integration Service Approval Admin (${slug})`,
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

  const clientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.service-approval-client",
      caseId,
    ),
    displayName: `Trellis Integration Service Approval Client (${slug})`,
    description: "App/client participant for the service approval fixture.",
    uses: {
      required: {
        approvalService: serviceContract.use({
          rpc: { call: ["Startup.Ping"] },
        }),
      },
    },
  }));

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

  async function provisionServiceInstance(runtime: LiveTrellisRuntime) {
    const seed = randomSessionSeed();
    const serviceAuth = await createAuth({ sessionKeySeed: seed });
    const admin = await runtime.connectClient({
      name: caseScopedName("service-approval-fixture-admin", caseId),
      contract: adminContract,
    });
    await admin.rpc.auth.serviceInstancesProvision({
      deploymentId: caseScopedName("service-approval-deployment", caseId),
      instanceKey: serviceAuth.sessionKey,
    }).orThrow();
    return { seed, sessionKey: serviceAuth.sessionKey };
  }

  async function connectService(runtime: LiveTrellisRuntime, seed: string) {
    return await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: caseScopedName("service-approval-fixture-service", caseId),
      sessionKeySeed: seed,
      telemetry: false,
      server: {},
    }).orThrow();
  }

  function connectServicePending(runtime: LiveTrellisRuntime, seed: string) {
    const promise = connectService(runtime, seed);
    promise.catch(() => undefined);
    return promise;
  }

  async function expectPromisePending(
    promise: Promise<unknown>,
    message: string,
    timeoutMs = 750,
  ): Promise<void> {
    const sentinel = Symbol("pending");
    const result = await Promise.race([
      promise.then(() => "resolved" as const),
      new Promise<typeof sentinel>((resolve) =>
        setTimeout(() => resolve(sentinel), timeoutMs)
      ),
    ]);
    assert(result === sentinel, message);
  }

  return {
    serviceContract,
    clientContract,
    serviceName: caseScopedName("service-approval-fixture-service", caseId),
    clientName: caseScopedName("service-approval-fixture-client", caseId),
    deploymentId: caseScopedName("service-approval-deployment", caseId),
    pingMessage: caseScopedName("approved-startup", caseId),
    provisionServiceInstance,
    connectService,
    connectServicePending,
    expectPromisePending,
  };
}
