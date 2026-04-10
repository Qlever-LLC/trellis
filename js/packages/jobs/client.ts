import type { BaseError, Result } from "@qlever-llc/result";
import type {
  Job,
  JobFilter,
  JobsHealthResponse,
  ServiceInfo,
} from "./types.ts";

type TrellisLike = {
  request<T>(method: string, input: unknown): Promise<Result<T, BaseError>>;
};

export class JobClient {
  readonly #trellis: TrellisLike;

  constructor(trellis: TrellisLike) {
    this.#trellis = trellis;
  }

  async health(): Promise<Result<JobsHealthResponse, BaseError>> {
    return await this.#trellis.request<JobsHealthResponse>("Jobs.Health", {});
  }

  async listServices(): Promise<Result<ServiceInfo[], BaseError>> {
    return (await this.#trellis.request<{ services?: ServiceInfo[] }>("Jobs.ListServices", {})).map((response) => response.services ?? []);
  }

  async list(filter: JobFilter = {}): Promise<Result<Job[], BaseError>> {
    return (await this.#trellis.request<{ jobs?: Job[] }>("Jobs.List", filter)).map((response) => response.jobs ?? []);
  }

  async get(service: string, jobType: string, jobId: string): Promise<Result<Job | null, BaseError>> {
    return (await this.#trellis.request<{ job?: Job | null }>("Jobs.Get", {
      service,
      jobType,
      id: jobId,
    })).map((response) => response.job ?? null);
  }

  async retry(service: string, jobType: string, jobId: string): Promise<Result<Job, BaseError>> {
    return (await this.#trellis.request<{ job: Job }>("Jobs.Retry", {
      service,
      jobType,
      id: jobId,
    })).map((response) => response.job);
  }

  async cancel(service: string, jobType: string, jobId: string): Promise<Result<Job, BaseError>> {
    return (await this.#trellis.request<{ job: Job }>("Jobs.Cancel", {
      service,
      jobType,
      id: jobId,
    })).map((response) => response.job);
  }

  async listDLQ(filter: JobFilter = {}): Promise<Result<Job[], BaseError>> {
    return (await this.#trellis.request<{ jobs?: Job[] }>("Jobs.ListDLQ", filter)).map((response) => response.jobs ?? []);
  }

  async replayDLQ(service: string, jobType: string, jobId: string): Promise<Result<Job, BaseError>> {
    return (await this.#trellis.request<{ job: Job }>("Jobs.ReplayDLQ", {
      service,
      jobType,
      id: jobId,
    })).map((response) => response.job);
  }

  async dismissDLQ(service: string, jobType: string, jobId: string): Promise<Result<Job, BaseError>> {
    return (await this.#trellis.request<{ job: Job }>("Jobs.DismissDLQ", {
      service,
      jobType,
      id: jobId,
    })).map((response) => response.job);
  }
}
