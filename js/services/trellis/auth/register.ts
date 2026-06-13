import type { Hono } from "@hono/hono";
import type {
  ContractEvent,
  ContractFeed,
  ContractOperation,
  ContractRpcMethod,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { templateToWildcard } from "../catalog/uses.ts";
import {
  jobsAdminRuntimePublishSubjects,
  operationCancelCapabilities,
  operationObserveCapabilities,
  TRANSFER_DOWNLOAD_SUBJECT_PREFIX,
  TRANSFER_UPLOAD_SUBJECT_PREFIX,
  TRELLIS_JOBS_CONTRACT_ID,
} from "../catalog/permissions.ts";
import type { SqlContractStorageRepository } from "../catalog/storage.ts";
import { createNatsAuthorityPhysicalResourceManager } from "../catalog/resources.ts";
import type { Config } from "../config.ts";
import type { AuthRuntimeDeps } from "./runtime_deps.ts";
import { createAuthorityReconciler } from "./reconciliation/authority_reconciler.ts";
import { registerApprovalAndUserRpcs } from "./registration/approval_users.ts";
import { registerDeviceAdminAndActivation } from "./registration/device_admin_activation.ts";
import { registerAuthHttpRoutes } from "./registration/http_routes.ts";
import { registerPortalAdminRpcs } from "./registration/portals_admin.ts";
import { registerServiceAdminRpcs } from "./registration/service_admin.ts";
import { registerSessionRpcs } from "./registration/session.ts";
import type {
  AuthContractsRuntime,
  AuthRuntime,
} from "./registration/types.ts";
import type {
  DeploymentAuthority,
  DeploymentAuthoritySurface,
  DeploymentResourceBinding,
  ImplementationOffer,
  MaterializedAuthorityNatsGrant,
} from "./schemas.ts";
import type {
  SqlAccountFlowRepository,
  SqlAuthorityReconciliationRepository,
  SqlCapabilityGroupRepository,
  SqlDeploymentAuthorityCapabilityDefinitionRepository,
  SqlDeploymentAuthorityGrantOverrideRepository,
  SqlDeploymentAuthorityPlanRepository,
  SqlDeploymentAuthorityRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlIdentityAuthorityRepository,
  SqlIdentityGrantRepository,
  SqlLocalCredentialRepository,
  SqlLoginPortalRepository,
  SqlMaterializedAuthorityRepository,
  SqlMaterializedResourceBindingRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
  SqlUserProjectionRepository,
} from "./storage.ts";

const PLATFORM_SERVICE_SURFACE_CONTRACT_IDS = new Set([
  "trellis.auth@v1",
  "trellis.core@v1",
  "trellis.health@v1",
]);
const TRANSFER_SERVICE_SESSION_PREFIX_PLACEHOLDER = "{serviceSessionPrefix}";

function createMaterializedResourceBindingAdapter(
  storage: SqlMaterializedResourceBindingRepository,
) {
  return {
    async get(deploymentId: string, kind: string, alias: string) {
      return (await storage.listBindingsByDeployment(deploymentId)).find((
        binding,
      ) => binding.kind === kind && binding.alias === alias);
    },
    async put(record: DeploymentResourceBinding) {
      const current = await storage.get(record.deploymentId);
      const resourceBindings = [
        ...(current?.resourceBindings ?? []).filter((binding) =>
          binding.kind !== record.kind || binding.alias !== record.alias
        ),
        record,
      ];
      await storage.put({
        deploymentId: record.deploymentId,
        desiredVersion: current?.desiredVersion ?? record.updatedAt,
        status: current?.status ?? "pending",
        resourceBindings,
        grants: current?.grants ?? { capabilities: [], surfaces: [], nats: [] },
        reconciledAt: current?.reconciledAt ?? null,
      });
    },
    listByDeployment: (deploymentId: string) =>
      storage.listBindingsByDeployment(deploymentId),
  };
}

function surfaceKey(surface: DeploymentAuthoritySurface): string {
  return JSON.stringify([
    surface.contractId,
    surface.kind,
    surface.name,
    surface.action ?? "",
  ]);
}

function surfaceGrant(input: {
  contract: TrellisContractV1;
  surface: DeploymentAuthoritySurface;
  grantSource: MaterializedAuthorityNatsGrant["grantSource"];
}): MaterializedAuthorityNatsGrant | undefined {
  const { contract, surface, grantSource } = input;
  const owned = grantSource === "owned-surface";
  if (surface.kind === "rpc") {
    const method: ContractRpcMethod | undefined = contract.rpc?.[surface.name];
    if (!method) return undefined;
    return {
      direction: owned ? "subscribe" : "publish",
      subject: templateToWildcard(method.subject),
      surface: { ...surface, kind: "rpc" },
      requiredCapabilities: owned ? [] : method.capabilities?.call ?? [],
      grantSource,
    };
  }
  if (surface.kind === "operation") {
    const operation: ContractOperation | undefined = contract.operations?.[
      surface.name
    ];
    if (!operation) return undefined;
    const control = surface.action === "observe" || surface.action === "cancel";
    const requiredCapabilities = owned
      ? []
      : surface.action === "observe"
      ? operationObserveCapabilities(operation)
      : surface.action === "cancel"
      ? operationCancelCapabilities(operation) ?? []
      : operation.capabilities?.call ?? [];
    return {
      direction: owned ? "subscribe" : "publish",
      subject: templateToWildcard(
        control ? `${operation.subject}.control` : operation.subject,
      ),
      surface: { ...surface, kind: "operation" },
      requiredCapabilities,
      grantSource,
    };
  }
  if (surface.kind === "event") {
    const event: ContractEvent | undefined = contract.events?.[surface.name];
    if (!event) return undefined;
    const action = surface.action === "subscribe" ? "subscribe" : "publish";
    return {
      direction: action,
      subject: templateToWildcard(event.subject),
      surface: { ...surface, kind: "event", action },
      requiredCapabilities: owned ? [] : event.capabilities?.[action] ?? [],
      grantSource,
    };
  }
  const feed: ContractFeed | undefined = contract.feeds?.[surface.name];
  if (!feed) return undefined;
  return {
    direction: owned ? "subscribe" : "publish",
    subject: templateToWildcard(feed.subject),
    surface: { ...surface, kind: "feed", action: "subscribe" },
    requiredCapabilities: owned ? [] : feed.capabilities?.subscribe ?? [],
    grantSource,
  };
}

function transferGrantsForOwnedSurface(input: {
  contract: TrellisContractV1;
  surface: DeploymentAuthoritySurface;
}): MaterializedAuthorityNatsGrant[] {
  const { contract, surface } = input;
  if (surface.kind === "operation" && surface.action === "call") {
    const operation: ContractOperation | undefined = contract.operations?.[
      surface.name
    ];
    if (operation?.transfer?.direction !== "send") return [];
    return [{
      direction: "subscribe",
      subject:
        `${TRANSFER_UPLOAD_SUBJECT_PREFIX}.${TRANSFER_SERVICE_SESSION_PREFIX_PLACEHOLDER}.*`,
      surface: { ...surface, kind: "operation" },
      requiredCapabilities: [],
      grantSource: "transfer",
    }];
  }
  if (surface.kind === "rpc" && surface.action === "call") {
    const method: ContractRpcMethod | undefined = contract.rpc?.[surface.name];
    if (method?.transfer?.direction !== "receive") return [];
    return [{
      direction: "subscribe",
      subject:
        `${TRANSFER_DOWNLOAD_SUBJECT_PREFIX}.${TRANSFER_SERVICE_SESSION_PREFIX_PLACEHOLDER}.*`,
      surface: { ...surface, kind: "rpc" },
      requiredCapabilities: [],
      grantSource: "transfer",
    }];
  }
  return [];
}

function jobsAdminRuntimeGrants(
  contract: TrellisContractV1,
): MaterializedAuthorityNatsGrant[] {
  if (contract.id !== TRELLIS_JOBS_CONTRACT_ID) return [];
  return jobsAdminRuntimePublishSubjects().map((subject) => ({
    direction: "publish" as const,
    subject,
    requiredCapabilities: ["service"],
    grantSource: "platform-service" as const,
  }));
}

function latestAcceptedOffersByLineage(
  offers: ImplementationOffer[],
): ImplementationOffer[] {
  const latest = new Map<string, ImplementationOffer>();
  for (const offer of offers) {
    if (offer.status !== "accepted" || offer.acceptedAt === null) continue;
    const current = latest.get(offer.lineageKey);
    if (
      current === undefined || current.acceptedAt === null ||
      offer.acceptedAt > current.acceptedAt ||
      (offer.acceptedAt === current.acceptedAt &&
        offer.lastRefreshedAt > current.lastRefreshedAt) ||
      (offer.acceptedAt === current.acceptedAt &&
        offer.lastRefreshedAt === current.lastRefreshedAt &&
        offer.offerId > current.offerId)
    ) {
      latest.set(offer.lineageKey, offer);
    }
  }
  return [...latest.values()].sort((left, right) =>
    left.lineageKey.localeCompare(right.lineageKey) ||
    left.contractId.localeCompare(right.contractId) ||
    left.contractDigest.localeCompare(right.contractDigest)
  );
}

export async function materializeAcceptedOfferNatsGrants(input: {
  authority: DeploymentAuthority;
  contracts: Pick<
    AuthContractsRuntime,
    "getKnownContract" | "getKnownContractsById"
  >;
  implementationOfferStorage: Pick<
    AuthRuntimeDeps["implementationOfferStorage"],
    "listByDeployment"
  >;
}): Promise<MaterializedAuthorityNatsGrant[]> {
  if (input.authority.kind !== "service" && input.authority.kind !== "device") {
    return [];
  }
  const offers = await input.implementationOfferStorage.listByDeployment(
    input.authority.kind,
    input.authority.deploymentId,
  );
  const contracts = new Map<string, TrellisContractV1>();
  const contractCandidates = new Map<string, TrellisContractV1[]>();
  const ownedContractIds = new Set<string>();
  for (const offer of latestAcceptedOffersByLineage(offers)) {
    ownedContractIds.add(offer.contractId);
    const contract = await input.contracts.getKnownContract(
      offer.contractDigest,
    );
    if (contract) {
      contracts.set(offer.contractId, contract);
      contractCandidates.set(offer.contractId, [contract]);
    }
  }
  const surfaces = new Map<string, {
    surface: DeploymentAuthoritySurface;
    grantSource: MaterializedAuthorityNatsGrant["grantSource"];
  }>();
  for (const surface of input.authority.desiredState.surfaces) {
    const owned = ownedContractIds.has(surface.contractId) ||
      !PLATFORM_SERVICE_SURFACE_CONTRACT_IDS.has(surface.contractId);
    surfaces.set(surfaceKey(surface), {
      surface,
      grantSource: owned ? "owned-surface" : "platform-service",
    });
  }
  for (const surface of input.authority.desiredState.needs.surfaces) {
    const key = surfaceKey(surface);
    const owned = ownedContractIds.has(surface.contractId);
    const grantSource = owned
      ? "owned-surface"
      : PLATFORM_SERVICE_SURFACE_CONTRACT_IDS.has(surface.contractId)
      ? "platform-service"
      : "used-surface";
    surfaces.set(key, { surface, grantSource });
  }
  if (input.authority.kind === "service") {
    const coreBindingSurface: DeploymentAuthoritySurface = {
      contractId: "trellis.core@v1",
      kind: "rpc",
      name: "Trellis.Bindings.Get",
      action: "call",
    };
    surfaces.set(surfaceKey(coreBindingSurface), {
      surface: coreBindingSurface,
      grantSource: "platform-service",
    });
  }
  for (const { surface } of surfaces.values()) {
    const knownContracts = await input.contracts.getKnownContractsById(
      surface.contractId,
    );
    const existing = contracts.get(surface.contractId);
    contractCandidates.set(
      surface.contractId,
      existing === undefined ? knownContracts : [
        existing,
        ...knownContracts.filter((contract) => contract !== existing),
      ],
    );
    if (existing === undefined && knownContracts[0] !== undefined) {
      contracts.set(surface.contractId, knownContracts[0]);
    }
  }
  const grants = [...surfaces.values()].flatMap(({ surface, grantSource }) => {
    const candidates = contractCandidates.get(surface.contractId) ?? [];
    const contract = candidates.find((candidate) =>
      surfaceGrant({ contract: candidate, surface, grantSource }) !== undefined
    );
    if (!contract) return [];
    const grant = surfaceGrant({ contract, surface, grantSource });
    if (!grant) return [];
    return grantSource === "owned-surface"
      ? [grant, ...transferGrantsForOwnedSurface({ contract, surface })]
      : [grant];
  }).concat([...ownedContractIds].flatMap((contractId) => {
    const contract = contracts.get(contractId);
    return contract ? jobsAdminRuntimeGrants(contract) : [];
  }));
  return [...new Map(grants.map((grant) => [
    JSON.stringify([
      grant.direction,
      grant.subject,
      grant.surface?.contractId ?? "",
      grant.surface?.kind ?? "",
      grant.surface?.name ?? "",
      grant.surface?.action ?? "",
      grant.grantSource,
    ]),
    grant,
  ])).values()].sort((left, right) =>
    left.direction.localeCompare(right.direction) ||
    left.subject.localeCompare(right.subject) ||
    (left.surface?.contractId ?? "").localeCompare(
      right.surface?.contractId ?? "",
    ) ||
    (left.surface?.kind ?? "").localeCompare(right.surface?.kind ?? "") ||
    (left.surface?.name ?? "").localeCompare(right.surface?.name ?? "") ||
    (left.surface?.action ?? "").localeCompare(right.surface?.action ?? "")
  );
}

type AuthRegistrationDeps =
  & {
    app: Hono;
    config: Config;
    trellis: AuthRuntime;
    contracts: AuthContractsRuntime;
    contractStorage: SqlContractStorageRepository;
    deploymentAuthorityStorage: SqlDeploymentAuthorityRepository;
    capabilityDefinitionStorage:
      SqlDeploymentAuthorityCapabilityDefinitionRepository;
    deploymentAuthorityPlanStorage: SqlDeploymentAuthorityPlanRepository;
    materializedAuthorityStorage: SqlMaterializedAuthorityRepository;
    materializedResourceBindingStorage:
      SqlMaterializedResourceBindingRepository;
    authorityReconciliationStorage: SqlAuthorityReconciliationRepository;
    implementationOfferStorage: AuthRuntimeDeps["implementationOfferStorage"];
    deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
    deploymentAuthorityGrantOverrideStorage:
      SqlDeploymentAuthorityGrantOverrideRepository;
    identityAuthorityStorage: SqlIdentityAuthorityRepository;
    accountFlowStorage: SqlAccountFlowRepository;
    loginPortalStorage: SqlLoginPortalRepository;
    accountStorage: SqlUserAccountRepository;
    capabilityGroupStorage: SqlCapabilityGroupRepository;
    userIdentityStorage: SqlUserIdentityRepository;
    localCredentialStorage: SqlLocalCredentialRepository;
    userStorage: SqlUserProjectionRepository;
    identityGrantStorage: SqlIdentityGrantRepository;
    deviceDeploymentStorage: SqlDeviceDeploymentRepository;
    deviceInstanceStorage: SqlDeviceInstanceRepository;
    deviceActivationStorage: SqlDeviceActivationRepository;
    serviceDeploymentStorage: SqlServiceDeploymentRepository;
    serviceInstanceStorage: SqlServiceInstanceRepository;
    sessionStorage: SqlSessionRepository;
    jetstreamReplicas: number;
  }
  & Pick<
    AuthRuntimeDeps,
    | "browserFlowsKV"
    | "connectionsKV"
    | "logger"
    | "natsAuth"
    | "natsSystem"
    | "natsTrellis"
    | "oauthStateKV"
    | "pendingAuthKV"
    | "sentinelCreds"
    | "trellis"
    | "deviceActivationReviewStorage"
    | "deviceProvisioningSecretStorage"
  >;

/**
 * Registers auth RPCs, operations, and HTTP routes.
 */
export async function registerAuth(deps: AuthRegistrationDeps): Promise<void> {
  const authorityReconciler = createAuthorityReconciler({
    deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
    materializedAuthorityStorage: deps.materializedAuthorityStorage,
    authorityReconciliationStorage: deps.authorityReconciliationStorage,
    natsGrantMaterializer: {
      materialize: async ({ authority }) =>
        await materializeAcceptedOfferNatsGrants({
          authority,
          contracts: deps.contracts,
          implementationOfferStorage: deps.implementationOfferStorage,
        }),
    },
    physicalResources: {
      manager: createNatsAuthorityPhysicalResourceManager(deps.natsTrellis, {
        jetstreamReplicas: deps.jetstreamReplicas,
      }),
    },
  });
  const registrationDeps = {
    ...deps,
    authorityReconciler,
    deploymentResourceBindingStorage: createMaterializedResourceBindingAdapter(
      deps.materializedResourceBindingStorage,
    ),
    deploymentAuthorityGrantOverrideStorage:
      deps.deploymentAuthorityGrantOverrideStorage,
    contractApprovalStorage: deps.identityGrantStorage,
  };
  const publishSessionRevoked = async (event: {
    origin: string;
    id: string;
    sessionKey: string;
    revokedBy: string;
  }) => {
    (await deps.trellis.event.auth.sessionsRevoked.publish(event)).inspectErr(
      (error) =>
        deps.logger.warn({ error }, "Failed to publish Auth.Sessions.Revoked"),
    );
  };
  await registerServiceAdminRpcs(registrationDeps);
  await registerPortalAdminRpcs(registrationDeps);
  await registerSessionRpcs(registrationDeps);
  await registerApprovalAndUserRpcs({
    ...registrationDeps,
    publishSessionRevoked,
  });
  await registerDeviceAdminAndActivation({
    ...registrationDeps,
    publishSessionRevoked,
  });
  registerAuthHttpRoutes(registrationDeps);
}

export const __testing__ = {
  materializeAcceptedOfferNatsGrants,
};
