import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { state } from "@qlever-llc/trellis/sdk/state";
import { trellisDemoService } from "@trellis-demo/service-sdk";
import * as schemas from "./schemas/index.ts";

const fieldOpsServiceUse = Object.assign(
  trellisDemoService.use({
    rpc: {
      call: ["Assignments.List", "Sites.List", "Sites.Get"],
    },
    operations: {
      call: ["Sites.Refresh", "Reports.Generate", "Evidence.Upload"],
    },
  }),
  {
    rpc: {
      call: ["Assignments.List", "Sites.List", "Sites.Get"],
    },
    operations: {
      call: ["Sites.Refresh", "Reports.Generate", "Evidence.Upload"],
      read: ["Sites.Refresh", "Reports.Generate", "Evidence.Upload"],
      cancel: ["Reports.Generate"],
    },
    events: {
      subscribe: [
        "Activity.Recorded",
        "Reports.Published",
        "Evidence.Uploaded",
        "Sites.Refreshed",
      ],
    },
  },
);

const contract = defineAppContract({ schemas }, (ref) => ({
  id: "trellis.demo-app@v1",
  displayName: "Field Ops Console",
  description: "Browser console for the consolidated Field Ops demo.",
  uses: {
    auth: auth.useDefaults(),
    fieldOps: fieldOpsServiceUse,
    state: state.useDefaults(),
  },
  state: {
    workspaceContext: {
      kind: "map",
      schema: ref.schema("InspectionContextState"),
    },
  },
}));

export default contract;
