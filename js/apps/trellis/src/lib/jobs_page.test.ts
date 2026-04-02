import { Result, UnexpectedError } from "@qlever-llc/trellis-result";
import { assertEquals } from "@std/assert";

import { loadJobsPageData } from "./jobs_page.ts";

Deno.test("loadJobsPageData requests jobs and services with the provided filter", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const data = await loadJobsPageData({
    request(method: string, input: unknown) {
      calls.push({ method, input });
      if (method === "Jobs.ListServices") {
        return Promise.resolve(Result.ok({ services: [{ name: "documents", healthy: true, workers: [] }] }));
      }
      return Promise.resolve(Result.ok({ jobs: [{ id: "job-1", service: "documents", type: "document-process", state: "pending" }] }));
    },
  }, { service: "documents", state: "pending" });

  assertEquals(calls, [
    { method: "Jobs.ListServices", input: {} },
    { method: "Jobs.List", input: { service: "documents", state: "pending" } },
  ]);
  assertEquals(data.services[0]?.name, "documents");
  assertEquals(data.jobs[0]?.id, "job-1");
});

Deno.test("loadJobsPageData reports jobs service as unavailable when Jobs RPCs have no responders", async () => {
  const data = await loadJobsPageData({
    request() {
      return Promise.resolve(Result.err(new UnexpectedError({ cause: new Error("No responders available for request") })));
    },
  });

  assertEquals(data.available, false);
  assertEquals(
    data.message,
    "Jobs service is not installed or not currently reachable.",
  );
  assertEquals(data.jobs, []);
  assertEquals(data.services, []);
});

Deno.test("loadJobsPageData reports missing Jobs permissions with re-auth guidance", async () => {
  const data = await loadJobsPageData({
    request() {
      return Promise.resolve(Result.err(new UnexpectedError({ cause: new Error('Permissions Violation for Publish to "rpc.v1.Jobs.ListServices"') })));
    },
  });

  assertEquals(data.available, false);
  assertEquals(
    data.message,
    "Your current session is not approved for Jobs RPCs. Sign out and sign back in to refresh permissions.",
  );
  assertEquals(data.jobs, []);
  assertEquals(data.services, []);
});
