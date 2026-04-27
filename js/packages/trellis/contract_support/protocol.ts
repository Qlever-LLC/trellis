import Type, { type Static } from "typebox";

function parseIsoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(
      `Expected canonical ISO 8601 UTC date-time string, received '${value}'`,
    );
  }
  return parsed;
}

function formatIsoDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Expected a valid Date instance");
  }
  return value.toISOString();
}

export const ContractSchemaRefSchema = Type.Object({
  schema: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export type ContractSchemaRef = Static<typeof ContractSchemaRefSchema>;

export const ContractKvResourceSchema = Type.Object({
  purpose: Type.String({ minLength: 1 }),
  schema: ContractSchemaRefSchema,
  required: Type.Optional(Type.Boolean({ default: true })),
  history: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  ttlMs: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  maxValueBytes: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export type ContractKvResource = Static<typeof ContractKvResourceSchema>;

export const ContractStoreResourceSchema = Type.Object({
  purpose: Type.String({ minLength: 1 }),
  required: Type.Optional(Type.Boolean({ default: true })),
  ttlMs: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  maxObjectBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  maxTotalBytes: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export type ContractStoreResource = Static<typeof ContractStoreResourceSchema>;

export const ContractStateStoreSchema = Type.Object({
  kind: Type.Union([
    Type.Literal("value"),
    Type.Literal("map"),
  ]),
  schema: ContractSchemaRefSchema,
  stateVersion: Type.Optional(Type.String({ minLength: 1 })),
  acceptedVersions: Type.Optional(Type.Record(
    Type.String({ minLength: 1 }),
    ContractSchemaRefSchema,
  )),
}, { additionalProperties: false });

export type ContractStateStore = Static<typeof ContractStateStoreSchema>;

export const ContractStateSchema = Type.Record(
  Type.String({ minLength: 1 }),
  ContractStateStoreSchema,
);

export type ContractState = Static<typeof ContractStateSchema>;

export const ContractJobQueueSchema = Type.Object({
  payload: ContractSchemaRefSchema,
  result: Type.Optional(ContractSchemaRefSchema),
  maxDeliver: Type.Optional(Type.Integer({ minimum: 1 })),
  backoffMs: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
  ackWaitMs: Type.Optional(Type.Integer({ minimum: 1 })),
  defaultDeadlineMs: Type.Optional(Type.Integer({ minimum: 1 })),
  progress: Type.Optional(Type.Boolean()),
  logs: Type.Optional(Type.Boolean()),
  dlq: Type.Optional(Type.Boolean()),
  concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export type ContractJobQueue = Static<typeof ContractJobQueueSchema>;

export const ContractJobsSchema = Type.Record(
  Type.String({ minLength: 1 }),
  ContractJobQueueSchema,
);

export type ContractJobs = Static<typeof ContractJobsSchema>;

export const ContractResourcesSchema = Type.Object({
  kv: Type.Optional(
    Type.Record(Type.String({ minLength: 1 }), ContractKvResourceSchema),
  ),
  store: Type.Optional(
    Type.Record(Type.String({ minLength: 1 }), ContractStoreResourceSchema),
  ),
}, { additionalProperties: false });

export type ContractResources = Static<typeof ContractResourcesSchema>;

export const KvResourceBindingSchema = Type.Object({
  bucket: Type.String({ minLength: 1 }),
  history: Type.Integer({ minimum: 1 }),
  ttlMs: Type.Integer({ minimum: 0 }),
  maxValueBytes: Type.Optional(Type.Integer({ minimum: 1 })),
});

export type KvResourceBinding = Static<typeof KvResourceBindingSchema>;

export const StoreResourceBindingSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  ttlMs: Type.Integer({ minimum: 0 }),
  maxObjectBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  maxTotalBytes: Type.Optional(Type.Integer({ minimum: 1 })),
});

export type StoreResourceBinding = Static<typeof StoreResourceBindingSchema>;

export const JobsQueueBindingSchema = Type.Object({
  queueType: Type.String({ minLength: 1 }),
  publishPrefix: Type.String({ minLength: 1 }),
  workSubject: Type.String({ minLength: 1 }),
  consumerName: Type.String({ minLength: 1 }),
  payload: ContractSchemaRefSchema,
  result: Type.Optional(ContractSchemaRefSchema),
  maxDeliver: Type.Integer({ minimum: 1 }),
  backoffMs: Type.Array(Type.Integer({ minimum: 0 })),
  ackWaitMs: Type.Integer({ minimum: 1 }),
  defaultDeadlineMs: Type.Optional(Type.Integer({ minimum: 1 })),
  progress: Type.Boolean(),
  logs: Type.Boolean(),
  dlq: Type.Boolean(),
  concurrency: Type.Integer({ minimum: 1 }),
});

export type JobsQueueBinding = Static<typeof JobsQueueBindingSchema>;

export const JobsResourceBindingSchema = Type.Object({
  namespace: Type.String({ minLength: 1 }),
  workStream: Type.Optional(Type.String({ minLength: 1 })),
  queues: Type.Record(Type.String({ minLength: 1 }), JobsQueueBindingSchema),
});

export type JobsResourceBinding = Static<typeof JobsResourceBindingSchema>;

export const ContractResourceBindingsSchema = Type.Object({
  kv: Type.Optional(
    Type.Record(Type.String({ minLength: 1 }), KvResourceBindingSchema),
  ),
  store: Type.Optional(
    Type.Record(Type.String({ minLength: 1 }), StoreResourceBindingSchema),
  ),
  jobs: Type.Optional(JobsResourceBindingSchema),
});

export type ContractResourceBindings = Static<
  typeof ContractResourceBindingsSchema
>;

export const InstalledServiceContractSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  digest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
  resources: ContractResourceBindingsSchema,
});

export type InstalledServiceContract = Static<
  typeof InstalledServiceContractSchema
>;

export const IsoDateSchema = Type.Codec(
  Type.String({ format: "date-time" }),
)
  .Decode((value: string) => parseIsoDate(value))
  .Encode((value: Date) => formatIsoDate(value));

export const EventHeaderSchema = Type.Object({
  header: Type.Object({
    id: Type.String(),
    time: IsoDateSchema,
  }),
});

export type EventHeader = Static<typeof EventHeaderSchema>;

export const PaginatedSchema = Type.Object({
  count: Type.Integer({ minimum: 0 }),
  offset: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 0 }),
  next: Type.Optional(Type.Integer({ minimum: 0 })),
  prev: Type.Optional(Type.Integer({ minimum: 0 })),
});

export type Paginated = Static<typeof PaginatedSchema>;
