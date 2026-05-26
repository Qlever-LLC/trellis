import { jetstreamManager } from "@nats-io/jetstream";
import { type KV, Kvm } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core";
import { Objm } from "@nats-io/obj";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import type { EnvelopeBoundary } from "../auth/schemas.ts";
import {
  type ContractEntry,
  resolveContractUsesFromKnownEntries,
  templateToWildcard,
} from "./uses.ts";

type StreamRetentionPolicy = "limits" | "interest" | "workqueue";
type StreamStorageType = "file" | "memory";
type StreamDiscardPolicy = "old" | "new";

const TRELLIS_JOBS_CONTRACT_ID = "trellis.jobs@v1";
const TRELLIS_EVENT_STREAM = "trellis";
const DEFAULT_REDELIVERY_BACKOFF_MS = [5000, 30000, 120000, 600000, 1800000];

type ContractEventConsumerGroup = {
  events: Array<{ use: string; event: string }>;
  replay?: "new" | "all";
  ordering?: "strict";
  concurrency?: number;
  ackWaitMs?: number;
  maxDeliver?: number;
  backoffMs?: number[];
};

type ContractWithEventConsumers = TrellisContractV1 & {
  eventConsumers?: Record<string, ContractEventConsumerGroup>;
};
type ContractUseMap = NonNullable<
  NonNullable<TrellisContractV1["uses"]>["required"]
>;

export type KvResourceRequest = {
  alias: string;
  purpose: string;
  required: boolean;
  history: number;
  ttlMs: number;
  maxValueBytes?: number;
};

export type StoreResourceRequest = {
  alias: string;
  purpose: string;
  required: boolean;
  ttlMs: number;
  maxObjectBytes?: number;
  maxTotalBytes?: number;
};

export type JobsQueueRequest = {
  queueType: string;
  payload: { schema: string };
  result?: { schema: string };
  maxDeliver: number;
  backoffMs: number[];
  ackWaitMs: number;
  defaultDeadlineMs?: number;
  progress: boolean;
  logs: boolean;
  dlq: boolean;
  concurrency: number;
};

export type EventConsumerGroupRequest = {
  alias: string;
  stream: string;
  filterSubjects: string[];
  replay: "new" | "all";
  ordering: "strict";
  concurrency: number;
  ackWaitMs: number;
  maxDeliver: number;
  backoffMs: number[];
};

type StreamResourceSourceBinding = {
  fromAlias: string;
  streamName: string;
  filterSubject?: string;
  subjectTransformDest?: string;
};

type BuiltinStreamBinding = {
  name: string;
  retention?: StreamRetentionPolicy;
  storage?: StreamStorageType;
  numReplicas?: number;
  maxAgeMs?: number;
  maxBytes?: number;
  maxMsgs?: number;
  discard?: StreamDiscardPolicy;
  allowDirect?: boolean;
  subjects: string[];
  sources?: StreamResourceSourceBinding[];
};

type ConsumerInfoLike = Record<string, unknown>;

type EventConsumerManager = {
  add(
    stream: string,
    config: Record<string, unknown>,
  ): Promise<ConsumerInfoLike>;
  info(stream: string, consumer: string): Promise<ConsumerInfoLike>;
  update?(
    stream: string,
    consumer: string,
    config: Record<string, unknown>,
  ): Promise<ConsumerInfoLike>;
};

export type ContractResourceAnalysis = {
  kv: KvResourceRequest[];
  store: StoreResourceRequest[];
  jobs: JobsQueueRequest[];
  eventConsumers: EventConsumerGroupRequest[];
};

export type ResourceProvisioningOptions = {
  jetstreamReplicas?: number;
  knownContractEntries?: ContractEntry[];
  envelopeBoundary?: EnvelopeBoundary;
};

export type ContractResourceBindings = {
  kv?: Record<string, {
    bucket: string;
    history: number;
    ttlMs: number;
    maxValueBytes?: number;
  }>;
  store?: Record<string, {
    name: string;
    ttlMs: number;
    maxObjectBytes?: number;
    maxTotalBytes?: number;
  }>;
  jobs?: {
    namespace: string;
    workStream: string;
    queues: Record<string, {
      queueType: string;
      publishPrefix: string;
      workSubject: string;
      consumerName: string;
      payload: { schema: string };
      result?: { schema: string };
      maxDeliver: number;
      backoffMs: number[];
      ackWaitMs: number;
      defaultDeadlineMs?: number;
      progress: boolean;
      logs: boolean;
      dlq: boolean;
      concurrency: number;
    }>;
  };
  eventConsumers?: Record<string, {
    stream: string;
    consumerName: string;
    filterSubjects: string[];
    replay: "new" | "all";
    ordering: "strict";
    concurrency: number;
    ackWaitMs: number;
    maxDeliver: number;
    backoffMs: number[];
  }>;
};

