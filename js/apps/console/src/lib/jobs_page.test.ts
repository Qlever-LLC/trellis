import { AsyncResult, BaseError, UnexpectedError } from "@qlever-llc/result";
import { deepEqual } from "node:assert/strict";
import type {
  JobsCancelOutput,
  JobsDismissDLQOutput,
  JobsGetOutput,
  JobsListInput,
  JobsListOutput,
  JobsListServicesOutput,
  JobsReplayDLQOutput,
  JobsRetryOutput,
} from "@qlever-llc/trellis/sdk/jobs";

import {
  cancelJob,
  dismissDlqJob,
  loadJobDetailData,
  loadJobsPageData,
  replayDlqJob,
  retryJob,
} from "./jobs_page.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

const jobContext = {
  requestId: "req_test",
  traceId: "trace_test",
  traceparent: "00-trace_test-span_test-01",
};

class JobsNotFoundTestError extends BaseError {
  override readonly name = "NotFoundError" as const;

  override toSerializable() {
    return {
      id: this.id,
      type: this.name,
      message: this.message,
      context: this.getContext(),
    };
  }
}

Deno.test("loadJobsPageData requests jobs and services with the provided filter", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  function request(
    method: "Jobs.ListServices",
    input: { limit: number; offset?: number },
  ): AsyncResult<JobsListServicesOutput, BaseError>;
  function request(
    method: "Jobs.List",
    input: JobsListInput,
  ): AsyncResult<JobsListOutput, BaseError>;
  function request(
    method: "Jobs.ListServices" | "Jobs.List",
    input: { limit: number; offset?: number } | JobsListInput,
  ): AsyncResult<JobsListServicesOutput | JobsListOutput, BaseError> {
    calls.push({ method, input });
    if (method === "Jobs.ListServices") {
      return AsyncResult.ok<JobsListServicesOutput>({
        count: 1,
        entries: [{ name: "documents", healthy: true, workers: [] }],
        limit: 500,
        offset: 0,
      });
    }

    return AsyncResult.ok<JobsListOutput>({
      count: 2,
      entries: [
        {
          id: "job-1",
          service: "documents",
          type: "document-process",
          state: "pending",
          payload: null,
          context: jobContext,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          tries: 0,
          maxTries: 3,
        },
      ],
      limit: 50,
      nextOffset: 50,
      offset: 0,
    });
  }
  const data = await loadJobsPageData({
    listServices: (input) => request("Jobs.ListServices", input),
    listJobs: (filter) => request("Jobs.List", filter),
  }, { service: "documents", state: ["pending"], limit: 50, offset: 0 });

  deepEqual(calls, [
    { method: "Jobs.ListServices", input: { limit: 500 } },
    {
      method: "Jobs.List",
      input: {
        service: "documents",
        state: ["pending"],
        limit: 50,
        offset: 0,
      },
    },
  ]);
  deepEqual(data.services[0]?.name, "documents");
  deepEqual(data.jobs[0]?.id, "job-1");
  deepEqual(data.nextOffset, 50);
});

