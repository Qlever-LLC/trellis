import { defineAppContract } from "@qlever-llc/trellis/contracts";

import { trellisDemoService } from "@trellis-demo/service-sdk";
import * as schemas from "./schemas/index.ts";

const contract = defineAppContract({ schemas }, (ref) => ({
  id: "trellis.demo-app@v1",
  displayName: "Field Ops Console",
  description: "Browser console for the consolidated Field Ops demo.",
  uses: {
    fieldOps: trellisDemoService.use({
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
    }),
  },
  state: {
    workspaceContext: {
      kind: "map",
      schema: ref.schema("InspectionContextState"),
    },
  },
}));

export default contract;
