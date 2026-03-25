import { Kvm } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core/internal";
import type { TrellisContractV1 } from "@trellis/contracts";

export type KvResourceRequest = {
  alias: string;
  purpose: string;
  required: boolean;
  history: number;
  ttlMs: number;
  maxValueBytes?: number;
};

export type ContractResourceAnalysis = {
  kv: KvResourceRequest[];
};

export type ContractResourceBindings = {
  kv?: Record<string, {
    bucket: string;
    history: number;
    ttlMs: number;
    maxValueBytes?: number;
  }>;
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
  const entries = Object.entries(resources?.kv ?? {});
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

export function getContractResourceAnalysis(contract: TrellisContractV1): ContractResourceAnalysis {
  return {
    kv: getKvResourceRequests(contract),
  };
}

export function getContractResourceSummary(contract: TrellisContractV1): { kvResources: number } {
  return {
    kvResources: getKvResourceRequests(contract).length,
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
  if (requests.length === 0) {
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

  return { kv: kvBindings };
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

  return {
    publish: [...publish].sort((left, right) => left.localeCompare(right)),
    subscribe: [...subscribe].sort((left, right) => left.localeCompare(right)),
  };
}
