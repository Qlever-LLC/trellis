import { defineAppContract } from "@qlever-llc/trellis";
import { auth as trellisAuth } from "@qlever-llc/trellis-sdk/auth";
import { health as trellisHealth } from "@qlever-llc/trellis-sdk/health";
import { jobs as trellisJobs } from "@qlever-llc/trellis-sdk/jobs";

export const contract = defineAppContract(
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
            "Auth.DisablePortalProfile",
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
            "Auth.Logout",
            "Auth.Me",
            "Auth.ListPortals",
            "Auth.ListPortalProfiles",
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
            "Auth.SetPortalProfile",
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
      jobs: trellisJobs.use({
        rpc: {
          call: ["Jobs.List", "Jobs.ListServices"],
        },
      }),
    },
  }),
);

export default contract;
