import { defineAppContract } from "@qlever-llc/trellis";

import { sdk as trellisDemoService } from "@trellis-sdk/trellis-demo-service";
import * as schemas from "./schemas/index.ts";

const contract = defineAppContract({ schemas }, (ref) => ({
  id: "trellis.demo-app@v1",
  displayName: "Field Ops Console",
  description: "Browser console for the consolidated Field Ops demo.",
  docs: {
    summary: "Field operations browser console.",
    markdown:
      "Declares the browser app's Field Ops service usage and workspace context state.",
  },
  uses: {
    required: {
      fieldOps: trellisDemoService.use({
        rpc: {
          call: [
            "Assignments.List",
            "Sites.List",
            "Sites.Get",
            "Evidence.List",
            "Evidence.Download",
            "Evidence.Delete",
            "Reports.List",
          ],
        },
        operations: {
          call: ["Sites.Refresh", "Reports.Generate", "Evidence.Upload"],
        },
        feeds: { subscribe: ["Audit.Feed"] },
      }),
    },
  },
  state: {
    workspaceContext: {
      kind: "map",
      schema: ref.schema("InspectionContextState"),
      stateVersion: "inspection-context.v1",
      docs: {
        summary: "Workspace context state.",
        markdown:
          "Stores per-workspace inspection context used by the browser console.",
      },
    },
  },
}));

export default contract;
