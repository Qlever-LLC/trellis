import Type from "typebox";

export const RefreshStatusValue = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
]);

export const InspectionSummariesRefreshStatus = Type.Object({
  refreshId: Type.String({ minLength: 1 }),
  siteId: Type.String({ minLength: 1 }),
  status: RefreshStatusValue,
  updatedAt: Type.String({ minLength: 1 }),
  message: Type.Optional(Type.String({ minLength: 1 })),
});

// Inspection.Summaries.Refresh
export const InspectionSummariesRefreshRequest = Type.Object({
  siteId: Type.String({ minLength: 1 }),
});
export const InspectionSummariesRefreshResponse = Type.Object({
  refreshId: Type.String({ minLength: 1 }),
  status: RefreshStatusValue,
});

// Inspection.Summaries.RefreshStatus.Get
export const InspectionSummariesRefreshStatusRequest = Type.Object({
  refreshId: Type.String({ minLength: 1 }),
});
export const InspectionSummariesRefreshStatusResponse = Type.Object({
  refresh: Type.Optional(InspectionSummariesRefreshStatus),
});

// InspectionSummariesRefresh Job
export const InspectionSummariesRefreshJobPayload = Type.Object({
  siteId: Type.String({ minLength: 1 }),
});
export const InspectionSummariesRefreshJobResult = Type.Object({
  refreshId: Type.String({ minLength: 1 }),
  status: RefreshStatusValue,
});
