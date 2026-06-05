import { jetstreamManager } from "@nats-io/jetstream";
import { type KV, Kvm } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core";
import { Objm } from "@nats-io/obj";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { ulid } from "ulid";

import type {
  DeploymentAuthorityResource,
  DeploymentAuthoritySurface,
  DeploymentResourceBinding,
} from "../auth/schemas.ts";
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

type AuthorityNeedSet = {
  surfaces: DeploymentAuthoritySurface[];
};

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

export type EventConsumerConfigManager = {
  info(stream: string, consumer: string): Promise<ConsumerInfoLike>;
  update?(
    stream: string,
    consumer: string,
    config: Record<string, unknown>,
  ): Promise<ConsumerInfoLike>;
};

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
  delete?(stream: string, consumer: string): Promise<boolean>;
};

type JobsQueueBinding = NonNullable<
  ContractResourceBindings["jobs"]
>["queues"][string];

export type ContractResourceAnalysis = {
  kv: KvResourceRequest[];
  store: StoreResourceRequest[];
  jobs: JobsQueueRequest[];
  eventConsumers: EventConsumerGroupRequest[];
};

export type ResourceProvisioningOptions = {
  jetstreamReplicas?: number;
  knownContractEntries?: ContractEntry[];
  authorityNeeds?: AuthorityNeedSet;
  existingResourceNames?: ExistingResourceNames;
  resourceNameGenerator?: ResourceNameGenerator;
};

export type ResourceNameKind =
  | "kv"
  | "store"
  | "eventConsumer"
  | "jobsNamespace"
  | "jobsQueue";

export type ResourceNameGenerator = (kind: ResourceNameKind) => string;

export type ExistingResourceNames = {
  kv?: Record<string, string>;
  store?: Record<string, string>;
  eventConsumers?: Record<string, string>;
  jobs?: {
    namespace?: string;
    queues?: Record<string, {
      publishPrefix?: string;
      workSubject?: string;
      consumerName?: string;
    }>;
  };
};

export type StoredResourceBindingView = {
  kind: string;
  alias: string;
  binding: Record<string, unknown>;
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

export type ProvisionedContractResource =
  | { kind: "kv"; alias: string; name: string }
  | { kind: "store"; alias: string; name: string }
  | { kind: "eventConsumer"; alias: string; stream: string; name: string }
  | { kind: "jobsQueueConsumer"; alias: string; stream: string; name: string };

export type ProvisionedContractResources = {
  bindings: ContractResourceBindings;
  created: ProvisionedContractResource[];
  adopted: ProvisionedContractResource[];
};

export type ResourceRollbackResult = {
  deleted: ProvisionedContractResource[];
  failed: Array<{ resource: ProvisionedContractResource; error: unknown }>;
};

export type ResourcePurgeManager = {
  deleteKvBucket(bucket: string): Promise<void>;
  deleteObjectStore(name: string): Promise<void>;
  deleteEventConsumer?(stream: string, consumerName: string): Promise<void>;
};

export type AuthorityPhysicalResourceManager = ResourcePurgeManager & {
  ensureKvBucket(
    bucket: string,
    request: Pick<KvResourceRequest, "history" | "ttlMs" | "maxValueBytes">,
    options?: ResourceProvisioningOptions,
  ): Promise<"created" | "adopted">;
  ensureObjectStore(
    name: string,
    request: StoreResourceRequest,
    options?: ResourceProvisioningOptions,
  ): Promise<"created" | "adopted">;
  ensureJobsInfrastructure(
    options?: ResourceProvisioningOptions,
  ): Promise<void>;
  ensureJobsQueueConsumer(
    stream: string,
    queue: JobsQueueBinding,
  ): Promise<"created" | "adopted">;
  ensureEventConsumer(
    request: EventConsumerGroupRequest,
    consumerName: string,
  ): Promise<"created" | "adopted">;
};

export type AuthorityResourceMaterializationOptions = {
  deploymentId: string;
  resources: readonly DeploymentAuthorityResource[];
  existingBindings: readonly DeploymentResourceBinding[];
  manager: AuthorityPhysicalResourceManager;
  provisioning?: ResourceProvisioningOptions;
  now?: string;
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
    async deleteEventConsumer(stream, consumerName) {
      const jsm = await jetstreamManager(nats);
      const consumers: EventConsumerManager = jsm.consumers;
      if (!consumers.delete) return;
      await consumers.delete(stream, consumerName);
    },
  };
}

