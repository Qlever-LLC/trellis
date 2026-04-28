import type { ContractsModule } from "../../catalog/runtime.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";

export type AuthRpcMethod =
  | "Auth.ListInstalledContracts"
  | "Auth.GetInstalledContract"
  | "Auth.CreateServiceDeployment"
  | "Auth.ListServiceDeployments"
  | "Auth.ApplyServiceDeploymentContract"
  | "Auth.UnapplyServiceDeploymentContract"
  | "Auth.DisableServiceDeployment"
  | "Auth.EnableServiceDeployment"
  | "Auth.RemoveServiceDeployment"
  | "Auth.ProvisionServiceInstance"
  | "Auth.ListServiceInstances"
  | "Auth.DisableServiceInstance"
  | "Auth.EnableServiceInstance"
  | "Auth.RemoveServiceInstance"
  | "Auth.Me"
  | "Auth.ValidateRequest"
  | "Auth.Logout"
  | "Auth.ListSessions"
  | "Auth.RevokeSession"
  | "Auth.ListConnections"
  | "Auth.KickConnection"
  | "Auth.ListApprovals"
  | "Auth.ListUserGrants"
  | "Auth.RevokeApproval"
  | "Auth.RevokeUserGrant"
  | "Auth.ListUsers"
  | "Auth.UpdateUser"
  | "Auth.CreatePortal"
  | "Auth.ListPortals"
  | "Auth.DisablePortal"
  | "Auth.ListPortalProfiles"
  | "Auth.SetPortalProfile"
  | "Auth.DisablePortalProfile"
  | "Auth.GetLoginPortalDefault"
  | "Auth.ListInstanceGrantPolicies"
  | "Auth.UpsertInstanceGrantPolicy"
  | "Auth.DisableInstanceGrantPolicy"
  | "Auth.SetLoginPortalDefault"
  | "Auth.ListLoginPortalSelections"
  | "Auth.SetLoginPortalSelection"
  | "Auth.ClearLoginPortalSelection"
  | "Auth.GetDevicePortalDefault"
  | "Auth.SetDevicePortalDefault"
  | "Auth.ListDevicePortalSelections"
  | "Auth.SetDevicePortalSelection"
  | "Auth.ClearDevicePortalSelection"
  | "Auth.CreateDeviceDeployment"
  | "Auth.ApplyDeviceDeploymentContract"
  | "Auth.UnapplyDeviceDeploymentContract"
  | "Auth.ListDeviceDeployments"
  | "Auth.DisableDeviceDeployment"
  | "Auth.EnableDeviceDeployment"
  | "Auth.RemoveDeviceDeployment"
  | "Auth.ProvisionDeviceInstance"
  | "Auth.ListDeviceInstances"
  | "Auth.DisableDeviceInstance"
  | "Auth.EnableDeviceInstance"
  | "Auth.RemoveDeviceInstance"
  | "Auth.ListDeviceActivations"
  | "Auth.RevokeDeviceActivation"
  | "Auth.GetDeviceConnectInfo"
  | "Auth.ListDeviceActivationReviews"
  | "Auth.DecideDeviceActivationReview";

export type RpcRegistrar = {
  mount: {
    bivarianceHack(method: AuthRpcMethod, handler: unknown): Promise<void>;
  }["bivarianceHack"];
};

export type OperationRegistrar = {
  operation: (name: "Auth.ActivateDevice") => {
    handle: {
      bivarianceHack(handler: unknown): Promise<void>;
    }["bivarianceHack"];
  };
};

export type AuthRuntime =
  & RpcRegistrar
  & OperationRegistrar
  & AuthRuntimeDeps["trellis"];

export type AuthContractsRuntime = Pick<
  ContractsModule,
  | "contractStore"
  | "installDeviceContract"
  | "installServiceContract"
  | "refreshActiveContracts"
  | "validateActiveCatalog"
>;
