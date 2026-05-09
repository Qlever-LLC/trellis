import type { Hono } from "@hono/hono";
import type { SqlContractStorageRepository } from "../catalog/storage.ts";
import type { Config } from "../config.ts";
import type { AuthRuntimeDeps } from "./runtime_deps.ts";
import { registerApprovalAndUserRpcs } from "./registration/approval_users.ts";
import { registerDeviceAdminAndActivation } from "./registration/device_admin_activation.ts";
import { registerAuthHttpRoutes } from "./registration/http_routes.ts";
import { registerServiceAdminRpcs } from "./registration/service_admin.ts";
import { registerSessionRpcs } from "./registration/session.ts";
import type {
  AuthContractsRuntime,
  AuthRuntime,
} from "./registration/types.ts";
import type {
  SqlIdentityEnvelopeRepository,
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeploymentGrantOverrideRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeploymentResourceBindingRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlEnvelopeExpansionRequestRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
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
    deploymentResourceBindingStorage: SqlDeploymentResourceBindingRepository;
    deploymentContractEvidenceStorage: SqlDeploymentContractEvidenceRepository;
    deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
    deploymentGrantOverrideStorage: SqlDeploymentGrantOverrideRepository;
    envelopeExpansionRequestStorage: SqlEnvelopeExpansionRequestRepository;
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
    (await deps.trellis.publish("Auth.Sessions.Revoked", event)).inspectErr(
      (error) =>
        deps.logger.warn({ error }, "Failed to publish Auth.Sessions.Revoked"),
    );
  };
  await registerServiceAdminRpcs(deps);
  await registerSessionRpcs(deps);
  await registerApprovalAndUserRpcs({ ...deps, publishSessionRevoked });
  await registerDeviceAdminAndActivation({ ...deps, publishSessionRevoked });
  registerAuthHttpRoutes(deps);
}
