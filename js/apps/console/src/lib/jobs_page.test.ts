import { AsyncResult, UnexpectedError } from "@qlever-llc/result";
import { deepEqual } from "node:assert/strict";
import type { JobFilter } from "@qlever-llc/trellis";

import { loadJobsPageData } from "./jobs_page.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

Deno.test("loadJobsPageData requests jobs and services with the provided filter", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const data = await loadJobsPageData({
    jobs() {
      return {
        listServices() {
          calls.push({ method: "Jobs.ListServices", input: {} });
          return AsyncResult.ok([{ name: "documents", healthy: true, workers: [] }]);
        },
        list(filter?: JobFilter) {
          calls.push({ method: "Jobs.List", input: filter ?? {} });
          return AsyncResult.ok([
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
          ]);
        },
      };
    },
  }, { service: "documents", state: "pending" });

  deepEqual(calls, [
    { method: "Jobs.ListServices", input: {} },
    { method: "Jobs.List", input: { service: "documents", state: "pending" } },
  ]);
  deepEqual(data.services[0]?.name, "documents");
  deepEqual(data.jobs[0]?.id, "job-1");
});

Deno.test("loadJobsPageData reports jobs service as unavailable when Jobs RPCs have no responders", async () => {
  const data = await loadJobsPageData({
    jobs() {
      return {
        listServices() {
          return AsyncResult.err(new UnexpectedError({ cause: new Error("No responders available for request") }));
        },
        list() {
          return AsyncResult.ok([]);
        },
      };
    },
  });

  deepEqual(data.available, false);
  deepEqual(
    data.message,
    "Jobs service is not installed or not currently reachable.",
  );
  deepEqual(data.jobs, []);
  deepEqual(data.services, []);
});

Deno.test("loadJobsPageData reports missing Jobs permissions with re-auth guidance", async () => {
  const data = await loadJobsPageData({
    jobs() {
      return {
        listServices() {
          return AsyncResult.err(new UnexpectedError({ cause: new Error('Permissions Violation for Publish to "rpc.v1.Jobs.ListServices"') }));
        },
        list() {
          return AsyncResult.ok([]);
        },
      };
    },
  });

  deepEqual(data.available, false);
  deepEqual(
    data.message,
    "Your current session is not approved for Jobs RPCs. Sign out and sign back in to refresh permissions.",
  );
  deepEqual(data.jobs, []);
  deepEqual(data.services, []);
});