Deno.test("loadJobsPageData reports Jobs admin runtime as unavailable when Jobs RPCs have no responders", async () => {
  function request(
    method: "Jobs.ListServices",
    input: { limit: number; offset?: number },
  ): AsyncResult<JobsListServicesOutput, BaseError>;
  function request(
    method: "Jobs.List",
    input: JobsListInput,
  ): AsyncResult<JobsListOutput, BaseError>;
  function request(
    method: "Jobs.ListServices" | "Jobs.List",
    _input: { limit: number; offset?: number } | JobsListInput,
  ): AsyncResult<JobsListServicesOutput | JobsListOutput, BaseError> {
    if (method === "Jobs.ListServices") {
      return AsyncResult.err(
        new UnexpectedError({
          cause: new Error("No responders available for request"),
        }),
      );
    }

    return AsyncResult.ok<JobsListOutput>({
      count: 0,
      entries: [],
      limit: 50,
      offset: 0,
    });
  }
  const data = await loadJobsPageData({
    listServices: (input) => request("Jobs.ListServices", input),
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
    input: { limit: number; offset?: number },
  ): AsyncResult<JobsListServicesOutput, BaseError>;
  function request(
    method: "Jobs.List",
    input: JobsListInput,
  ): AsyncResult<JobsListOutput, BaseError>;
  function request(
    method: "Jobs.ListServices" | "Jobs.List",
    _input: { limit: number; offset?: number } | JobsListInput,
  ): AsyncResult<JobsListServicesOutput | JobsListOutput, BaseError> {
    if (method === "Jobs.ListServices") {
      return AsyncResult.err(
        new UnexpectedError({
          cause: new Error("no responders: 'rpc.v1.Jobs.ListServices'"),
        }),
      );
    }

    return AsyncResult.ok<JobsListOutput>({
      count: 0,
      entries: [],
      limit: 50,
      offset: 0,
    });
  }
  const data = await loadJobsPageData({
    listServices: (input) => request("Jobs.ListServices", input),
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
    input: { limit: number; offset?: number },
  ): AsyncResult<JobsListServicesOutput, BaseError>;
  function request(
    method: "Jobs.List",
    input: JobsListInput,
  ): AsyncResult<JobsListOutput, BaseError>;
  function request(
    method: "Jobs.ListServices" | "Jobs.List",
    _input: { limit: number; offset?: number } | JobsListInput,
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

    return AsyncResult.ok<JobsListOutput>({
      count: 0,
      entries: [],
      limit: 50,
      offset: 0,
    });
  }
  const data = await loadJobsPageData({
    listServices: (input) => request("Jobs.ListServices", input),
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

Deno.test("loadJobDetailData requests detail by id", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const data = await loadJobDetailData({
    getJob: (input) => {
      calls.push({ method: "Jobs.Get", input });
      return AsyncResult.ok<JobsGetOutput>({
        job: {
          id: "job-1",
          service: "documents",
          type: "document-process",
          state: "failed",
          payload: { documentId: "doc-1" },
          context: jobContext,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
          tries: 3,
          maxTries: 3,
          lastError: "boom",
        },
      });
    },
  }, "job-1");

  deepEqual(calls, [{ method: "Jobs.Get", input: { id: "job-1" } }]);
  deepEqual(data.available, true);
  deepEqual(data.job?.id, "job-1");
});

Deno.test("loadJobDetailData treats declared NotFoundError as an empty detail", async () => {
  const data = await loadJobDetailData({
    getJob: () =>
      AsyncResult.err(
        new JobsNotFoundTestError("Job 'missing' not found"),
      ),
  }, "missing");

  deepEqual(data, { available: true });
});

Deno.test("cancelJob sends id-only action input", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  await cancelJob({
    action: (input) => {
      calls.push({ method: "Jobs.Cancel", input });
      return AsyncResult.ok<JobsCancelOutput>({
        job: {
          id: "job-1",
          service: "documents",
          type: "document-process",
          state: "cancelled",
          payload: null,
          context: jobContext,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
          tries: 0,
          maxTries: 3,
        },
      });
    },
  }, "job-1");

  deepEqual(calls, [{ method: "Jobs.Cancel", input: { id: "job-1" } }]);
});

Deno.test("retryJob sends id-only action input", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  await retryJob({
    action: (input) => {
      calls.push({ method: "Jobs.Retry", input });
      return AsyncResult.ok<JobsRetryOutput>({
        job: {
          id: "job-1",
          service: "documents",
          type: "document-process",
          state: "retry",
          payload: null,
          context: jobContext,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
          tries: 3,
          maxTries: 3,
        },
      });
    },
  }, "job-1");

  deepEqual(calls, [{ method: "Jobs.Retry", input: { id: "job-1" } }]);
});

Deno.test("replayDlqJob sends id-only action input", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  await replayDlqJob({
    action: (input) => {
      calls.push({ method: "Jobs.ReplayDLQ", input });
      return AsyncResult.ok<JobsReplayDLQOutput>({
        job: {
          id: "job-1",
          service: "documents",
          type: "document-process",
          state: "retry",
          payload: null,
          context: jobContext,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
          tries: 3,
          maxTries: 3,
        },
      });
    },
  }, "job-1");

  deepEqual(calls, [{ method: "Jobs.ReplayDLQ", input: { id: "job-1" } }]);
});

Deno.test("dismissDlqJob sends id-only action input", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  await dismissDlqJob({
    action: (input) => {
      calls.push({ method: "Jobs.DismissDLQ", input });
      return AsyncResult.ok<JobsDismissDLQOutput>({
        job: {
          id: "job-1",
          service: "documents",
          type: "document-process",
          state: "dismissed",
          payload: null,
          context: jobContext,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
          tries: 3,
          maxTries: 3,
        },
      });
    },
  }, "job-1");

  deepEqual(calls, [{ method: "Jobs.DismissDLQ", input: { id: "job-1" } }]);
});
