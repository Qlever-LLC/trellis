import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { health } from "@qlever-llc/trellis/sdk/health";
import * as schemas from "./src/schemas/index.ts";

export const contract = defineServiceContract(
  {
    schemas,
  },
  (ref) => ({
    id: "trellis.demo-service@v1",
    displayName: "Field Ops Demo Service",
    description: "Consolidated Field Ops demo service for Trellis concepts.",
    uses: { health: health.useDefaults() },
    exports: {
      schemas: ["EvidenceRecord", "InspectionAssignment", "ReportRecord", "SiteSummary"],
    },
    jobs: {
      refreshSiteSummary: {
        payload: ref.schema("SiteRefreshJobPayload"),
        result: ref.schema("SiteRefreshJobResult"),
      },
    },
    resources: {
      kv: {
        siteSummaries: {
          purpose: "Latest site summaries for the Field Ops demo.",
          schema: ref.schema("SiteSummary"),
          history: 1,
          ttlMs: 0,
        },
      },
      store: {
        uploads: {
          purpose: "Persistent evidence locker files for the Field Ops demo.",
          ttlMs: 0,
          maxObjectBytes: 64 * 1024 * 1024,
          maxTotalBytes: 256 * 1024 * 1024,
        },
      },
    },
    rpc: {
      "Assignments.List": {
        version: "v1",
        input: ref.schema("AssignmentsListRequest"),
        output: ref.schema("AssignmentsListResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Sites.List": {
        version: "v1",
        input: ref.schema("SitesListRequest"),
        output: ref.schema("SitesListResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Sites.Get": {
        version: "v1",
        input: ref.schema("SitesGetRequest"),
        output: ref.schema("SitesGetResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Evidence.List": {
        version: "v1",
        input: ref.schema("EvidenceListRequest"),
        output: ref.schema("EvidenceListResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Evidence.Download": {
        version: "v1",
        input: ref.schema("EvidenceDownloadRequest"),
        output: ref.schema("EvidenceDownloadResponse"),
        transfer: { direction: "receive" },
        capabilities: { call: [] },
        errors: [ref.error("TransferError"), ref.error("UnexpectedError")],
      },
      "Evidence.Delete": {
        version: "v1",
        input: ref.schema("EvidenceDeleteRequest"),
        output: ref.schema("EvidenceDeleteResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Reports.List": {
        version: "v1",
        input: ref.schema("ReportsListRequest"),
        output: ref.schema("ReportsListResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
    },
    operations: {
      "Sites.Refresh": {
        version: "v1",
        input: ref.schema("SitesRefreshRequest"),
        progress: ref.schema("SitesRefreshProgress"),
        output: ref.schema("SitesRefreshResponse"),
        capabilities: { call: [], read: [] },
      },
      "Reports.Generate": {
        version: "v1",
        input: ref.schema("ReportsGenerateRequest"),
        progress: ref.schema("ReportsGenerateProgress"),
        output: ref.schema("ReportsGenerateResponse"),
        capabilities: { call: [], read: [] },
      },
      "Evidence.Upload": {
        version: "v1",
        input: ref.schema("EvidenceUploadRequest"),
        progress: ref.schema("EvidenceUploadProgress"),
        output: ref.schema("EvidenceUploadResponse"),
        transfer: {
          direction: "send",
          store: "uploads",
          key: "/key",
          contentType: "/contentType",
          metadata: "/metadata",
          expiresInMs: 60_000,
        },
        capabilities: { call: [], read: [] },
      },
    },
    events: {
      "Activity.Recorded": {
        version: "v1",
        event: ref.schema("ActivityRecordedEvent"),
      },
      "Reports.Published": {
        version: "v1",
        event: ref.schema("ReportsPublishedEvent"),
      },
      "Evidence.Uploaded": {
        version: "v1",
        event: ref.schema("EvidenceUploadedEvent"),
      },
      "Sites.Refreshed": {
        version: "v1",
        event: ref.schema("SitesRefreshedEvent"),
      },
    },
  }),
);

export default contract;
