import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { health } from "@qlever-llc/trellis/sdk/health";
import { trellisDemoJobsService } from "@trellis-demo/jobs-service-sdk";

const contract = defineDeviceContract(() => ({
  id: "trellis.demo-jobs-device@v1",
  displayName: "Inspection Jobs Demo Device",
  description: "Field inspection jobs demo device.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
    demo: trellisDemoJobsService.use({
      rpc: {
        call: [
          "Inspection.Summaries.Refresh",
          "Inspection.Summaries.RefreshStatus.Get",
        ],
      },
    }),
  },
}));

export default contract;
