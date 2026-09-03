import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { AuthDeviceUserAuthoritiesResolve } from "@trellis/apis/trellis.auth";

export const contract = defineAppContract(() => ({
  id: "trellis-app.portal@v1",
  apiId: "trellis-app.portal@v1",
  apiVersion: "1.0.0",
  displayName: "Trellis Device Activation",
  description:
    "Trellis built-in app for authenticated device activation over the Auth.DeviceUserAuthorities.Resolve operation.",
  uses: [AuthDeviceUserAuthoritiesResolve],
}));

export default contract;
