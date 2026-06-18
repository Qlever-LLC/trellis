import { defineAppContract, defineServiceContract } from "@qlever-llc/trellis";
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
          rpc: { call: ["Entity.Get"] },
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
