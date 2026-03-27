import { defineContract } from "@qlever-llc/trellis-contracts";
import { auth as trellisAuth } from "@qlever-llc/trellis-sdk-auth";
import { jobs as trellisJobs } from "@qlever-llc/trellis-sdk-jobs";

export const trellisApp = defineContract({
  id: "trellis.console@v1",
  displayName: "Trellis Console",
  description: "Drive the Trellis admin console's authenticated RPC access.",
  kind: "app",
  uses: {
    auth: trellisAuth.use({
      rpc: {
        call: [
          "Auth.GetInstalledContract",
          "Auth.InstallService",
          "Auth.KickConnection",
          "Auth.ListApprovals",
          "Auth.ListConnections",
          "Auth.ListUsers",
          "Auth.ListInstalledContracts",
          "Auth.ListServices",
          "Auth.ListSessions",
          "Auth.Logout",
          "Auth.Me",
          "Auth.RevokeApproval",
          "Auth.RevokeSession",
          "Auth.UpdateUser",
          "Auth.UpgradeServiceContract",
        ],
      },
    }),
    jobs: trellisJobs.use({
      rpc: {
        call: [
          "Jobs.Get",
          "Jobs.List",
          "Jobs.ListServices",
        ],
      },
    }),
  },
});
