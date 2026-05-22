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

/** Registers Trellis control-plane RPCs, HTTP routes, and background tasks. */
export async function registerControlPlane(deps: {
  app: Hono;
  config: Config;
  runtime: RuntimeGlobals;
}): Promise<ReturnType<typeof startControlPlaneBackgroundTasks>> {
  const { app, config, runtime } = deps;
  const {
    browserFlowsKV,
    connectionsKV,
    contractApprovalStorage,
    contractStorage,
    deploymentContractEvidenceStorage,
    deploymentEnvelopeStorage,
    deploymentGrantOverrideStorage,
    deploymentPortalRouteStorage,
    envelopeExpansionRequestStorage,
    deploymentResourceBindingStorage,
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

  const contracts = createContractsModule({
    builtinContracts: resolveBuiltinContracts(),
    contractStorage,
    deploymentContractEvidenceStorage,
    deploymentEnvelopeStorage,
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
    deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage,
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
    deploymentEnvelopeStorage,
    deploymentResourceBindingStorage,
    deploymentContractEvidenceStorage,
    deploymentPortalRouteStorage,
    deploymentGrantOverrideStorage,
    envelopeExpansionRequestStorage,
    accountFlowStorage,
    loginPortalStorage,
    accountStorage,
    capabilityGroupStorage,
    userIdentityStorage,
    localCredentialStorage,
    userStorage,
    contractApprovalStorage,
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
    contractApprovalStorage,
    deploymentEnvelopeStorage,
    envelopeExpansionRequestStorage,
    deviceActivationStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    connectionsKV,
    logger,
    natsAuth,
    natsSystem,
    sessionStorage,
    trellis,
    contracts,
    config,
  });
}
