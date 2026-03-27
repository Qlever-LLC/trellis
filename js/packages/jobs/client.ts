import type { BaseError, Result } from "@qlever-llc/trellis-result";
import { isErr } from "@qlever-llc/trellis-result";

import type {
  Job,
  JobFilter,
  ServiceInfo,
  ServiceRegistration,
} from "./types.ts";

type TrellisLike = {
  requestOrThrow(method: string, input: unknown): Promise<unknown>;
};

type KVEntryLike<TValue> = { value: TValue };

type KVLike<TValue> = {
  get(key: string): Promise<{ take(): KVEntryLike<TValue> | Result<never, BaseError> }>;
  keys(filter?: string | string[]): Promise<{ take(): AsyncIterable<string> | Result<never, BaseError> }>;
};

type Stores = {
  jobsKV: KVLike<Job>;
  serviceInstancesKV: KVLike<ServiceRegistration>;
};

export class JobClient {
  readonly #trellis?: TrellisLike;
  readonly #stores?: Stores;

  constructor(source: TrellisLike | Stores) {
    if ("requestOrThrow" in source) {
      this.#trellis = source;
    } else {
      this.#stores = source;
    }
  }

  async listServices(): Promise<ServiceInfo[]> {
    if (this.#trellis) {
      const response = await this.#trellis.requestOrThrow("Jobs.ListServices", {}) as { services?: ServiceInfo[] };
      return response.services ?? [];
    }

    const keys = (await this.#stores!.serviceInstancesKV.keys(">")).take();
    if (isErr(keys)) throw keys.error;

    const grouped = new Map<string, ServiceRegistration[]>();
    for await (const key of keys) {
      const value = (await this.#stores!.serviceInstancesKV.get(key)).take();
      if (isErr(value)) continue;
      const registration = value.value;
      grouped.set(registration.service, [...(grouped.get(registration.service) ?? []), registration]);
    }

    return [...grouped.entries()]
      .map(([name, instances]) => ({ name, instances, healthy: instances.length > 0 }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async list(filter: JobFilter = {}): Promise<Job[]> {
    if (this.#trellis) {
      const response = await this.#trellis.requestOrThrow("Jobs.List", filter) as { jobs?: Job[] };
      return response.jobs ?? [];
    }

    const keys = (await this.#stores!.jobsKV.keys(">")).take();
    if (isErr(keys)) throw keys.error;

    const states = filter.state
      ? new Set(Array.isArray(filter.state) ? filter.state : [filter.state])
      : undefined;
    const jobs: Job[] = [];
    for await (const key of keys) {
      const entry = (await this.#stores!.jobsKV.get(key)).take();
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

  async get(service: string, jobType: string, jobId: string): Promise<Job | null> {
    if (this.#trellis) {
      const response = await this.#trellis.requestOrThrow("Jobs.Get", {
        service,
        jobType,
        id: jobId,
      }) as { job?: Job | null };
      return response.job ?? null;
    }

    const entry = (await this.#stores!.jobsKV.get(`${service}.${jobType}.${jobId}`)).take();
    return isErr(entry) ? null : entry.value;
  }

  async retry(service: string, jobType: string, jobId: string): Promise<Job> {
    const response = await this.#trellis!.requestOrThrow("Jobs.Retry", {
      service,
      jobType,
      id: jobId,
    }) as { job: Job };
    return response.job;
  }

  async cancel(service: string, jobType: string, jobId: string): Promise<Job> {
    const response = await this.#trellis!.requestOrThrow("Jobs.Cancel", {
      service,
      jobType,
      id: jobId,
    }) as { job: Job };
    return response.job;
  }
}
