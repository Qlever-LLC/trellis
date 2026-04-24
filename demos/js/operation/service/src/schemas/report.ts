import Type from "typebox";

export const InspectionReportGenerateRequest = Type.Object({
  inspectionId: Type.String({ minLength: 1 }),
});

export const InspectionReportGenerateProgress = Type.Object({
  stage: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
});

export const InspectionReportGenerateResponse = Type.Object({
  reportId: Type.String({ minLength: 1 }),
  inspectionId: Type.String({ minLength: 1 }),
  status: Type.String({ minLength: 1 }),
});
