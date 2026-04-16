import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth } from "@qlever-llc/trellis-sdk/auth";
import { health } from "@qlever-llc/trellis-sdk/health";
import { trellisDemoService as demoService } from "@trellis-demo/demo-service-sdk";

export const contract = defineDeviceContract(() => ({
  id: "trellis.demo-device@v1",
  displayName: "Demo Device",
  description: "A simple activated device that logs its connection details.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
    demo: demoService.use({
      rpc: {
        call: ["Demo.Groups.List", "Demo.Files.InitiateUpload"],
      },
    }),
  },
}));

export default contract;