export type InstalledServiceContractBinding = {
  contractId: string;
  digest: string;
  resources: ContractResourceBindings;
};

export type ResourcePurgeManager = {
  deleteKvBucket(bucket: string): Promise<void>;
  deleteObjectStore(name: string): Promise<void>;
};

export type PurgeableContractResourceBindings = {
  kv?: ContractResourceBindings["kv"];
  store?: ContractResourceBindings["store"];
  jobs?: unknown;
};

/**
 * Creates a NATS-backed resource purge manager for deleting physical KV buckets
 * and object stores by their persisted binding names.
 */
export function createNatsResourcePurgeManager(
  nats: NatsConnection,
): ResourcePurgeManager {
  return {
    async deleteKvBucket(bucket) {
      const kv = await new Kvm(nats).open(bucket);
      await kv.destroy();
    },
    async deleteObjectStore(name) {
      const store = await new Objm(nats).open(name);
      await store.destroy();
    },
  };
}

/**
 * Deletes physical KV and object-store resources referenced by persisted service
 * contract bindings. Jobs bindings are intentionally ignored because they use
 * shared platform streams.
 */
export async function purgeContractResourceBindings(
  bindings: Iterable<PurgeableContractResourceBindings>,
  manager: ResourcePurgeManager,
): Promise<void> {
  const kvBuckets = new Set<string>();
  const objectStores = new Set<string>();
  for (const binding of bindings) {
    for (const kvBinding of Object.values(binding.kv ?? {})) {
      kvBuckets.add(kvBinding.bucket);
    }
    for (const storeBinding of Object.values(binding.store ?? {})) {
      objectStores.add(storeBinding.name);
    }
  }
  for (const bucket of kvBuckets) {
    await manager.deleteKvBucket(bucket);
  }
  for (const name of objectStores) {
    await manager.deleteObjectStore(name);
  }
}

export function getKvPermissionGrants(
  bucket: string,
  options: { allowCreate?: boolean } = {},
): {
  publish: string[];
  subscribe: string[];
} {
  const stream = `KV_${bucket}`;
  return {
    publish: [
      "$JS.API.INFO",
      `$KV.${bucket}.>`,
      `$JS.API.STREAM.INFO.${stream}`,
      ...(options.allowCreate ? [`$JS.API.STREAM.CREATE.${stream}`] : []),
      `$JS.API.STREAM.MSG.GET.${stream}`,
      `$JS.API.DIRECT.GET.${stream}`,
      `$JS.API.DIRECT.GET.${stream}.>`,
      `$JS.API.CONSUMER.CREATE.${stream}`,
      `$JS.API.CONSUMER.CREATE.${stream}.>`,
      `$JS.API.CONSUMER.INFO.${stream}.>`,
      `$JS.API.CONSUMER.DELETE.${stream}.>`,
      `$JS.API.CONSUMER.MSG.NEXT.${stream}.>`,
      `$JS.API.$KV.${bucket}.>`,
      `$JS.ACK.${stream}.>`,
    ],
    subscribe: [],
  };
}

const BUILTIN_JOBS_STREAMS: Record<string, BuiltinStreamBinding> = {
  jobs: {
    name: "JOBS",
    retention: "limits",
    storage: "file",
    numReplicas: 3,
    maxAgeMs: 0,
    maxBytes: -1,
    maxMsgs: -1,
    discard: "old",
    allowDirect: true,
    subjects: ["trellis.jobs.>"],
  },
  jobsWork: {
    name: "JOBS_WORK",
    retention: "workqueue",
    storage: "file",
    numReplicas: 3,
    subjects: ["trellis.work.>"],
    sources: [
      {
        fromAlias: "jobs",
        streamName: "JOBS",
        filterSubject: "trellis.jobs.*.*.*.created",
        subjectTransformDest: "trellis.work.$1.$2",
      },
      {
        fromAlias: "jobs",
        streamName: "JOBS",
        filterSubject: "trellis.jobs.*.*.*.retried",
        subjectTransformDest: "trellis.work.$1.$2",
      },
    ],
  },
  jobsAdvisories: {
    name: "JOBS_ADVISORIES",
    retention: "limits",
    storage: "file",
    numReplicas: 1,
    maxAgeMs: 604_800_000,
    subjects: ["$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>"],
  },
};

