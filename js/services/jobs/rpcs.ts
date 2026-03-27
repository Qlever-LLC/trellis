import { ValidationError } from "@qlever-llc/trellis";
import type { BaseError } from "@qlever-llc/trellis-result";
import { isErr, Result } from "@qlever-llc/trellis-result";
import { Value } from "typebox/value";
import type { Job, ServiceInfo, ServiceRegistration } from "../../packages/jobs/types.ts";
import {
  JobFilterSchema,
  JobSchema,
  JobsGetRequestSchema,
  JobsMutateRequestSchema,
  ServiceRegistrationSchema,
} from "../../packages/jobs/types.ts";

type JobsMountRuntime = {
  trellis: {
    mount(method: string, handler: (input: unknown) => Promise<unknown>): Promise<void>;
  };
};

type KVLike<TValue> = {
  get(key: string): Promise<{ take(): { value: TValue } | Result<never, BaseError> }>;
  put(key: string, value: TValue): Promise<{ take(): void | Result<never, BaseError> }>;
  keys(filter?: string | string[]): Promise<{ take(): AsyncIterable<string> | Result<never, BaseError> }>;
};

type JobsStores = {
  jobsKV: KVLike<Job>;
  serviceInstancesKV: KVLike<ServiceRegistration>;
};

async function listServices(stores: JobsStores): Promise<ServiceInfo[]> {
  const keys = (await stores.serviceInstancesKV.keys(">")).take();
  if (isErr(keys)) throw keys.error;

  const grouped = new Map<string, ServiceRegistration[]>();
  for await (const key of keys) {
    const value = (await stores.serviceInstancesKV.get(key)).take();
    if (isErr(value)) continue;
    const registration = value.value;
    grouped.set(registration.service, [...(grouped.get(registration.service) ?? []), registration]);
  }

  return [...grouped.entries()]
    .map(([name, instances]) => ({ name, instances, healthy: instances.length > 0 }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function listJobs(stores: JobsStores, input: unknown): Promise<Job[]> {
  const filter = Value.Parse(JobFilterSchema, input);
  const keys = (await stores.jobsKV.keys(">")).take();
  if (isErr(keys)) throw keys.error;

  const states = filter.state
    ? new Set(Array.isArray(filter.state) ? filter.state : [filter.state])
    : undefined;
  const jobs: Job[] = [];

  for await (const key of keys) {
    const entry = (await stores.jobsKV.get(key)).take();
    if (isErr(entry)) continue;
    const job = entry.value;
    if (filter.service && job.service !== filter.service) continue;
    if (filter.type && job.type !== filter.type) continue;
    if (states && !states.has(job.state)) continue;
    if (filter.since && job.updatedAt < filter.since) continue;
    jobs.push(job);
  }

  jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return jobs.slice(0, filter.limit ?? jobs.length);
}

async function getJob(stores: JobsStores, input: unknown): Promise<Job | null> {
  const request = Value.Parse(JobsGetRequestSchema, input);
  const entry = (await stores.jobsKV.get(`${request.service}.${request.jobType}.${request.id}`)).take();
  return isErr(entry) ? null : entry.value;
}

export async function registerJobsRpcHandlers(
  service: JobsMountRuntime,
  stores: JobsStores,
) {
  await service.trellis.mount("Jobs.ListServices", async () => {
    return Result.ok({ services: await listServices(stores) });
  });

  await service.trellis.mount("Jobs.List", async (input) => {
    return Result.ok({ jobs: await listJobs(stores, input) });
  });

  await service.trellis.mount("Jobs.Get", async (input) => {
    const job = await getJob(stores, input);
    return Result.ok(job ? { job } : {});
  });

  await service.trellis.mount("Jobs.Cancel", async (input) => {
    const request = Value.Parse(JobsMutateRequestSchema, input);
    const entry = (await stores.jobsKV.get(`${request.service}.${request.jobType}.${request.id}`)).take();
    if (isErr(entry)) {
      return Result.err(new ValidationError({
        errors: [{ path: "/id", message: "job not found" }],
        cause: entry.error,
      }));
    }

    const job = { ...entry.value, state: "cancelled" as const, updatedAt: new Date().toISOString() };
    const saved = (await stores.jobsKV.put(`${request.service}.${request.jobType}.${request.id}`, job)).take();
    if (isErr(saved)) return Result.err(saved.error);
    return Result.ok({ job });
  });

  await service.trellis.mount("Jobs.Retry", async (input) => {
    const request = Value.Parse(JobsMutateRequestSchema, input);
    const entry = (await stores.jobsKV.get(`${request.service}.${request.jobType}.${request.id}`)).take();
    if (isErr(entry)) {
      return Result.err(new ValidationError({
        errors: [{ path: "/id", message: "job not found" }],
        cause: entry.error,
      }));
    }

    const job = {
      ...entry.value,
      state: "pending" as const,
      updatedAt: new Date().toISOString(),
      lastError: undefined,
      result: undefined,
      completedAt: undefined,
      startedAt: undefined,
      progress: undefined,
    };
    const saved = (await stores.jobsKV.put(`${request.service}.${request.jobType}.${request.id}`, job)).take();
    if (isErr(saved)) return Result.err(saved.error);
    return Result.ok({ job });
  });
}