/** Creates a NATS-backed manager for authority-owned physical resources. */
export function createNatsAuthorityPhysicalResourceManager(
  nats: NatsConnection,
  defaultOptions: ResourceProvisioningOptions = {},
): AuthorityPhysicalResourceManager {
  const mergeOptions = (options?: ResourceProvisioningOptions) => ({
    ...defaultOptions,
    ...options,
    jetstreamReplicas: options?.jetstreamReplicas ??
      defaultOptions.jetstreamReplicas,
  });
  return {
    ...createNatsResourcePurgeManager(nats),
    ensureKvBucket: (bucket, request, options) =>
      ensureKvResource(nats, bucket, request, mergeOptions(options)),
    ensureObjectStore: (name, request, options) =>
      ensureStoreResource(nats, name, request, mergeOptions(options)),
    ensureJobsInfrastructure: (options) =>
      ensureBuiltinJobsInfrastructure(nats, mergeOptions(options)),
    ensureJobsQueueConsumer: (stream, queue) =>
      ensureJobsQueueConsumer(nats, stream, queue),
    ensureEventConsumer: (request, consumerName) =>
      ensureEventConsumer(nats, request, consumerName),
  };
}

/**
 * Best-effort rollback for resources created by a failed provisioning attempt.
 * Adopted resources are intentionally preserved.
 */
export async function rollbackProvisionedContractResources(
  result: Pick<ProvisionedContractResources, "created">,
  manager: ResourcePurgeManager,
): Promise<ResourceRollbackResult> {
  const deleted: ProvisionedContractResource[] = [];
  const failed: ResourceRollbackResult["failed"] = [];
  for (const resource of result.created) {
    try {
      if (resource.kind === "kv") {
        await manager.deleteKvBucket(resource.name);
      } else if (resource.kind === "store") {
        await manager.deleteObjectStore(resource.name);
      } else if (manager.deleteEventConsumer) {
        await manager.deleteEventConsumer(resource.stream, resource.name);
      } else {
        continue;
      }
      deleted.push(resource);
    } catch (error) {
      failed.push({ resource, error });
    }
  }
  return { deleted, failed };
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
): Promise<"created" | "adopted"> {
  const kvm = new Kvm(nats);
  let kv: KV;
  let action: "created" | "adopted" = "created";
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
    action = "adopted";
    kv = await kvm.open(bucket);
  }
  try {
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
  } catch (error) {
    if (action === "created") {
      try {
        await kv.destroy();
      } catch {
        // The caller will still report the original provisioning failure.
      }
    }
    throw error;
  }
  return action;
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
): Promise<"created" | "adopted"> {
  const objm = new Objm(nats);
  let objectStore;
  let action: "created" | "adopted" = "created";
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
    action = "adopted";
    objectStore = await objm.open(name);
  }
  try {
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
  } catch (error) {
    if (action === "created") {
      try {
        await objectStore.destroy();
      } catch {
        // The caller will still report the original provisioning failure.
      }
    }
    throw error;
  }
  return action;
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
): Promise<"created" | "adopted"> {
  const jsm = await jetstreamManager(nats);
  const consumers: EventConsumerManager = jsm.consumers;
  const config = toEventConsumerConfig(request, consumerName);

  try {
    await consumers.add(request.stream, config);
    return "created";
  } catch (addError) {
    try {
      await reconcileEventConsumerConfig(
        consumers,
        request.stream,
        consumerName,
        config,
      );
      return "adopted";
    } catch (adoptError) {
      if (isConsumerNotFoundError(adoptError)) {
        throw addError;
      }
      throw adoptError;
    }
  }
}

