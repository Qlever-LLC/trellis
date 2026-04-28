import { kick } from "../callout/kick.ts";
import {
  authListServiceDeploymentsHandler,
  authListServiceInstancesHandler,
  createAuthApplyServiceDeploymentContractHandler,
  createAuthCreateServiceDeploymentHandler,
  createAuthDisableServiceDeploymentHandler,
  createAuthDisableServiceInstanceHandler,
  createAuthEnableServiceDeploymentHandler,
  createAuthEnableServiceInstanceHandler,
  createAuthProvisionServiceInstanceHandler,
  createAuthRemoveServiceDeploymentHandler,
  createAuthRemoveServiceInstanceHandler,
  createAuthUnapplyServiceDeploymentContractHandler,
} from "../admin/service_rpc.ts";
import type { AuthContractsRuntime, RpcRegistrar } from "./types.ts";
import type { RuntimeKV } from "../runtime_deps.ts";
import type { Connection } from "../schemas.ts";
import type { SqlSessionRepository } from "../storage.ts";

export async function registerServiceAdminRpcs(deps: {
  trellis: RpcRegistrar;
  connectionsKV: RuntimeKV<Connection>;
  sessionStorage: SqlSessionRepository;
  contracts: Pick<
    AuthContractsRuntime,
    "installServiceContract" | "refreshActiveContracts"
  >;
}): Promise<void> {
  await deps.trellis.mount(
    "Auth.CreateServiceDeployment",
    createAuthCreateServiceDeploymentHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListServiceDeployments",
    authListServiceDeploymentsHandler,
  );
  await deps.trellis.mount(
    "Auth.ApplyServiceDeploymentContract",
    createAuthApplyServiceDeploymentContractHandler({
      installServiceContract: deps.contracts.installServiceContract,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.UnapplyServiceDeploymentContract",
    createAuthUnapplyServiceDeploymentContractHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.DisableServiceDeployment",
    createAuthDisableServiceDeploymentHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.EnableServiceDeployment",
    createAuthEnableServiceDeploymentHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.RemoveServiceDeployment",
    createAuthRemoveServiceDeploymentHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.ProvisionServiceInstance",
    createAuthProvisionServiceInstanceHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListServiceInstances",
    authListServiceInstancesHandler,
  );
  await deps.trellis.mount(
    "Auth.DisableServiceInstance",
    createAuthDisableServiceInstanceHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.EnableServiceInstance",
    createAuthEnableServiceInstanceHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.RemoveServiceInstance",
    createAuthRemoveServiceInstanceHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
    }),
  );
}
