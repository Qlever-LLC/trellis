import { assertEquals, assertExists, assertMatch } from "@std/assert";
import type { MsgHdrs } from "@nats-io/nats-core";

import { JobCancellationToken, JobManager } from "./job-manager.ts";

type PublishedMessage = {
  subject: string;
  payload: Uint8Array;
  headers?: MsgHdrs;
};

const TRACEPARENT_PATTERN =
  /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

Deno.test("JobManager creates and publishes job context", async () => {
  const published: PublishedMessage[] = [];
  const manager = new JobManager<{ siteId: string }, { ok: boolean }>({
    nc: {
      publish(subject, payload, opts) {
        published.push({ subject, payload, headers: opts?.headers });
      },
    },
    jobs: {
      namespace: "svc",
      queues: {
        refresh: {
          queueType: "refresh",
          publishPrefix: "trellis.jobs.svc.refresh",
          workSubject: "trellis.work.svc.refresh",
          consumerName: "svc-refresh",
          payload: { schema: "RefreshPayload" },
          result: { schema: "RefreshResult" },
          maxDeliver: 3,
          backoffMs: [],
          ackWaitMs: 1_000,
          progress: false,
          logs: false,
          dlq: false,
          concurrency: 1,
        },
      },
    },
    meta: {
      nextJobId: () => "job-1",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });

  const job = await manager.create("refresh", { siteId: "site-1" });
  assertEquals(job.context.requestId.length > 0, true);
  assertMatch(job.context.traceparent, TRACEPARENT_PATTERN);
  assertEquals(job.context.traceId, job.context.traceparent.slice(3, 35));

  assertEquals(published.length, 1);
  const created = JSON.parse(
    new TextDecoder().decode(published[0].payload),
  ) as {
    context?: typeof job.context;
  };
  assertEquals(created.context, job.context);
  assertEquals(published[0].headers?.get("request-id"), job.context.requestId);
  assertEquals(
    published[0].headers?.get("traceparent"),
    job.context.traceparent,
  );

  const outcome = await manager.process(
    job,
    new JobCancellationToken(),
    async (activeJob) => {
      assertEquals(activeJob.context(), job.context);
      return { ok: true };
    },
  );

  assertEquals(outcome.outcome, "completed");
  assertEquals(published.length, 3);
  for (const message of published) {
    const event = JSON.parse(new TextDecoder().decode(message.payload)) as {
      context?: typeof job.context;
    };
    assertEquals(event.context, job.context);
    assertExists(message.headers);
    assertEquals(message.headers.get("request-id"), job.context.requestId);
    assertEquals(message.headers.get("traceparent"), job.context.traceparent);
  }
});