async function ensureJobsQueueConsumer(
  nats: NatsConnection,
  stream: string,
  queue: JobsQueueBinding,
): Promise<"created" | "adopted"> {
  const jsm = await jetstreamManager(nats);
  const consumers: EventConsumerManager = jsm.consumers;
  const config = toJobsQueueConsumerConfig(queue);

  try {
    await consumers.add(stream, config);
    return "created";
  } catch (addError) {
    try {
      await reconcileJobsQueueConsumerConfig(
        consumers,
        stream,
        queue.consumerName,
        config,
      );
    } catch (adoptError) {
      if (isConsumerNotFoundError(adoptError)) {
        throw addError;
      }
      throw adoptError;
    }
  }
  return "adopted";
}

function toEventConsumerConfig(
  request: EventConsumerGroupRequest,
  consumerName: string,
): Record<string, unknown> {
  return {
    durable_name: consumerName,
    ack_policy: "explicit",
    deliver_policy: request.replay,
    filter_subjects: request.filterSubjects,
    ack_wait: request.ackWaitMs * 1_000_000,
    max_deliver: request.maxDeliver,
    max_ack_pending: request.concurrency,
    backoff: request.backoffMs.map((delay) => delay * 1_000_000),
  };
}

function toJobsQueueConsumerConfig(
  queue: JobsQueueBinding,
): Record<string, unknown> {
  return {
    durable_name: queue.consumerName,
    ack_policy: "explicit",
    filter_subject: queue.workSubject,
    ack_wait: queue.ackWaitMs * 1_000_000,
    max_deliver: queue.maxDeliver,
    max_ack_pending: queue.concurrency,
    backoff: queue.backoffMs.map((delay) => delay * 1_000_000),
  };
}

/**
 * Updates an existing event consumer when possible and otherwise validates that
 * the adopted durable consumer exactly matches the requested runtime settings.
 */
export async function reconcileEventConsumerConfig(
  consumers: EventConsumerConfigManager,
  stream: string,
  consumerName: string,
  config: Record<string, unknown>,
): Promise<void> {
  if (consumers.update) {
    try {
      const info = await consumers.update(stream, consumerName, config);
      assertEventConsumerConfigMatches(stream, consumerName, info, config);
      return;
    } catch (updateError) {
      if (!isConsumerNotFoundError(updateError)) {
        throw updateError;
      }
    }
  }

  const info = await consumers.info(stream, consumerName);
  assertEventConsumerConfigMatches(stream, consumerName, info, config);
}

/**
 * Updates an existing jobs queue durable consumer when possible and otherwise
 * validates that the adopted consumer matches the queue binding.
 */
export async function reconcileJobsQueueConsumerConfig(
  consumers: EventConsumerConfigManager,
  stream: string,
  consumerName: string,
  config: Record<string, unknown>,
): Promise<void> {
  if (consumers.update) {
    try {
      const info = await consumers.update(stream, consumerName, config);
      assertConsumerConfigMatches(
        "jobs queue consumer",
        stream,
        consumerName,
        info,
        config,
      );
      return;
    } catch (updateError) {
      if (!isConsumerNotFoundError(updateError)) {
        throw updateError;
      }
    }
  }

  const info = await consumers.info(stream, consumerName);
  assertConsumerConfigMatches(
    "jobs queue consumer",
    stream,
    consumerName,
    info,
    config,
  );
}

function assertEventConsumerConfigMatches(
  stream: string,
  consumerName: string,
  info: ConsumerInfoLike,
  expected: Record<string, unknown>,
): void {
  assertConsumerConfigMatches(
    "event consumer",
    stream,
    consumerName,
    info,
    expected,
  );
}

