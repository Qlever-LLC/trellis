import { defineContract } from "@qlever-llc/trellis";
import { auth as trellisAuth } from "@qlever-llc/trellis/sdk/auth";

export const trellisApp = defineContract({
  id: "trellis.console@v1",
  displayName: "Trellis Console",
  description: "Drive the Trellis admin console's authenticated RPC access.",
  kind: "app",
  uses: {
    auth: trellisAuth.useDefaults({
      rpc: {
        call: [
          "Auth.GetInstalledContract",
          "Auth.InstallService",
          "Auth.KickConnection",
          "Auth.ListApprovals",
          "Auth.ListConnections",
          "Auth.ListInstalledContracts",
          "Auth.ListServices",
          "Auth.ListSessions",
          "Auth.ListUsers",
          "Auth.RevokeApproval",
          "Auth.RevokeSession",
          "Auth.UpdateUser",
          "Auth.UpgradeServiceContract",
        ],
      },
    }),
  },
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = trellisApp;
