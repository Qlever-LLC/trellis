import { jetstreamManager } from "@nats-io/jetstream";
import { type KV, Kvm } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core/internal";
import { Objm } from "@nats-io/obj";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

type StreamRetentionPolicy = "limits" | "interest" | "workqueue";
type StreamStorageType = "file" | "memory";
type StreamDiscardPolicy = "old" | "new";

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
  subjects: string[];
  sources?: StreamResourceSourceBinding[];
};

export type ContractResourceAnalysis = {
  kv: KvResourceRequest[];
  store: StoreResourceRequest[];
  jobs: JobsQueueRequest[];
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
};

export type InstalledServiceContractBinding = {
  contractId: string;
  digest: string;
  resources: ContractResourceBindings;
};

export type ResourceCompatibilityPreflightInput = {
  serviceDeploymentId: string;
  contractId: string;
  proposedDigest: string;
  proposed: Partial<Pick<ContractResourceAnalysis, "kv" | "store">>;
  existingBindingsByDigest?: Record<string, ContractResourceBindings>;
};

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

const BUILTIN_JOBS_STATE_BUCKET = "trellis_jobs";
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
): Promise<void> {
  const kvm = new Kvm(nats);
  let kv: KV;
  try {
    kv = await kvm.create(bucket, {
      history: request.history,
      ttl: request.ttlMs,
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
  await reconcileKvResourceConfig(
    {
      update: (name, config) => jsm.streams.update(name, config),
    },
    await kv.status(),
    request,
  );
}

type KvResourceStreamConfig = {
  name: string;
  max_msgs_per_subject: number;
  max_age: number;
  max_msg_size: number;
} & Record<string, unknown>;

type KvResourceStatus = {
  streamInfo: {
    config: KvResourceStreamConfig;
  };
};

type KvStreamUpdater = {
  update(name: string, config: KvResourceStreamConfig): Promise<unknown>;
};

/**
 * Updates an existing KV bucket stream so persisted bindings match the requested
 * lineage/profile-scoped resource settings.
 */
export async function reconcileKvResourceConfig(
  streams: KvStreamUpdater,
  status: KvResourceStatus,
  request: Pick<KvResourceRequest, "history" | "ttlMs" | "maxValueBytes">,
): Promise<void> {
  const config = status.streamInfo.config;
  const maxAge = request.ttlMs > 0 ? request.ttlMs * 1_000_000 : 0;
  const maxMsgSize = request.maxValueBytes ?? -1;
  if (
    config.max_msgs_per_subject === request.history &&
    config.max_age === maxAge &&
    config.max_msg_size === maxMsgSize
  ) {
    return;
  }

  await streams.update(config.name, {
    ...config,
    max_msgs_per_subject: request.history,
    max_age: maxAge,
    max_msg_size: maxMsgSize,
  });
}

async function ensureStoreResource(
  nats: NatsConnection,
  name: string,
  store: StoreResourceRequest,
): Promise<void> {
  const objm = new Objm(nats);
  let objectStore;
  try {
    objectStore = await objm.create(name, {
      ...(store.ttlMs > 0 ? { ttl: store.ttlMs * 1_000_000 } : {}),
      ...(store.maxTotalBytes !== undefined
        ? { max_bytes: store.maxTotalBytes }
        : {}),
    });
  } catch (error) {
    if (!isObjectStoreAlreadyExistsError(error)) {
      throw error;
    }
    objectStore = await objm.open(name);
  }
  const status = await objectStore.status();
  const maxAge = store.ttlMs > 0 ? store.ttlMs * 1_000_000 : 0;
  if (
    status.streamInfo.config.max_age === maxAge &&
    (store.maxTotalBytes === undefined ||
      status.streamInfo.config.max_bytes === store.maxTotalBytes)
  ) {
    return;
  }

  const jsm = await jetstreamManager(nats);
  await jsm.streams.update(status.streamInfo.config.name, {
    ...status.streamInfo.config,
    max_age: maxAge,
    ...(store.maxTotalBytes !== undefined
      ? { max_bytes: store.maxTotalBytes }
      : {}),
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
): Promise<void> {
  const jsm = await jetstreamManager(nats);
  const config = toJetStreamStreamConfig(stream);

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

async function ensureBuiltinJobsInfrastructure(
  nats: NatsConnection,
): Promise<void> {
  await ensureKvResource(nats, BUILTIN_JOBS_STATE_BUCKET, {
    history: 1,
    ttlMs: 0,
  });
  await Promise.all(
    Object.values(BUILTIN_JOBS_STREAMS).map((stream) =>
      ensureStreamResource(nats, stream)
    ),
  );
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

/**
 * Validates that a new same-lineage resource request is compatible with already
 * allowed digests before any physical resource provisioning is attempted.
 */
export function preflightContractResourceCompatibility(
  input: ResourceCompatibilityPreflightInput,
): void {
  for (const request of input.proposed.kv ?? []) {
    const bucket = buildResourceName(
      input.serviceDeploymentId,
      input.contractId,
      request.alias,
    );
    for (
      const [digest, bindings] of Object.entries(
        input.existingBindingsByDigest ?? {},
      )
    ) {
      if (digest === input.proposedDigest) continue;
      const existing = bindings.kv?.[request.alias];
      if (!existing) continue;
      if (
        existing.history === request.history &&
        existing.ttlMs === request.ttlMs &&
        existing.maxValueBytes === request.maxValueBytes
      ) {
        continue;
      }
      throw new Error(
        `incompatible KV resource settings for ${input.contractId} ${request.alias} (${bucket}) between ${digest} and ${input.proposedDigest}`,
      );
    }
  }

  for (const request of input.proposed.store ?? []) {
    const name = buildResourceName(
      input.serviceDeploymentId,
      input.contractId,
      request.alias,
    );
    for (
      const [digest, bindings] of Object.entries(
        input.existingBindingsByDigest ?? {},
      )
    ) {
      if (digest === input.proposedDigest) continue;
      const existing = bindings.store?.[request.alias];
      if (!existing) continue;
      if (
        existing.ttlMs === request.ttlMs &&
        existing.maxTotalBytes === request.maxTotalBytes
      ) {
        continue;
      }
      throw new Error(
        `incompatible store resource settings for ${input.contractId} ${request.alias} (${name}) between ${digest} and ${input.proposedDigest}`,
      );
    }
  }
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

export function getStoreResourceRequests(
  contract: TrellisContractV1,
): StoreResourceRequest[] {
  return Object.entries(contract.resources?.store ?? {})
    .map(([alias, resource]) => ({
      alias,
      purpose: resource.purpose,
      required: resource.required ?? true,
      ttlMs: resource.ttlMs ?? 0,
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
): Promise<ContractResourceBindings> {
  const requests = getKvResourceRequests(contract);
  const stores = getStoreResourceRequests(contract);
  const jobs = getJobsQueueRequests(contract);
  if (
    requests.length === 0 &&
    stores.length === 0 &&
    jobs.length === 0
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
        await ensureKvResource(nats, bucket, request);
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
          await ensureStoreResource(nats, name, store);
        } catch (error) {
          if (!store.required) continue;
          throw error;
        }

        storeBindings[store.alias] = {
          name,
          ttlMs: store.ttlMs,
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

  if (jobs.length > 0) {
    if (!nats) {
      throw new Error(
        "NATS connection is required to provision jobs resources",
      );
    }
    await ensureBuiltinJobsInfrastructure(nats);
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
    publish.add(`$JS.API.CONSUMER.DURABLE.CREATE.${workStream}.>`);
    publish.add(`$JS.API.CONSUMER.INFO.${workStream}.>`);
    publish.add(`$JS.API.CONSUMER.MSG.NEXT.${workStream}.>`);
    publish.add(`$JS.ACK.${workStream}.>`);
    for (const queue of Object.values(bindings.jobs.queues)) {
      publish.add(queue.publishPrefix + ".>");
      publish.add(queue.workSubject);
      subscribe.add(`${queue.publishPrefix}.*.cancelled`);
    }
  }

  return {
    publish: [...publish].sort((left, right) => left.localeCompare(right)),
    subscribe: [...subscribe].sort((left, right) => left.localeCompare(right)),
  };
}
