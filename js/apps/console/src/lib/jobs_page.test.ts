import { AsyncResult, BaseError, UnexpectedError } from "@qlever-llc/result";
import { deepEqual } from "node:assert/strict";
import type {
  JobsListInput,
  JobsListOutput,
  JobsListServicesOutput,
} from "@qlever-llc/trellis/sdk/jobs";

import { loadJobsPageData } from "./jobs_page.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

Deno.test("loadJobsPageData requests jobs and services with the provided filter", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  function request(
    method: "Jobs.ListServices",
    input: Record<string, never>,
  ): AsyncResult<JobsListServicesOutput, BaseError>;
  function request(
    method: "Jobs.List",
    input: JobsListInput,
  ): AsyncResult<JobsListOutput, BaseError>;
  function request(
    method: "Jobs.ListServices" | "Jobs.List",
    input: Record<string, never> | JobsListInput,
  ): AsyncResult<JobsListServicesOutput | JobsListOutput, BaseError> {
    calls.push({ method, input });
    if (method === "Jobs.ListServices") {
      return AsyncResult.ok<JobsListServicesOutput>({
        services: [{ name: "documents", healthy: true, workers: [] }],
      });
    }

    return AsyncResult.ok<JobsListOutput>({
      jobs: [
        {
          id: "job-1",
          service: "documents",
          type: "document-process",
          state: "pending",
          payload: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          tries: 0,
          maxTries: 3,
        },
      ],
    });
  }
  const data = await loadJobsPageData({
    listServices: () => request("Jobs.ListServices", {}),
    listJobs: (filter) => request("Jobs.List", filter),
  }, { service: "documents", state: "pending" });

  deepEqual(calls, [
    { method: "Jobs.ListServices", input: {} },
    { method: "Jobs.List", input: { service: "documents", state: "pending" } },
  ]);
  deepEqual(data.services[0]?.name, "documents");
  deepEqual(data.jobs[0]?.id, "job-1");
});

Deno.test("loadJobsPageData reports Jobs admin runtime as unavailable when Jobs RPCs have no responders", async () => {
  function request(
    method: "Jobs.ListServices",
    input: Record<string, never>,
  ): AsyncResult<JobsListServicesOutput, BaseError>;
  function request(
    method: "Jobs.List",
    input: JobsListInput,
  ): AsyncResult<JobsListOutput, BaseError>;
  function request(
    method: "Jobs.ListServices" | "Jobs.List",
    _input: Record<string, never> | JobsListInput,
  ): AsyncResult<JobsListServicesOutput | JobsListOutput, BaseError> {
    if (method === "Jobs.ListServices") {
      return AsyncResult.err(
        new UnexpectedError({
          cause: new Error("No responders available for request"),
        }),
      );
    }

    return AsyncResult.ok<JobsListOutput>({ jobs: [] });
  }
  const data = await loadJobsPageData({
    listServices: () => request("Jobs.ListServices", {}),
    listJobs: (filter) => request("Jobs.List", filter),
  });

  deepEqual(data.available, false);
  deepEqual(
    data.message,
    "Jobs admin runtime is not currently reachable.",
  );
  deepEqual(data.jobs, []);
  deepEqual(data.services, []);
});

Deno.test("loadJobsPageData reports lowercase NATS no responders as unavailable", async () => {
  function request(
    method: "Jobs.ListServices",
    input: Record<string, never>,
  ): AsyncResult<JobsListServicesOutput, BaseError>;
  function request(
    method: "Jobs.List",
    input: JobsListInput,
  ): AsyncResult<JobsListOutput, BaseError>;
  function request(
    method: "Jobs.ListServices" | "Jobs.List",
    _input: Record<string, never> | JobsListInput,
  ): AsyncResult<JobsListServicesOutput | JobsListOutput, BaseError> {
    if (method === "Jobs.ListServices") {
      return AsyncResult.err(
        new UnexpectedError({
          cause: new Error("no responders: 'rpc.v1.Jobs.ListServices'"),
        }),
      );
    }

    return AsyncResult.ok<JobsListOutput>({ jobs: [] });
  }
  const data = await loadJobsPageData({
    listServices: () => request("Jobs.ListServices", {}),
    listJobs: (filter) => request("Jobs.List", filter),
  });

  deepEqual(data.available, false);
  deepEqual(
    data.message,
    "Jobs admin runtime is not currently reachable.",
  );
});

Deno.test("loadJobsPageData reports missing Jobs permissions with re-auth guidance", async () => {
  function request(
    method: "Jobs.ListServices",
    input: Record<string, never>,
  ): AsyncResult<JobsListServicesOutput, BaseError>;
  function request(
    method: "Jobs.List",
    input: JobsListInput,
  ): AsyncResult<JobsListOutput, BaseError>;
  function request(
    method: "Jobs.ListServices" | "Jobs.List",
    _input: Record<string, never> | JobsListInput,
  ): AsyncResult<JobsListServicesOutput | JobsListOutput, BaseError> {
    if (method === "Jobs.ListServices") {
      return AsyncResult.err(
        new UnexpectedError({
          cause: new Error(
            'Permissions Violation for Publish to "rpc.v1.Jobs.ListServices"',
          ),
        }),
      );
    }

    return AsyncResult.ok<JobsListOutput>({ jobs: [] });
  }
  const data = await loadJobsPageData({
    listServices: () => request("Jobs.ListServices", {}),
    listJobs: (filter) => request("Jobs.List", filter),
  });

  deepEqual(data.available, false);
  deepEqual(
    data.message,
    "Your current session is not approved for Jobs RPCs. Sign out and sign back in to refresh permissions.",
  );
  deepEqual(data.jobs, []);
  deepEqual(data.services, []);
});
