import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { health } from "@qlever-llc/trellis/sdk/health";
import * as schemas from "./src/schemas/index.ts";

export const contract = defineServiceContract(
  { schemas, exports: { schemas: ["SiteSummary"] } },
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
