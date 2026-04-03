import { type StaticDecode, Type } from "typebox";

export const JobStateSchema = Type.Union([
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

export type JobState = StaticDecode<typeof JobStateSchema>;

export const JobLogEntrySchema = Type.Object({
  timestamp: Type.String({ format: "date-time" }),
  level: Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("error")]),
  message: Type.String(),
}, { additionalProperties: false });

export type JobLogEntry = StaticDecode<typeof JobLogEntrySchema>;

export const JobProgressSchema = Type.Object({
  step: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  current: Type.Optional(Type.Integer({ minimum: 0 })),
  total: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

export type JobProgress = StaticDecode<typeof JobProgressSchema>;

export const JobSchema = Type.Object({
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
}, { additionalProperties: false });

export type Job<TPayload = unknown, TResult = unknown> = Omit<StaticDecode<typeof JobSchema>, "payload" | "result"> & {
  payload: TPayload;
  result?: TResult;
};

export const JobEventSchema = Type.Object({
  jobId: Type.String({ minLength: 1 }),
  service: Type.String({ minLength: 1 }),
  jobType: Type.String({ minLength: 1 }),
  eventType: Type.Union([
    Type.Literal("created"),
    Type.Literal("started"),
    Type.Literal("retry"),
    Type.Literal("progress"),
    Type.Literal("logged"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("cancelled"),
    Type.Literal("expired"),
    Type.Literal("retried"),
    Type.Literal("dead"),
    Type.Literal("dismissed"),
  ]),
  state: JobStateSchema,
  previousState: Type.Optional(JobStateSchema),
  tries: Type.Integer({ minimum: 0 }),
  maxTries: Type.Optional(Type.Integer({ minimum: 1 })),
  error: Type.Optional(Type.String()),
  progress: Type.Optional(JobProgressSchema),
  logs: Type.Optional(Type.Array(JobLogEntrySchema)),
  payload: Type.Optional(Type.Unknown()),
  result: Type.Optional(Type.Unknown()),
  deadline: Type.Optional(Type.String({ format: "date-time" })),
  timestamp: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export type JobEvent<TPayload = unknown, TResult = unknown> =
  Omit<StaticDecode<typeof JobEventSchema>, "payload" | "result"> & {
    payload?: TPayload;
    result?: TResult;
  };

export const WorkerHeartbeatSchema = Type.Object({
  service: Type.String({ minLength: 1 }),
  jobType: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
  version: Type.Optional(Type.String({ minLength: 1 })),
  timestamp: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export type WorkerHeartbeat = StaticDecode<typeof WorkerHeartbeatSchema>;

export const ServiceInfoSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  workers: Type.Array(WorkerHeartbeatSchema),
  healthy: Type.Boolean(),
}, { additionalProperties: false });

export type ServiceInfo = StaticDecode<typeof ServiceInfoSchema>;

export const JobFilterSchema = Type.Object({
  service: Type.Optional(Type.String({ minLength: 1 })),
  type: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(Type.Union([JobStateSchema, Type.Array(JobStateSchema)])),
  since: Type.Optional(Type.String({ format: "date-time" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
}, { additionalProperties: false });

export type JobFilter = StaticDecode<typeof JobFilterSchema>;

export const JobsHealthRequestSchema = Type.Object({}, { additionalProperties: false });

export const JobsHealthCheckSchema = Type.Object({
  name: Type.String(),
  status: Type.Union([Type.Literal("ok"), Type.Literal("failed")]),
  latencyMs: Type.Number(),
  error: Type.Optional(Type.String()),
}, { additionalProperties: false });

export type JobsHealthCheck = StaticDecode<typeof JobsHealthCheckSchema>;

export const JobsHealthResponseSchema = Type.Object({
  status: Type.Union([
    Type.Literal("healthy"),
    Type.Literal("unhealthy"),
    Type.Literal("degraded"),
  ]),
  service: Type.String(),
  timestamp: Type.String({ format: "date-time" }),
  checks: Type.Array(JobsHealthCheckSchema),
}, { additionalProperties: false });

export type JobsHealthRequest = StaticDecode<typeof JobsHealthRequestSchema>;
export type JobsHealthResponse = StaticDecode<typeof JobsHealthResponseSchema>;

export const JobsListServicesRequestSchema = Type.Object({}, { additionalProperties: false });
export const JobsListServicesResponseSchema = Type.Object({
  services: Type.Array(ServiceInfoSchema),
}, { additionalProperties: false });

export const JobsListRequestSchema = JobFilterSchema;
export const JobsListResponseSchema = Type.Object({
  jobs: Type.Array(JobSchema),
}, { additionalProperties: false });

export const JobsListDLQRequestSchema = JobFilterSchema;
export const JobsListDLQResponseSchema = Type.Object({
  jobs: Type.Array(JobSchema),
}, { additionalProperties: false });

export const JobsGetRequestSchema = Type.Object({
  service: Type.String({ minLength: 1 }),
  jobType: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const JobsGetResponseSchema = Type.Object({
  job: Type.Optional(JobSchema),
}, { additionalProperties: false });

export type JobsGetRequest = StaticDecode<typeof JobsGetRequestSchema>;
export type JobsGetResponse = StaticDecode<typeof JobsGetResponseSchema>;

export const JobsMutateRequestSchema = JobsGetRequestSchema;
export const JobsMutateResponseSchema = Type.Object({
  job: JobSchema,
}, { additionalProperties: false });

export const JobsReplayDLQRequestSchema = JobsGetRequestSchema;
export const JobsReplayDLQResponseSchema = JobsMutateResponseSchema;

export const JobsDismissDLQRequestSchema = JobsGetRequestSchema;
export const JobsDismissDLQResponseSchema = JobsMutateResponseSchema;

export type JobsMutateRequest = StaticDecode<typeof JobsMutateRequestSchema>;
export type JobsMutateResponse = StaticDecode<typeof JobsMutateResponseSchema>;
export type JobsListDLQRequest = StaticDecode<typeof JobsListDLQRequestSchema>;
export type JobsListDLQResponse = StaticDecode<typeof JobsListDLQResponseSchema>;
export type JobsReplayDLQRequest = StaticDecode<typeof JobsReplayDLQRequestSchema>;
export type JobsReplayDLQResponse = StaticDecode<typeof JobsReplayDLQResponseSchema>;
export type JobsDismissDLQRequest = StaticDecode<typeof JobsDismissDLQRequestSchema>;
export type JobsDismissDLQResponse = StaticDecode<typeof JobsDismissDLQResponseSchema>;
