import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { health } from "@qlever-llc/trellis/sdk/health";
import * as schemas from "./src/schemas/index.ts";

export const contract = defineServiceContract({
  schemas,
  exports: { schemas: ["InspectionAssignment", "SiteSummary"] },
}, (ref) => ({
  id: "trellis.demo-rpc-service@v1",
  displayName: "Inspection RPC Demo Service",
  description: "Field inspection RPC demo service.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
  },
  rpc: {
    "Inspection.Assignments.List": {
      version: "v1",
      input: ref.schema("InspectionAssignmentsListRequest"),
      output: ref.schema("InspectionAssignmentsListResponse"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
    "Inspection.Sites.GetSummary": {
      version: "v1",
      input: ref.schema("SiteSummaryRequest"),
      output: ref.schema("SiteSummaryResponse"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
  },
}));

export default contract;
