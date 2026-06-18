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

export function createResourcesFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const resourceSchemas = {
    ResourceExerciseInput: Type.Object({
      key: Type.String(),
      message: Type.String(),
    }),
    ResourceExerciseOutput: Type.Object({
      provider: Type.String(),
      storeText: Type.String(),
      kvMessage: Type.String(),
    }),
    ResourceRecord: Type.Object({ message: Type.String() }),
  } as const;

  const serviceContract = defineServiceContract(
    { schemas: resourceSchemas },
    (ref) => ({
      id: caseScopedContractId(
        "trellis.integration.resources-service",
        caseId,
      ),
      displayName: `Trellis Integration Resources Service (${slug})`,
      description: "Exercises service-bound KV and store resource handles.",
      resources: {
        kv: {
          records: {
            purpose: "Store integration resource records",
            schema: ref.schema("ResourceRecord"),
            required: true,
            history: 1,
            ttlMs: 0,
          },
          optionalRecords: {
            purpose: "Store optional integration resource records",
            schema: ref.schema("ResourceRecord"),
            required: false,
            history: 1,
            ttlMs: 0,
          },
        },
        store: {
          blobs: {
            purpose: "Store integration resource blobs",
            required: true,
            ttlMs: 0,
            maxObjectBytes: 1048576,
            maxTotalBytes: 4194304,
          },
          optionalBlobs: {
            purpose: "Store optional integration resource blobs",
            required: false,
            ttlMs: 0,
            maxObjectBytes: 1048576,
            maxTotalBytes: 4194304,
          },
        },
      },
      rpc: {
        "Resources.Exercise": {
          version: "v1",
          subject: caseScopedSubject(
            "rpc.v1.Integration.Resources",
            caseId,
            "Exercise",
          ),
          input: ref.schema("ResourceExerciseInput"),
          output: ref.schema("ResourceExerciseOutput"),
          capabilities: { call: [] },
          errors: [],
        },
      },
    }),
  );

  const clientContract = defineAppContract(() => ({
    id: caseScopedContractId("trellis.integration.resources-client", caseId),
    displayName: `Trellis Integration Resources Client (${slug})`,
    description:
      "App/client participant for the resources integration fixture.",
    uses: {
      required: {
        resourcesService: serviceContract.use({
          rpc: { call: ["Resources.Exercise"] },
        }),
      },
    },
  }));

  const serviceName = caseScopedName("resources-fixture-service", caseId);

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
    serviceName,
    clientName: caseScopedName("resources-fixture-client", caseId),
    resourceKey: caseScopedName("client.resource", caseId),
    connectService,
  };
}
