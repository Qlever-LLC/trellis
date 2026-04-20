import { defineServiceContract } from "@qlever-llc/trellis";
import { auth, health } from "@qlever-llc/trellis-sdk";
import Type from "typebox";

const schemas = {
  InspectionReportGenerateRequest: Type.Object({
    inspectionId: Type.String({ minLength: 1 }),
  }),
  InspectionReportGenerateProgress: Type.Object({
    stage: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  }),
  InspectionReportGenerateResponse: Type.Object({
    reportId: Type.String({ minLength: 1 }),
    inspectionId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
  }),
} as const;

const contract = defineServiceContract(
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
