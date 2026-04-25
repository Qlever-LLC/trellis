import Type from "typebox";

export const InspectionContextState = Type.Object({
  siteId: Type.String(),
  note: Type.String(),
  updatedBy: Type.String(),
  updatedAt: Type.String({ format: "date-time" }),
});
