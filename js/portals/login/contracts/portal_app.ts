import { defineContract } from "@qlever-llc/trellis/contracts";
import { auth as trellisAuth } from "@qlever-llc/trellis/sdk/auth";

export const portalApp = defineContract({
  id: "trellis.portal-app@v1",
  displayName: "Portal App",
  description: "User-facing Trellis auth and workload activation portal.",
  kind: "portal",
  uses: {
    auth: trellisAuth.use({
      rpc: {
        call: ["Auth.ActivateWorkload", "Auth.GetWorkloadActivationStatus"],
      },
    }),
  },
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = portalApp;
