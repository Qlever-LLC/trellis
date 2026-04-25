import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { health } from "@qlever-llc/trellis/sdk/health";
import * as schemas from "./src/schemas/index.ts";

export const contract = defineServiceContract(
  {
    schemas,
    exports: { schemas: ["InspectionSummariesRefreshStatus"] },
  },
  (ref) => ({
    id: "trellis.demo-jobs-service@v1",
    displayName: "Inspection Jobs Demo Service",
    description: "Field inspection jobs demo service.",
    uses: {
      auth: auth.useDefaults(),
      health: health.useDefaults(),
    },
    jobs: {
      refreshSummaries: {
        payload: ref.schema("InspectionSummariesRefreshJobPayload"),
        result: ref.schema("InspectionSummariesRefreshJobResult"),
      },
    },
    resources: {
      kv: {
        refreshStatuses: {
          purpose: "Stored refresh statuses for the jobs demo.",
          schema: ref.schema("InspectionSummariesRefreshStatus"),
          history: 1,
          ttlMs: 0,
        },
      },
    },
    rpc: {
      "Inspection.Summaries.Refresh": {
        version: "v1",
        input: ref.schema("InspectionSummariesRefreshRequest"),
        output: ref.schema("InspectionSummariesRefreshResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Inspection.Summaries.RefreshStatus.Get": {
        version: "v1",
        input: ref.schema("InspectionSummariesRefreshStatusRequest"),
        output: ref.schema("InspectionSummariesRefreshStatusResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
    },
  }),
);

export default contract;
