import {
  authDecideDeviceActivationReviewHandler,
  authDisableDeviceInstanceHandler,
  authDisableDeviceProfileHandler,
  authEnableDeviceInstanceHandler,
  authEnableDeviceProfileHandler,
  authListDeviceActivationReviewsHandler,
  authListDeviceActivationsHandler,
  authListDeviceInstancesHandler,
  authListDeviceProfilesHandler,
  authRemoveDeviceInstanceHandler,
  authRemoveDeviceProfileHandler,
  authRevokeDeviceActivationHandler,
  createAuthApplyDeviceProfileContractHandler,
  createAuthCreateDeviceProfileHandler,
  createAuthProvisionDeviceInstanceHandler,
  createAuthUnapplyDeviceProfileContractHandler,
} from "../admin/rpc.ts";
import {
  createActivateDeviceHandler,
  createGetDeviceConnectInfoHandler,
} from "../device_activation/operation.ts";
import type { AuthContractsRuntime, AuthRuntime } from "./types.ts";

export async function registerDeviceAdminAndActivation(deps: {
  trellis: AuthRuntime;
  contracts: Pick<
    AuthContractsRuntime,
    "installDeviceContract" | "refreshActiveContracts"
  >;
}): Promise<void> {
  await deps.trellis.mount(
    "Auth.CreateDeviceProfile",
    createAuthCreateDeviceProfileHandler({
      installDeviceContract: deps.contracts.installDeviceContract,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.ApplyDeviceProfileContract",
    createAuthApplyDeviceProfileContractHandler({
      installDeviceContract: deps.contracts.installDeviceContract,
    }),
  );
  await deps.trellis.mount(
    "Auth.UnapplyDeviceProfileContract",
    createAuthUnapplyDeviceProfileContractHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListDeviceProfiles",
    authListDeviceProfilesHandler,
  );
  await deps.trellis.mount(
    "Auth.DisableDeviceProfile",
    authDisableDeviceProfileHandler,
  );
  await deps.trellis.mount(
    "Auth.EnableDeviceProfile",
    authEnableDeviceProfileHandler,
  );
  await deps.trellis.mount(
    "Auth.RemoveDeviceProfile",
    authRemoveDeviceProfileHandler,
  );
  await deps.trellis.mount(
    "Auth.ProvisionDeviceInstance",
    createAuthProvisionDeviceInstanceHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListDeviceInstances",
    authListDeviceInstancesHandler,
  );
  await deps.trellis.mount(
    "Auth.DisableDeviceInstance",
    authDisableDeviceInstanceHandler,
  );
  await deps.trellis.mount(
    "Auth.EnableDeviceInstance",
    authEnableDeviceInstanceHandler,
  );
  await deps.trellis.mount(
    "Auth.RemoveDeviceInstance",
    authRemoveDeviceInstanceHandler,
  );
  await deps.trellis.mount(
    "Auth.ListDeviceActivations",
    authListDeviceActivationsHandler,
  );
  await deps.trellis.mount(
    "Auth.RevokeDeviceActivation",
    authRevokeDeviceActivationHandler,
  );
  await deps.trellis.operation("Auth.ActivateDevice").handle(
    createActivateDeviceHandler(),
  );
  await deps.trellis.mount(
    "Auth.GetDeviceConnectInfo",
    createGetDeviceConnectInfoHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListDeviceActivationReviews",
    authListDeviceActivationReviewsHandler,
  );
  await deps.trellis.mount(
    "Auth.DecideDeviceActivationReview",
    authDecideDeviceActivationReviewHandler,
  );
}
