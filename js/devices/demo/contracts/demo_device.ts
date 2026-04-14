import { defineContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import demoService from "../../../services/demo/contracts/demo_service.ts";

export const CONTRACT = defineContract({
  id: "trellis.demo-device@v1",
  displayName: "Demo Device",
  description: "A simple activated device that logs its connection details.",
  kind: "device",
  uses: {
    auth: auth.useDefaults(),
    demo: demoService.use({
      rpc: {
        call: ["Demo.Groups.List", "Demo.Files.InitiateUpload"],
      },
    }),
  },
});

export default CONTRACT;
