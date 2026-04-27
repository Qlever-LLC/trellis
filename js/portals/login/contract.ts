import { defineAppContract } from "@qlever-llc/trellis";
import { auth as trellisAuth } from "@qlever-llc/trellis/sdk/auth";

export const contract = defineAppContract(() => ({
  id: "portal.trellis.activation@v1",
  displayName: "Trellis Device Activation",
  description: "Trellis built-in app for authenticated device activation.",
  uses: {
    auth: trellisAuth.use({
      operations: {
        call: ["Auth.ActivateDevice"],
      },
    }),
  },
}));

export default contract;
