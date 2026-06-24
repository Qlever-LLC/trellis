import { assert, assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as trellisCore } from "@qlever-llc/trellis/sdk/core.ts";
import type { TrellisCatalogOutput } from "@qlever-llc/trellis/sdk/core.ts";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID =
  "control-plane.catalog-force-replace-resolves-catalog-issue" as const;
const serviceContractId = caseScopedContractId(
  "trellis.integration.control-plane.catalog-force-replace-service",
  CASE_ID,
);
const serviceSubject = caseScopedSubject(
  "rpc.v1.integration.control-plane.catalog-force-replace",
  CASE_ID,
  "CatalogForce.Ping",
);

const baseSchemas = {
  PingInput: Type.Object({ message: Type.String() }),
  PingOutput: Type.Object({
    message: Type.String(),
    variant: Type.Literal("base"),
  }),
} as const;

const replacementSchemas = {
  PingInput: Type.Object({ count: Type.Number() }),
  PingOutput: Type.Object({
    count: Type.Number(),
    variant: Type.Literal("replacement"),
  }),
} as const;

const baseServiceContract = defineServiceContract({ schemas: baseSchemas }, (
  ref,
) => ({
  id: serviceContractId,
  displayName: "Trellis Control-Plane Catalog Force Replace Service",
  description:
    "Provides the base contract digest for catalog force-replace integration coverage.",
  rpc: {
    "CatalogForce.Ping": {
      version: "v1",
      subject: serviceSubject,
      input: ref.schema("PingInput"),
      output: ref.schema("PingOutput"),
      errors: [],
    },
  },
}));

const replacementServiceContract = defineServiceContract(
  { schemas: replacementSchemas },
  (ref) => ({
    id: serviceContractId,
    displayName: "Trellis Control-Plane Catalog Force Replace Service",
    description:
      "Provides an incompatible replacement digest for catalog force-replace integration coverage.",
    rpc: {
      "CatalogForce.Ping": {
        version: "v1",
        subject: serviceSubject,
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        errors: [],
      },
    },
  }),
);

const baseClientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.catalog-force-replace-base-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Catalog Force Replace Base Client",
  description: "Calls the base force-replace probe service contract.",
  uses: {
    required: {
      forceReplaceService: baseServiceContract.use({
        rpc: { call: ["CatalogForce.Ping"] },
      }),
    },
  },
}));

const catalogAdminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.catalog-force-replace-admin-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Catalog Force Replace Admin Client",
  description:
    "Observes the public catalog and invokes catalog issue resolution through generated admin RPCs.",
  uses: {
    required: {
      core: trellisCore.use({ rpc: { call: ["Trellis.Catalog"] } }),
      auth: trellisAuth.use({
        rpc: { call: ["Auth.CatalogIssues.Resolve"] },
      }),
    },
  },
}));

const baseDeploymentId = caseScopedName(
  "catalog-force-replace-base-deployment",
  CASE_ID,
);
const replacementDeploymentId = caseScopedName(
  "catalog-force-replace-replacement-deployment",
  CASE_ID,
);
const baseServiceName = caseScopedName("catalog-force-replace-base", CASE_ID);
const replacementServiceName = caseScopedName(
  "catalog-force-replace-replacement",
  CASE_ID,
);
const baseClientName = caseScopedName(
  "catalog-force-replace-base-client",
  CASE_ID,
);
const catalogAdminName = caseScopedName(
  "catalog-force-replace-admin-client",
  CASE_ID,
);

liveTrellisTest({
  name:
    "control-plane.catalog-force-replace-resolves-catalog-issue resolves incompatible active catalog issue with force-replace",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.deployments.create({
      id: baseDeploymentId,
      mutableDev: false,
    });
    await runtime.deployments.create({
      id: replacementDeploymentId,
      mutableDev: false,
    });

    const baseKey = await runtime.services.createInstance({
      deployment: baseDeploymentId,
      name: baseServiceName,
      contract: baseServiceContract,
    });
    const baseService = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: baseServiceContract,
      name: baseServiceName,
      sessionKeySeed: baseKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    const catalogAdmin = await runtime.connectClient({
      name: catalogAdminName,
      contract: catalogAdminContract,
    });
    let replacementService: { stop(): Promise<void> } | undefined;

    try {
      baseService.handle.rpc.catalogForce.ping(({ input }) =>
        Result.ok({ message: input.message, variant: "base" })
      );

      const baseClient = await runtime.connectClient({
        name: baseClientName,
        contract: baseClientContract,
      });
      try {
        assertEquals(
          await baseClient.rpc.catalogForce.ping({ message: "before" })
            .orThrow(),
          { message: "before", variant: "base" },
        );
      } finally {
        await baseClient.connection.close().catch(() => undefined);
      }

      const replacementKey = await runtime.services.createInstance({
        deployment: replacementDeploymentId,
        name: replacementServiceName,
        contract: replacementServiceContract,
      });
      const connectedReplacementService = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: replacementServiceContract,
        name: replacementServiceName,
        sessionKeySeed: replacementKey.seed,
        telemetry: false,
        server: { log: false },
      }).orThrow();
      replacementService = connectedReplacementService;
      connectedReplacementService.handle.rpc.catalogForce.ping(({ input }) =>
        Result.ok({ count: input.count, variant: "replacement" })
      );

      const issue = await runtime.waitFor(async () => {
        const catalog = await catalogAdmin.rpc.trellis.catalog({}).orThrow();
        return findForceReplaceIssue(catalog) ?? false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(issue.digest, replacementServiceContract.CONTRACT_DIGEST);
      assertEquals(issue.effectiveDigests, [
        baseServiceContract.CONTRACT_DIGEST,
      ]);
      assert(
        issue.actions.some((action) => action.action === "force-replace"),
        "expected catalog issue to expose the public force-replace action",
      );

      assertEquals(
        await catalogAdmin.rpc.auth.catalogIssuesResolve({
          issueId: issue.issueId,
          action: "force-replace",
        }).orThrow(),
        {
          success: true,
          issueId: issue.issueId,
          action: "force-replace",
        },
      );

      const postResolve = await runtime.waitFor(async () => {
        const catalog = await catalogAdmin.rpc.trellis.catalog({}).orThrow();
        return findForceReplaceIssue(catalog) === undefined ? catalog : false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(findForceReplaceIssue(postResolve), undefined);
      assert(
        postResolve.catalog.contracts.some((contract) =>
          contract.id === serviceContractId &&
          contract.digest === replacementServiceContract.CONTRACT_DIGEST
        ),
        "expected replacement digest to become the active catalog contract",
      );
    } finally {
      await catalogAdmin.connection.close().catch(() => undefined);
      await replacementService?.stop().catch(() => undefined);
      await baseService.stop().catch(() => undefined);
    }
  },
});

function findForceReplaceIssue(catalog: TrellisCatalogOutput) {
  return catalog.catalog.issues?.find((issue) =>
    issue.kind === "incompatible-active-contract" &&
    issue.contractId === serviceContractId &&
    issue.conflictingDigest === replacementServiceContract.CONTRACT_DIGEST &&
    issue.effectiveDigests?.includes(baseServiceContract.CONTRACT_DIGEST!)
  );
}
