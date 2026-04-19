declare module "@qlever-llc/trellis-jobs" {
  import type { BaseError, Result } from "@qlever-llc/result";

  export type WorkerInfo = {
    instanceId: string;
    jobType: string;
    timestamp: string;
  };

  export type ServiceInfo = {
    healthy: boolean;
    name: string;
    workers: WorkerInfo[];
  };

  export type Job = {
    id: string;
    service: string;
    state: string;
    type: string;
    updatedAt: string;
  };

  export type JobFilter = {
    limit?: number;
    service?: string;
    state?: string | string[];
    since?: string;
    type?: string;
  };

  export class JobClient {
    constructor(trellis: {
      request<T>(method: string, input: unknown): Promise<Result<T, BaseError>>;
    });
    listServices(): Promise<Result<ServiceInfo[], BaseError>>;
    list(filter?: JobFilter): Promise<Result<Job[], BaseError>>;
  }
}
