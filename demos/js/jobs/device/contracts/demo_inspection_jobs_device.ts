import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth, health } from "@qlever-llc/trellis-sdk";
import { trellisDemoJobsService as jobsService } from "@trellis-demo/jobs-service-sdk";

const contract = defineDeviceContract(() => ({
  id: "trellis.demo-jobs-device@v1",
  displayName: "Inspection Jobs Demo Device",
  description: "Field inspection jobs demo device.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
    inspections: jobsService.use({
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
