import { Kvm } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core/internal";
import { Objm } from "@nats-io/obj";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

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

export type StreamResourceRequest = {
  alias: string;
  purpose: string;
  required: boolean;
  subjects: string[];
};

export type ContractResourceAnalysis = {
  kv: KvResourceRequest[];
  store: StoreResourceRequest[];
  streams: StreamResourceRequest[];
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
    maxObjectBytes?: number;
    maxTotalBytes?: number;
  }>;
  streams?: Record<string, {
    name: string;
    subjects: string[];
  }>;
  jobs?: {
    namespace: string;
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

function sanitizeToken(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "resource";
}

export function getKvResourceRequests(
  contract: TrellisContractV1,
): KvResourceRequest[] {
  const resources = (contract as TrellisContractV1 & {
    resources?: {
      kv?: Record<string, {
        purpose: string;
        required?: boolean;
        history?: number;
        ttlMs?: number;
        maxValueBytes?: number;
      }>;
    };
  }).resources;
  const entries = Object.entries(resources?.kv ?? {}) as Array<[string, {
    purpose: string;
    required?: boolean;
    history?: number;
    ttlMs?: number;
    maxValueBytes?: number;
  }]>;
  return entries
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
  const queues = (contract as TrellisContractV1 & {
    resources?: {
      jobs?: {
        queues?: Record<string, {
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
        }>;
      };
    };
  }).resources?.jobs?.queues;

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
  const entries = Object.entries(contract.resources?.store ?? {});

  return entries
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

export function getStreamResourceRequests(
  contract: TrellisContractV1,
): StreamResourceRequest[] {
  const resources = (contract as TrellisContractV1 & {
    resources?: {
      streams?: Record<string, {
        purpose: string;
        required?: boolean;
        subjects: string[];
      }>;
    };
  }).resources;
  const entries = Object.entries(resources?.streams ?? {}) as Array<[string, {
    purpose: string;
    required?: boolean;
    subjects: string[];
  }]>;

  return entries
    .map(([alias, resource]) => ({
      alias,
      purpose: resource.purpose,
      required: resource.required ?? true,
      subjects: [...resource.subjects],
    }))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function getContractResourceAnalysis(
  contract: TrellisContractV1,
): ContractResourceAnalysis {
  return {
    kv: getKvResourceRequests(contract),
    store: getStoreResourceRequests(contract),
    streams: getStreamResourceRequests(contract),
    jobs: getJobsQueueRequests(contract),
  };
}

export function getContractResourceSummary(
  contract: TrellisContractV1,
): {
  kvResources: number;
  storeResources: number;
  streamsResources: number;
  jobsQueues: number;
} {
  return {
    kvResources: getKvResourceRequests(contract).length,
    storeResources: getStoreResourceRequests(contract).length,
    streamsResources: getStreamResourceRequests(contract).length,
    jobsQueues: getJobsQueueRequests(contract).length,
  };
}

function buildKvBucketName(
  serviceSessionKey: string,
  contractId: string,
  alias: string,
): string {
  const service = sanitizeToken(serviceSessionKey).slice(0, 16);
  const contract = sanitizeToken(contractId).slice(0, 16);
  const logical = sanitizeToken(alias).slice(0, 24);
  return `svc_${service}_${contract}_${logical}`;
}

function buildStreamName(
  serviceSessionKey: string,
  contractId: string,
  alias: string,
): string {
  const service = sanitizeToken(serviceSessionKey).slice(0, 16);
  const contract = sanitizeToken(contractId).slice(0, 16);
  const logical = sanitizeToken(alias).slice(0, 24);
  return `svc_${service}_${contract}_${logical}`;
}

function buildStoreName(
  serviceSessionKey: string,
  contractId: string,
  alias: string,
): string {
  const service = sanitizeToken(serviceSessionKey).slice(0, 16);
  const contract = sanitizeToken(contractId).slice(0, 16);
  const logical = sanitizeToken(alias).slice(0, 24);
  return `svc_${service}_${contract}_${logical}`;
}

export async function provisionContractResourceBindings(
  nats: NatsConnection | undefined,
  contract: TrellisContractV1,
  serviceSessionKey: string,
): Promise<ContractResourceBindings> {
  const requests = getKvResourceRequests(contract);
  const stores = getStoreResourceRequests(contract);
  const streams = getStreamResourceRequests(contract);
  const jobs = getJobsQueueRequests(contract);
  if (
    requests.length === 0 &&
    stores.length === 0 &&
    streams.length === 0 &&
    jobs.length === 0
  ) {
    return {};
  }

  const kvBindings: NonNullable<ContractResourceBindings["kv"]> = {};

  if (requests.length > 0) {
    if (!nats) {
      throw new Error("NATS connection is required to provision KV resources");
    }
    const kvm = new Kvm(nats);
    for (const request of requests) {
      const bucket = buildKvBucketName(
        serviceSessionKey,
        contract.id,
        request.alias,
      );
      try {
        await kvm.create(bucket, {
          history: request.history,
          ttl: request.ttlMs,
          ...(request.maxValueBytes
            ? { maxValueSize: request.maxValueBytes }
            : {}),
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("bucket already exists")
        ) {
          throw error;
        }
        await kvm.open(bucket);
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
    if (!nats) {
      throw new Error("NATS connection is required to provision store resources");
    }

    const objm = new Objm(nats);
    bindings.store = Object.fromEntries(
      await Promise.all(stores.map(async (store) => {
        const name = buildStoreName(serviceSessionKey, contract.id, store.alias);
        await objm.create(name, {
          ...(store.ttlMs > 0 ? { ttl: store.ttlMs * 1_000_000 } : {}),
          ...(store.maxTotalBytes !== undefined
            ? { max_bytes: store.maxTotalBytes }
            : {}),
        });

        return [store.alias, {
          name,
          ttlMs: store.ttlMs,
          ...(store.maxObjectBytes !== undefined
            ? { maxObjectBytes: store.maxObjectBytes }
            : {}),
          ...(store.maxTotalBytes !== undefined
            ? { maxTotalBytes: store.maxTotalBytes }
            : {}),
        }];
      })),
    );
  }

  if (streams.length > 0) {
    bindings.streams = Object.fromEntries(
      streams.map((stream) => [stream.alias, {
        name: buildStreamName(serviceSessionKey, contract.id, stream.alias),
        subjects: [...stream.subjects],
      }]),
    );
  }

  if (jobs.length > 0) {
    const namespace = sanitizeToken(serviceSessionKey).slice(0, 32);
    bindings.jobs = {
      namespace,
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
    const stream = `KV_${kvBinding.bucket}`;
    publish.add(`$KV.${kvBinding.bucket}.>`);
    publish.add(`$JS.API.STREAM.MSG.GET.${stream}`);
    publish.add(`$JS.API.CONSUMER.CREATE.${stream}.>`);
    publish.add(`$JS.API.CONSUMER.DURABLE.CREATE.${stream}.>`);
    publish.add(`$JS.API.CONSUMER.INFO.${stream}.>`);
    publish.add(`$JS.API.CONSUMER.DELETE.${stream}.>`);
    publish.add(`$JS.API.CONSUMER.MSG.NEXT.${stream}.>`);
    publish.add(`$JS.API.$KV.${kvBinding.bucket}.>`);
    publish.add(`$JS.ACK.${stream}.>`);
  }

  for (const storeBinding of Object.values(bindings?.store ?? {})) {
    const stream = `OBJ_${storeBinding.name}`;
    publish.add("$JS.API.INFO");
    publish.add(`$O.${storeBinding.name}.C.>`);
    publish.add(`$O.${storeBinding.name}.M.>`);
    publish.add(`$JS.API.STREAM.INFO.${stream}`);
    publish.add(`$JS.API.STREAM.CREATE.${stream}`);
    publish.add(`$JS.API.STREAM.MSG.GET.${stream}`);
    publish.add(`$JS.API.STREAM.PURGE.${stream}`);
    publish.add(`$JS.API.CONSUMER.CREATE.${stream}.>`);
    publish.add(`$JS.API.CONSUMER.DELETE.${stream}.>`);
    publish.add(`$JS.FC.${stream}.>`);
  }

  for (const streamBinding of Object.values(bindings?.streams ?? {})) {
    for (const subject of streamBinding.subjects) {
      publish.add(subject);
    }
    publish.add(`$JS.API.CONSUMER.CREATE.${streamBinding.name}.>`);
    publish.add(`$JS.API.CONSUMER.DURABLE.CREATE.${streamBinding.name}.>`);
    publish.add(`$JS.API.CONSUMER.INFO.${streamBinding.name}.>`);
    publish.add(`$JS.API.CONSUMER.MSG.NEXT.${streamBinding.name}.>`);
    publish.add(`$JS.ACK.${streamBinding.name}.>`);
  }

  if (bindings?.jobs) {
    const namespace = bindings.jobs.namespace;
    publish.add(`trellis.jobs.${namespace}.>`);
    publish.add(`trellis.jobs.workers.${namespace}.>`);
    publish.add(`trellis.work.${namespace}.>`);
    for (const queue of Object.values(bindings.jobs.queues)) {
      publish.add(queue.publishPrefix + ".>");
      publish.add(queue.workSubject);
    }
  }

  return {
    publish: [...publish].sort((left, right) => left.localeCompare(right)),
    subscribe: [...subscribe].sort((left, right) => left.localeCompare(right)),
  };
}
