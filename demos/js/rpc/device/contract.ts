import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth, health } from "@qlever-llc/trellis-sdk";
import { trellisDemoRpcService as rpcService } from "@trellis-demo/rpc-service-sdk";

const contract = defineDeviceContract(() => ({
  id: "trellis.demo-rpc-device@v1",
  displayName: "Inspection RPC Demo Device",
  description: "Field inspection RPC demo device.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
    inspections: rpcService.use({
      rpc: {
        call: ["Inspection.Assignments.List", "Inspection.Sites.GetSummary"],
      },
    }),
  },
}));

export default contract;
