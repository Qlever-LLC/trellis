import type { Hono } from "@hono/hono";
import type { SqlContractStorageRepository } from "../catalog/storage.ts";
import type { Config } from "../config.ts";
import type { AuthRuntimeDeps } from "./runtime_deps.ts";
import { registerApprovalAndUserRpcs } from "./registration/approval_users.ts";
import { registerDeviceAdminAndActivation } from "./registration/device_admin_activation.ts";
import { registerAuthHttpRoutes } from "./registration/http_routes.ts";
import { registerInstalledContractRpcs } from "./registration/installed_contracts.ts";
import { registerPortalPolicyAdminRpcs } from "./registration/portal_policy_admin.ts";
import { registerServiceAdminRpcs } from "./registration/service_admin.ts";
import { registerSessionRpcs } from "./registration/session.ts";
import type {
  AuthContractsRuntime,
  AuthRuntime,
} from "./registration/types.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalRepository,
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
    userStorage: SqlUserProjectionRepository;
    contractApprovalStorage: SqlContractApprovalRepository;
    portalStorage: SqlPortalRepository;
    portalDefaultStorage: SqlPortalDefaultRepository;
    loginPortalSelectionStorage: SqlLoginPortalSelectionRepository;
    devicePortalSelectionStorage: SqlDevicePortalSelectionRepository;
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
    | "instanceGrantPolicyStorage"
    | "portalProfileStorage"
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
    (await deps.trellis.publish("Auth.SessionRevoked", event)).inspectErr(
      (error) =>
        deps.logger.warn({ error }, "Failed to publish Auth.SessionRevoked"),
    );
  };
  await registerInstalledContractRpcs(deps);
  await registerServiceAdminRpcs(deps);
  await registerSessionRpcs(deps);
  await registerApprovalAndUserRpcs({ ...deps, publishSessionRevoked });
  await registerPortalPolicyAdminRpcs({ ...deps, publishSessionRevoked });
  await registerDeviceAdminAndActivation({ ...deps, publishSessionRevoked });
  registerAuthHttpRoutes(deps);
}
