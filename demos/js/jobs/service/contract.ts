import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth, health } from "@qlever-llc/trellis-sdk";
import * as schemas from "./schemas/index.ts";

export const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.demo-jobs-service@v1",
  displayName: "Inspection Jobs Demo Service",
  description: "Field inspection jobs demo service.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
  },
  jobs: {
    refreshSummaries: {
      payload: ref.schema("InspectionSummariesRefreshJobPayloadSchema"),
      result: ref.schema("InspectionSummariesRefreshJobResultSchema"),
    },
  },
  resources: {
    kv: {
      refreshStatuses: {
        purpose: "Stored refresh statuses for the jobs demo.",
        history: 1,
        ttlMs: 0,
      },
    },
  },
  rpc: {
    "Inspection.Summaries.Refresh": {
      version: "v1",
      input: ref.schema("InspectionSummariesRefreshRequestSchema"),
      output: ref.schema("InspectionSummariesRefreshResponseSchema"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
    "Inspection.Summaries.RefreshStatus.Get": {
      version: "v1",
      input: ref.schema("InspectionSummariesRefreshStatusRequestSchema"),
      output: ref.schema("InspectionSummariesRefreshStatusResponseSchema"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
  },
}));

export default contract;
