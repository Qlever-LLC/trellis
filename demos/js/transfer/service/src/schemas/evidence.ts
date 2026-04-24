import Type from "typebox";

export const InspectionEvidenceUploadRequest = Type.Object({
  key: Type.String({ minLength: 1 }),
  contentType: Type.Optional(Type.String({ minLength: 1 })),
  evidenceType: Type.String({ minLength: 1 }),
});

export const InspectionEvidenceUploadProgress = Type.Object({
  stage: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
});

export const InspectionEvidenceUploadResponse = Type.Object({
  evidenceId: Type.String({ minLength: 1 }),
  key: Type.String({ minLength: 1 }),
  size: Type.Integer({ minimum: 0 }),
  disposition: Type.String({ minLength: 1 }),
});
