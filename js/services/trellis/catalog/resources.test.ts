import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Objm } from "@nats-io/obj";
import { TypedStore } from "@qlever-llc/trellis";
import { assertEquals, assertRejects } from "@std/assert";
import { NatsTest } from "../../../packages/trellis/testing/nats.ts";

import {
  getJobsQueueRequests,
  getKvResourceRequests,
  getResourcePermissionGrants,
  getStoreResourceRequests,
  getStreamResourceRequests,
  provisionContractResourceBindings,
} from "./resources.ts";

const CONTRACT = {
  format: "trellis.contract.v1",
  id: "activity@v1",
  displayName: "Activity",
  description: "Store activity entries in KV.",
  kind: "service",
  resources: {
    kv: {
      activity: {
        purpose: "Store activity entries",
      },
    },
  },
} as TrellisContractV1;

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

Deno.test("resource requests apply KV defaults", () => {
  assertEquals(getKvResourceRequests(CONTRACT), [
    {
      alias: "activity",
      purpose: "Store activity entries",
      required: true,
      history: 1,
      ttlMs: 0,
    },
  ]);
});

Deno.test("resource requests apply store defaults", () => {
  const contract = {
    ...CONTRACT,
    resources: {
      ...CONTRACT.resources,
      store: {
        uploads: {
          purpose: "Temporary uploaded files awaiting processing",
          maxObjectBytes: 100 * 1024 * 1024,
        },
      },
    },
  } as TrellisContractV1;

  assertEquals(getStoreResourceRequests(contract), [
    {
      alias: "uploads",
      purpose: "Temporary uploaded files awaiting processing",
      required: true,
      ttlMs: 0,
      maxObjectBytes: 100 * 1024 * 1024,
    },
  ]);
});

Deno.test("store resources require NATS during provisioning", async () => {
  const contract = {
    ...CONTRACT,
    resources: {
      store: {
        uploads: {
          purpose: "Temporary uploaded files awaiting processing",
        },
      },
    },
  } as TrellisContractV1;

  await assertRejects(
    () => provisionContractResourceBindings(undefined, contract, "svc_test_activity_v1"),
    Error,
    "NATS connection is required to provision store resources",
  );
});

Deno.test("resource permission grants include per-bucket JetStream subjects", () => {
  const grants = getResourcePermissionGrants({
    kv: {
      activity: {
        bucket: "svc_test_activity_v1_activity",
        history: 1,
        ttlMs: 0,
      },
    },
  });

  assertEquals(
    grants.publish.includes("$KV.svc_test_activity_v1_activity.>"),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.MSG.GET.KV_svc_test_activity_v1_activity",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.$KV.svc_test_activity_v1_activity.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.ACK.KV_svc_test_activity_v1_activity.>"),
    true,
  );
});

Deno.test("resource permission grants include store object subjects and subscribe permissions", () => {
  const grants = getResourcePermissionGrants({
    store: {
      uploads: {
        name: "svc_test_activity_v1_uploads",
        ttlMs: 0,
      },
    },
  });

  assertEquals(
    grants.publish.includes("$O.svc_test_activity_v1_uploads.C.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$O.svc_test_activity_v1_uploads.M.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.STREAM.INFO.OBJ_svc_test_activity_v1_uploads"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.STREAM.MSG.GET.OBJ_svc_test_activity_v1_uploads"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.CREATE.OBJ_svc_test_activity_v1_uploads.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.FC.OBJ_svc_test_activity_v1_uploads.>"),
    true,
  );
});

Deno.test("jobs resource requests apply queue defaults", () => {
  const contract = {
    ...CONTRACT,
    schemas: {
      Payload: { type: "object" },
    },
    resources: {
      ...CONTRACT.resources,
      jobs: {
        queues: {
          "document-process": {
            payload: { schema: "Payload" },
          },
        },
      },
    },
  } as TrellisContractV1;

  assertEquals(getJobsQueueRequests(contract), [
    {
      queueType: "document-process",
      payload: { schema: "Payload" },
      maxDeliver: 5,
      backoffMs: [5000, 30000, 120000, 600000, 1800000],
      ackWaitMs: 300000,
      progress: true,
      logs: true,
      dlq: true,
      concurrency: 1,
    },
  ]);
});

Deno.test("jobs provisioning returns queue bindings and grants worker heartbeat subjects", async () => {
  const contract = {
    ...CONTRACT,
    schemas: {
      Payload: { type: "object" },
    },
    resources: {
      jobs: {
        queues: {
          "document-process": {
            payload: { schema: "Payload" },
          },
        },
      },
    },
  } as TrellisContractV1;

  const bindings = await provisionContractResourceBindings(
    undefined,
    contract,
    "svc_test_documents_v1",
  );

  assertEquals(bindings.jobs, {
    namespace: "svc_test_documents_v1",
    queues: {
      "document-process": {
        queueType: "document-process",
        publishPrefix: "trellis.jobs.svc_test_documents_v1.document-process",
        workSubject: "trellis.work.svc_test_documents_v1.document-process",
        consumerName: "svc_test_documents_v1-document-process",
        payload: { schema: "Payload" },
        maxDeliver: 5,
        backoffMs: [5000, 30000, 120000, 600000, 1800000],
        ackWaitMs: 300000,
        progress: true,
        logs: true,
        dlq: true,
        concurrency: 1,
      },
    },
  });
  assertEquals(bindings.streams?.jobsWork, {
    name: "JOBS_WORK",
    subjects: ["trellis.work.svc_test_documents_v1.>"],
  });

  const grants = getResourcePermissionGrants(bindings);
  assertEquals(
    grants.publish.includes("trellis.jobs.workers.svc_test_documents_v1.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.CREATE.JOBS_WORK.>"),
    true,
  );
});

