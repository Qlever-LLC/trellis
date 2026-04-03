import { assertEquals, assertRejects } from "@std/assert";

import {
  newWorkerHeartbeat,
  publishWorkerHeartbeat,
  startWorkerHeartbeatLoop,
  workerHeartbeatSubject,
} from "./heartbeat.ts";

Deno.test("workerHeartbeatSubject derives sibling jobs-subsystem subject", () => {
  assertEquals(
    workerHeartbeatSubject("documents", "document-process", "instance-1"),
    "trellis.jobs.workers.documents.document-process.instance-1.heartbeat",
  );
});

Deno.test("newWorkerHeartbeat includes concurrency and version when present", () => {
  assertEquals(newWorkerHeartbeat({
    service: "documents",
    jobType: "document-process",
    instanceId: "instance-1",
    concurrency: 3,
    version: "1.2.3",
    timestamp: "2026-03-28T12:00:00.000Z",
  }), {
    service: "documents",
    jobType: "document-process",
    instanceId: "instance-1",
    concurrency: 3,
    version: "1.2.3",
    timestamp: "2026-03-28T12:00:00.000Z",
  });
});

Deno.test("publishWorkerHeartbeat publishes encoded heartbeat payload", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];

  await publishWorkerHeartbeat({
    publish(subject: string, payload: Uint8Array) {
      published.push({ subject, payload: JSON.parse(new TextDecoder().decode(payload)) });
    },
  }, {
    service: "documents",
    jobType: "document-process",
    instanceId: "instance-1",
    timestamp: "2026-03-28T12:00:00.000Z",
  });

  assertEquals(published, [{
    subject: "trellis.jobs.workers.documents.document-process.instance-1.heartbeat",
    payload: {
      service: "documents",
      jobType: "document-process",
      instanceId: "instance-1",
      timestamp: "2026-03-28T12:00:00.000Z",
    },
  }]);
});

Deno.test("startWorkerHeartbeatLoop publishes immediately and on interval", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
  let tick = 0;
  const loop = await startWorkerHeartbeatLoop({
    publisher: {
      publish(subject: string, payload: Uint8Array) {
        published.push({ subject, payload: JSON.parse(new TextDecoder().decode(payload)) });
      },
    },
    service: "documents",
    jobType: "document-process",
    instanceId: "instance-1",
    concurrency: 2,
    version: "1.2.3",
    intervalMs: 5,
    nowIso: () => `2026-03-28T12:00:0${tick++}.000Z`,
  });

  await new Promise((resolve) => setTimeout(resolve, 15));
  await loop.stop();

  assertEquals(published[0], {
    subject: "trellis.jobs.workers.documents.document-process.instance-1.heartbeat",
    payload: {
      service: "documents",
      jobType: "document-process",
      instanceId: "instance-1",
      concurrency: 2,
      version: "1.2.3",
      timestamp: "2026-03-28T12:00:00.000Z",
    },
  });
  assertEquals(published.length >= 2, true);
});

Deno.test("startWorkerHeartbeatLoop surfaces background publish failures on stop", async () => {
  let publishes = 0;
  const loop = await startWorkerHeartbeatLoop({
    publisher: {
      publish() {
        publishes += 1;
        if (publishes > 1) {
          throw new Error("heartbeat publish failed");
        }
      },
    },
    service: "documents",
    jobType: "document-process",
    instanceId: "instance-1",
    intervalMs: 5,
    nowIso: () => "2026-03-28T12:00:00.000Z",
  });

  await new Promise((resolve) => setTimeout(resolve, 15));
  await assertRejects(
    () => loop.stop(),
    Error,
    "worker heartbeat loop failed",
  );
});
