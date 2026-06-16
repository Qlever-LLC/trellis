import { assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";

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

const resourcesServiceContract = defineServiceContract(
  { schemas: resourceSchemas },
  (ref) => ({
    id: "trellis.integration.resources-service@v1",
    displayName: "Trellis Integration Resources Service",
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
        subject: "rpc.v1.Resources.Exercise",
        input: ref.schema("ResourceExerciseInput"),
        output: ref.schema("ResourceExerciseOutput"),
        capabilities: { call: [] },
        errors: [],
      },
    },
  }),
);

const resourcesClientContract = defineAppContract(() => ({
  id: "trellis.integration.resources-client@v1",
  displayName: "Trellis Integration Resources Client",
  description: "App/client participant for the resources integration fixture.",
  uses: {
    required: {
      resourcesService: resourcesServiceContract.use({
        rpc: { call: ["Resources.Exercise"] },
      }),
    },
  },
}));

Deno.test("resources.service-uses-bound-resources-for-client-call uses service-bound resources", async () => {
  await withTrellisRuntime(async (runtime) => {
    const serviceKey = await runtime.registerService({
      name: "resources-fixture-service",
      contract: resourcesServiceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: resourcesServiceContract,
      name: "resources-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

    try {
      if (service.kv.optionalRecords === undefined) {
        throw new Error("optionalRecords KV binding should be present");
      }
      if (service.store.optionalBlobs === undefined) {
        throw new Error("optionalBlobs store binding should be present");
      }

      await service.handle.rpc.resources.exercise(async ({ input, client }) => {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const store = await client.store.blobs.open().orThrow();
        const storeKey = `${input.key}.store`;
        const storeText = `store:${input.message}`;

        await store.create(storeKey, encoder.encode(storeText), {
          contentType: "text/plain",
          metadata: { source: "resources-integration" },
        }).orThrow();
        const storeEntry = await client.store.blobs.waitFor(storeKey, {
          timeoutMs: 5000,
          pollIntervalMs: 25,
        }).orThrow();
        assertEquals(storeEntry.info.contentType, "text/plain");
        assertEquals(storeEntry.info.metadata.source, "resources-integration");
        const readText = decoder.decode(await storeEntry.bytes().orThrow());

        const status = await store.status().orThrow();
        assertEquals(status.ttlMs, 0);
        assertEquals(status.maxTotalBytes, 4194304);
        const listed = await store.list({ prefix: input.key, limit: 10 })
          .orThrow();
        if (!listed.entries.some((entry) => entry.key === storeKey)) {
          throw new Error(`store list did not include ${storeKey}`);
        }

        const kvKey = `${input.key}.kv`;
        await client.kv.records.create(kvKey, { message: input.message })
          .orThrow();
        await client.kv.records.put(kvKey, {
          message: `kv:${input.message}`,
        }).orThrow();
        const kvEntry = await client.kv.records.get(kvKey).orThrow();
        const kvMessage = kvEntry.value.message;

        await kvEntry.delete(true).orThrow();
        await store.delete(storeKey).orThrow();

        return Result.ok({
          provider: "ts",
          storeText: readText,
          kvMessage,
        });
      });

      const client = await runtime.connectClient({
        name: "resources-fixture-client",
        contract: resourcesClientContract,
      });

      const result = await client.rpc.resources.exercise({
        key: "client.resource",
        message: "client to resources",
      }).orThrow();
      assertEquals(result, {
        provider: "ts",
        storeText: "store:client to resources",
        kvMessage: "kv:client to resources",
      });
    } finally {
      await service.stop();
    }
  });
});
