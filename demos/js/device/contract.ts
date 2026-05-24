import { defineDeviceContract } from "@qlever-llc/trellis";
import { sdk as trellisDemoService } from "@trellis-sdk/trellis-demo-service";
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
      "Audit.Recorded",
      "Reports.Published",
      "Evidence.Uploaded",
      "Sites.Refreshed",
    ],
  },
});

const contract = defineDeviceContract(
  { schemas },
  (ref) => ({
    id: "trellis.demo-device@v1",
    displayName: "Field Device Demo",
    description: "Activated Field Device TUI for the consolidated demo.",
    docs: {
      summary: "Activated field device demo.",
      markdown:
        "Declares the Field Device demo's service usage and local state for selected sites and draft inspections.",
    },
    uses: {
      required: { fieldOps },
    },
    state: {
      selectedSite: {
        kind: "value",
        schema: ref.schema("SelectedSiteState"),
        stateVersion: "selected-site.v1",
        docs: {
          summary: "Selected site state.",
          markdown: "Stores the active site selected in the device TUI.",
        },
      },
      draftInspections: {
        kind: "map",
        schema: ref.schema("DraftInspectionState"),
        stateVersion: "draft-inspection.v1",
        docs: {
          summary: "Draft inspection state.",
          markdown:
            "Stores editable inspection draft notes keyed by inspection id.",
        },
      },
    },
  }),
);

export default contract;