async function ensureKvResource(
  nats: NatsConnection,
  bucket: string,
  request: Pick<KvResourceRequest, "history" | "ttlMs" | "maxValueBytes">,
  options: ResourceProvisioningOptions = {},
): Promise<void> {
  const kvm = new Kvm(nats);
  let kv: KV;
  try {
    kv = await kvm.create(bucket, {
      history: request.history,
      ttl: request.ttlMs,
      replicas: options.jetstreamReplicas ?? 1,
      ...(request.maxValueBytes ? { maxValueSize: request.maxValueBytes } : {}),
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("bucket already exists")
    ) {
      throw error;
    }
    kv = await kvm.open(bucket);
  }
  const jsm = await jetstreamManager(nats);
  const status = await kv.status();
  assertKvResourceStream(bucket, status.streamInfo.config);
  await reconcileKvResourceConfig(
    {
      update: (name, config) => jsm.streams.update(name, config),
    },
    status,
    request,
    options,
  );
}

type KvResourceStreamConfig = {
  name: string;
  subjects?: string[];
  max_msgs_per_subject: number;
  max_age: number;
  max_msg_size: number;
  num_replicas: number;
} & Record<string, unknown>;

type KvResourceStatus = {
  streamInfo: {
    config: KvResourceStreamConfig;
  };
};

type KvStreamUpdater = {
  update(name: string, config: KvResourceStreamConfig): Promise<unknown>;
};

function assertKvResourceStream(
  bucket: string,
  config: KvResourceStreamConfig,
): void {
  const expectedStream = `KV_${bucket}`;
  const expectedSubject = `$KV.${bucket}.>`;
  if (
    config.name !== expectedStream ||
    !config.subjects?.includes(expectedSubject)
  ) {
    throw new Error(
      `stream '${config.name}' is not a KV bucket for '${bucket}'`,
    );
  }
}

/**
 * Updates an existing KV bucket stream so persisted bindings match the requested
 * lineage/profile-scoped resource settings.
 */
export async function reconcileKvResourceConfig(
  streams: KvStreamUpdater,
  status: KvResourceStatus,
  request: Pick<KvResourceRequest, "history" | "ttlMs" | "maxValueBytes">,
  options: ResourceProvisioningOptions = {},
): Promise<void> {
  const config = status.streamInfo.config;
  const maxAge = request.ttlMs > 0 ? request.ttlMs * 1_000_000 : 0;
  const maxMsgSize = request.maxValueBytes ?? -1;
  const numReplicas = options.jetstreamReplicas ?? 1;
  if (
    config.max_msgs_per_subject === request.history &&
    config.max_age === maxAge &&
    config.max_msg_size === maxMsgSize &&
    config.num_replicas === numReplicas
  ) {
    return;
  }

  await streams.update(config.name, {
    ...config,
    max_msgs_per_subject: request.history,
    max_age: maxAge,
    max_msg_size: maxMsgSize,
    num_replicas: numReplicas,
  });
}

async function ensureStoreResource(
  nats: NatsConnection,
  name: string,
  store: StoreResourceRequest,
  options: ResourceProvisioningOptions = {},
): Promise<void> {
  const objm = new Objm(nats);
  let objectStore;
  try {
    objectStore = await objm.create(name, {
      ...(store.ttlMs > 0 ? { ttl: store.ttlMs * 1_000_000 } : {}),
      ...(store.maxTotalBytes !== undefined
        ? { max_bytes: store.maxTotalBytes }
        : {}),
      replicas: options.jetstreamReplicas ?? 1,
    });
  } catch (error) {
    if (!isObjectStoreAlreadyExistsError(error)) {
      throw error;
    }
    objectStore = await objm.open(name);
  }
  const status = await objectStore.status();
  assertStoreResourceStream(name, status.streamInfo.config);
  await reconcileStoreResourceConfig(
    {
      async update(streamName, config) {
        const jsm = await jetstreamManager(nats);
        return jsm.streams.update(streamName, config);
      },
    },
    status,
    store,
    options,
  );
}

type StoreResourceStreamConfig = {
  name: string;
  subjects?: string[];
  max_age: number;
  max_bytes: number;
  num_replicas: number;
} & Record<string, unknown>;

type StoreResourceStatus = {
  streamInfo: {
    config: StoreResourceStreamConfig;
  };
};

type StoreStreamUpdater = {
  update(name: string, config: StoreResourceStreamConfig): Promise<unknown>;
};

function assertStoreResourceStream(
  name: string,
  config: StoreResourceStreamConfig,
): void {
  const expectedStream = `OBJ_${name}`;
  const expectedSubjectPrefix = `$O.${name}.`;
  if (
    config.name !== expectedStream ||
    !config.subjects?.some((subject) =>
      subject.startsWith(expectedSubjectPrefix)
    )
  ) {
    throw new Error(
      `stream '${config.name}' is not an object store for '${name}'`,
    );
  }
}

/**
 * Updates an existing object-store stream so omitted limits are reconciled back
 * to the NATS unlimited sentinel instead of preserving stale finite limits.
 */
export async function reconcileStoreResourceConfig(
  streams: StoreStreamUpdater,
  status: StoreResourceStatus,
  store: Pick<StoreResourceRequest, "ttlMs" | "maxTotalBytes">,
  options: ResourceProvisioningOptions = {},
): Promise<void> {
  const config = status.streamInfo.config;
  const maxAge = store.ttlMs > 0 ? store.ttlMs * 1_000_000 : 0;
  const maxBytes = store.maxTotalBytes ?? -1;
  const numReplicas = options.jetstreamReplicas ?? 1;
  if (
    config.max_age === maxAge &&
    config.max_bytes === maxBytes &&
    config.num_replicas === numReplicas
  ) {
    return;
  }

  await streams.update(config.name, {
    ...config,
    max_age: maxAge,
    max_bytes: maxBytes,
    num_replicas: numReplicas,
  });
}

function isObjectStoreAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("bucket already exists") ||
    error.message.includes("object store already exists") ||
    error.message.includes("stream name already in use")
  );
}

