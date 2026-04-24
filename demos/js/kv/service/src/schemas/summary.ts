import Type from "typebox";

export const Empty = Type.Object({});

export const SiteSummaryRequest = Type.Object({
  siteId: Type.String({ minLength: 1 }),
});

export const SiteSummary = Type.Object({
  siteId: Type.String({ minLength: 1 }),
  siteName: Type.String({ minLength: 1 }),
  openInspections: Type.Integer({ minimum: 0 }),
  overdueInspections: Type.Integer({ minimum: 0 }),
  latestStatus: Type.String({ minLength: 1 }),
  lastReportAt: Type.String({ minLength: 1 }),
});

export const SiteSummariesListResponse = Type.Object({
  summaries: Type.Array(SiteSummary),
});

export const SiteSummaryResponse = Type.Object({
  summary: Type.Optional(SiteSummary),
});
