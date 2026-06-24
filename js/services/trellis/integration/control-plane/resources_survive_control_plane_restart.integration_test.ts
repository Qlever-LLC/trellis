import { assertEquals } from "@std/assert";
import { defineServiceContract } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import {
  liveTrellisTest,
  restartTrellisControlPlane,
  runtimeScopeForCase,
} from "../_support/runtime.ts";

const CASE_ID =
  "control-plane.resources-survive-control-plane-restart" as const;

const schemas = {
  ResourceRecord: Type.Object({ message: Type.String() }),
} as const;

const serviceContract = defineServiceContract({ schemas }, (ref) => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.resources-restart-service",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Resources Restart Service",
  description:
    "Verifies service-owned resource bindings and backing data remain usable after control-plane restart.",
  resources: {
    kv: {
      records: {
        purpose: "Store restart-persistence KV records",
        schema: ref.schema("ResourceRecord"),
        required: true,
        history: 1,
        ttlMs: 0,
      },
    },
    store: {
      blobs: {
        purpose: "Store restart-persistence blobs",
        required: true,
        ttlMs: 0,
        maxObjectBytes: 1048576,
        maxTotalBytes: 4194304,
      },
    },
  },
}));

const serviceName = caseScopedName("resources-restart-service", CASE_ID);
const kvKey = caseScopedName("restart.resources.kv", CASE_ID);
const storeKey = caseScopedName("restart/resources/store", CASE_ID);

liveTrellisTest({
  name:
    "control-plane.resources-survive-control-plane-restart reuses service resource bindings after restart",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let service = await connectService(runtime.trellisUrl, serviceKey.seed);

    try {
      await service.kv.records.create(kvKey, { message: "before restart" })
        .orThrow();

      const store = await service.store.blobs.open().orThrow();
      await store.create(storeKey, encoder.encode("blob before restart"), {
        contentType: "text/plain",
        metadata: { phase: "before-restart" },
      }).orThrow();

      await service.stop();

      await restartTrellisControlPlane(runtime);

      service = await connectService(runtime.trellisUrl, serviceKey.seed);

      const kvEntry = await service.kv.records.get(kvKey).orThrow();
      assertEquals(kvEntry.value, { message: "before restart" });

      const restartedStore = await service.store.blobs.open().orThrow();
      const storeEntry = await restartedStore.get(storeKey).orThrow();
      assertEquals(storeEntry.info.contentType, "text/plain");
      assertEquals(storeEntry.info.metadata.phase, "before-restart");
      assertEquals(
        decoder.decode(await storeEntry.bytes().orThrow()),
        "blob before restart",
      );
    } finally {
      await service.stop().catch(() => undefined);
    }
  },
});

async function connectService(trellisUrl: string, sessionKeySeed: string) {
  return await TrellisService.connect({
    trellisUrl,
    contract: serviceContract,
    name: serviceName,
    sessionKeySeed,
    telemetry: false,
    server: { log: false },
  }).orThrow();
}