async function ensureStreamResource(
  nats: NatsConnection,
  stream: BuiltinStreamBinding,
  options: ResourceProvisioningOptions = {},
): Promise<void> {
  const jsm = await jetstreamManager(nats);
  const config = toJetStreamStreamConfig(stream, {
    numReplicas: options.jetstreamReplicas ?? stream.numReplicas,
  });

  try {
    await jsm.streams.info(stream.name);
    await jsm.streams.update(stream.name, config);
  } catch (error) {
    if (isStreamNotFoundError(error)) {
      await jsm.streams.add(config);
      return;
    }
    throw error;
  }
}

function toJetStreamStreamConfig(
  stream: BuiltinStreamBinding,
  overrides?: { numReplicas?: number },
) {
  return {
    name: stream.name,
    subjects: [...stream.subjects],
    ...(stream.retention ? { retention: stream.retention } : {}),
    ...(stream.storage ? { storage: stream.storage } : {}),
    ...((overrides?.numReplicas ?? stream.numReplicas) !== undefined
      ? { num_replicas: overrides?.numReplicas ?? stream.numReplicas }
      : {}),
    ...(stream.maxAgeMs !== undefined
      ? { max_age: stream.maxAgeMs * 1_000_000 }
      : {}),
    ...(stream.maxBytes !== undefined ? { max_bytes: stream.maxBytes } : {}),
    ...(stream.maxMsgs !== undefined ? { max_msgs: stream.maxMsgs } : {}),
    ...(stream.discard ? { discard: stream.discard } : {}),
    ...(stream.allowDirect !== undefined
      ? { allow_direct: stream.allowDirect }
      : {}),
    ...(stream.sources
      ? {
        sources: stream.sources.map((source) => ({
          name: source.streamName,
          ...(source.subjectTransformDest
            ? {
              subject_transforms: [{
                ...(source.filterSubject ? { src: source.filterSubject } : {}),
                dest: source.subjectTransformDest,
              }],
            }
            : source.filterSubject
            ? { filter_subject: source.filterSubject }
            : {}),
        })),
      }
      : {}),
  };
}

function isStreamNotFoundError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "StreamNotFoundError" ||
    error.message.includes("stream not found")
  );
}

function isConsumerNotFoundError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "ConsumerNotFoundError" ||
    error.message.includes("consumer not found")
  );
}

async function ensureBuiltinJobsInfrastructure(
  nats: NatsConnection,
  options: ResourceProvisioningOptions = {},
): Promise<void> {
  await ensureStreamResource(nats, BUILTIN_JOBS_STREAMS.jobs, options);
  await ensureStreamResource(nats, BUILTIN_JOBS_STREAMS.jobsWork, options);
  await ensureStreamResource(
    nats,
    BUILTIN_JOBS_STREAMS.jobsAdvisories,
    options,
  );
}

