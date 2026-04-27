import { kick } from "../callout/kick.ts";
import {
  authListServiceInstancesHandler,
  authListServiceProfilesHandler,
  createAuthApplyServiceProfileContractHandler,
  createAuthCreateServiceProfileHandler,
  createAuthDisableServiceInstanceHandler,
  createAuthDisableServiceProfileHandler,
  createAuthEnableServiceInstanceHandler,
  createAuthEnableServiceProfileHandler,
  createAuthProvisionServiceInstanceHandler,
  createAuthRemoveServiceInstanceHandler,
  createAuthRemoveServiceProfileHandler,
  createAuthUnapplyServiceProfileContractHandler,
} from "../admin/service_rpc.ts";
import type { AuthContractsRuntime, RpcRegistrar } from "./types.ts";

export async function registerServiceAdminRpcs(deps: {
  trellis: RpcRegistrar;
  contracts: Pick<
    AuthContractsRuntime,
    "installServiceContract" | "refreshActiveContracts"
  >;
}): Promise<void> {
  await deps.trellis.mount(
    "Auth.CreateServiceProfile",
    createAuthCreateServiceProfileHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListServiceProfiles",
    authListServiceProfilesHandler,
  );
  await deps.trellis.mount(
    "Auth.ApplyServiceProfileContract",
    createAuthApplyServiceProfileContractHandler({
      installServiceContract: deps.contracts.installServiceContract,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.UnapplyServiceProfileContract",
    createAuthUnapplyServiceProfileContractHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.DisableServiceProfile",
    createAuthDisableServiceProfileHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.EnableServiceProfile",
    createAuthEnableServiceProfileHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.RemoveServiceProfile",
    createAuthRemoveServiceProfileHandler({
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
    createAuthDisableServiceInstanceHandler({ kick }),
  );
  await deps.trellis.mount(
    "Auth.EnableServiceInstance",
    createAuthEnableServiceInstanceHandler({ kick }),
  );
  await deps.trellis.mount(
    "Auth.RemoveServiceInstance",
    createAuthRemoveServiceInstanceHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
}
