import type { Hono } from "@hono/hono";

import { ensureAdminBootstrapFlow } from "../auth/account_flows/bootstrap.ts";
import { registerAuth } from "../auth/register.ts";
import { registerCatalog } from "../catalog/register.ts";
import { createContractsModule } from "../catalog/runtime.ts";
import type { Config } from "../config.ts";
import { registerState } from "../state/register.ts";
import { createSessionResolver, createStateHandlers } from "../state/rpc.ts";
import { StateStore } from "../state/storage.ts";
import {
  resolveBuiltinContracts,
  startControlPlaneBackgroundTasks,
} from "./control_plane.ts";
import type { RuntimeGlobals } from "./globals.ts";
import type { AuthLogger } from "../auth/runtime_deps.ts";
import type { DeploymentAuthoritySurface } from "../auth/schemas.ts";
import type { SqlDeploymentAuthorityRepository } from "../auth/storage.ts";

type ControlPlaneRegistrationRuntime = Omit<RuntimeGlobals, "logger"> & {
  logger: AuthLogger;
};

function createCatalogAuthorityStorage(
  storage: SqlDeploymentAuthorityRepository,
) {
  return {
    async get(deploymentId: string) {
      return await storage.get(deploymentId);
    },
    async listEnabled() {
      return await storage.listEnabled();
    },
    async listEnabledBySurface(surface: DeploymentAuthoritySurface) {
      return (await storage.listEnabled())
        .filter((authority) =>
          authority.desiredState.surfaces.some((allowed) =>
            allowed.contractId === surface.contractId &&
            allowed.kind === surface.kind &&
            allowed.name === surface.name &&
            allowed.action === surface.action
          )
        );
    },
  };
}

/** Registers Trellis control-plane RPCs, HTTP routes, and background tasks. */
export async function registerControlPlane(deps: {
  app: Hono;
  config: Config;
  runtime: ControlPlaneRegistrationRuntime;
}): Promise<ReturnType<typeof startControlPlaneBackgroundTasks>> {
  const { app, config, runtime } = deps;
  const {
    browserFlowsKV,
    connectionsKV,
    contractStorage,
    deploymentAuthorityStorage,
    capabilityDefinitionStorage,
    deploymentAuthorityGrantOverrideStorage,
    deploymentAuthorityPlanStorage,
    deploymentPortalRouteStorage,
    implementationOfferStorage,
    materializedAuthorityStorage,
    materializedResourceBindingStorage,
    authorityReconciliationStorage,
    identityAuthorityStorage,
    identityGrantStorage,
    accountFlowStorage,
    accountStorage,
    capabilityGroupStorage,
    loginPortalStorage,
    deviceActivationReviewStorage,
    deviceActivationStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    deviceProvisioningSecretStorage,
    logger,
    localCredentialStorage,
    natsAuth,
    natsSystem,
    natsTrellis,
    jetstreamReplicas,
    oauthStateKV,
    pendingAuthKV,
    sentinelCreds,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    sessionStorage,
    stateKV,
    trellis,
    userIdentityStorage,
    userStorage,
  } = runtime;
  const catalogAuthorityStorage = createCatalogAuthorityStorage(
    deploymentAuthorityStorage,
  );

  const contracts = createContractsModule({
    builtinContracts: resolveBuiltinContracts(),
    contractStorage,
    implementationOfferStorage,
    deploymentAuthorityStorage: catalogAuthorityStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    logger,
    serviceInstanceStorage,
    serviceDeploymentStorage,
  });

  const stateHandlers = createStateHandlers({
    sessionResolver: createSessionResolver(sessionStorage),
    state: new StateStore({ kv: stateKV }),
    contracts,
  });

  await registerCatalog({
    trellis,
    contracts,
    serviceInstanceStorage,
    serviceDeploymentStorage,
    deviceInstanceStorage,
    deviceDeploymentStorage,
    deploymentAuthorityStorage: catalogAuthorityStorage,
    materializedAuthorityStorage,
    implementationOfferStorage,
    connectionsKV,
    logger,
  });

  await registerState({ trellis, stateHandlers });

  await registerAuth({
    app,
    config,
    trellis,
    contracts,
    contractStorage,
    deploymentAuthorityStorage,
    deploymentAuthorityPlanStorage,
    materializedAuthorityStorage,
    materializedResourceBindingStorage,
    authorityReconciliationStorage,
    implementationOfferStorage,
    deploymentPortalRouteStorage,
    deploymentAuthorityGrantOverrideStorage,
    identityAuthorityStorage,
    accountFlowStorage,
    loginPortalStorage,
    accountStorage,
    capabilityDefinitionStorage,
    capabilityGroupStorage,
    userIdentityStorage,
    localCredentialStorage,
    userStorage,
    identityGrantStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    deviceActivationStorage,
    deviceActivationReviewStorage,
    deviceProvisioningSecretStorage,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    sessionStorage,
    browserFlowsKV,
    connectionsKV,
    logger,
    natsAuth,
    natsSystem,
    natsTrellis,
    jetstreamReplicas,
    oauthStateKV,
    pendingAuthKV,
    sentinelCreds,
  });

  await ensureAdminBootstrapFlow({
    accountStorage,
    userIdentityStorage,
    localCredentialStorage,
    capabilityGroupStorage,
    accountFlowStorage,
    portalBaseUrl: config.web.publicOrigin ?? config.oauth.redirectBase,
    logger,
  });

  return startControlPlaneBackgroundTasks({
    contractStorage,
    capabilityGroupStorage,
    userStorage,
    deploymentAuthorityStorage,
    deploymentAuthorityGrantOverrideStorage,
    materializedAuthorityStorage,
    materializedResourceBindingStorage,
    authorityReconciliationStorage,
    implementationOfferStorage,
    deviceActivationStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    connectionsKV,
    logger,
    natsAuth,
    natsSystem,
    natsTrellis,
    jetstreamReplicas,
    sessionStorage,
    trellis,
    contracts,
    config,
  });
}
