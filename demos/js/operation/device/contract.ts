import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { health } from "@qlever-llc/trellis/sdk/health";
import { trellisDemoOperationService as operationService } from "@trellis-demo/operation-service-sdk";

const inspections = operationService.use({
  operations: {
    call: ["Inspection.Report.Generate"],
  },
});

// The generated `use(...)` helper only models operation calls, so add the
// read/cancel permissions this demo needs on the same use object.
Object.assign(inspections, {
  operations: {
    call: ["Inspection.Report.Generate"],
    read: ["Inspection.Report.Generate"],
    cancel: ["Inspection.Report.Generate"],
  },
});

const contract = defineDeviceContract(() => ({
  id: "trellis.demo-operation-device@v1",
  displayName: "Inspection Operation Demo Device",
  description: "Field inspection operation demo device.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
    inspections,
  },
}));

export default contract;
