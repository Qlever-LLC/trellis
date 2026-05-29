import { isErr, Result } from "@qlever-llc/result";
import { ValidationError } from "@qlever-llc/trellis";
import { ulid } from "ulid";
import { createKick } from "../callout/kick.ts";
import {
  createAuthDeploymentAuthorityAcceptMigrationHandler,
  createAuthDeploymentAuthorityAcceptUpdateHandler,
  createAuthDeploymentAuthorityGetHandler,
  createAuthDeploymentAuthorityGrantOverridesListHandler,
  createAuthDeploymentAuthorityGrantOverridesPutHandler,
  createAuthDeploymentAuthorityGrantOverridesRemoveHandler,
  createAuthDeploymentAuthorityListHandler,
  createAuthDeploymentAuthorityPlansGetHandler,
  createAuthDeploymentAuthorityPlansListHandler,
  createAuthDeploymentAuthorityReconcileHandler,
  createAuthDeploymentAuthorityRejectHandler,
} from "../admin/authority_rpc.ts";
import {
  createAuthServiceInstancesDisableHandler,
  createAuthServiceInstancesEnableHandler,
  createAuthServiceInstancesListHandler,
  createAuthServiceInstancesProvisionHandler,
  createAuthServiceInstancesRemoveHandler,
} from "../admin/service_rpc.ts";
import { analyzeContractProposal } from "../contract_proposal_analysis.ts";
import { computeAuthorityNeedsDelta } from "../authority_needs_decision.ts";
import { classifyDeploymentAuthorityPlan } from "../deployment_authority_plan.ts";
import type { AuthContractsRuntime, RpcRegistrar } from "./types.ts";
import type { AuthRuntimeDeps, RuntimeKV } from "../runtime_deps.ts";
import type {
  AuthorityNeedSet,
  Connection,
  DeploymentAuthority,
  DeploymentAuthorityGrantOverride,
  DeploymentAuthorityPlan,
} from "../schemas.ts";
import type {
  BoundedListQuery,
  ListPage,
  SqlDeploymentAuthorityPlanRepository,
  SqlDeploymentAuthorityRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeviceDeploymentRepository,
  SqlImplementationOfferRepository,
  SqlMaterializedAuthorityRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
} from "../storage.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type { Config } from "../../config.ts";
import type { createAuthorityReconciler } from "../reconciliation/authority_reconciler.ts";

function authoritySurfaces(needs: AuthorityNeedSet) {
  return needs.surfaces.map(({ required: _required, ...surface }) => surface);
}

function authorityNeeds(needs: AuthorityNeedSet) {
  return [
    ...needs.contracts.map((contract) => ({
      kind: "contract" as const,
      contractId: contract.contractId,
      required: contract.required,
    })),
    ...needs.surfaces.map(({ required, ...surface }) => ({
      kind: "surface" as const,
      surface,
      required,
    })),
    ...needs.capabilities.map((capability) => ({
      kind: "capability" as const,
      capability,
      required: true,
    })),
    ...needs.resources.map((resource) => ({
      kind: "resource" as const,
      resource,
      required: resource.required,
    })),
  ];
}

const EMPTY_AUTHORITY_NEEDS: AuthorityNeedSet = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function normalizedNeeds(needs: AuthorityNeedSet): AuthorityNeedSet {
  return computeAuthorityNeedsDelta(EMPTY_AUTHORITY_NEEDS, needs);
}

function mergeNeeds(...needs: AuthorityNeedSet[]): AuthorityNeedSet {
  return normalizedNeeds({
    contracts: needs.flatMap((entry) => entry.contracts),
    surfaces: needs.flatMap((entry) => entry.surfaces),
    capabilities: needs.flatMap((entry) => entry.capabilities),
    resources: needs.flatMap((entry) => entry.resources),
  });
}

function currentNeeds(authority: DeploymentAuthority): AuthorityNeedSet {
  return {
    contracts: authority.desiredState.needs.flatMap((need) =>
      need.kind === "contract"
        ? [{ contractId: need.contractId, required: need.required }]
        : []
    ),
    surfaces: authority.desiredState.needs.flatMap((need) =>
      need.kind === "surface"
        ? [{ ...need.surface, required: need.required }]
        : []
    ),
    capabilities: authority.desiredState.capabilities,
    resources: authority.desiredState.resources,
  };
}

