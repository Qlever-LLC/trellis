import { defineDeviceContract } from "@qlever-llc/trellis";
import { Type } from "typebox";

import { auth } from "@qlever-llc/trellis/sdk/auth";
import { health } from "@qlever-llc/trellis/sdk/health";
import { state } from "@qlever-llc/trellis/sdk/state";

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

const contract = defineDeviceContract(
  { schemas },
  (ref) => ({
    id: "trellis.demo-state-device@v1",
    displayName: "Inspection State Demo Device",
    description: "Field inspection state demo device.",
    uses: {
      auth: auth.useDefaults(),
      health: health.useDefaults(),
      state: state.useDefaults(),
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
