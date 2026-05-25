import { createKick } from "../callout/kick.ts";
import {
  createAuthEnvelopeExpansionsListHandler,
  createAuthEnvelopeExpansionsRejectHandler,
  createAuthEnvelopesApproveRequestHandler,
  createAuthEnvelopesChangesPreviewHandler,
  createAuthEnvelopesExpandHandler,
  createAuthEnvelopesGetHandler,
  createAuthEnvelopesGrantOverridesListHandler,
  createAuthEnvelopesGrantOverridesPutHandler,
  createAuthEnvelopesGrantOverridesRemoveHandler,
  createAuthEnvelopesListHandler,
  createAuthEnvelopesShrinkHandler,
} from "../admin/envelopes_rpc.ts";
import {
  createAuthServiceInstancesDisableHandler,
  createAuthServiceInstancesEnableHandler,
  createAuthServiceInstancesListHandler,
  createAuthServiceInstancesProvisionHandler,
  createAuthServiceInstancesRemoveHandler,
} from "../admin/service_rpc.ts";
import type { AuthContractsRuntime, RpcRegistrar } from "./types.ts";
import type { AuthRuntimeDeps, RuntimeKV } from "../runtime_deps.ts";
import type { Connection } from "../schemas.ts";
import type {
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeploymentGrantOverrideRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeploymentResourceBindingRepository,
  SqlDeviceDeploymentRepository,
  SqlEnvelopeExpansionRequestRepository,
  SqlEnvelopeHistoryRepository,
  SqlIdentityEnvelopeRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
} from "../storage.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type { Config } from "../../config.ts";

export async function registerServiceAdminRpcs(deps: {
  config: Config;
  trellis: RpcRegistrar;
  connectionsKV: RuntimeKV<Connection>;
  sessionStorage: SqlSessionRepository;
  contractStorage: SqlContractStorageRepository;
  deploymentEnvelopeStorage: SqlDeploymentEnvelopeRepository;
  envelopeHistoryStorage: SqlEnvelopeHistoryRepository;
  deploymentResourceBindingStorage: SqlDeploymentResourceBindingRepository;
  deploymentContractEvidenceStorage: SqlDeploymentContractEvidenceRepository;
  deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
  deploymentGrantOverrideStorage: SqlDeploymentGrantOverrideRepository;
  envelopeExpansionRequestStorage: SqlEnvelopeExpansionRequestRepository;
  contractApprovalStorage: SqlIdentityEnvelopeRepository;
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
    deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
  };

  await deps.trellis.handle.rpc.auth.envelopesList(
    createAuthEnvelopesListHandler({
      deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopesGet(
    createAuthEnvelopesGetHandler({
      deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
      deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
      deploymentContractEvidenceStorage: deps.deploymentContractEvidenceStorage,
      envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
      deploymentPortalRouteStorage: deps.deploymentPortalRouteStorage,
      deploymentGrantOverrideStorage: deps.deploymentGrantOverrideStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopesGrantOverridesList(
    createAuthEnvelopesGrantOverridesListHandler({
      deploymentGrantOverrideStorage: deps.deploymentGrantOverrideStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopesGrantOverridesPut(
    createAuthEnvelopesGrantOverridesPutHandler({
      deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
      deploymentGrantOverrideStorage: deps.deploymentGrantOverrideStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopesGrantOverridesRemove(
    createAuthEnvelopesGrantOverridesRemoveHandler({
      deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
      deploymentGrantOverrideStorage: deps.deploymentGrantOverrideStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopesExpand(
    createAuthEnvelopesExpandHandler({
      contracts: deps.contracts,
      contractStorage: deps.contractStorage,
      deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
      envelopeHistoryStorage: deps.envelopeHistoryStorage,
      deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
      deploymentContractEvidenceStorage: deps.deploymentContractEvidenceStorage,
      nats: deps.natsTrellis,
      resourceProvisioningOptions: {
        jetstreamReplicas: deps.config.nats.jetstream.replicas,
      },
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopeExpansionsApprove(
    createAuthEnvelopesApproveRequestHandler({
      contracts: deps.contracts,
      contractStorage: deps.contractStorage,
      deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
      envelopeHistoryStorage: deps.envelopeHistoryStorage,
      deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
      deploymentContractEvidenceStorage: deps.deploymentContractEvidenceStorage,
      envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
      nats: deps.natsTrellis,
      resourceProvisioningOptions: {
        jetstreamReplicas: deps.config.nats.jetstream.replicas,
      },
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopeExpansionsList(
    createAuthEnvelopeExpansionsListHandler({
      envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopeExpansionsReject(
    createAuthEnvelopeExpansionsRejectHandler({
      envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopesChangesPreview(
    createAuthEnvelopesChangesPreviewHandler({
      contracts: deps.contracts,
      deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
      deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
      deploymentContractEvidenceStorage: deps.deploymentContractEvidenceStorage,
      identityEnvelopeStorage: deps.contractApprovalStorage,
      envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
      sessionStorage: deps.sessionStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.handle.rpc.auth.envelopesShrink(
    createAuthEnvelopesShrinkHandler({
      contracts: deps.contracts,
      deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
      envelopeHistoryStorage: deps.envelopeHistoryStorage,
      deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
      deploymentContractEvidenceStorage: deps.deploymentContractEvidenceStorage,
      identityEnvelopeStorage: deps.contractApprovalStorage,
      envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
      kick,
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
