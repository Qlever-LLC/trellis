import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { auth as trellisAuth } from "@qlever-llc/trellis-sdk/auth";
import { health as trellisHealth } from "../../../services/trellis/contracts/trellis_health.ts";

export const trellisApp = defineAppContract(
  () => ({
    id: "trellis.console@v1",
    displayName: "Trellis Console",
    description: "Drive the Trellis admin console's authenticated RPC access.",
    uses: {
      auth: trellisAuth.useDefaults({
        rpc: {
          call: [
            "Auth.ClearDevicePortalSelection",
            "Auth.ClearLoginPortalSelection",
            "Auth.ApplyDeviceProfileContract",
            "Auth.ApplyServiceProfileContract",
            "Auth.CreateDeviceProfile",
            "Auth.CreateServiceProfile",
            "Auth.CreatePortal",
            "Auth.DecideDeviceActivationReview",
            "Auth.DisableDeviceInstance",
            "Auth.DisableDeviceProfile",
            "Auth.DisableServiceInstance",
            "Auth.DisableServiceProfile",
            "Auth.DisableInstanceGrantPolicy",
            "Auth.DisablePortal",
            "Auth.EnableDeviceInstance",
            "Auth.EnableDeviceProfile",
            "Auth.EnableServiceInstance",
            "Auth.EnableServiceProfile",
            "Auth.GetDevicePortalDefault",
            "Auth.GetInstalledContract",
            "Auth.GetLoginPortalDefault",
            "Auth.KickConnection",
            "Auth.ListApprovals",
            "Auth.ListConnections",
            "Auth.ListDeviceActivationReviews",
            "Auth.ListDeviceActivations",
            "Auth.ListDeviceInstances",
            "Auth.ListInstanceGrantPolicies",
            "Auth.ListDevicePortalSelections",
            "Auth.ListDeviceProfiles",
            "Auth.ListInstalledContracts",
            "Auth.ListLoginPortalSelections",
            "Auth.ListPortals",
            "Auth.ListServiceInstances",
            "Auth.ListServiceProfiles",
            "Auth.ListSessions",
            "Auth.ListUserGrants",
            "Auth.ListUsers",
            "Auth.ProvisionDeviceInstance",
            "Auth.ProvisionServiceInstance",
            "Auth.RemoveDeviceInstance",
            "Auth.RemoveDeviceProfile",
            "Auth.RevokeApproval",
            "Auth.RevokeDeviceActivation",
            "Auth.RevokeSession",
            "Auth.RevokeUserGrant",
            "Auth.RemoveServiceInstance",
            "Auth.RemoveServiceProfile",
            "Auth.SetDevicePortalDefault",
            "Auth.SetDevicePortalSelection",
            "Auth.SetLoginPortalDefault",
            "Auth.SetLoginPortalSelection",
            "Auth.UnapplyDeviceProfileContract",
            "Auth.UnapplyServiceProfileContract",
            "Auth.UpsertInstanceGrantPolicy",
            "Auth.UpdateUser",
          ],
        },
      }),
      health: trellisHealth.use({
        events: {
          subscribe: ["Health.Heartbeat"],
        },
      }),
    },
  }),
);

export const CONTRACT_ID = trellisApp.CONTRACT_ID;
export const CONTRACT = trellisApp.CONTRACT;
export const CONTRACT_DIGEST = trellisApp.CONTRACT_DIGEST;
export const API: typeof trellisApp.API = trellisApp.API;
export const use: typeof trellisApp.use = trellisApp.use;
export default trellisApp;
