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
});

export type JobLogEntry = StaticDecode<typeof JobLogEntrySchema>;

export const JobProgressSchema = Type.Object({
  step: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  current: Type.Optional(Type.Integer({ minimum: 0 })),
  total: Type.Optional(Type.Integer({ minimum: 0 })),
});

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
});

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
});

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
});

export type WorkerHeartbeat = StaticDecode<typeof WorkerHeartbeatSchema>;