function contractIdOf(
  contract: Record<string, unknown>,
  fallback: string,
): string {
  return typeof contract.id === "string" && contract.id.length > 0
    ? contract.id
    : fallback;
}

function invalid(
  path: string,
  message: string,
  context?: Record<string, unknown>,
) {
  return Result.err(
    new ValidationError({
      errors: [{ path, message }],
      ...(context ? { context } : {}),
    }),
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

type TemporaryDeploymentAuthorityGrantOverrideStorage = {
  listByDeployment(
    deploymentId: string,
  ): Promise<DeploymentAuthorityGrantOverride[]>;
  listCountedPage(
    query: BoundedListQuery,
  ): Promise<ListPage<DeploymentAuthorityGrantOverride>>;
  replaceForDeployment(
    deploymentId: string,
    records: DeploymentAuthorityGrantOverride[],
  ): Promise<void>;
};

export async function registerServiceAdminRpcs(deps: {
  config: Config;
  trellis: RpcRegistrar;
  connectionsKV: RuntimeKV<Connection>;
  sessionStorage: SqlSessionRepository;
  contractStorage: SqlContractStorageRepository;
  deploymentAuthorityStorage: SqlDeploymentAuthorityRepository;
  deploymentAuthorityPlanStorage: SqlDeploymentAuthorityPlanRepository;
  materializedAuthorityStorage: SqlMaterializedAuthorityRepository;
  implementationOfferStorage: SqlImplementationOfferRepository;
  deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
  deploymentAuthorityGrantOverrideStorage:
    TemporaryDeploymentAuthorityGrantOverrideStorage;
  authorityReconciler: ReturnType<typeof createAuthorityReconciler>;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  natsSystem: {
    request(subject: string, payload?: string): Promise<unknown>;
  };
  natsTrellis: AuthRuntimeDeps["natsTrellis"];
  logger: Pick<AuthRuntimeDeps["logger"], "debug" | "trace" | "warn">;
  contracts: Pick<
    AuthContractsRuntime,
    | "getActiveContractsById"
    | "getActiveEntries"
    | "getKnownContract"
    | "getKnownEntriesByContractId"
    | "installDeviceContract"
    | "installServiceContract"
    | "validateContract"
    | "refreshActiveContracts"
    | "refreshActiveContractsForRemoval"
    | "validateActiveCatalog"
    | "validateActiveCatalogForRemoval"
  >;
}): Promise<void> {
  const kick = createKick({ logger: deps.logger, natsSystem: deps.natsSystem });
  const serviceAdminDeps = {
    logger: deps.logger,
    deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
  };

  const listDeploymentAuthorities = createAuthDeploymentAuthorityListHandler({
    deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
    logger: deps.logger,
  });
  const getDeploymentAuthority = createAuthDeploymentAuthorityGetHandler({
    deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
    materializedAuthorityStorage: deps.materializedAuthorityStorage,
    deploymentPortalRouteStorage: deps.deploymentPortalRouteStorage,
    deploymentAuthorityGrantOverrideStorage:
      deps.deploymentAuthorityGrantOverrideStorage,
    logger: deps.logger,
  });

  await deps.trellis.handle.rpc.auth.deploymentAuthorityList(
    listDeploymentAuthorities,
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityGet(
    getDeploymentAuthority,
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityPlansList(
    createAuthDeploymentAuthorityPlansListHandler({
      deploymentAuthorityPlanStorage: deps.deploymentAuthorityPlanStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityPlansGet(
    createAuthDeploymentAuthorityPlansGetHandler({
      deploymentAuthorityPlanStorage: deps.deploymentAuthorityPlanStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityGrantOverridesList(
    createAuthDeploymentAuthorityGrantOverridesListHandler({
      deploymentAuthorityGrantOverrideStorage:
        deps.deploymentAuthorityGrantOverrideStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityGrantOverridesPut(
    createAuthDeploymentAuthorityGrantOverridesPutHandler({
      deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
      deploymentAuthorityGrantOverrideStorage:
        deps.deploymentAuthorityGrantOverrideStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityGrantOverridesRemove(
    createAuthDeploymentAuthorityGrantOverridesRemoveHandler({
      deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
      deploymentAuthorityGrantOverrideStorage:
        deps.deploymentAuthorityGrantOverrideStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityPlan(async (args) => {
    const current = await getDeploymentAuthority(args);
    if (current.isErr()) return current;

    let analysis;
    try {
      analysis = await analyzeContractProposal(
        deps.contracts,
        args.input.contract,
        { dependencyResolution: "knownOrPending" },
      );
    } catch (error) {
      return invalid("/contract", toError(error).message);
    }

    if (analysis.contract.digest !== args.input.expectedDigest) {
      return invalid("/expectedDigest", "contract digest did not match", {
        expectedDigest: args.input.expectedDigest,
        actualDigest: analysis.contract.digest,
      });
    }

    const requested = mergeNeeds(
      analysis.required,
      analysis.optional,
      analysis.contributedAvailability,
    );
    const detail = current.take();
    if (isErr(detail)) return detail;
    try {
      if (detail.authority.kind === "device") {
        await deps.contracts.installDeviceContract(args.input.contract);
      } else {
        await deps.contracts.installServiceContract(args.input.contract);
      }
    } catch (error) {
      const message = toError(error).message;
      if (!message.includes("references unknown contract")) {
        return invalid("/contract", message);
      }
      deps.logger.debug({ err: toError(error) }, "Contract install deferred");
    }
    const classified = classifyDeploymentAuthorityPlan(
      currentNeeds(detail.authority),
      requested,
    );
    const planBase = {
      planId:
        `${args.input.deploymentId}:${args.input.expectedDigest}:${ulid()}`,
      deploymentId: args.input.deploymentId,
      proposal: {
        deploymentId: args.input.deploymentId,
        contractId: contractIdOf(
          args.input.contract,
          analysis.contract.id,
        ),
        contractDigest: args.input.expectedDigest,
        contract: args.input.contract,
        requestedNeeds: authorityNeeds(requested),
        providedSurfaces: authoritySurfaces(requested),
        summary: {
          adapter: "deployment-authority-plan",
          desiredVersion: detail.authority.version,
        },
      },
      desiredChange: classified.desiredChange,
      materializationPreview: {
        resourceBindings: [],
        provisioning: "not-run",
      },
      warnings: [],
      createdAt: new Date().toISOString(),
      state: "pending" as const,
    };
    const plan: DeploymentAuthorityPlan = classified.classification ===
        "migration"
      ? {
        ...planBase,
        classification: "migration",
        acknowledgementRequired: true,
      }
      : { ...planBase, classification: "update" };
    try {
      await deps.deploymentAuthorityPlanStorage.put(plan);
    } catch (error) {
      return Result.err(
        new ValidationError({
          errors: [{ path: "/planId", message: toError(error).message }],
        }),
      );
    }
    return Result.ok({ plan });
  });
  await deps.trellis.handle.rpc.auth.deploymentAuthorityAcceptUpdate(
    createAuthDeploymentAuthorityAcceptUpdateHandler({
      deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
      deploymentAuthorityPlanStorage: deps.deploymentAuthorityPlanStorage,
      authorityReconciler: deps.authorityReconciler,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityAcceptMigration(
    createAuthDeploymentAuthorityAcceptMigrationHandler({
      deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
      deploymentAuthorityPlanStorage: deps.deploymentAuthorityPlanStorage,
      authorityReconciler: deps.authorityReconciler,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityReject(
    createAuthDeploymentAuthorityRejectHandler({
      deploymentAuthorityPlanStorage: deps.deploymentAuthorityPlanStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.deploymentAuthorityReconcile(
    createAuthDeploymentAuthorityReconcileHandler({
      authorityReconciler: deps.authorityReconciler,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.serviceInstancesProvision(
    createAuthServiceInstancesProvisionHandler(serviceAdminDeps),
  );
  await deps.trellis.handle.rpc.auth.serviceInstancesList(
    createAuthServiceInstancesListHandler(serviceAdminDeps),
  );
  await deps.trellis.handle.rpc.auth.serviceInstancesDisable(
    createAuthServiceInstancesDisableHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      validateActiveCatalog: deps.contracts.validateActiveCatalog,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    }),
  );
  await deps.trellis.handle.rpc.auth.serviceInstancesEnable(
    createAuthServiceInstancesEnableHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      validateActiveCatalog: deps.contracts.validateActiveCatalog,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    }),
  );
  await deps.trellis.handle.rpc.auth.serviceInstancesRemove(
    createAuthServiceInstancesRemoveHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      validateActiveCatalog: deps.contracts.validateActiveCatalog,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    }),
  );
}
