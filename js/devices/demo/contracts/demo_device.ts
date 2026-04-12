import { defineContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";

export const CONTRACT = defineContract({
  id: "trellis.demo-device@v1",
  displayName: "Demo Device",
  description: "A simple activated device that logs its connection details.",
  kind: "device",
  uses: {
    auth: auth.useDefaults(),
  },
});

export default CONTRACT;