async function ensureEventConsumer(
  nats: NatsConnection,
  request: EventConsumerGroupRequest,
  consumerName: string,
): Promise<void> {
  const jsm = await jetstreamManager(nats);
  const consumers: EventConsumerManager = jsm.consumers;
  const config = {
    durable_name: consumerName,
    ack_policy: "explicit",
    deliver_policy: request.replay,
    filter_subjects: request.filterSubjects,
    ack_wait: request.ackWaitMs * 1_000_000,
    max_deliver: request.maxDeliver,
    max_ack_pending: request.concurrency,
    backoff: request.backoffMs.map((delay) => delay * 1_000_000),
  };

  try {
    await consumers.add(request.stream, config);
  } catch (addError) {
    if (consumers.update) {
      try {
        await consumers.update(request.stream, consumerName, config);
        return;
      } catch (updateError) {
        if (!isConsumerNotFoundError(updateError)) {
          throw updateError;
        }
      }
    }
    try {
      await consumers.info(request.stream, consumerName);
    } catch {
      throw addError;
    }
  }
}

function sanitizeToken(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "resource";
}

function stableResourceHash(parts: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(parts.join("\u001f"))) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0").slice(0, 12);
}

function buildResourceName(
  serviceDeploymentId: string,
  contractId: string,
  alias: string,
): string {
  const service = sanitizeToken(serviceDeploymentId).slice(0, 12);
  const contract = sanitizeToken(contractId).slice(0, 12);
  const logical = sanitizeToken(alias).slice(0, 20);
  const hash = stableResourceHash([serviceDeploymentId, contractId, alias]);
  return `svc_${service}_${contract}_${logical}_${hash}`;
}

function buildEventConsumerName(
  serviceDeploymentId: string,
  contractId: string,
  alias: string,
): string {
  const service = sanitizeToken(serviceDeploymentId).slice(0, 12);
  const contract = sanitizeToken(contractId).slice(0, 12);
  const logical = sanitizeToken(alias).slice(0, 24);
  const hash = stableResourceHash([
    serviceDeploymentId,
    contractId,
    alias,
    "event-consumer",
  ]);
  return `svc_${service}_${contract}_${logical}_${hash}`.slice(0, 64);
}

