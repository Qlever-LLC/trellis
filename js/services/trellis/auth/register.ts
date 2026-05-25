import type { Hono } from "@hono/hono";
import type { SqlContractStorageRepository } from "../catalog/storage.ts";
import type { Config } from "../config.ts";
import type { AuthRuntimeDeps } from "./runtime_deps.ts";
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
  SqlAccountFlowRepository,
  SqlCapabilityGroupRepository,
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeploymentGrantOverrideRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeploymentResourceBindingRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlEnvelopeExpansionRequestRepository,
  SqlEnvelopeHistoryRepository,
  SqlIdentityEnvelopeRepository,
  SqlLocalCredentialRepository,
  SqlLoginPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
  SqlUserProjectionRepository,
} from "./storage.ts";

type AuthRegistrationDeps =
  & {
    app: Hono;
    config: Config;
    trellis: AuthRuntime;
    contracts: AuthContractsRuntime;
    contractStorage: SqlContractStorageRepository;
    deploymentEnvelopeStorage: SqlDeploymentEnvelopeRepository;
    envelopeHistoryStorage: SqlEnvelopeHistoryRepository;
    deploymentResourceBindingStorage: SqlDeploymentResourceBindingRepository;
    deploymentContractEvidenceStorage: SqlDeploymentContractEvidenceRepository;
    deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
    deploymentGrantOverrideStorage: SqlDeploymentGrantOverrideRepository;
    envelopeExpansionRequestStorage: SqlEnvelopeExpansionRequestRepository;
    accountFlowStorage: SqlAccountFlowRepository;
    loginPortalStorage: SqlLoginPortalRepository;
    accountStorage: SqlUserAccountRepository;
    capabilityGroupStorage: SqlCapabilityGroupRepository;
    userIdentityStorage: SqlUserIdentityRepository;
    localCredentialStorage: SqlLocalCredentialRepository;
    userStorage: SqlUserProjectionRepository;
    contractApprovalStorage: SqlIdentityEnvelopeRepository;
    deviceDeploymentStorage: SqlDeviceDeploymentRepository;
    deviceInstanceStorage: SqlDeviceInstanceRepository;
    deviceActivationStorage: SqlDeviceActivationRepository;
    serviceDeploymentStorage: SqlServiceDeploymentRepository;
    serviceInstanceStorage: SqlServiceInstanceRepository;
    sessionStorage: SqlSessionRepository;
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
  await registerServiceAdminRpcs(deps);
  await registerPortalAdminRpcs(deps);
  await registerSessionRpcs(deps);
  await registerApprovalAndUserRpcs({ ...deps, publishSessionRevoked });
  await registerDeviceAdminAndActivation({ ...deps, publishSessionRevoked });
  registerAuthHttpRoutes(deps);
}
