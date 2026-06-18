import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "../_support/names.ts";

export function createAppIdentityApprovalFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const schemas = {
    GrantPingInput: Type.Object({ message: Type.String() }),
    GrantPingOutput: Type.Object({
      message: Type.String(),
      approved: Type.Boolean(),
    }),
  } as const;

  const serviceContract = defineServiceContract({ schemas }, (ref) => ({
    id: caseScopedContractId(
      "trellis.integration.app-identity-approval-service",
      caseId,
    ),
    displayName: `Trellis Integration App Identity Approval Service (${slug})`,
    description: "Exercises an approved app identity grant with a service RPC.",
    capabilities: {
      approvedPing: {
        displayName: "Call approved ping",
        description: "Call the RPC used by the app identity approval fixture.",
      },
    },
    rpc: {
      "Grant.Ping": {
        version: "v1",
        subject: caseScopedSubject(
          "rpc.v1.Integration.AppIdentityApproval",
          caseId,
          "Grant.Ping",
        ),
        input: ref.schema("GrantPingInput"),
        output: ref.schema("GrantPingOutput"),
        capabilities: { call: ["approvedPing"] },
        errors: [],
      },
    },
  }));

  const clientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.app-identity-approval-client",
      caseId,
    ),
    displayName: `Trellis Integration App Identity Approval Client (${slug})`,
    description:
      "App/client participant for the app identity approval fixture.",
    uses: {
      required: {
        grantService: serviceContract.use({ rpc: { call: ["Grant.Ping"] } }),
      },
    },
  }));

  const serviceName = caseScopedName(
    "app-identity-approval-fixture-service",
    caseId,
  );
  const clientName = caseScopedName(
    "app-identity-approval-fixture-client",
    caseId,
  );

  async function setupService(runtime: LiveTrellisRuntime) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();

    service.handle.rpc.grant.ping(({ input }) =>
      Result.ok({ message: input.message, approved: true })
    );

    return service;
  }

  async function setupClientRegistration(runtime: LiveTrellisRuntime) {
    const clientKey = await runtime.registerClient({
      name: clientName,
      contract: clientContract,
    });
    return { clientKey, clientAuth: runtime.clientAuth(clientKey) };
  }

  return {
    slug,
    serviceContract,
    clientContract,
    serviceName,
    clientName,
    pingMessage: caseScopedName("app-approved", caseId),
    setupService,
    setupClientRegistration,
  };
}
