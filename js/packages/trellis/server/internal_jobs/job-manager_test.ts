import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertMatch,
  assertRejects,
} from "@std/assert";
import type { MsgHdrs } from "@nats-io/nats-core";
import { JobNotEnqueuedError } from "../../jobs.ts";

import {
  JobCancellationToken,
  JobManager,
  JobProcessError,
} from "./job-manager.ts";
import type { JobsBinding } from "./bindings.ts";
import type { JobKeyCoordinator } from "./key-coordinator.ts";
import type { Job, JobContext } from "./types.ts";

type PublishedMessage = {
  subject: string;
  payload: Uint8Array;
  headers?: MsgHdrs;
};

const TRACEPARENT_PATTERN =
  /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

const jobContext: JobContext = {
  requestId: "request-1",
  traceId: "0123456789abcdef0123456789abcdef",
  traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
};

function unsupportedCoordinator(): JobKeyCoordinator {
  return {
    admitCreate: () => Promise.reject(new Error("unexpected admit")),
    restoreReplacedQueuedJob: () =>
      Promise.reject(new Error("unexpected restore")),
    removeQueuedJob: () => Promise.reject(new Error("unexpected remove")),
    acquireActiveSlot: () => Promise.reject(new Error("unexpected acquire")),
    renewHeartbeat: () => Promise.reject(new Error("unexpected renew")),
    releaseActiveSlot: () => Promise.reject(new Error("unexpected release")),
  };
}

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

Deno.test("JobManager preserves structured failure error string", async () => {
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
          maxDeliver: 1,
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
      nextJobId: () => "job-structured-failure",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });
  const job = await manager.create("refresh", { siteId: "site-1" });
  const serializedError = JSON.stringify({
    id: "err-1",
    type: "AuthError",
    message: "Auth failed: forbidden",
    context: {
      jobType: "refresh",
      service: "svc",
      contractId: "jobs.test@v1",
      contractDigest: "digest-1",
      requestId: job.context.requestId,
    },
    traceId: job.context.traceId,
    reason: "forbidden",
  });

  const outcome = await manager.process(
    job,
    new JobCancellationToken(),
    async () => {
      throw JobProcessError.failed(serializedError);
    },
  );

  assertEquals(outcome.outcome, "failed");
  if (outcome.outcome !== "failed") return;
  assertEquals(JSON.parse(outcome.error), JSON.parse(serializedError));

  const failedEvent = JSON.parse(
    new TextDecoder().decode(published[published.length - 1]!.payload),
  ) as { error?: string };
  assertEquals(
    JSON.parse(failedEvent.error ?? ""),
    JSON.parse(serializedError),
  );
});

