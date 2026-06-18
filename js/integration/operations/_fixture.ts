import { defineAppContract, defineServiceContract } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "../_support/names.ts";

export function createOperationsFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const operationSchemas = {
    OperationInput: Type.Object({ message: Type.String() }),
    OperationProgress: Type.Object({
      message: Type.String(),
      step: Type.Number(),
    }),
    OperationOutput: Type.Object({
      message: Type.String(),
      done: Type.Boolean(),
    }),
  } as const;

  const serviceContract = defineServiceContract(
    { schemas: operationSchemas },
    (ref) => ({
      id: caseScopedContractId(
        "trellis.integration.operations-service",
        caseId,
      ),
      displayName: `Trellis Integration Operations Service (${slug})`,
      description: "Exercises generated operation start and watch surfaces.",
      capabilities: {
        process: {
          displayName: "Process entities",
          description: "Start and observe entity processing operations.",
        },
      },
      operations: {
        "Entity.Process": {
          version: "v1",
          subject: caseScopedSubject(
            "operations.v1.Integration.Operations",
            caseId,
            "Entity.Process",
          ),
          input: ref.schema("OperationInput"),
          progress: ref.schema("OperationProgress"),
          output: ref.schema("OperationOutput"),
          errors: [ref.error("UnexpectedError")],
          capabilities: { call: ["process"], observe: ["process"] },
          cancel: false,
        },
      },
    }),
  );

  const clientContract = defineAppContract(() => ({
    id: caseScopedContractId("trellis.integration.operations-client", caseId),
    displayName: `Trellis Integration Operations Client (${slug})`,
    description:
      "App/client participant for the operations integration fixture.",
    uses: {
      required: {
        operationsService: serviceContract.use({
          operations: { call: ["Entity.Process"] },
        }),
      },
    },
  }));

  const unauthorizedClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.operations-unauthorized-client",
      caseId,
    ),
    displayName: `Trellis Integration Unauthorized Operations Client (${slug})`,
    description:
      "App/client without operation call authority for Entity.Process.",
    uses: { required: { operationsService: serviceContract.use({}) } },
  }));

  const serviceName = caseScopedName("operations-fixture-service", caseId);

  async function connectService(runtime: LiveTrellisRuntime) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    return await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();
  }

  return {
    slug,
    serviceContract,
    clientContract,
    unauthorizedClientContract,
    serviceName,
    clientName: caseScopedName("operations-fixture-client", caseId),
    unauthorizedClientName: caseScopedName(
      "operations-fixture-unauthorized-client",
      caseId,
    ),
    message: caseScopedName("operation", caseId),
    connectService,
  };
}
