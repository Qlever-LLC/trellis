import type { Hono } from "@hono/hono";

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
    deviceActivationReviewStorage,
    deviceActivationStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    devicePortalSelectionStorage,
    deviceProvisioningSecretStorage,
    instanceGrantPolicyStorage,
    logger,
    loginPortalSelectionStorage,
    natsAuth,
    natsTrellis,
    oauthStateKV,
    pendingAuthKV,
    portalDefaultStorage,
    portalProfileStorage,
    portalStorage,
    sentinelCreds,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    sessionStorage,
    stateKV,
    trellis,
    userStorage,
  } = runtime;

  const contracts = createContractsModule({
    builtinContracts: resolveBuiltinContracts(),
    contractStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    logger,
    serviceInstanceStorage,
    serviceDeploymentStorage,
  });

  const stateHandlers = createStateHandlers({
    sessionResolver: createSessionResolver(sessionStorage),
    state: new StateStore({ kv: stateKV }),
    contractStore: contracts.contractStore,
  });

  await registerCatalog({
    trellis,
    contracts,
    serviceInstanceStorage,
    logger,
  });

  await registerState({ trellis, stateHandlers });

  await registerAuth({
    app,
    config,
    trellis,
    contracts,
    contractStorage,
    userStorage,
    contractApprovalStorage,
    portalStorage,
    portalDefaultStorage,
    loginPortalSelectionStorage,
    devicePortalSelectionStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    deviceActivationStorage,
    deviceActivationReviewStorage,
    deviceProvisioningSecretStorage,
    instanceGrantPolicyStorage,
    portalProfileStorage,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    sessionStorage,
    browserFlowsKV,
    connectionsKV,
    logger,
    natsAuth,
    natsTrellis,
    oauthStateKV,
    pendingAuthKV,
    sentinelCreds,
  });

  return startControlPlaneBackgroundTasks({
    contractStorage,
    userStorage,
    contractApprovalStorage,
    deviceActivationStorage,
    deviceDeploymentStorage,
    instanceGrantPolicyStorage,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    portalProfileStorage,
    portalStorage,
    connectionsKV,
    logger,
    natsAuth,
    sessionStorage,
    trellis,
    contractStore: contracts.contractStore,
    config,
  });
}