Deno.test("JobManager keyed create rejects before publishing created", async () => {
  const published: PublishedMessage[] = [];
  const coordinator: JobKeyCoordinator = {
    ...unsupportedCoordinator(),
    admitCreate: () =>
      Promise.resolve({
        kind: "rejected",
        key: "tenant-a",
        reason: "queue-depth",
        active: 0,
        queued: 1,
        limit: 1,
      }),
  };
  const manager = new JobManager<{ tenant: string }, { ok: boolean }>({
    nc: {
      publish(subject, payload, opts) {
        published.push({ subject, payload, headers: opts?.headers });
      },
    },
    jobs: {
      namespace: "svc",
      queues: {
        sync: {
          queueType: "sync",
          publishPrefix: "trellis.jobs.svc.sync",
          workSubject: "trellis.work.svc.sync",
          consumerName: "svc-sync",
          payload: { schema: "SyncPayload" },
          maxDeliver: 3,
          backoffMs: [],
          ackWaitMs: 1_000,
          progress: false,
          logs: false,
          dlq: false,
          concurrency: 1,
          keyConcurrency: {
            key: ["/tenant"],
            maxActive: 1,
            heartbeatIntervalMs: 30_000,
            heartbeatTtlMs: 120_000,
            stalePolicy: "fail-stale",
          },
          queue: { maxQueuedPerKey: 0, whenFull: "reject" },
        },
      },
    },
    keyCoordinator: coordinator,
    meta: {
      nextJobId: () => "job-1",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });

  const error = await assertRejects(
    () => manager.create("sync", { tenant: "a" }),
    JobNotEnqueuedError,
  );
  assertInstanceOf(error, JobNotEnqueuedError);
  assertEquals(error.reason, "queue-depth");
  assertEquals(published.length, 0);
});

Deno.test("JobManager submit returns keyed policy outcomes", async () => {
  const published: PublishedMessage[] = [];
  const outcomes = [
    "accepted",
    "rejected",
    "coalesced",
    "replaced",
  ] as const;
  let outcomeIndex = 0;
  const coordinator: JobKeyCoordinator = {
    ...unsupportedCoordinator(),
    admitCreate: (request) => {
      const outcome = outcomes[outcomeIndex++] ?? "accepted";
      if (outcome === "rejected") {
        return Promise.resolve({
          kind: "rejected",
          key: "tenant-a",
          reason: "active-limit",
          active: 1,
          queued: 0,
          limit: 1,
        });
      }
      if (outcome === "coalesced") {
        return Promise.resolve({
          kind: "coalesced",
          key: "tenant-a",
          existing: { service: "svc", jobType: "sync", id: "job-existing" },
          reason: "active-limit",
        });
      }
      if (outcome === "replaced") {
        return Promise.resolve({
          kind: "replaced",
          key: "tenant-a",
          keyHash: "hash",
          replaced: {
            service: "svc",
            jobType: "sync",
            id: "job-old",
            createdAt: request.createdAt,
            requestId: request.context.requestId,
            context: request.context,
          },
          state: {
            version: 1,
            service: "svc",
            jobType: "sync",
            key: "tenant-a",
            keyHash: "hash",
            maxActive: 1,
            active: [],
            queued: [],
            staleTakeoverCount: 0,
            updatedAt: request.createdAt,
          },
        });
      }
      return Promise.resolve({
        kind: "accepted",
        key: "tenant-a",
        keyHash: "hash",
        state: {
          version: 1,
          service: "svc",
          jobType: "sync",
          key: "tenant-a",
          keyHash: "hash",
          maxActive: 1,
          active: [],
          queued: [],
          staleTakeoverCount: 0,
          updatedAt: request.createdAt,
        },
      });
    },
  };
  let id = 0;
  const manager = new JobManager<{ tenant: string }, { ok: boolean }>({
    nc: {
      publish(subject, payload, opts) {
        published.push({ subject, payload, headers: opts?.headers });
      },
    },
    jobs: keyedJobsBinding(),
    keyCoordinator: coordinator,
    meta: {
      nextJobId: () => `job-${++id}`,
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });

  assertEquals(
    (await manager.submit("sync", { tenant: "a" })).kind,
    "accepted",
  );
  assertEquals(
    (await manager.submit("sync", { tenant: "a" })).kind,
    "rejected",
  );
  assertEquals(
    (await manager.submit("sync", { tenant: "a" })).kind,
    "coalesced",
  );
  const replaced = await manager.submit("sync", { tenant: "a" });
  assertEquals(replaced.kind, "replaced");
  const eventTypes = published.map((message) =>
    (JSON.parse(new TextDecoder().decode(message.payload)) as {
      eventType: string;
    })
      .eventType
  );
  assertEquals(eventTypes, ["created", "skipped", "created"]);
});

Deno.test("JobManager create rejects coalesce and replace-oldest policy outcomes", async () => {
  const outcomes = ["coalesced", "replaced"] as const;
  let outcomeIndex = 0;
  let restored = 0;
  const coordinator: JobKeyCoordinator = {
    ...unsupportedCoordinator(),
    restoreReplacedQueuedJob: () => {
      restored += 1;
      return Promise.resolve({ kind: "restored", state: emptyKeyState() });
    },
    admitCreate: (request) => {
      const outcome = outcomes[outcomeIndex++];
      if (outcome === "replaced") {
        return Promise.resolve({
          kind: "replaced",
          key: "tenant-a",
          keyHash: "hash",
          replaced: {
            service: "svc",
            jobType: "sync",
            id: "job-old",
            createdAt: request.createdAt,
            requestId: request.context.requestId,
            context: request.context,
          },
          state: emptyKeyState(),
        });
      }
      return Promise.resolve({
        kind: "coalesced",
        key: "tenant-a",
        existing: { service: "svc", jobType: "sync", id: "job-existing" },
        reason: "active-limit",
      });
    },
  };
  const manager = new JobManager<{ tenant: string }, { ok: boolean }>({
    nc: { publish: () => {} },
    jobs: keyedJobsBinding(),
    keyCoordinator: coordinator,
    meta: {
      nextJobId: () => "job-new",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });

  const coalesced = await assertRejects(
    () => manager.create("sync", { tenant: "a" }),
    JobNotEnqueuedError,
  );
  assertEquals(coalesced.reason, "coalesced");

  const replaced = await assertRejects(
    () => manager.create("sync", { tenant: "a" }),
    JobNotEnqueuedError,
  );
  assertEquals(replaced.reason, "queue-depth");
  assertEquals(restored, 1);
});

Deno.test("JobManager restores replaced queued reservation when skipped publish fails", async () => {
  let restored = 0;
  const coordinator: JobKeyCoordinator = {
    ...unsupportedCoordinator(),
    admitCreate: (request) =>
      Promise.resolve({
        kind: "replaced",
        key: "tenant-a",
        keyHash: "hash",
        replaced: {
          service: "svc",
          jobType: "sync",
          id: "job-old",
          createdAt: "2024-01-01T00:00:00.000Z",
          requestId: request.context.requestId,
          context: request.context,
        },
        state: emptyKeyState(),
      }),
    restoreReplacedQueuedJob: (args) => {
      restored += 1;
      assertEquals(args.replacementJobId, "job-new");
      assertEquals(args.replaced.id, "job-old");
      return Promise.resolve({ kind: "restored", state: emptyKeyState() });
    },
  };
  const manager = new JobManager<{ tenant: string }, { ok: boolean }>({
    nc: {
      publish(subject) {
        if (subject.endsWith(".skipped")) {
          throw new Error("skipped publish failed");
        }
      },
    },
    jobs: keyedJobsBinding(),
    keyCoordinator: coordinator,
    meta: {
      nextJobId: () => "job-new",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });

  await assertRejects(
    () => manager.submit("sync", { tenant: "a" }),
    Error,
    "skipped publish failed",
  );
  assertEquals(restored, 1);
});

Deno.test("JobManager removes queued reservation when created publish fails", async () => {
  let removed = 0;
  const coordinator: JobKeyCoordinator = {
    ...unsupportedCoordinator(),
    admitCreate: (request) =>
      Promise.resolve({
        kind: "accepted",
        key: "tenant-a",
        keyHash: "hash",
        state: { ...emptyKeyState(), updatedAt: request.createdAt },
      }),
    removeQueuedJob: () => {
      removed += 1;
      return Promise.resolve({ kind: "removed", state: emptyKeyState() });
    },
  };
  const manager = new JobManager<{ tenant: string }, { ok: boolean }>({
    nc: {
      publish() {
        throw new Error("publish failed");
      },
    },
    jobs: keyedJobsBinding(),
    keyCoordinator: coordinator,
    meta: {
      nextJobId: () => "job-1",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });

  await assertRejects(
    () => manager.submit("sync", { tenant: "a" }),
    Error,
    "publish failed",
  );
  assertEquals(removed, 1);
});

Deno.test("JobManager keyed process acquires renews and releases slot", async () => {
  const published: PublishedMessage[] = [];
  let renewed = 0;
  let released = 0;
  const coordinator: JobKeyCoordinator = {
    ...unsupportedCoordinator(),
    acquireActiveSlot: () =>
      Promise.resolve({
        kind: "acquired",
        key: "tenant-a",
        keyHash: "hash",
        slotToken: "slot-1",
        stale: [],
        state: emptyKeyState(),
      }),
    renewHeartbeat: () => {
      renewed += 1;
      return Promise.resolve({ kind: "renewed", state: emptyKeyState() });
    },
    releaseActiveSlot: () => {
      released += 1;
      return Promise.resolve({ kind: "released", state: emptyKeyState() });
    },
  };
  const manager = new JobManager<{ tenant: string }, { ok: boolean }>({
    nc: {
      publish(subject, payload, opts) {
        published.push({ subject, payload, headers: opts?.headers });
      },
    },
    jobs: keyedJobsBinding(),
    keyCoordinator: coordinator,
    meta: {
      nextJobId: () => "unused",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });
  let jetstreamHeartbeats = 0;

  const outcome = await manager.processWithHeartbeat(
    keyedJob(),
    new JobCancellationToken(),
    () => {
      jetstreamHeartbeats += 1;
      return Promise.resolve();
    },
    async (job) => {
      await job.heartbeat();
      return { ok: true };
    },
    { instanceId: "worker-1" },
  );

  assertEquals(outcome.outcome, "completed");
  assertEquals(jetstreamHeartbeats, 1);
  assertEquals(renewed, 1);
  assertEquals(released, 1);
  assertEquals(published.map(eventType), ["started", "completed"]);
});

Deno.test("JobManager releases acquired slot when stale publish fails before handler", async () => {
  let released = 0;
  let handlerRan = false;
  const coordinator: JobKeyCoordinator = {
    ...unsupportedCoordinator(),
    acquireActiveSlot: () =>
      Promise.resolve({
        kind: "acquired",
        key: "tenant-a",
        keyHash: "hash",
        slotToken: "slot-1",
        stale: [{
          jobId: "job-stale",
          slotToken: "slot-stale",
          instanceId: "worker-old",
          startedAt: "2024-01-01T00:00:00.000Z",
          heartbeatAt: "2024-01-01T00:00:00.000Z",
          leaseExpiresAt: "2024-01-01T00:00:01.000Z",
          tries: 1,
          context: jobContext,
        }],
        state: emptyKeyState(),
      }),
    releaseActiveSlot: () => {
      released += 1;
      return Promise.resolve({ kind: "released", state: emptyKeyState() });
    },
  };
  const manager = new JobManager<{ tenant: string }, { ok: boolean }>({
    nc: {
      publish(subject) {
        if (subject.endsWith(".stale")) {
          throw new Error("stale publish failed");
        }
      },
    },
    jobs: keyedJobsBinding(),
    keyCoordinator: coordinator,
    meta: {
      nextJobId: () => "unused",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });

  await assertRejects(
    () =>
      manager.processWithHeartbeat(
        keyedJob(),
        new JobCancellationToken(),
        () => Promise.resolve(),
        () => {
          handlerRan = true;
          return Promise.resolve({ ok: true });
        },
        { instanceId: "worker-1" },
      ),
    Error,
    "stale publish failed",
  );
  assertEquals(released, 1);
  assertEquals(handlerRan, false);
});

Deno.test("JobManager releases acquired slot when started publish fails before handler", async () => {
  let released = 0;
  let handlerRan = false;
  const coordinator: JobKeyCoordinator = {
    ...unsupportedCoordinator(),
    acquireActiveSlot: () =>
      Promise.resolve({
        kind: "acquired",
        key: "tenant-a",
        keyHash: "hash",
        slotToken: "slot-1",
        stale: [],
        state: emptyKeyState(),
      }),
    releaseActiveSlot: () => {
      released += 1;
      return Promise.resolve({ kind: "released", state: emptyKeyState() });
    },
  };
  const manager = new JobManager<{ tenant: string }, { ok: boolean }>({
    nc: {
      publish(subject) {
        if (subject.endsWith(".started")) {
          throw new Error("started publish failed");
        }
      },
    },
    jobs: keyedJobsBinding(),
    keyCoordinator: coordinator,
    meta: {
      nextJobId: () => "unused",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });

  await assertRejects(
    () =>
      manager.processWithHeartbeat(
        keyedJob(),
        new JobCancellationToken(),
        () => Promise.resolve(),
        () => {
          handlerRan = true;
          return Promise.resolve({ ok: true });
        },
        { instanceId: "worker-1" },
      ),
    Error,
    "started publish failed",
  );
  assertEquals(released, 1);
  assertEquals(handlerRan, false);
});

Deno.test("JobManager publishes staleCompletionIgnored when slot is lost", async () => {
  const published: PublishedMessage[] = [];
  const coordinator: JobKeyCoordinator = {
    ...unsupportedCoordinator(),
    acquireActiveSlot: () =>
      Promise.resolve({
        kind: "acquired",
        key: "tenant-a",
        keyHash: "hash",
        slotToken: "slot-1",
        stale: [],
        state: emptyKeyState(),
      }),
    releaseActiveSlot: () => Promise.resolve({ kind: "staleCompletion" }),
  };
  const manager = new JobManager<{ tenant: string }, { ok: boolean }>({
    nc: {
      publish(subject, payload, opts) {
        published.push({ subject, payload, headers: opts?.headers });
      },
    },
    jobs: keyedJobsBinding(),
    keyCoordinator: coordinator,
    meta: {
      nextJobId: () => "unused",
      nowIso: () => "2024-01-01T00:00:00.000Z",
    },
  });

  const outcome = await manager.processWithHeartbeat(
    keyedJob(),
    new JobCancellationToken(),
    () => Promise.resolve(),
    () => Promise.resolve({ ok: true }),
    { instanceId: "worker-1" },
  );

  assertEquals(outcome.outcome, "stale_completion_ignored");
  assertEquals(published.map(eventType), ["started", "staleCompletionIgnored"]);
});

function keyedJobsBinding(): JobsBinding {
  return {
    namespace: "svc",
    queues: {
      sync: {
        queueType: "sync",
        publishPrefix: "trellis.jobs.svc.sync",
        workSubject: "trellis.work.svc.sync",
        consumerName: "svc-sync",
        payload: { schema: "SyncPayload" },
        maxDeliver: 3,
        backoffMs: [],
        ackWaitMs: 1_000,
        progress: false,
        logs: false,
        dlq: false,
        concurrency: 1,
        keyConcurrency: {
          key: ["/tenant"],
          maxActive: 1,
          heartbeatIntervalMs: 30_000,
          heartbeatTtlMs: 120_000,
          stalePolicy: "fail-stale",
        },
        queue: { maxQueuedPerKey: 0, whenFull: "reject" },
      },
    },
  };
}

function keyedJob(): Job<{ tenant: string }, { ok: boolean }> {
  return {
    id: "job-1",
    service: "svc",
    type: "sync",
    state: "pending",
    context: jobContext,
    payload: { tenant: "a" },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    tries: 0,
    maxTries: 3,
  };
}

function emptyKeyState() {
  return {
    version: 1 as const,
    service: "svc",
    jobType: "sync",
    key: "tenant-a",
    keyHash: "hash",
    maxActive: 1,
    active: [],
    queued: [],
    staleTakeoverCount: 0,
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function eventType(message: PublishedMessage): string {
  return (JSON.parse(new TextDecoder().decode(message.payload)) as {
    eventType: string;
  }).eventType;
}
