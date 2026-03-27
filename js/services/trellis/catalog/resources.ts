import { Kvm } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core/internal";
import type { TrellisContractV1 } from "@qlever-llc/trellis-contracts";

export type KvResourceRequest = {
  alias: string;
  purpose: string;
  required: boolean;
  history: number;
  ttlMs: number;
  maxValueBytes?: number;
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

export type ContractResourceAnalysis = {
  kv: KvResourceRequest[];
  jobs: JobsQueueRequest[];
};

export type ContractResourceBindings = {
  kv?: Record<string, {
    bucket: string;
    history: number;
      ttlMs: number;
      maxValueBytes?: number;
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
    registry?: {
      bucket: string;
    };
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

export function getKvResourceRequests(contract: TrellisContractV1): KvResourceRequest[] {
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
  }]>
  ;
  return entries
    .map(([alias, resource]) => ({
      alias,
      purpose: resource.purpose,
      required: resource.required ?? true,
      history: resource.history ?? 1,
      ttlMs: resource.ttlMs ?? 0,
      ...(resource.maxValueBytes ? { maxValueBytes: resource.maxValueBytes } : {}),
    }))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function getJobsQueueRequests(contract: TrellisContractV1): JobsQueueRequest[] {
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
      ...(queue.defaultDeadlineMs ? { defaultDeadlineMs: queue.defaultDeadlineMs } : {}),
      progress: queue.progress ?? true,
      logs: queue.logs ?? true,
      dlq: queue.dlq ?? true,
      concurrency: queue.concurrency ?? 1,
    }))
    .sort((left, right) => left.queueType.localeCompare(right.queueType));
}

export function getContractResourceAnalysis(contract: TrellisContractV1): ContractResourceAnalysis {
  return {
    kv: getKvResourceRequests(contract),
    jobs: getJobsQueueRequests(contract),
  };
}

export function getContractResourceSummary(contract: TrellisContractV1): { kvResources: number; jobsQueues: number } {
  return {
    kvResources: getKvResourceRequests(contract).length,
    jobsQueues: getJobsQueueRequests(contract).length,
  };
}

function buildKvBucketName(serviceSessionKey: string, contractId: string, alias: string): string {
  const service = sanitizeToken(serviceSessionKey).slice(0, 16);
  const contract = sanitizeToken(contractId).slice(0, 16);
  const logical = sanitizeToken(alias).slice(0, 24);
  return `svc_${service}_${contract}_${logical}`;
}

export async function provisionContractResourceBindings(
  nats: NatsConnection,
  contract: TrellisContractV1,
  serviceSessionKey: string,
): Promise<ContractResourceBindings> {
  const requests = getKvResourceRequests(contract);
  const jobs = getJobsQueueRequests(contract);
  if (requests.length === 0 && jobs.length === 0) {
    return {};
  }

  const kvm = new Kvm(nats);
  const kvBindings: NonNullable<ContractResourceBindings["kv"]> = {};

  for (const request of requests) {
    const bucket = buildKvBucketName(serviceSessionKey, contract.id, request.alias);
    try {
      await kvm.create(bucket, {
        history: request.history,
        ttl: request.ttlMs,
        ...(request.maxValueBytes ? { maxValueSize: request.maxValueBytes } : {}),
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("bucket already exists")) {
        throw error;
      }
      await kvm.open(bucket);
    }
    kvBindings[request.alias] = {
      bucket,
      history: request.history,
      ttlMs: request.ttlMs,
      ...(request.maxValueBytes ? { maxValueBytes: request.maxValueBytes } : {}),
    };
  }

  const bindings: ContractResourceBindings = {};
  if (Object.keys(kvBindings).length > 0) {
    bindings.kv = kvBindings;
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
            ...(queue.defaultDeadlineMs ? { defaultDeadlineMs: queue.defaultDeadlineMs } : {}),
            progress: queue.progress,
            logs: queue.logs,
            dlq: queue.dlq,
            concurrency: queue.concurrency,
          }];
        }),
      ),
      registry: {
        bucket: "trellis_service_instances",
      },
    };
  }

  return bindings;
}

export function getResourcePermissionGrants(bindings?: ContractResourceBindings): {
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

  if (bindings?.jobs) {
    const namespace = bindings.jobs.namespace;
    publish.add(`trellis.jobs.${namespace}.>`);
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
