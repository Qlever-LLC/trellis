import { defineContract } from "@trellis/contracts";
import { auth as trellisAuth } from "@trellis/sdk-auth";

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
  },
});
