import Type, {
  type Static,
  type TArray,
  type TObject,
  type TSchema,
} from "typebox";

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
});

export type ContractSchemaRef = Static<typeof ContractSchemaRefSchema>;

export const ContractDocsSchema = Type.Object({
  summary: Type.Optional(Type.String()),
  markdown: Type.String(),
});

export type ContractDocs = Static<typeof ContractDocsSchema>;

export const ContractKvResourceSchema = Type.Object({
  purpose: Type.String({ minLength: 1 }),
  schema: ContractSchemaRefSchema,
  required: Type.Optional(Type.Boolean({ default: true })),
  history: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  ttlMs: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  maxValueBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  docs: Type.Optional(ContractDocsSchema),
});

export type ContractKvResource = Static<typeof ContractKvResourceSchema>;

export const ContractStoreResourceSchema = Type.Object({
  purpose: Type.String({ minLength: 1 }),
  required: Type.Optional(Type.Boolean({ default: true })),
  ttlMs: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  maxObjectBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  maxTotalBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  docs: Type.Optional(ContractDocsSchema),
});

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
  docs: Type.Optional(ContractDocsSchema),
});

export type ContractStateStore = Static<typeof ContractStateStoreSchema>;

export const ContractStateSchema = Type.Record(
  Type.String({ minLength: 1 }),
  ContractStateStoreSchema,
);

export type ContractState = Static<typeof ContractStateSchema>;

export const JobKeyConcurrencySchema = Type.Object({
  key: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  maxActive: Type.Optional(Type.Integer({ minimum: 1 })),
  heartbeatIntervalMs: Type.Optional(Type.Integer({ minimum: 1 })),
  heartbeatTtlMs: Type.Optional(Type.Integer({ minimum: 1 })),
  stalePolicy: Type.Optional(Type.Union([
    Type.Literal("fail-stale"),
    Type.Literal("block"),
  ])),
});

export type JobKeyConcurrency = Static<typeof JobKeyConcurrencySchema>;

export const JobQueueDepthSchema = Type.Object({
  maxQueuedPerKey: Type.Optional(Type.Integer({ minimum: 0 })),
  whenFull: Type.Optional(Type.Union([
    Type.Literal("reject"),
    Type.Literal("coalesce"),
    Type.Literal("replace-oldest"),
  ])),
});

export type JobQueueDepth = Static<typeof JobQueueDepthSchema>;

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
  keyConcurrency: Type.Optional(JobKeyConcurrencySchema),
  queue: Type.Optional(JobQueueDepthSchema),
  docs: Type.Optional(ContractDocsSchema),
});

export type ContractJobQueue = Static<typeof ContractJobQueueSchema>;

export const ContractJobsSchema = Type.Record(
  Type.String({ minLength: 1 }),
  ContractJobQueueSchema,
);

export type ContractJobs = Static<typeof ContractJobsSchema>;

export const ContractEventConsumerUsesSchema = Type.Record(
  Type.String({ minLength: 1 }),
  Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
);

export type ContractEventConsumerUses = Static<
  typeof ContractEventConsumerUsesSchema
>;

export const ContractEventConsumerSelfSchema = Type.Array(
  Type.String({ minLength: 1 }),
);

export type ContractEventConsumerSelf = Static<
  typeof ContractEventConsumerSelfSchema
>;

export const ContractEventConsumerGroupSchema = Type.Object({
  uses: Type.Optional(ContractEventConsumerUsesSchema),
  self: Type.Optional(ContractEventConsumerSelfSchema),
  replay: Type.Optional(Type.Union([
    Type.Literal("new"),
    Type.Literal("all"),
  ])),
  ordering: Type.Optional(Type.Literal("strict")),
  concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
  ackWaitMs: Type.Optional(Type.Integer({ minimum: 1 })),
  maxDeliver: Type.Optional(Type.Integer({ minimum: 1 })),
  backoffMs: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
  docs: Type.Optional(ContractDocsSchema),
});

export type ContractEventConsumerGroup = Static<
  typeof ContractEventConsumerGroupSchema
>;

