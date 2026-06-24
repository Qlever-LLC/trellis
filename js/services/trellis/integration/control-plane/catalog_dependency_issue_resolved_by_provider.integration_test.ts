import { assert, assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID =
  "control-plane.catalog-dependency-issue-resolved-by-provider" as const;

const schemas = {
  PingInput: Type.Object({ message: Type.String() }),
  PingOutput: Type.Object({ message: Type.String(), servedBy: Type.String() }),
} as const;

const providerContract = defineServiceContract({ schemas }, (ref) => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.catalog-dependency-provider",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Catalog Dependency Provider",
  description:
    "Provides an RPC used to prove catalog dependency availability changes when a provider appears.",
  rpc: {
    "CatalogDependency.Ping": {
      version: "v1",
      subject: caseScopedSubject(
        "rpc.v1.integration.control-plane.catalog-dependency-provider",
        CASE_ID,
        "CatalogDependency.Ping",
      ),
      input: ref.schema("PingInput"),
      output: ref.schema("PingOutput"),
      errors: [],
    },
  },
}));

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.catalog-dependency-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Catalog Dependency Client",
  description:
    "Requires the catalog dependency provider RPC for dependency-resolution coverage.",
  uses: {
    required: {
      dependencyProvider: providerContract.use({
        rpc: { call: ["CatalogDependency.Ping"] },
      }),
    },
  },
}));

const providerName = caseScopedName("catalog-dependency-provider", CASE_ID);
const clientName = caseScopedName("catalog-dependency-client", CASE_ID);
const shapeOnlyDeployment = caseScopedName(
  "catalog-dependency-shape-only",
  CASE_ID,
);

liveTrellisTest({
  name:
    "control-plane.catalog-dependency-issue-resolved-by-provider resolves an app dependency issue when a provider contract appears",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.contracts.approve({
      deployment: shapeOnlyDeployment,
      contract: providerContract,
    });

    const client = await runtime.connectClient({
      name: clientName,
      contract: clientContract,
    });

    let service: { stop(): Promise<void> } | undefined;
    try {
      await assertProviderRpcUnavailable(client);

      const providerKey = await runtime.registerService({
        name: providerName,
        contract: providerContract,
      });
      const connectedService = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: providerContract,
        name: providerName,
        sessionKeySeed: providerKey.seed,
        telemetry: false,
        server: { log: false },
      }).orThrow();
      service = connectedService;
      connectedService.handle.rpc.catalogDependency.ping(({ input }) =>
        Result.ok({ message: input.message, servedBy: providerName })
      );

      const result = await runtime.waitFor(async () => {
        try {
          return await client.rpc.catalogDependency.ping({
            message: "after-provider",
          }).orThrow();
        } catch {
          return false;
        }
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(result, {
        message: "after-provider",
        servedBy: providerName,
      });
    } finally {
      await client.connection.close().catch(() => undefined);
      await service?.stop().catch(() => undefined);
    }
  },
});

async function assertProviderRpcUnavailable(
  client: ProviderRpcClient,
) {
  let error: unknown;
  try {
    await client.rpc.catalogDependency.ping({ message: "before-provider" })
      .orThrow();
  } catch (caught) {
    error = caught;
  }

  assert(
    error !== undefined,
    "expected provider RPC to fail before service start",
  );
}

type ProviderRpcClient = {
  readonly rpc: {
    readonly catalogDependency: {
      ping(input: { message: string }): {
        orThrow(): Promise<unknown>;
      };
    };
  };
};