Deno.test("stream resource requests apply defaults", () => {
  const contract = {
    ...CONTRACT,
    resources: {
      ...CONTRACT.resources,
      streams: {
        activity: {
          purpose: "Persist activity events",
          subjects: ["events.v1.Activity.Recorded"],
        },
      },
    },
  } as TrellisContractV1;

  assertEquals(getStreamResourceRequests(contract), [
    {
      alias: "activity",
      purpose: "Persist activity events",
      required: true,
      subjects: ["events.v1.Activity.Recorded"],
    },
  ]);
});

Deno.test("stream-only contracts produce stream bindings during provisioning", async () => {
  const contract = {
    ...CONTRACT,
    resources: {
      streams: {
        activity: {
          purpose: "Persist activity events",
          subjects: ["events.v1.Activity.Recorded"],
        },
      },
    },
  } as TrellisContractV1;

  const bindings = await provisionContractResourceBindings(
    undefined,
    contract,
    "svc_test_activity_v1",
  );

  assertEquals(bindings.streams?.activity, {
    name: "svc_svc_test_activit_activity_v1_activity",
    subjects: ["events.v1.Activity.Recorded"],
  });
});

Deno.test("resource permission grants include stream subjects and JetStream controls", () => {
  const grants = getResourcePermissionGrants({
    streams: {
      activity: {
        name: "svc_svc_test_activit_activity_v1_activity",
        subjects: ["events.v1.Activity.Recorded"],
      },
    },
  });

  assertEquals(grants.publish.includes("events.v1.Activity.Recorded"), true);
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.CREATE.svc_svc_test_activit_activity_v1_activity.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.DURABLE.CREATE.svc_svc_test_activit_activity_v1_activity.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.INFO.svc_svc_test_activit_activity_v1_activity.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.MSG.NEXT.svc_svc_test_activit_activity_v1_activity.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.ACK.svc_svc_test_activit_activity_v1_activity.>",
    ),
    true,
  );
});

Deno.test({
  name: "store provisioning returns a usable bound store",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const contract = {
      ...CONTRACT,
      resources: {
        store: {
          uploads: {
            purpose: "Temporary uploaded files awaiting processing",
            ttlMs: 60_000,
            maxObjectBytes: 1024,
            maxTotalBytes: 4096,
          },
        },
      },
    } as TrellisContractV1;

    const bindings = await provisionContractResourceBindings(
      nats.nc,
      contract,
      "svc_test_activity_v1",
    );

    assertEquals(bindings.store?.uploads, {
      name: "svc_svc_test_activit_activity_v1_uploads",
      ttlMs: 60_000,
      maxObjectBytes: 1024,
      maxTotalBytes: 4096,
    });

    const opened = await TypedStore.open(nats.nc, bindings.store!.uploads.name, {
      bindOnly: true,
      ttlMs: bindings.store!.uploads.ttlMs,
      maxObjectBytes: bindings.store!.uploads.maxObjectBytes,
      maxTotalBytes: bindings.store!.uploads.maxTotalBytes,
    });
    const store = opened.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });

    const created = await store.create("incoming/test.txt", new TextEncoder().encode("hello"));
    assertEquals(created.isOk(), true);

    const entry = (await store.get("incoming/test.txt")).match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });

    const bytes = (await entry.bytes()).match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
    assertEquals(new TextDecoder().decode(bytes), "hello");
  },
});

Deno.test({
  name: "store provisioning updates existing bucket limits",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const initialContract = {
      ...CONTRACT,
      resources: {
        store: {
          uploads: {
            purpose: "Temporary uploaded files awaiting processing",
            ttlMs: 60_000,
            maxObjectBytes: 1024,
            maxTotalBytes: 4096,
          },
        },
      },
    } as TrellisContractV1;

    const updatedContract = {
      ...CONTRACT,
      resources: {
        store: {
          uploads: {
            purpose: "Temporary uploaded files awaiting processing",
            ttlMs: 120_000,
            maxObjectBytes: 1024,
            maxTotalBytes: 16_384,
          },
        },
      },
    } as TrellisContractV1;

    const initialBindings = await provisionContractResourceBindings(
      nats.nc,
      initialContract,
      "svc_test_activity_v1",
    );
    assertEquals(initialBindings.store?.uploads.maxTotalBytes, 4096);

    const updatedBindings = await provisionContractResourceBindings(
      nats.nc,
      updatedContract,
      "svc_test_activity_v1",
    );
    assertEquals(updatedBindings.store?.uploads.maxTotalBytes, 16_384);

    const objectStore = await new Objm(nats.nc).open(updatedBindings.store!.uploads.name);
    const status = await objectStore.status();
    assertEquals(status.streamInfo.config.max_bytes, 16_384);
    assertEquals(status.streamInfo.config.max_age, 120_000 * 1_000_000);
  },
});