function assertConsumerConfigMatches(
  label: string,
  stream: string,
  consumerName: string,
  info: ConsumerInfoLike,
  expected: Record<string, unknown>,
): void {
  const actual = info.config;
  if (!isRecord(actual)) {
    throw new Error(
      `${label} '${stream}.${consumerName}' info did not include config`,
    );
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    const normalizedExpected = normalizedConsumerConfigValue(
      expected,
      key,
      expectedValue,
    );
    if (!consumerConfigValueEquals(actual[key], normalizedExpected)) {
      throw new Error(
        `${label} '${stream}.${consumerName}' config drift for '${key}'`,
      );
    }
  }
}

function normalizedConsumerConfigValue(
  expected: Record<string, unknown>,
  key: string,
  value: unknown,
): unknown {
  const backoff = expected.backoff;
  if (key === "ack_wait" && Array.isArray(backoff) && backoff.length > 0) {
    return backoff[0];
  }
  return value;
}

function consumerConfigValueEquals(
  actual: unknown,
  expected: unknown,
): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => actual[index] === value);
  }
  return actual === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Generates a Trellis-owned physical resource name for a cloud-side binding. */
export function generateInternalResourceName(kind: ResourceNameKind): string {
  const token = ulid().toLowerCase();
  switch (kind) {
    case "kv":
      return `tr_kv_${token}`;
    case "store":
      return `tr_obj_${token}`;
    case "eventConsumer":
      return `tr_cons_${token}`;
    case "jobsNamespace":
      return `tr_jobs_${token}`.slice(0, 32);
    case "jobsQueue":
      return `tr_jq_${token}`;
  }
}

function stringBindingValue(
  binding: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = binding[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Extracts reusable physical resource names from persisted binding records. */
export function existingResourceNamesFromBindings(
  records: readonly StoredResourceBindingView[],
): ExistingResourceNames {
  const names: ExistingResourceNames = {};
  for (const record of records) {
    if (record.kind === "kv") {
      const bucket = stringBindingValue(record.binding, "bucket");
      if (bucket) (names.kv ??= {})[record.alias] = bucket;
    } else if (record.kind === "store") {
      const name = stringBindingValue(record.binding, "name");
      if (name) (names.store ??= {})[record.alias] = name;
    } else if (record.kind === "event-consumer") {
      const consumerName = stringBindingValue(record.binding, "consumerName");
      if (consumerName) {
        (names.eventConsumers ??= {})[record.alias] = consumerName;
      }
    } else if (record.kind === "jobs") {
      const namespace = stringBindingValue(record.binding, "namespace");
      if (namespace) (names.jobs ??= {}).namespace ??= namespace;
      const queue: NonNullable<
        NonNullable<ExistingResourceNames["jobs"]>["queues"]
      >[string] = {};
      const publishPrefix = stringBindingValue(record.binding, "publishPrefix");
      const workSubject = stringBindingValue(record.binding, "workSubject");
      const consumerName = stringBindingValue(record.binding, "consumerName");
      if (publishPrefix) queue.publishPrefix = publishPrefix;
      if (workSubject) queue.workSubject = workSubject;
      if (consumerName) queue.consumerName = consumerName;
      if (Object.keys(queue).length > 0) {
        ((names.jobs ??= {}).queues ??= {})[record.alias] = queue;
      }
    }
  }
  return names;
}

function optionalPositiveInteger(
  definition: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = definition[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `resource definition '${key}' must be a non-negative integer`,
    );
  }
  return value;
}

function optionalBoolean(
  definition: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = definition[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`resource definition '${key}' must be a boolean`);
  }
  return value;
}

function requiredSchema(
  definition: Record<string, unknown>,
  key: string,
): { schema: string } {
  const value = definition[key];
  if (
    !isRecord(value) || typeof value.schema !== "string" ||
    value.schema.length === 0
  ) {
    throw new Error(`resource definition '${key}' must be a schema reference`);
  }
  return { schema: value.schema };
}

function optionalSchema(
  definition: Record<string, unknown>,
  key: string,
): { schema: string } | undefined {
  if (definition[key] === undefined) return undefined;
  return requiredSchema(definition, key);
}

