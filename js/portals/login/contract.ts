import { defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";

export const contract = defineAppContract(() => ({
  id: "trellis.portal.activation@v1",
  displayName: "Trellis Device Activation",
  description:
    "Trellis built-in app for authenticated device activation over the Auth.DeviceUserAuthorities.Resolve operation.",
  uses: {
    required: {
      auth: trellisAuth.use({
        operations: {
          call: ["Auth.DeviceUserAuthorities.Resolve"],
        },
      }),
    },
  },
}));

export default contract;
