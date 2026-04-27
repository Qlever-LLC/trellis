import { defineDeviceContract } from "@qlever-llc/trellis";
import { trellisDemoService } from "@trellis-demo/service-sdk";
import { Type } from "typebox";

const schemas = {
  SelectedSiteState: Type.Object({
    siteId: Type.String(),
    siteName: Type.String(),
    selectedAt: Type.String({ format: "date-time" }),
  }),
  DraftInspectionState: Type.Object({
    inspectionId: Type.String(),
    siteId: Type.String(),
    checklistName: Type.String(),
    notes: Type.String(),
    updatedAt: Type.String({ format: "date-time" }),
  }),
} as const;

const fieldOps = trellisDemoService.use({
  rpc: {
    call: [
      "Assignments.List",
      "Sites.List",
      "Sites.Get",
      "Evidence.List",
      "Evidence.Download",
    ],
  },
  operations: {
    call: ["Sites.Refresh", "Reports.Generate", "Evidence.Upload"],
  },
  events: {
    subscribe: [
      "Activity.Recorded",
      "Reports.Published",
      "Evidence.Uploaded",
      "Sites.Refreshed",
    ],
  },
});

// The generated use helper currently models operation calls only. Keep the
// manifest permission declaration explicit for operation read and cancel.
Object.assign(fieldOps, {
  operations: {
    call: ["Sites.Refresh", "Reports.Generate", "Evidence.Upload"],
    read: ["Sites.Refresh", "Reports.Generate", "Evidence.Upload"],
    cancel: ["Reports.Generate"],
  },
});

const contract = defineDeviceContract(
  { schemas },
  (ref) => ({
    id: "trellis.demo-device@v1",
    displayName: "Field Device Demo",
    description: "Activated Field Device TUI for the consolidated demo.",
    uses: {
      fieldOps,
    },
    state: {
      selectedSite: {
        kind: "value",
        schema: ref.schema("SelectedSiteState"),
      },
      draftInspections: {
        kind: "map",
        schema: ref.schema("DraftInspectionState"),
      },
    },
  }),
);

export default contract;