export const ContractEventConsumersSchema = Type.Record(
  Type.String({ minLength: 1 }),
  ContractEventConsumerGroupSchema,
);

export type ContractEventConsumers = Static<
  typeof ContractEventConsumersSchema
>;

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

export const JobsQueueKeyConcurrencyBindingSchema = Type.Object({
  key: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  maxActive: Type.Integer({ minimum: 1 }),
  heartbeatIntervalMs: Type.Integer({ minimum: 1 }),
  heartbeatTtlMs: Type.Integer({ minimum: 1 }),
  stalePolicy: Type.Union([
    Type.Literal("fail-stale"),
    Type.Literal("block"),
  ]),
});

export type JobsQueueKeyConcurrencyBinding = Static<
  typeof JobsQueueKeyConcurrencyBindingSchema
>;

export const JobsQueueDepthBindingSchema = Type.Object({
  maxQueuedPerKey: Type.Integer({ minimum: 0 }),
  whenFull: Type.Union([
    Type.Literal("reject"),
    Type.Literal("coalesce"),
    Type.Literal("replace-oldest"),
  ]),
});

export type JobsQueueDepthBinding = Static<
  typeof JobsQueueDepthBindingSchema
>;

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
  keyConcurrency: Type.Optional(JobsQueueKeyConcurrencyBindingSchema),
  queue: Type.Optional(JobsQueueDepthBindingSchema),
});

export type JobsQueueBinding = Static<typeof JobsQueueBindingSchema>;

export const JobsResourceBindingSchema = Type.Object({
  namespace: Type.String({ minLength: 1 }),
  workStream: Type.Optional(Type.String({ minLength: 1 })),
  queues: Type.Record(Type.String({ minLength: 1 }), JobsQueueBindingSchema),
});

export type JobsResourceBinding = Static<typeof JobsResourceBindingSchema>;

export const EventConsumerResourceBindingSchema = Type.Object({
  stream: Type.String({ minLength: 1 }),
  consumerName: Type.String({ minLength: 1 }),
  filterSubjects: Type.Array(Type.String({ minLength: 1 })),
  replay: Type.Union([Type.Literal("new"), Type.Literal("all")]),
  ordering: Type.Literal("strict"),
  concurrency: Type.Integer({ minimum: 1 }),
  ackWaitMs: Type.Integer({ minimum: 1 }),
  maxDeliver: Type.Integer({ minimum: 1 }),
  backoffMs: Type.Array(Type.Integer({ minimum: 0 })),
});

export type EventConsumerResourceBinding = Static<
  typeof EventConsumerResourceBindingSchema
>;

export const ContractResourceBindingsSchema = Type.Object({
  kv: Type.Optional(
    Type.Record(Type.String({ minLength: 1 }), KvResourceBindingSchema),
  ),
  store: Type.Optional(
    Type.Record(Type.String({ minLength: 1 }), StoreResourceBindingSchema),
  ),
  jobs: Type.Optional(JobsResourceBindingSchema),
  eventConsumers: Type.Optional(
    Type.Record(
      Type.String({ minLength: 1 }),
      EventConsumerResourceBindingSchema,
    ),
  ),
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

/** Schema for a bounded pagination request. */
export const PageRequestSchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0 }),
});

/** Bounded pagination request. */
export type PageRequest = Static<typeof PageRequestSchema>;

/** Create a schema for a bounded page response with typed entries. */
export function PageResponseSchema<TEntry extends TSchema>(entry: TEntry) {
  return Type.Object({
    entries: Type.Array(entry, { default: [] }),
    count: Type.Integer({ minimum: 0 }),
    offset: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 0 }),
    nextOffset: Type.Optional(Type.Integer({ minimum: 0 })),
  });
}

/** Bounded pagination response with typed entries. */
export type PageResponse<TEntry> = {
  entries: TEntry[];
  count: number;
  offset: number;
  limit: number;
  nextOffset?: number;
};

/**
 * Validates and normalizes an offset pagination query.
 *
 * Ensures `offset` and `limit` are non-negative integers within bounds. Throws
 * `RangeError` on invalid input.
 */