function optionalNumberArray(
  definition: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const value = definition[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((entry) => Number.isInteger(entry) && entry >= 0)
  ) {
    throw new Error(
      `resource definition '${key}' must be an array of non-negative integers`,
    );
  }
  return [...value];
}

function optionalStringArray(
  definition: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = definition[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    throw new Error(`resource definition '${key}' must be an array of strings`);
  }
  return [...value];
}

function resourceDefinition(
  resource: DeploymentAuthorityResource,
): Record<string, unknown> {
  const definition = resource.definition ?? {};
  if (!isRecord(definition)) {
    throw new Error(
      `Resource ${resource.kind}:${resource.alias} definition must be an object`,
    );
  }
  return definition;
}

function toKvRequest(resource: DeploymentAuthorityResource): KvResourceRequest {
  const definition = resourceDefinition(resource);
  return {
    alias: resource.alias,
    purpose: typeof definition.purpose === "string" ? definition.purpose : "",
    required: resource.required,
    history: optionalPositiveInteger(definition, "history") ?? 1,
    ttlMs: optionalPositiveInteger(definition, "ttlMs") ?? 0,
    ...(optionalPositiveInteger(definition, "maxValueBytes") !== undefined
      ? { maxValueBytes: optionalPositiveInteger(definition, "maxValueBytes") }
      : {}),
  };
}

function toStoreRequest(
  resource: DeploymentAuthorityResource,
): StoreResourceRequest {
  const definition = resourceDefinition(resource);
  return {
    alias: resource.alias,
    purpose: typeof definition.purpose === "string" ? definition.purpose : "",
    required: resource.required,
    ttlMs: optionalPositiveInteger(definition, "ttlMs") ?? 0,
    ...(optionalPositiveInteger(definition, "maxObjectBytes") !== undefined
      ? {
        maxObjectBytes: optionalPositiveInteger(definition, "maxObjectBytes"),
      }
      : {}),
    ...(optionalPositiveInteger(definition, "maxTotalBytes") !== undefined
      ? { maxTotalBytes: optionalPositiveInteger(definition, "maxTotalBytes") }
      : {}),
  };
}

function toJobsQueueRequest(
  resource: DeploymentAuthorityResource,
): JobsQueueRequest {
  const definition = resourceDefinition(resource);
  const maxDeliver = optionalPositiveInteger(definition, "maxDeliver") ?? 5;
  return {
    queueType: typeof definition.queueType === "string" &&
        definition.queueType.length > 0
      ? definition.queueType
      : resource.alias,
    payload: requiredSchema(definition, "payload"),
    ...(optionalSchema(definition, "result") !== undefined
      ? { result: optionalSchema(definition, "result") }
      : {}),
    maxDeliver,
    backoffMs: optionalNumberArray(definition, "backoffMs") ??
      DEFAULT_REDELIVERY_BACKOFF_MS.slice(0, Math.max(maxDeliver - 1, 0)),
    ackWaitMs: optionalPositiveInteger(definition, "ackWaitMs") ?? 300000,
    ...(optionalPositiveInteger(definition, "defaultDeadlineMs") !== undefined
      ? {
        defaultDeadlineMs: optionalPositiveInteger(
          definition,
          "defaultDeadlineMs",
        ),
      }
      : {}),
    progress: optionalBoolean(definition, "progress") ?? true,
    logs: optionalBoolean(definition, "logs") ?? true,
    dlq: optionalBoolean(definition, "dlq") ?? true,
    concurrency: optionalPositiveInteger(definition, "concurrency") ?? 1,
  };
}

