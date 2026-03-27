import { assertEquals } from "@std/assert";

import { loadJobsPageData } from "./jobs_page.ts";

Deno.test("loadJobsPageData requests jobs and services with the provided filter", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const data = await loadJobsPageData({
    requestOrThrow(method: string, input: unknown) {
      calls.push({ method, input });
      if (method === "Jobs.ListServices") {
        return Promise.resolve({ services: [{ name: "documents", healthy: true, instances: [] }] });
      }
      return Promise.resolve({ jobs: [{ id: "job-1", service: "documents", type: "document-process", state: "pending" }] });
    },
  }, { service: "documents", state: "pending" });

  assertEquals(calls, [
    { method: "Jobs.ListServices", input: {} },
    { method: "Jobs.List", input: { service: "documents", state: "pending" } },
  ]);
  assertEquals(data.services[0]?.name, "documents");
  assertEquals(data.jobs[0]?.id, "job-1");
});
