import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as trellisHealth } from "@qlever-llc/trellis/sdk/health";
import { sdk as trellisJobs } from "@qlever-llc/trellis/sdk/jobs";

export const contract = defineAppContract(
  () => ({
    id: "trellis.console@v1",
    displayName: "Trellis Console",
    description:
      "Drive the Trellis admin console's contract-declared Auth, Health, and Jobs access.",
    uses: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.ClearDevicePortalSelection",
            "Auth.ClearLoginPortalSelection",
            "Auth.ApplyDeviceDeploymentContract",
            "Auth.ApplyServiceDeploymentContract",
            "Auth.CreateDeviceDeployment",
            "Auth.CreateServiceDeployment",
            "Auth.CreatePortal",
            "Auth.DecideDeviceActivationReview",
            "Auth.DisableDeviceInstance",
            "Auth.DisableDeviceDeployment",
            "Auth.DisableServiceInstance",
            "Auth.DisableServiceDeployment",
            "Auth.DisableInstanceGrantPolicy",
            "Auth.DisablePortal",
            "Auth.DisablePortalProfile",
            "Auth.EnableDeviceInstance",
            "Auth.EnableDeviceDeployment",
            "Auth.EnableServiceInstance",
            "Auth.EnableServiceDeployment",
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
            "Auth.ListDeviceDeployments",
            "Auth.ListInstalledContracts",
            "Auth.ListLoginPortalSelections",
            "Auth.Logout",
            "Auth.Me",
            "Auth.ListPortals",
            "Auth.ListPortalProfiles",
            "Auth.ListServiceInstances",
            "Auth.ListServiceDeployments",
            "Auth.ListSessions",
            "Auth.ListUserGrants",
            "Auth.ListUsers",
            "Auth.ProvisionDeviceInstance",
            "Auth.ProvisionServiceInstance",
            "Auth.RemoveDeviceInstance",
            "Auth.RemoveDeviceDeployment",
            "Auth.RevokeApproval",
            "Auth.RevokeDeviceActivation",
            "Auth.RevokeSession",
            "Auth.RevokeUserGrant",
            "Auth.RemoveServiceInstance",
            "Auth.RemoveServiceDeployment",
            "Auth.SetDevicePortalDefault",
            "Auth.SetDevicePortalSelection",
            "Auth.SetLoginPortalDefault",
            "Auth.SetLoginPortalSelection",
            "Auth.SetPortalProfile",
            "Auth.UnapplyDeviceDeploymentContract",
            "Auth.UnapplyServiceDeploymentContract",
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
