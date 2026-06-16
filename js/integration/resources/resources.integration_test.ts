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

Deno.test(
  "resources.service-receives-required-bindings has required KV and store handles materialized",
  async () => {
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
        assertEquals(typeof service.kv.records, "object");
        assertEquals(typeof service.store.blobs, "object");
      } finally {
        await service.stop();
      }
    });
  },
);

Deno.test(
  "resources.service-receives-optional-bindings has optional KV and store handles when declared",
  async () => {
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
        assertEquals(typeof service.kv.optionalRecords, "object");
        assertEquals(typeof service.store.optionalBlobs, "object");
      } finally {
        await service.stop();
      }
    });
  },
);

Deno.test(
  "resources.service-store-create-read-list-delete uses store resources during a client RPC",
  async () => {
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
        await service.handle.rpc.resources.exercise(
          async ({ input, client }) => {
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
            assertEquals(
              storeEntry.info.metadata.source,
              "resources-integration",
            );
            const readText = decoder.decode(
              await storeEntry.bytes().orThrow(),
            );

            const status = await store.status().orThrow();
            assertEquals(status.ttlMs, 0);
            assertEquals(status.maxTotalBytes, 4194304);
            const listed = await store.list({ prefix: input.key, limit: 10 })
              .orThrow();
            if (!listed.entries.some((entry) => entry.key === storeKey)) {
              throw new Error(`store list did not include ${storeKey}`);
            }

            await store.delete(storeKey).orThrow();

            return Result.ok({
              provider: "ts",
              storeText: readText,
              kvMessage: "",
            });
          },
        );

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
          kvMessage: "",
        });
      } finally {
        await service.stop();
      }
    });
  },
);

Deno.test(
  "resources.service-kv-create-put-get-delete uses KV resources during a client RPC",
  async () => {
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
        await service.handle.rpc.resources.exercise(
          async ({ input, client }) => {
            const kvKey = `${input.key}.kv`;
            await client.kv.records.create(kvKey, {
              message: input.message,
            }).orThrow();
            await client.kv.records.put(kvKey, {
              message: `kv:${input.message}`,
            }).orThrow();
            const kvEntry = await client.kv.records.get(kvKey).orThrow();
            const kvMessage = kvEntry.value.message;

            await kvEntry.delete(true).orThrow();

            return Result.ok({
              provider: "ts",
              storeText: "",
              kvMessage,
            });
          },
        );

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
          storeText: "",
          kvMessage: "kv:client to resources",
        });
      } finally {
        await service.stop();
      }
    });
  },
);

Deno.test(
  "resources.service-kv-stale-revision-rejected fails on stale revision KV operations",
  async () => {
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
        await service.handle.rpc.resources.exercise(
          async ({ input, client }) => {
            const kvKey = `${input.key}.kv`;

            await client.kv.records.create(kvKey, {
              message: "initial",
            }).orThrow();

            const entry = await client.kv.records.get(kvKey).orThrow();
            assertEquals(entry.value.message, "initial");

            await client.kv.records.put(kvKey, {
              message: "updated",
            }).orThrow();

            const stalePutResult = await entry.put(
              { message: "stale" },
              true,
            );
            assertEquals(stalePutResult.isErr(), true);

            const staleDeleteResult = await entry.delete(true);
            assertEquals(staleDeleteResult.isErr(), true);

            await client.kv.records.delete(kvKey).orThrow();

            return Result.ok({
              provider: "ts",
              storeText: "",
              kvMessage: "stale-test-passed",
            });
          },
        );

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
          storeText: "",
          kvMessage: "stale-test-passed",
        });
      } finally {
        await service.stop();
      }
    });
  },
);
