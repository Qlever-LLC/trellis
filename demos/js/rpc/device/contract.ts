import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { health } from "@qlever-llc/trellis/sdk/health";
import { trellisDemoRpcService } from "@trellis-demo/rpc-service-sdk";

const contract = defineDeviceContract(() => ({
  id: "trellis.demo-rpc-device@v1",
  displayName: "Inspection RPC Demo Device",
  description: "Field inspection RPC demo device.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
    inspections: trellisDemoRpcService.use({
      rpc: {
        call: ["Inspection.Assignments.List", "Inspection.Sites.GetSummary"],
      },
    }),
  },
}));

export default contract;
