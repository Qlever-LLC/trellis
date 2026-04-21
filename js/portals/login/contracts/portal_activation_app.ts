import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { auth as trellisAuth } from "@qlever-llc/trellis-sdk/auth";

export const portalActivationApp = defineAppContract(
  () => ({
    id: "trellis.portal-activation-app@v1",
    displayName: "Portal Activation App",
    description: "Built-in app contract for authenticated device activation in the Trellis portal.",
    uses: {
      auth: trellisAuth.use({
        operations: {
          call: ["Auth.ActivateDevice"],
        },
      }),
    },
  }),
);

export const CONTRACT_ID = portalActivationApp.CONTRACT_ID;
export const CONTRACT = portalActivationApp.CONTRACT;
export const CONTRACT_DIGEST = portalActivationApp.CONTRACT_DIGEST;
export const API: typeof portalActivationApp.API = portalActivationApp.API;
export const use: typeof portalActivationApp.use = portalActivationApp.use;
export default portalActivationApp;
