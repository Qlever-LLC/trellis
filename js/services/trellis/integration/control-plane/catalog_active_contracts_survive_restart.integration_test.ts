import { assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
  TrellisClient,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
} from "@qlever-llc/trellis-test/integration";
import {
  liveTrellisTest,
  restartTrellisControlPlane,
  runtimeScopeForCase,
} from "../_support/runtime.ts";

const CASE_ID = "control-plane.catalog-active-contracts-survive-restart";
const schemas = {
  PingInput: Type.Object({ message: Type.String() }),
  PingOutput: Type.Object({
    message: Type.String(),
    generation: Type.Number(),
  }),
} as const;

const serviceContract = defineServiceContract({ schemas }, (ref) => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.catalog-restart-service",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Catalog Restart Service",
  description:
    "Verifies active service contract state remains usable after control-plane restart.",
  capabilities: {
    ping: {
      displayName: "Call catalog restart ping",
      description: "Call the restart persistence probe RPC.",
    },
  },
  rpc: {
    "CatalogRestart.Ping": {
      version: "v1",
      subject: caseScopedSubject(
        "rpc.v1.integration.control-plane.catalog-restart",
        CASE_ID,
        "CatalogRestart.Ping",
      ),
      input: ref.schema("PingInput"),
      output: ref.schema("PingOutput"),
      capabilities: { call: ["ping"] },
      errors: [],
    },
  },
}));

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.catalog-restart-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Catalog Restart Client",
  description:
    "Verifies active app contract authority remains usable after restart.",
  uses: {
    required: {
      catalogRestartService: serviceContract.use({
        rpc: { call: ["CatalogRestart.Ping"] },
      }),
    },
  },
}));

const serviceName = caseScopedName("catalog-restart-service", CASE_ID);
const clientName = caseScopedName("catalog-restart-client", CASE_ID);

liveTrellisTest({
  name:
    "control-plane.catalog-active-contracts-survive-restart keeps approved contracts usable after restart",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    const clientKey = await runtime.registerClient({
      name: clientName,
      contract: clientContract,
    });
    const clientAuth = runtime.clientAuth(clientKey);

    let service = await connectService(runtime.trellisUrl, serviceKey.seed, 1);
    let client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: clientName,
      contract: clientContract,
      auth: clientAuth.auth,
      onAuthRequired: clientAuth.onAuthRequired,
    }).orThrow();

    try {
      assertEquals(
        await client.rpc.catalogRestart.ping({ message: "before" }).orThrow(),
        { message: "before", generation: 1 },
      );

      await client.connection.close();
      await service.stop();

      await restartTrellisControlPlane(runtime);

      service = await connectService(runtime.trellisUrl, serviceKey.seed, 2);
      client = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: clientName,
        contract: clientContract,
        auth: clientAuth.auth,
      }).orThrow();

      assertEquals(
        await client.rpc.catalogRestart.ping({ message: "after" }).orThrow(),
        { message: "after", generation: 2 },
      );
    } finally {
      await client.connection.close().catch(() => undefined);
      await service.stop().catch(() => undefined);
    }
  },
});

async function connectService(
  trellisUrl: string,
  sessionKeySeed: string,
  generation: number,
) {
  const service = await TrellisService.connect({
    trellisUrl,
    contract: serviceContract,
    name: serviceName,
    sessionKeySeed,
    telemetry: false,
    server: { log: false },
  }).orThrow();
  service.handle.rpc.catalogRestart.ping(({ input }) =>
    Result.ok({ message: input.message, generation })
  );
  return service;
}
