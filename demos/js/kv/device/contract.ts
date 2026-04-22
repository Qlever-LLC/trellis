import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth, health } from "@qlever-llc/trellis-sdk";
import { trellisDemoKvService as kvService } from "@trellis-demo/kv-service-sdk";

const contract = defineDeviceContract(() => ({
  id: "trellis.demo-kv-device@v1",
  displayName: "Inspection KV Demo Device",
  description: "Field inspection KV demo device.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
    inspections: kvService.use({
      rpc: {
        call: ["Inspection.Summaries.List", "Inspection.Summaries.Get"],
      },
    }),
  },
}));

export default contract;
