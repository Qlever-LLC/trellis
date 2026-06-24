import {
  defineAppContract,
  defineServiceContract,
  withTrellisValidation,
} from "@qlever-llc/trellis";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
} from "../_support/names.ts";

export function createRpcFixture(caseId: string) {
  const slug = caseId.replaceAll(".", "-");

  const rpcSchemas = {
    EntityGetInput: Type.Object({ id: Type.String() }),
    EntityGetOutput: Type.Object({
      id: Type.String(),
      found: Type.Boolean(),
      caller: Type.Optional(Type.Any()),
      sessionKey: Type.Optional(Type.String()),
      requestId: Type.Optional(Type.String()),
      traceId: Type.Optional(Type.String()),
    }),
    AnnotatedValidationInput: Type.Object({
      items: withTrellisValidation(
        Type.Array(Type.String(), { minItems: 1 }),
        {
          label: "Items",
          issues: {
            minItems: {
              code: "rpc.items.required",
              message: "Add at least one item.",
            },
          },
        },
      ),
    }),
    MixedValidationInput: Type.Object({
      items: withTrellisValidation(
        Type.Array(Type.String(), { minItems: 1 }),
        {
          label: "Items",
          issues: {
            minItems: {
              code: "rpc.items.required",
              message: "Add at least one item.",
            },
          },
        },
      ),
      name: Type.String({ minLength: 3 }),
    }),
    ValidationOutput: Type.Object({ success: Type.Boolean() }),
  } as const;

  const serviceContract = defineServiceContract(
    { schemas: rpcSchemas },
    (ref) => ({
      id: caseScopedContractId("trellis.integration.rpc-service", caseId),
      displayName: `Trellis Integration RPC Service (${slug})`,
      description:
        "Exercises client-to-service RPC through generated surfaces.",
      capabilities: {
        read: {
          displayName: "Read entities",
          description: "Read entity records in the RPC integration fixture.",
        },
      },
      rpc: {
        "Entity.Get": {
          version: "v1",
          subject: caseScopedSubject(
            "rpc.v1.integration.rpc",
            caseId,
            "Entity.Get",
          ),
          input: ref.schema("EntityGetInput"),
          output: ref.schema("EntityGetOutput"),
          capabilities: { call: ["read"] },
          errors: ["NOT_FOUND"],
        },
        "Validation.Annotated": {
          version: "v1",
          subject: caseScopedSubject(
            "rpc.v1.integration.rpc",
            caseId,
            "Validation.Annotated",
          ),
          input: ref.schema("AnnotatedValidationInput"),
          output: ref.schema("ValidationOutput"),
          capabilities: { call: ["read"] },
          errors: [],
        },
        "Validation.Mixed": {
          version: "v1",
          subject: caseScopedSubject(
            "rpc.v1.integration.rpc",
            caseId,
            "Validation.Mixed",
          ),
          input: ref.schema("MixedValidationInput"),
          output: ref.schema("ValidationOutput"),
          capabilities: { call: ["read"] },
          errors: [],
        },
      },
    }),
  );

  const clientContract = defineAppContract(() => ({
    id: caseScopedContractId("trellis.integration.rpc-client", caseId),
    displayName: `Trellis Integration RPC Client (${slug})`,
    description: "App/client participant for the RPC integration fixture.",
    uses: {
      required: {
        rpcService: serviceContract.use({
          rpc: {
            call: [
              "Entity.Get",
              "Validation.Annotated",
              "Validation.Mixed",
            ],
          },
        }),
      },
    },
  }));

  const unauthorizedClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.rpc-unauthorized-client",
      caseId,
    ),
    displayName: `Trellis Integration Unauthorized RPC Client (${slug})`,
    description: "App/client without rpc.call authority for Entity.Get.",
    uses: {
      required: {
        rpcService: serviceContract.use({}),
      },
    },
  }));

  return {
    slug,
    serviceContract,
    clientContract,
    unauthorizedClientContract,
    serviceName: caseScopedName("rpc-fixture-service", caseId),
    clientName: caseScopedName("rpc-fixture-client", caseId),
    unauthorizedClientName: caseScopedName(
      "rpc-fixture-unauthorized-client",
      caseId,
    ),
    entityId: `entity-${slug}`,
  };
}
