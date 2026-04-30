import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { Type } from "typebox";

const JobStateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("active"),
  Type.Literal("retry"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("expired"),
  Type.Literal("dead"),
  Type.Literal("dismissed"),
]);

const JobLogEntrySchema = Type.Object({
  timestamp: Type.String({ format: "date-time" }),
  level: Type.Union([
    Type.Literal("info"),
    Type.Literal("warn"),
    Type.Literal("error"),
  ]),
  message: Type.String(),
});

const JobProgressSchema = Type.Object({
  current: Type.Integer({ minimum: 0 }),
  total: Type.Integer({ minimum: 0 }),
  message: Type.Optional(Type.String()),
});

const JobSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  service: Type.String({ minLength: 1 }),
  type: Type.String({ minLength: 1 }),
  state: JobStateSchema,
  payload: Type.Unknown(),
  result: Type.Optional(Type.Unknown()),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
  startedAt: Type.Optional(Type.String({ format: "date-time" })),
  completedAt: Type.Optional(Type.String({ format: "date-time" })),
  tries: Type.Integer({ minimum: 0 }),
  maxTries: Type.Integer({ minimum: 1 }),
  lastError: Type.Optional(Type.String()),
  deadline: Type.Optional(Type.String({ format: "date-time" })),
  progress: Type.Optional(JobProgressSchema),
  logs: Type.Optional(Type.Array(JobLogEntrySchema)),
});

const JobIdentitySchema = Type.Object({
  service: Type.String({ minLength: 1 }),
  jobType: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
});

const JobListRequestSchema = Type.Object({
  service: Type.Optional(Type.String({ minLength: 1 })),
  type: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(JobStateSchema),
  since: Type.Optional(Type.String({ format: "date-time" })),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
});

const WorkerSchema = Type.Object({
  service: Type.String({ minLength: 1 }),
  jobType: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  timestamp: Type.String({ format: "date-time" }),
  concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
  version: Type.Optional(Type.String({ minLength: 1 })),
});

const schemas = {
  Empty: Type.Object({}),
  JobState: JobStateSchema,
  JobLogEntry: JobLogEntrySchema,
  JobProgress: JobProgressSchema,
  Job: JobSchema,
  JobsHealthResponse: Type.Object({
    service: Type.String({ minLength: 1 }),
    status: Type.Unknown(),
    timestamp: Type.String({ format: "date-time" }),
    checks: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  }),
  JobsListServicesResponse: Type.Object({
    services: Type.Array(Type.Object({
      name: Type.String({ minLength: 1 }),
      healthy: Type.Boolean(),
      workers: Type.Array(WorkerSchema),
    })),
  }),
  JobsListRequest: JobListRequestSchema,
  JobsListResponse: Type.Object({ jobs: Type.Array(JobSchema) }),
  JobsGetRequest: JobIdentitySchema,
  JobsGetResponse: Type.Object({ job: Type.Optional(JobSchema) }),
  JobsCancelRequest: JobIdentitySchema,
  JobsCancelResponse: Type.Object({ job: JobSchema }),
  JobsRetryRequest: JobIdentitySchema,
  JobsRetryResponse: Type.Object({ job: JobSchema }),
  JobsListDLQRequest: JobListRequestSchema,
  JobsListDLQResponse: Type.Object({ jobs: Type.Array(JobSchema) }),
  JobsReplayDLQRequest: JobIdentitySchema,
  JobsReplayDLQResponse: Type.Object({ job: JobSchema }),
  JobsDismissDLQRequest: JobIdentitySchema,
  JobsDismissDLQResponse: Type.Object({ job: JobSchema }),
} as const;

export const trellisJobs = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.jobs@v1",
    displayName: "Trellis Jobs",
    description: "Trellis-managed background job administration API.",
    resources: {
      kv: {
        jobsState: {
          purpose: "Projected Trellis job state for admin queries.",
          schema: ref.schema("Job"),
          history: 1,
        },
      },
    },
    rpc: {
      "Jobs.Health": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("JobsHealthResponse"),
        capabilities: { call: ["jobs.admin.read"] },
        errors: [ref.error("UnexpectedError")],
      },
      "Jobs.ListServices": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("JobsListServicesResponse"),
        capabilities: { call: ["jobs.admin.read"] },
        errors: [ref.error("UnexpectedError")],
      },
      "Jobs.List": {
        version: "v1",
        input: ref.schema("JobsListRequest"),
        output: ref.schema("JobsListResponse"),
        capabilities: { call: ["jobs.admin.read"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "Jobs.Get": {
        version: "v1",
        input: ref.schema("JobsGetRequest"),
        output: ref.schema("JobsGetResponse"),
        capabilities: { call: ["jobs.admin.read"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "Jobs.Cancel": {
        version: "v1",
        input: ref.schema("JobsCancelRequest"),
        output: ref.schema("JobsCancelResponse"),
        capabilities: { call: ["jobs.admin.mutate"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "Jobs.Retry": {
        version: "v1",
        input: ref.schema("JobsRetryRequest"),
        output: ref.schema("JobsRetryResponse"),
        capabilities: { call: ["jobs.admin.mutate"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "Jobs.ListDLQ": {
        version: "v1",
        input: ref.schema("JobsListDLQRequest"),
        output: ref.schema("JobsListDLQResponse"),
        capabilities: { call: ["jobs.admin.read"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "Jobs.ReplayDLQ": {
        version: "v1",
        input: ref.schema("JobsReplayDLQRequest"),
        output: ref.schema("JobsReplayDLQResponse"),
        capabilities: { call: ["jobs.admin.mutate"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "Jobs.DismissDLQ": {
        version: "v1",
        input: ref.schema("JobsDismissDLQRequest"),
        output: ref.schema("JobsDismissDLQResponse"),
        capabilities: { call: ["jobs.admin.mutate"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
    },
  }),
);

export const CONTRACT_ID = trellisJobs.CONTRACT_ID;
export const CONTRACT = trellisJobs.CONTRACT;
export const CONTRACT_DIGEST = trellisJobs.CONTRACT_DIGEST;
export const API: typeof trellisJobs.API = trellisJobs.API;
export const use: typeof trellisJobs.use = trellisJobs.use;
export default trellisJobs;
