import { createKick } from "../callout/kick.ts";
import {
  createAuthApplyServiceDeploymentContractHandler,
  createAuthCreateServiceDeploymentHandler,
  createAuthDisableServiceDeploymentHandler,
  createAuthDisableServiceInstanceHandler,
  createAuthEnableServiceDeploymentHandler,
  createAuthEnableServiceInstanceHandler,
  createAuthListServiceDeploymentsHandler,
  createAuthListServiceInstancesHandler,
  createAuthProvisionServiceInstanceHandler,
  createAuthRemoveServiceDeploymentHandler,
  createAuthRemoveServiceInstanceHandler,
  createAuthUnapplyServiceDeploymentContractHandler,
} from "../admin/service_rpc.ts";
import type { AuthContractsRuntime, RpcRegistrar } from "./types.ts";
import type { AuthRuntimeDeps, RuntimeKV } from "../runtime_deps.ts";
import type { Connection } from "../schemas.ts";
import type {
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
} from "../storage.ts";

export async function registerServiceAdminRpcs(deps: {
  trellis: RpcRegistrar;
  connectionsKV: RuntimeKV<Connection>;
  sessionStorage: SqlSessionRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  natsAuth: {
    request(subject: string, payload?: string): Promise<unknown>;
  };
  natsTrellis: Parameters<
    typeof createAuthApplyServiceDeploymentContractHandler
  >[0]["nats"];
  logger: Pick<AuthRuntimeDeps["logger"], "debug" | "trace" | "warn">;
  contracts: Pick<
    AuthContractsRuntime,
    "installServiceContract" | "refreshActiveContracts"
  >;
}): Promise<void> {
  const kick = createKick({ logger: deps.logger, natsAuth: deps.natsAuth });
  const serviceAdminDeps = {
    logger: deps.logger,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
  };

  await deps.trellis.mount(
    "Auth.CreateServiceDeployment",
    createAuthCreateServiceDeploymentHandler(serviceAdminDeps),
  );
  await deps.trellis.mount(
    "Auth.ListServiceDeployments",
    createAuthListServiceDeploymentsHandler(serviceAdminDeps),
  );
  await deps.trellis.mount(
    "Auth.ApplyServiceDeploymentContract",
    createAuthApplyServiceDeploymentContractHandler({
      installServiceContract: deps.contracts.installServiceContract,
      nats: deps.natsTrellis,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      serviceDeploymentStorage: deps.serviceDeploymentStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.mount(
    "Auth.UnapplyServiceDeploymentContract",
    createAuthUnapplyServiceDeploymentContractHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      logger: deps.logger,
      serviceDeploymentStorage: deps.serviceDeploymentStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.DisableServiceDeployment",
    createAuthDisableServiceDeploymentHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceDeploymentStorage: deps.serviceDeploymentStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.EnableServiceDeployment",
    createAuthEnableServiceDeploymentHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      serviceDeploymentStorage: deps.serviceDeploymentStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.RemoveServiceDeployment",
    createAuthRemoveServiceDeploymentHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      serviceDeploymentStorage: deps.serviceDeploymentStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.ProvisionServiceInstance",
    createAuthProvisionServiceInstanceHandler(serviceAdminDeps),
  );
  await deps.trellis.mount(
    "Auth.ListServiceInstances",
    createAuthListServiceInstancesHandler(serviceAdminDeps),
  );
  await deps.trellis.mount(
    "Auth.DisableServiceInstance",
    createAuthDisableServiceInstanceHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.EnableServiceInstance",
    createAuthEnableServiceInstanceHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.RemoveServiceInstance",
    createAuthRemoveServiceInstanceHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    }),
  );
}