export function getKvResourceRequests(
  contract: TrellisContractV1,
): KvResourceRequest[] {
  return Object.entries(contract.resources?.kv ?? {})
    .map(([alias, resource]) => ({
      alias,
      purpose: resource.purpose,
      required: resource.required ?? true,
      history: resource.history ?? 1,
      ttlMs: resource.ttlMs ?? 0,
      ...(resource.maxValueBytes
        ? { maxValueBytes: resource.maxValueBytes }
        : {}),
    }))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function getJobsQueueRequests(
  contract: TrellisContractV1,
): JobsQueueRequest[] {
  const queues = contract.jobs;

  return (Object.entries(queues ?? {}) as Array<[string, {
    payload: { schema: string };
    result?: { schema: string };
    maxDeliver?: number;
    backoffMs?: number[];
    ackWaitMs?: number;
    defaultDeadlineMs?: number;
    progress?: boolean;
    logs?: boolean;
    dlq?: boolean;
    concurrency?: number;
  }]>)
    .map(([queueType, queue]) => ({
      queueType,
      payload: queue.payload,
      ...(queue.result ? { result: queue.result } : {}),
      maxDeliver: queue.maxDeliver ?? 5,
      backoffMs: queue.backoffMs ?? [5000, 30000, 120000, 600000, 1800000],
      ackWaitMs: queue.ackWaitMs ?? 300000,
      ...(queue.defaultDeadlineMs
        ? { defaultDeadlineMs: queue.defaultDeadlineMs }
        : {}),
      progress: queue.progress ?? true,
      logs: queue.logs ?? true,
      dlq: queue.dlq ?? true,
      concurrency: queue.concurrency ?? 1,
    }))
    .sort((left, right) => left.queueType.localeCompare(right.queueType));
}

function envelopeAllowsEventSubscribe(
  envelope: EnvelopeBoundary | undefined,
  contractId: string,
  name: string,
): boolean {
  if (!envelope) return true;
  return envelope.surfaces.some((surface) =>
    surface.contractId === contractId &&
    surface.kind === "event" &&
    surface.name === name &&
    surface.action === "subscribe"
  );
}

function eventConsumerMaxDeliver(group: ContractEventConsumerGroup): number {
  return group.maxDeliver ?? DEFAULT_REDELIVERY_BACKOFF_MS.length + 1;
}

function eventConsumerBackoffMs(
  group: ContractEventConsumerGroup,
  maxDeliver: number,
): number[] {
  const maxBackoffEntries = Math.max(maxDeliver - 1, 0);
  return [...(group.backoffMs ?? DEFAULT_REDELIVERY_BACKOFF_MS)].slice(
    0,
    maxBackoffEntries,
  );
}

export function getEventConsumerGroupRequests(
  contract: TrellisContractV1,
  options: Pick<
    ResourceProvisioningOptions,
    "knownContractEntries" | "envelopeBoundary"
  > = {},
): EventConsumerGroupRequest[] {
  const groups = (contract as ContractWithEventConsumers).eventConsumers ?? {};
  if (Object.keys(groups).length === 0) return [];

  const eventConsumerContract = contractWithOnlyEventConsumerUses(
    contract,
    groups,
  );
  const resolved = resolveContractUsesFromKnownEntries(
    options.knownContractEntries ?? [],
    eventConsumerContract,
  );
  return Object.entries(groups)
    .map(([alias, group]) => {
      const maxDeliver = eventConsumerMaxDeliver(group);
      const filterSubjects = group.events.map((eventRef) => {
        const resolvedEvent = resolved.eventSubscribes.find((event) =>
          event.alias === eventRef.use && event.key === eventRef.event &&
          envelopeAllowsEventSubscribe(
            options.envelopeBoundary,
            event.contractId,
            event.key,
          )
        );
        if (!resolvedEvent) {
          throw new Error(
            `event consumer group '${alias}' references unapproved or unknown subscribed event '${eventRef.use}.${eventRef.event}'`,
          );
        }
        return templateToWildcard(resolvedEvent.event.subject);
      });
      return {
        alias,
        stream: TRELLIS_EVENT_STREAM,
        filterSubjects: [...new Set(filterSubjects)].sort((left, right) =>
          left.localeCompare(right)
        ),
        replay: group.replay ?? "new",
        ordering: group.ordering ?? "strict",
        concurrency: group.concurrency ?? 1,
        ackWaitMs: group.ackWaitMs ?? 300000,
        maxDeliver,
        backoffMs: eventConsumerBackoffMs(group, maxDeliver),
      };
    })
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

function contractWithOnlyEventConsumerUses(
  contract: TrellisContractV1,
  groups: Record<string, ContractEventConsumerGroup>,
): TrellisContractV1 {
  const aliases = new Set(
    Object.values(groups).flatMap((group) =>
      group.events.map((eventRef) => eventRef.use)
    ),
  );
  const required = pickContractUses(contract.uses?.required, aliases);
  const optional = pickContractUses(contract.uses?.optional, aliases);
  const scopedContract: TrellisContractV1 = { ...contract };
  if (required || optional) {
    scopedContract.uses = {
      ...(required ? { required } : {}),
      ...(optional ? { optional } : {}),
    };
  } else {
    delete scopedContract.uses;
  }
  return scopedContract;
}

function pickContractUses(
  uses: ContractUseMap | undefined,
  aliases: ReadonlySet<string>,
): ContractUseMap | undefined {
  const entries = Object.entries(uses ?? {}).filter(([alias]) =>
    aliases.has(alias)
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getEventConsumerGroupDeclarations(
  contract: TrellisContractV1,
): EventConsumerGroupRequest[] {
  const groups = (contract as ContractWithEventConsumers).eventConsumers ?? {};
  return Object.entries(groups)
    .map(([alias, group]) => {
      const maxDeliver = eventConsumerMaxDeliver(group);
      return {
        alias,
        stream: TRELLIS_EVENT_STREAM,
        filterSubjects: [],
        replay: group.replay ?? "new",
        ordering: group.ordering ?? "strict",
        concurrency: group.concurrency ?? 1,
        ackWaitMs: group.ackWaitMs ?? 300000,
        maxDeliver,
        backoffMs: eventConsumerBackoffMs(group, maxDeliver),
      };
    })
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function getStoreResourceRequests(
  contract: TrellisContractV1,
): StoreResourceRequest[] {
  return Object.entries(contract.resources?.store ?? {})
    .map(([alias, resource]) => ({
      alias,
      purpose: resource.purpose,
      required: resource.required ?? true,
      ttlMs: resource.ttlMs ?? 0,
      ...(resource.maxObjectBytes !== undefined
        ? { maxObjectBytes: resource.maxObjectBytes }
        : {}),
      ...(resource.maxTotalBytes !== undefined
        ? { maxTotalBytes: resource.maxTotalBytes }
        : {}),
    }))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function getContractResourceAnalysis(
  contract: TrellisContractV1,
): ContractResourceAnalysis {
  return {
    kv: getKvResourceRequests(contract),
    store: getStoreResourceRequests(contract),
    jobs: getJobsQueueRequests(contract),
    eventConsumers: getEventConsumerGroupDeclarations(contract),
  };
}

export function getContractResourceSummary(
  contract: TrellisContractV1,
): {
  kvResources: number;
  storeResources: number;
  jobsQueues: number;
} {
  return {
    kvResources: getKvResourceRequests(contract).length,
    storeResources: getStoreResourceRequests(contract).length,
    jobsQueues: getJobsQueueRequests(contract).length,
  };
}

export function needsUnboundContractInfrastructure(
  contract: TrellisContractV1,
): boolean {
  return contract.id === TRELLIS_JOBS_CONTRACT_ID;
}

function buildJobsNamespace(
  serviceDeploymentId: string,
  contractId: string,
): string {
  const service = sanitizeToken(serviceDeploymentId).slice(0, 8);
  const contract = sanitizeToken(contractId).slice(0, 8);
  const hash = stableResourceHash([serviceDeploymentId, contractId, "jobs"])
    .slice(0, 12);
  return `${service}_${contract}_${hash}`.slice(0, 32);
}

export async function provisionContractResourceBindings(
  nats: NatsConnection | undefined,
  contract: TrellisContractV1,
  serviceDeploymentId: string,
  options: ResourceProvisioningOptions = {},
): Promise<ContractResourceBindings> {
  const requests = getKvResourceRequests(contract);
  const stores = getStoreResourceRequests(contract);
  const jobs = getJobsQueueRequests(contract);
  const eventConsumers = getEventConsumerGroupRequests(contract, options);
  const needsBuiltinJobsInfrastructure = jobs.length > 0 ||
    contract.id === TRELLIS_JOBS_CONTRACT_ID;
  if (
    requests.length === 0 &&
    stores.length === 0 &&
    !needsBuiltinJobsInfrastructure &&
    eventConsumers.length === 0
  ) {
    return {};
  }

  const kvBindings: NonNullable<ContractResourceBindings["kv"]> = {};

  if (requests.length > 0) {
    if (!nats && requests.some((request) => request.required)) {
      throw new Error("NATS connection is required to provision KV resources");
    }
    for (const request of requests) {
      if (!nats) continue;
      const bucket = buildResourceName(
        serviceDeploymentId,
        contract.id,
        request.alias,
      );
      try {
        await ensureKvResource(nats, bucket, request, options);
      } catch (error) {
        if (!request.required) continue;
        throw error;
      }
      kvBindings[request.alias] = {
        bucket,
        history: request.history,
        ttlMs: request.ttlMs,
        ...(request.maxValueBytes
          ? { maxValueBytes: request.maxValueBytes }
          : {}),
      };
    }
  }

  const bindings: ContractResourceBindings = {};
  if (Object.keys(kvBindings).length > 0) {
    bindings.kv = kvBindings;
  }

  if (stores.length > 0) {
    if (!nats && stores.some((store) => store.required)) {
      throw new Error(
        "NATS connection is required to provision store resources",
      );
    }

    const storeBindings: NonNullable<ContractResourceBindings["store"]> = {};
    if (nats) {
      for (const store of stores) {
        const name = buildResourceName(
          serviceDeploymentId,
          contract.id,
          store.alias,
        );
        try {
          await ensureStoreResource(nats, name, store, options);
        } catch (error) {
          if (!store.required) continue;
          throw error;
        }

        storeBindings[store.alias] = {
          name,
          ttlMs: store.ttlMs,
          ...(store.maxObjectBytes !== undefined
            ? { maxObjectBytes: store.maxObjectBytes }
            : {}),
          ...(store.maxTotalBytes !== undefined
            ? { maxTotalBytes: store.maxTotalBytes }
            : {}),
        };
      }
    }
    if (Object.keys(storeBindings).length > 0) {
      bindings.store = storeBindings;
    }
  }

  if (needsBuiltinJobsInfrastructure) {
    if (!nats) {
      throw new Error(
        "NATS connection is required to provision jobs resources",
      );
    }
    await ensureBuiltinJobsInfrastructure(nats, options);
  }

  if (jobs.length > 0) {
    const namespace = buildJobsNamespace(serviceDeploymentId, contract.id);
    bindings.jobs = {
      namespace,
      workStream: "JOBS_WORK",
      queues: Object.fromEntries(
        jobs.map((queue) => {
          const queueToken = sanitizeToken(queue.queueType).slice(0, 48);
          return [queue.queueType, {
            queueType: queue.queueType,
            publishPrefix: `trellis.jobs.${namespace}.${queueToken}`,
            workSubject: `trellis.work.${namespace}.${queueToken}`,
            consumerName: `${namespace}-${queueToken}`.slice(0, 64),
            payload: queue.payload,
            ...(queue.result ? { result: queue.result } : {}),
            maxDeliver: queue.maxDeliver,
            backoffMs: [...queue.backoffMs],
            ackWaitMs: queue.ackWaitMs,
            ...(queue.defaultDeadlineMs
              ? { defaultDeadlineMs: queue.defaultDeadlineMs }
              : {}),
            progress: queue.progress,
            logs: queue.logs,
            dlq: queue.dlq,
            concurrency: queue.concurrency,
          }];
        }),
      ),
    };
  }

  if (eventConsumers.length > 0) {
    if (!nats) {
      throw new Error(
        "NATS connection is required to provision event consumer resources",
      );
    }
    const consumerBindings: NonNullable<
      ContractResourceBindings["eventConsumers"]
    > = {};
    for (const consumer of eventConsumers) {
      const consumerName = buildEventConsumerName(
        serviceDeploymentId,
        contract.id,
        consumer.alias,
      );
      await ensureEventConsumer(nats, consumer, consumerName);
      consumerBindings[consumer.alias] = {
        stream: consumer.stream,
        consumerName,
        filterSubjects: [...consumer.filterSubjects],
        replay: consumer.replay,
        ordering: consumer.ordering,
        concurrency: consumer.concurrency,
        ackWaitMs: consumer.ackWaitMs,
        maxDeliver: consumer.maxDeliver,
        backoffMs: [...consumer.backoffMs],
      };
    }
    bindings.eventConsumers = consumerBindings;
  }

  return bindings;
}

export function getResourcePermissionGrants(
  bindings?: ContractResourceBindings,
): {
  publish: string[];
  subscribe: string[];
} {
  const publish = new Set<string>();
  const subscribe = new Set<string>();

  for (const kvBinding of Object.values(bindings?.kv ?? {})) {
    const grants = getKvPermissionGrants(kvBinding.bucket);
    for (const subject of grants.publish) publish.add(subject);
    for (const subject of grants.subscribe) subscribe.add(subject);
  }

  for (const storeBinding of Object.values(bindings?.store ?? {})) {
    const stream = `OBJ_${storeBinding.name}`;
    publish.add("$JS.API.INFO");
    publish.add(`$O.${storeBinding.name}.C.>`);
    publish.add(`$O.${storeBinding.name}.M.>`);
    publish.add(`$JS.API.STREAM.INFO.${stream}`);
    publish.add(`$JS.API.STREAM.MSG.GET.${stream}`);
    publish.add(`$JS.API.STREAM.PURGE.${stream}`);
    publish.add(`$JS.API.CONSUMER.CREATE.${stream}`);
    publish.add(`$JS.API.CONSUMER.CREATE.${stream}.>`);
    publish.add(`$JS.API.CONSUMER.DELETE.${stream}.>`);
    publish.add(`$JS.FC.${stream}.>`);
  }

  if (bindings?.jobs) {
    const namespace = bindings.jobs.namespace;
    const workStream = bindings.jobs.workStream;
    publish.add(`trellis.jobs.${namespace}.>`);
    publish.add(`trellis.jobs.workers.${namespace}.>`);
    publish.add(`trellis.work.${namespace}.>`);
    publish.add("$JS.API.DIRECT.GET.JOBS");
    publish.add("$JS.API.DIRECT.GET.JOBS.>");
    publish.add("$JS.API.STREAM.MSG.GET.JOBS");
    publish.add(`$JS.API.CONSUMER.CREATE.${workStream}.>`);
    publish.add(`$JS.API.CONSUMER.INFO.${workStream}.>`);
    publish.add(`$JS.API.CONSUMER.MSG.NEXT.${workStream}.>`);
    publish.add(`$JS.ACK.${workStream}.>`);
    for (const queue of Object.values(bindings.jobs.queues)) {
      publish.add(queue.publishPrefix + ".>");
      publish.add(queue.workSubject);
      subscribe.add(`${queue.publishPrefix}.*.*`);
      subscribe.add(`${queue.publishPrefix}.*.cancelled`);
    }
  }

  for (const consumer of Object.values(bindings?.eventConsumers ?? {})) {
    publish.add("$JS.API.INFO");
    publish.add(
      `$JS.API.CONSUMER.INFO.${consumer.stream}.${consumer.consumerName}`,
    );
    publish.add(
      `$JS.API.CONSUMER.MSG.NEXT.${consumer.stream}.${consumer.consumerName}`,
    );
    publish.add(`$JS.ACK.${consumer.stream}.${consumer.consumerName}.>`);
  }

  return {
    publish: [...publish].sort((left, right) => left.localeCompare(right)),
    subscribe: [...subscribe].sort((left, right) => left.localeCompare(right)),
  };
}
