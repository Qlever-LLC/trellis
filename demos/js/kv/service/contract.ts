import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth, health } from "@qlever-llc/trellis-sdk";
import Type from "typebox";

export const EmptySchema = Type.Object({});

export const SiteSummaryRequestSchema = Type.Object({
  siteId: Type.String({ minLength: 1 }),
});

export const SiteSummarySchema = Type.Object({
  siteId: Type.String({ minLength: 1 }),
  siteName: Type.String({ minLength: 1 }),
  openInspections: Type.Integer({ minimum: 0 }),
  overdueInspections: Type.Integer({ minimum: 0 }),
  latestStatus: Type.String({ minLength: 1 }),
  lastReportAt: Type.String({ minLength: 1 }),
});

export const SiteSummariesListResponseSchema = Type.Object({
  summaries: Type.Array(SiteSummarySchema),
});

export const SiteSummaryResponseSchema = Type.Object({
  summary: Type.Optional(SiteSummarySchema),
});

const schemas = {
  Empty: EmptySchema,
  SiteSummaryRequest: SiteSummaryRequestSchema,
  SiteSummary: SiteSummarySchema,
  SiteSummariesListResponse: SiteSummariesListResponseSchema,
  SiteSummaryResponse: SiteSummaryResponseSchema,
} as const;

export const contract = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.demo-kv-service@v1",
    displayName: "Inspection KV Demo Service",
    description: "Field inspection KV demo service.",
    uses: {
      auth: auth.useDefaults(),
      health: health.useDefaults(),
    },
    resources: {
      kv: {
        siteSummaries: {
          purpose: "Latest site summaries for the KV demo.",
          schema: ref.schema("SiteSummary"),
          history: 1,
          ttlMs: 0,
        },
      },
    },
    rpc: {
      "Inspection.Summaries.List": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("SiteSummariesListResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Inspection.Summaries.Get": {
        version: "v1",
        input: ref.schema("SiteSummaryRequest"),
        output: ref.schema("SiteSummaryResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
    },
  }),
);

export default contract;
