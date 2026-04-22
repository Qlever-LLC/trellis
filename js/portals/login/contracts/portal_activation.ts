import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { auth as trellisAuth } from "@qlever-llc/trellis-sdk/auth";

export const portalActivationApp = defineAppContract(() => ({
  id: "portal.trellis.activation@v1",
  displayName: "Trellis Device Activation",
  description: "Trellis built-in app for authenticated device activation.",
  uses: {
    auth: trellisAuth.useDefaults({
      operations: {
        call: ["Auth.ActivateDevice"],
      },
    }),
  },
}));

export default portalActivationApp;
