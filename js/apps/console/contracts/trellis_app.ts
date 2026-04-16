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
            "Auth.CreateDeviceProfile",
            "Auth.CreatePortal",
            "Auth.DecideDeviceActivationReview",
            "Auth.DisableDeviceInstance",
            "Auth.DisableDeviceProfile",
            "Auth.DisableInstanceGrantPolicy",
            "Auth.DisablePortal",
            "Auth.GetDevicePortalDefault",
            "Auth.GetInstalledContract",
            "Auth.GetLoginPortalDefault",
            "Auth.InstallService",
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
            "Auth.ListServices",
            "Auth.ListSessions",
            "Auth.ListUsers",
            "Auth.ProvisionDeviceInstance",
            "Auth.RevokeApproval",
            "Auth.RevokeDeviceActivation",
            "Auth.RevokeSession",
            "Auth.SetDevicePortalDefault",
            "Auth.SetDevicePortalSelection",
            "Auth.SetLoginPortalDefault",
            "Auth.SetLoginPortalSelection",
            "Auth.UpsertInstanceGrantPolicy",
            "Auth.UpdateUser",
            "Auth.UpgradeServiceContract",
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
