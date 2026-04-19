import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth, health } from "@qlever-llc/trellis-sdk";
import { trellisDemoOperationService as operationService } from "@trellis-demo/operation-service-sdk";

const inspectionsUse = operationService.use({
  operations: {
    call: ["Inspection.Report.Generate"],
  },
});

Object.assign(inspectionsUse, {
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
    inspections: inspectionsUse,
  },
}));

export default contract;
