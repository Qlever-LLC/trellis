import { Result, UnexpectedError } from "@qlever-llc/trellis-result";
import { assertEquals } from "@std/assert";

import { JobClient } from "./client.ts";

function createStore<TValue>(entries: Record<string, TValue>) {
  const map = new Map(Object.entries(entries));
  return {
    async get(key: string) {
      const value = map.get(key);
      return {
        take() {
          return value === undefined
            ? Result.err(new UnexpectedError({ cause: new Error(`missing key '${key}'`) })).take()
            : Result.ok({ value }).take();
        },
      };
    },
    async keys() {
      async function* iterate() {
        for (const key of map.keys()) {
          yield key;
        }
      }
      return {
        take() {
          return Result.ok(iterate()).take();
        },
      };
    },
  };
}

Deno.test("JobClient lists projected jobs and registered services from KV-like stores", async () => {
  const client = new JobClient({
    jobsKV: createStore({
      "documents.document-process.job-1": {
        id: "job-1",
        service: "documents",
        type: "document-process",
        state: "active",
        payload: { documentId: "doc-1" },
        createdAt: "2026-03-27T12:00:00.000Z",
        updatedAt: "2026-03-27T12:01:00.000Z",
        tries: 1,
        maxTries: 5,
      },
    }),
    serviceInstancesKV: createStore({
      "documents.instance-1": {
        service: "documents",
        instanceId: "instance-1",
        jobTypes: ["document-process"],
        registeredAt: "2026-03-27T12:00:00.000Z",
        heartbeatAt: "2026-03-27T12:01:00.000Z",
      },
    }),
  });

  const jobs = await client.list({ service: "documents" });
  const services = await client.listServices();

  assertEquals(jobs.map((job: { id: string }) => job.id), ["job-1"]);
  assertEquals(services[0]?.name, "documents");
  assertEquals(services[0]?.healthy, true);
});