function toEventConsumerRequest(
  resource: DeploymentAuthorityResource,
): EventConsumerGroupRequest {
  const definition = resourceDefinition(resource);
  const stream = definition.stream;
  const maxDeliver = optionalPositiveInteger(definition, "maxDeliver") ??
    DEFAULT_REDELIVERY_BACKOFF_MS.length + 1;
  if (typeof stream !== "string" || stream.length === 0) {
    throw new Error(
      `Resource event-consumer:${resource.alias} definition.stream is required`,
    );
  }
  return {
    alias: resource.alias,
    stream,
    filterSubjects: optionalStringArray(definition, "filterSubjects") ?? [],
    replay: definition.replay === "all" ? "all" : "new",
    ordering: "strict",
    concurrency: optionalPositiveInteger(definition, "concurrency") ?? 1,
    ackWaitMs: optionalPositiveInteger(definition, "ackWaitMs") ?? 300000,
    maxDeliver,
    backoffMs: optionalNumberArray(definition, "backoffMs") ??
      DEFAULT_REDELIVERY_BACKOFF_MS.slice(0, Math.max(maxDeliver - 1, 0)),
  };
}

function bindingKey(
  binding: Pick<DeploymentResourceBinding, "kind" | "alias">,
) {
  return `${binding.kind}:${binding.alias}`;
}

async function deleteRemovedAuthorityBinding(
  binding: DeploymentResourceBinding,
  manager: AuthorityPhysicalResourceManager,
): Promise<void> {
  if (binding.kind === "kv") {
    const bucket = stringBindingValue(binding.binding, "bucket");
    if (bucket) await manager.deleteKvBucket(bucket);
  } else if (binding.kind === "store") {
    const name = stringBindingValue(binding.binding, "name");
    if (name) await manager.deleteObjectStore(name);
  } else if (binding.kind === "event-consumer" && manager.deleteEventConsumer) {
    const stream = stringBindingValue(binding.binding, "stream");
    const consumerName = stringBindingValue(binding.binding, "consumerName");
    if (stream && consumerName) {
      await manager.deleteEventConsumer(stream, consumerName);
    }
  } else if (binding.kind === "jobs" && manager.deleteEventConsumer) {
    const stream = stringBindingValue(binding.binding, "workStream");
    const consumerName = stringBindingValue(binding.binding, "consumerName");
    if (stream && consumerName) {
      await manager.deleteEventConsumer(stream, consumerName);
    }
  }
}

