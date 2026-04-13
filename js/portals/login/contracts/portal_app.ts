import { defineContract } from "@qlever-llc/trellis/contracts";
import { auth as trellisAuth } from "@qlever-llc/trellis/sdk/auth";

export const portalApp = defineContract({
  id: "trellis.portal-app@v1",
  displayName: "Portal App",
  description: "User-facing Trellis auth and device activation portal.",
  kind: "portal",
  uses: {
    auth: trellisAuth.use({
      rpc: {
        call: ["Auth.ActivateDevice", "Auth.GetDeviceActivationStatus"],
      },
    }),
  },
});

export const CONTRACT_ID = portalApp.CONTRACT_ID;
export const CONTRACT = portalApp.CONTRACT;
export const CONTRACT_DIGEST = portalApp.CONTRACT_DIGEST;
export const API: typeof portalApp.API = portalApp.API;
export const use: typeof portalApp.use = portalApp.use;
