import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth, health } from "@qlever-llc/trellis-sdk";
import * as inspectionSchemas from "./src/schemas/index.ts";

const schemas = {
  RefreshStatusValue: inspectionSchemas.RefreshStatusValueSchema,
  InspectionSummariesRefreshStatus:
    inspectionSchemas.InspectionSummariesRefreshStatusSchema,
  InspectionSummariesRefreshRequest:
    inspectionSchemas.InspectionSummariesRefreshRequestSchema,
  InspectionSummariesRefreshResponse:
    inspectionSchemas.InspectionSummariesRefreshResponseSchema,
  InspectionSummariesRefreshStatusRequest:
    inspectionSchemas.InspectionSummariesRefreshStatusRequestSchema,
  InspectionSummariesRefreshStatusResponse:
    inspectionSchemas.InspectionSummariesRefreshStatusResponseSchema,
  InspectionSummariesRefreshJobPayload:
    inspectionSchemas.InspectionSummariesRefreshJobPayloadSchema,
  InspectionSummariesRefreshJobResult:
    inspectionSchemas.InspectionSummariesRefreshJobResultSchema,
} as const;

export const contract = defineServiceContract({
  schemas,
  exports: { schemas: ["InspectionSummariesRefreshStatus"] },
}, (ref) => ({
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
}));

export default contract;
