import Type from "typebox";

export const InspectionAssignment = Type.Object({
  inspectionId: Type.String({ minLength: 1 }),
  siteId: Type.String({ minLength: 1 }),
  siteName: Type.String({ minLength: 1 }),
  assetName: Type.String({ minLength: 1 }),
  checklistName: Type.String({ minLength: 1 }),
  priority: Type.Union([
    Type.Literal("high"),
    Type.Literal("medium"),
    Type.Literal("low"),
  ]),
  scheduledFor: Type.String({ minLength: 1 }),
});

export const AssignmentsListRequest = Type.Object({
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});
export const AssignmentsListResponse = Type.Object({
  entries: Type.Array(InspectionAssignment),
  count: Type.Integer({ minimum: 0 }),
  offset: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 0 }),
  nextOffset: Type.Optional(Type.Integer({ minimum: 0 })),
});
