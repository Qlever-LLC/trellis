import { Result, UnexpectedError } from "@qlever-llc/trellis-result";
import { assertEquals } from "@std/assert";

import type { Job, ServiceRegistration } from "../../packages/jobs/types.ts";
import { registerJobsRpcHandlers } from "./rpcs.ts";

function createMutableStore<TValue>(entries: Record<string, TValue>) {
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
    async put(key: string, value: TValue) {
      map.set(key, value);
      return {
        take() {
          return Result.ok(undefined).take();
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

Deno.test("registerJobsRpcHandlers mounts list/get/listServices handlers backed by KV-like stores", async () => {
  const jobsKV = createMutableStore<Job>({
    "documents.document-process.job-1": {
      id: "job-1",
      service: "documents",
      type: "document-process",
      state: "pending",
      payload: { documentId: "doc-1" },
      createdAt: "2026-03-27T12:00:00.000Z",
      updatedAt: "2026-03-27T12:00:00.000Z",
      tries: 0,
      maxTries: 5,
    },
  });
  const serviceInstancesKV = createMutableStore<ServiceRegistration>({
    "documents.instance-1": {
      service: "documents",
      instanceId: "instance-1",
      jobTypes: ["document-process"],
      registeredAt: "2026-03-27T12:00:00.000Z",
      heartbeatAt: "2026-03-27T12:01:00.000Z",
    },
  });

  const mounted = new Map<string, (input: unknown) => Promise<{ take(): unknown }>>();
  type JobsMethod = "Jobs.ListServices" | "Jobs.List" | "Jobs.Get" | "Jobs.Cancel" | "Jobs.Retry";
  const service = {
    trellis: {
      mount(method: JobsMethod, handler: (input: unknown) => Promise<unknown>) {
        mounted.set(method, async (input: unknown) => await handler(input) as { take(): unknown });
        return Promise.resolve();
      },
    },
  };

  await registerJobsRpcHandlers(service, { jobsKV, serviceInstancesKV });

  const list = (await mounted.get("Jobs.List")!({ service: "documents" })).take() as { jobs: Array<{ id: string }> };
  const get = (await mounted.get("Jobs.Get")!({ service: "documents", jobType: "document-process", id: "job-1" })).take() as { job?: { id: string } };
  const services = (await mounted.get("Jobs.ListServices")!({})).take() as { services: Array<{ name: string }> };

  assertEquals(list.jobs.map((job) => job.id), ["job-1"]);
  assertEquals(get.job?.id, "job-1");
  assertEquals(services.services.map((entry) => entry.name), ["documents"]);
});