/** Materializes authority-owned physical resources from normalized definitions. */
export async function materializeAuthorityResourceBindings(
  options: AuthorityResourceMaterializationOptions,
): Promise<DeploymentResourceBinding[]> {
  const now = options.now ?? new Date().toISOString();
  const names = existingResourceNamesFromBindings(options.existingBindings);
  const newResourceName = options.provisioning?.resourceNameGenerator ??
    generateInternalResourceName;
  const existingByKey = new Map(
    options.existingBindings.map((binding) => [bindingKey(binding), binding]),
  );
  const desiredKeys = new Set(options.resources.map(bindingKey));
  const bindings: DeploymentResourceBinding[] = [];
  const createdBindings: DeploymentResourceBinding[] = [];

  try {
    for (const resource of options.resources) {
      const existing = existingByKey.get(bindingKey(resource));
      if (resource.kind === "transfer") continue;
      if (resource.kind === "kv") {
        const request = toKvRequest(resource);
        const bucket = names.kv?.[resource.alias] ?? newResourceName("kv");
        const action = await options.manager.ensureKvBucket(
          bucket,
          request,
          options.provisioning,
        );
        const binding = {
          deploymentId: options.deploymentId,
          kind: resource.kind,
          alias: resource.alias,
          binding: {
            bucket,
            history: request.history,
            ttlMs: request.ttlMs,
            ...(request.maxValueBytes !== undefined
              ? { maxValueBytes: request.maxValueBytes }
              : {}),
          },
          limits: null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        } satisfies DeploymentResourceBinding;
        bindings.push(binding);
        if (action === "created") createdBindings.push(binding);
      } else if (resource.kind === "store") {
        const request = toStoreRequest(resource);
        const name = names.store?.[resource.alias] ?? newResourceName("store");
        const action = await options.manager.ensureObjectStore(
          name,
          request,
          options.provisioning,
        );
        const binding = {
          deploymentId: options.deploymentId,
          kind: resource.kind,
          alias: resource.alias,
          binding: {
            name,
            ttlMs: request.ttlMs,
            ...(request.maxObjectBytes !== undefined
              ? { maxObjectBytes: request.maxObjectBytes }
              : {}),
            ...(request.maxTotalBytes !== undefined
              ? { maxTotalBytes: request.maxTotalBytes }
              : {}),
          },
          limits: null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        } satisfies DeploymentResourceBinding;
        bindings.push(binding);
        if (action === "created") createdBindings.push(binding);
      } else if (resource.kind === "jobs") {
        const request = toJobsQueueRequest(resource);
        await options.manager.ensureJobsInfrastructure(options.provisioning);
        const namespace = names.jobs?.namespace ??
          newResourceName("jobsNamespace").slice(0, 32);
        const existingQueue = names.jobs?.queues?.[resource.alias];
        const queueToken = newResourceName("jobsQueue").slice(0, 48);
        const queue: JobsQueueBinding = {
          ...request,
          publishPrefix: existingQueue?.publishPrefix ??
            `trellis.jobs.${namespace}.${queueToken}`,
          workSubject: existingQueue?.workSubject ??
            `trellis.work.${namespace}.${queueToken}`,
          consumerName: existingQueue?.consumerName ??
            `${namespace}_${queueToken}`.slice(0, 64),
        };
        const workStream = "JOBS_WORK";
        const action = await options.manager.ensureJobsQueueConsumer(
          workStream,
          queue,
        );
        const binding = {
          deploymentId: options.deploymentId,
          kind: resource.kind,
          alias: resource.alias,
          binding: { namespace, workStream, ...queue },
          limits: null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        } satisfies DeploymentResourceBinding;
        bindings.push(binding);
        if (action === "created") createdBindings.push(binding);
      } else if (resource.kind === "event-consumer") {
        const request = toEventConsumerRequest(resource);
        const consumerName = names.eventConsumers?.[resource.alias] ??
          newResourceName("eventConsumer").slice(0, 64);
        const action = await options.manager.ensureEventConsumer(
          request,
          consumerName,
        );
        const binding = {
          deploymentId: options.deploymentId,
          kind: resource.kind,
          alias: resource.alias,
          binding: { ...request, consumerName },
          limits: null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        } satisfies DeploymentResourceBinding;
        bindings.push(binding);
        if (action === "created") createdBindings.push(binding);
      }
    }

    for (const existing of options.existingBindings) {
      if (!desiredKeys.has(bindingKey(existing))) {
        await deleteRemovedAuthorityBinding(existing, options.manager);
      }
    }
  } catch (error) {
    for (const binding of [...createdBindings].reverse()) {
      try {
        await deleteRemovedAuthorityBinding(binding, options.manager);
      } catch {
        // Keep the original materialization error; leaked resources can be reconciled manually.
      }
    }
    throw error;
  }

  return bindings.sort((left, right) =>
    bindingKey(left).localeCompare(bindingKey(right))
  );
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

function authorityAllowsEventSubscribe(
  authority: AuthorityNeedSet | undefined,
  contractId: string,
  name: string,
): boolean {
  if (!authority) return true;
  return authority.surfaces.some((surface) =>
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
    "knownContractEntries" | "authorityNeeds"
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
          authorityAllowsEventSubscribe(
            options.authorityNeeds,
            event.contractId,
            event.key,
          )
        );
        if (!resolvedEvent) {
          throw new Error(
            `event consumer group '${alias}' references unaccepted or unknown subscribed event '${eventRef.use}.${eventRef.event}'`,
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

export async function provisionContractResourceBindings(
  nats: NatsConnection | undefined,
  contract: TrellisContractV1,
  serviceDeploymentId: string,
  options: ResourceProvisioningOptions = {},
): Promise<ContractResourceBindings> {
  return (await provisionContractResources(
    nats,
    contract,
    serviceDeploymentId,
    options,
  )).bindings;
}

/**
 * Provisions or adopts every declared NATS-backed resource for a contract and
 * reports which physical resources were created by this attempt.
 */
export async function provisionContractResources(
  nats: NatsConnection | undefined,
  contract: TrellisContractV1,
  _serviceDeploymentId: string,
  options: ResourceProvisioningOptions = {},
): Promise<ProvisionedContractResources> {
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
    return { bindings: {}, created: [], adopted: [] };
  }

  const result: ProvisionedContractResources = {
    bindings: {},
    created: [],
    adopted: [],
  };
  const newResourceName = options.resourceNameGenerator ??
    generateInternalResourceName;

  try {
    const kvBindings: NonNullable<ContractResourceBindings["kv"]> = {};

    if (requests.length > 0) {
      if (!nats) {
        throw new Error(
          "NATS connection is required to provision KV resources",
        );
      }
      for (const request of requests) {
        const bucket = options.existingResourceNames?.kv?.[request.alias] ??
          newResourceName("kv");
        const action = await ensureKvResource(nats, bucket, request, options);
        result[action].push({ kind: "kv", alias: request.alias, name: bucket });
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

    if (Object.keys(kvBindings).length > 0) {
      result.bindings.kv = kvBindings;
    }

    if (stores.length > 0) {
      if (!nats) {
        throw new Error(
          "NATS connection is required to provision store resources",
        );
      }

      const storeBindings: NonNullable<ContractResourceBindings["store"]> = {};
      for (const store of stores) {
        const name = options.existingResourceNames?.store?.[store.alias] ??
          newResourceName("store");
        const action = await ensureStoreResource(nats, name, store, options);
        result[action].push({ kind: "store", alias: store.alias, name });

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
      if (Object.keys(storeBindings).length > 0) {
        result.bindings.store = storeBindings;
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
      if (!nats) {
        throw new Error(
          "NATS connection is required to provision jobs resources",
        );
      }
      const namespace = options.existingResourceNames?.jobs?.namespace ??
        newResourceName("jobsNamespace").slice(0, 32);
      const jobBindings: NonNullable<ContractResourceBindings["jobs"]> = {
        namespace,
        workStream: "JOBS_WORK",
        queues: {},
      };

      for (const queue of jobs) {
        const existingQueue = options.existingResourceNames?.jobs?.queues?.[
          queue.queueType
        ];
        const queueToken = newResourceName("jobsQueue").slice(0, 48);
        const queueBinding: JobsQueueBinding = {
          queueType: queue.queueType,
          publishPrefix: existingQueue?.publishPrefix ??
            `trellis.jobs.${namespace}.${queueToken}`,
          workSubject: existingQueue?.workSubject ??
            `trellis.work.${namespace}.${queueToken}`,
          consumerName: existingQueue?.consumerName ??
            `${namespace}_${queueToken}`.slice(0, 64),
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
        };
        const action = await ensureJobsQueueConsumer(
          nats,
          jobBindings.workStream,
          queueBinding,
        );
        result[action].push({
          kind: "jobsQueueConsumer",
          alias: queue.queueType,
          stream: jobBindings.workStream,
          name: queueBinding.consumerName,
        });
        jobBindings.queues[queue.queueType] = queueBinding;
      }

      result.bindings.jobs = {
        ...jobBindings,
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
        const consumerName = options.existingResourceNames?.eventConsumers?.[
          consumer.alias
        ] ?? newResourceName("eventConsumer").slice(0, 64);
        const action = await ensureEventConsumer(nats, consumer, consumerName);
        result[action].push({
          kind: "eventConsumer",
          alias: consumer.alias,
          stream: consumer.stream,
          name: consumerName,
        });
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
      result.bindings.eventConsumers = consumerBindings;
    }

    return result;
  } catch (error) {
    if (nats && result.created.length > 0) {
      await rollbackProvisionedContractResources(
        result,
        createNatsResourcePurgeManager(nats),
      );
    }
    throw error;
  }
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
