import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { health } from "@qlever-llc/trellis/sdk/health";
import * as schemas from "./src/schemas/index.ts";

export const contract = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.demo-operation-service@v1",
    displayName: "Inspection Operation Demo Service",
    description: "Field inspection operation demo service.",
    uses: {
      auth: auth.useDefaults(),
      health: health.useDefaults(),
    },
    operations: {
      "Inspection.Report.Generate": {
        version: "v1",
        input: ref.schema("InspectionReportGenerateRequest"),
        progress: ref.schema("InspectionReportGenerateProgress"),
        output: ref.schema("InspectionReportGenerateResponse"),
        capabilities: {
          call: [],
          read: [],
          cancel: [],
        },
        cancel: true,
      },
    },
  }),
);

export default contract;