export function normalizePageQuery(
  query: PageRequest,
  maxLimit: number = Number.MAX_SAFE_INTEGER,
): Required<PageRequest> {
  if (!Number.isInteger(query.limit) || query.limit < 0) {
    throw new RangeError("list limit must be a non-negative integer");
  }
  if (query.limit > maxLimit) {
    throw new RangeError(`list limit must be <= ${maxLimit}`);
  }
  const offset = query.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("list offset must be a non-negative integer");
  }
  return { offset, limit: query.limit };
}

/**
 * Builds a {@link PageResponse} from a pre-sliced offset page.
 *
 * @param entries - The entries for the current page, already sliced by the caller.
 * @param totalCount - Total number of matching entries before slicing.
 * @param query - The original pagination query used to produce the page.
 * @param maxLimit - Optional maximum limit accepted by the endpoint.
 */
export function buildPageResponse<T>(
  entries: T[],
  totalCount: number,
  query: PageRequest,
  maxLimit?: number,
): PageResponse<T> {
  const { offset, limit } = normalizePageQuery(query, maxLimit);
  return {
    entries,
    count: totalCount,
    offset,
    limit,
    nextOffset: limit <= 0 || offset + limit >= totalCount
      ? undefined
      : offset + limit,
  };
}

/** Schema for a cursor pagination query. */
export const CursorQuerySchema = Type.Object({
  cursor: Type.Optional(Type.String({ minLength: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 0, maximum: 500 })),
});

/** Cursor pagination query. */
export type CursorQuery = Static<typeof CursorQuerySchema>;

/** Schema for cursor pagination response metadata. */
export const CursorPageInfoSchema = Type.Object({
  nextCursor: Type.Optional(Type.String({ minLength: 1 })),
});

/** Cursor pagination response metadata. */
export type CursorPageInfo = Static<typeof CursorPageInfoSchema>;

/** TypeBox schema for a cursor page response with typed items. */
export type CursorPageResponseSchema<TItem extends TSchema> = TObject<{
  items: TArray<TItem>;
  page: typeof CursorPageInfoSchema;
}>;

/** Create a schema for a cursor page response with typed items. */
export function CursorPageSchema<TItem extends TSchema>(
  item: TItem,
): CursorPageResponseSchema<TItem> {
  return Type.Object({
    items: Type.Array(item, { default: [] }),
    page: CursorPageInfoSchema,
  });
}

/** Cursor pagination response with typed items. */
export type CursorPage<TItem> = {
  items: TItem[];
  page: CursorPageInfo;
};

/** Options for normalizing a cursor pagination query. */
export type CursorQueryOptions = {
  /** Limit used when the query does not specify one. Defaults to `100`. */
  defaultLimit?: number;
  /** Maximum accepted limit. Defaults to `500`. */
  maxLimit?: number;
};

/** Cursor query after defaults and validation have been applied. */
export type NormalizedCursorQuery = {
  cursor?: string;
  limit: number;
};

/**
 * Validates and normalizes a cursor pagination query.
 *
 * Defaults `limit` to `100`, rejects limits above `500` unless `maxLimit` is
 * overridden, and preserves a non-empty optional cursor.
 */
export function normalizeCursorQuery(
  query: CursorQuery,
  options: CursorQueryOptions = {},
): NormalizedCursorQuery {
  const maxLimit = options.maxLimit ?? 500;
  const limit = query.limit ?? options.defaultLimit ?? 100;
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("list limit must be a non-negative integer");
  }
  if (limit > maxLimit) {
    throw new RangeError(`list limit must be <= ${maxLimit}`);
  }
  if (query.cursor === undefined) {
    return { limit };
  }
  if (query.cursor.length === 0) {
    throw new RangeError("list cursor must be a non-empty string");
  }
  return { cursor: query.cursor, limit };
}

/**
 * Builds a {@link CursorPage} from items and an optional next cursor.
 *
 * @param items - The items for the current page.
 * @param nextCursor - Cursor clients can use to request the next page.
 */
export function buildCursorPage<T>(
  items: T[],
  nextCursor?: string,
): CursorPage<T> {
  return {
    items,
    page: nextCursor === undefined ? {} : { nextCursor },
  };
}
