import Type from "typebox";

export const RefreshStatusValueSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
]);

export const InspectionSummariesRefreshStatusSchema = Type.Object({
  refreshId: Type.String({ minLength: 1 }),
  siteId: Type.String({ minLength: 1 }),
  status: RefreshStatusValueSchema,
  updatedAt: Type.String({ minLength: 1 }),
  message: Type.Optional(Type.String({ minLength: 1 })),
});

// Inspection.Summaries.Refresh
export const InspectionSummariesRefreshRequestSchema = Type.Object({
  siteId: Type.String({ minLength: 1 }),
});
export const InspectionSummariesRefreshResponseSchema = Type.Object({
  refreshId: Type.String({ minLength: 1 }),
  status: RefreshStatusValueSchema,
});

// Inspection.Summaries.RefreshStatus.Get
export const InspectionSummariesRefreshStatusRequestSchema = Type.Object({
  refreshId: Type.String({ minLength: 1 }),
});
export const InspectionSummariesRefreshStatusResponseSchema = Type.Object({
  refresh: Type.Optional(InspectionSummariesRefreshStatusSchema),
});

// InspectionSummariesRefresh Job
export const InspectionSummariesRefreshJobPayloadSchema = Type.Object({
  siteId: Type.String({ minLength: 1 }),
});
export const InspectionSummariesRefreshJobResultSchema = Type.Object({
  refreshId: Type.String({ minLength: 1 }),
  status: RefreshStatusValueSchema,
});
