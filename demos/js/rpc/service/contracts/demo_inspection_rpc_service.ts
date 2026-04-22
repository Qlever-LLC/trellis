import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth, health } from "@qlever-llc/trellis-sdk";
import Type from "typebox";

const schemas = {
  Empty: Type.Object({}),
  InspectionAssignment: Type.Object({
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
  }),
  InspectionAssignmentsListResponse: Type.Object({
    assignments: Type.Array(Type.Object({
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
    })),
  }),
  SiteSummaryRequest: Type.Object({
    siteId: Type.String({ minLength: 1 }),
  }),
  SiteSummary: Type.Object({
    siteId: Type.String({ minLength: 1 }),
    siteName: Type.String({ minLength: 1 }),
    openInspections: Type.Integer({ minimum: 0 }),
    overdueInspections: Type.Integer({ minimum: 0 }),
    latestStatus: Type.String({ minLength: 1 }),
    lastReportAt: Type.String({ minLength: 1 }),
  }),
  SiteSummaryResponse: Type.Object({
    summary: Type.Optional(Type.Object({
      siteId: Type.String({ minLength: 1 }),
      siteName: Type.String({ minLength: 1 }),
      openInspections: Type.Integer({ minimum: 0 }),
      overdueInspections: Type.Integer({ minimum: 0 }),
      latestStatus: Type.String({ minLength: 1 }),
      lastReportAt: Type.String({ minLength: 1 }),
    })),
  }),
} as const;

export const contract = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.demo-rpc-service@v1",
    displayName: "Inspection RPC Demo Service",
    description: "Field inspection RPC demo service.",
    uses: {
      auth: auth.useDefaults(),
      health: health.useDefaults(),
    },
    rpc: {
      "Inspection.Assignments.List": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("InspectionAssignmentsListResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Inspection.Sites.GetSummary": {
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
