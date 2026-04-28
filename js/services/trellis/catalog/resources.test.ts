import { jetstreamManager } from "@nats-io/jetstream";
import { Kvm } from "@nats-io/kv";
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
  provisionContractResourceBindings,
  reconcileKvResourceConfig,
} from "./resources.ts";

const CONTRACT = {
  format: "trellis.contract.v1",
  id: "activity@v1",
  displayName: "Activity",
  description: "Store activity entries in KV.",
  kind: "service",
  schemas: {
    ActivityEntry: { type: "object" },
  },
  resources: {
    kv: {
      activity: {
        purpose: "Store activity entries",
        schema: { schema: "ActivityEntry" },
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

Deno.test("resource requests apply store defaults and omit unenforced object limits", () => {
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
    () =>
      provisionContractResourceBindings(
        undefined,
        contract,
        "activity.default",
      ),
    Error,
    "NATS connection is required to provision store resources",
  );
});

Deno.test("optional resources do not require NATS and do not create bindings", async () => {
  const contract = {
    ...CONTRACT,
    resources: {
      kv: {
        activity: {
          purpose: "Store activity entries",
          schema: { schema: "ActivityEntry" },
          required: false,
        },
      },
      store: {
        uploads: {
          purpose: "Temporary uploaded files awaiting processing",
          required: false,
        },
      },
    },
  } as TrellisContractV1;

  assertEquals(
    await provisionContractResourceBindings(
      undefined,
      contract,
      "activity.default",
    ),
    {},
  );
});

Deno.test("required resources still require NATS when optional resources are present", async () => {
  const contract = {
    ...CONTRACT,
    resources: {
      kv: {
        activity: {
          purpose: "Store activity entries",
          schema: { schema: "ActivityEntry" },
          required: false,
        },
      },
      store: {
        uploads: {
          purpose: "Temporary uploaded files awaiting processing",
          required: true,
        },
      },
    },
  } as TrellisContractV1;

  await assertRejects(
    () =>
      provisionContractResourceBindings(
        undefined,
        contract,
        "activity.default",
      ),
    Error,
    "NATS connection is required to provision store resources",
  );
});

Deno.test("resource permission grants include only bound KV usage subjects", () => {
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
    grants.publish.includes("$JS.API.INFO"),
    true,
  );
  assertEquals(
    grants.publish.includes("$KV.svc_test_activity_v1_activity.>"),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.INFO.KV_svc_test_activity_v1_activity",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.CREATE.KV_svc_test_activity_v1_activity",
    ),
    false,
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
  // KV watches in the current NATS client create and delete ephemeral consumers.
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.CREATE.KV_svc_test_activity_v1_activity.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.DURABLE.CREATE.KV_svc_test_activity_v1_activity.>",
    ),
    false,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.DELETE.KV_svc_test_activity_v1_activity.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.ACK.KV_svc_test_activity_v1_activity.>"),
    true,
  );
});

Deno.test("KV reconciliation updates existing bucket limits", async () => {
  const updates: Array<
    {
      name: string;
      config: {
        max_msgs_per_subject: number;
        max_age: number;
        max_msg_size: number;
      };
    }
  > = [];

  await reconcileKvResourceConfig(
    {
      update(name, config) {
        updates.push({
          name,
          config: {
            max_msgs_per_subject: config.max_msgs_per_subject,
            max_age: config.max_age,
            max_msg_size: config.max_msg_size,
          },
        });
        return Promise.resolve();
      },
    },
    {
      streamInfo: {
        config: {
          name: "KV_activity",
          subjects: ["$KV.activity.>"],
          retention: "limits",
          max_consumers: -1,
          max_msgs_per_subject: 1,
          max_msgs: -1,
          max_age: 0,
          max_bytes: -1,
          max_msg_size: -1,
          storage: "file",
          discard: "old",
          num_replicas: 1,
          duplicate_window: 0,
          sealed: false,
          deny_delete: true,
          deny_purge: false,
          allow_rollup_hdrs: true,
          allow_direct: false,
          mirror_direct: false,
          discard_new_per_subject: false,
          first_seq: 0,
          allow_msg_ttl: false,
          allow_msg_counter: false,
          allow_msg_schedules: false,
          allow_atomic: false,
          persist_mode: "default",
        },
      },
    },
    { history: 3, ttlMs: 60_000, maxValueBytes: 1024 },
  );

  assertEquals(updates, [{
    name: "KV_activity",
    config: {
      max_msgs_per_subject: 3,
      max_age: 60_000 * 1_000_000,
      max_msg_size: 1024,
    },
  }]);
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
    grants.publish.includes(
      "$JS.API.STREAM.INFO.OBJ_svc_test_activity_v1_uploads",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.CREATE.OBJ_svc_test_activity_v1_uploads",
    ),
    false,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.MSG.GET.OBJ_svc_test_activity_v1_uploads",
    ),
    true,
  );
  // Object store mutations use purge and ephemeral consumers through the NATS client.
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.PURGE.OBJ_svc_test_activity_v1_uploads",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.CREATE.OBJ_svc_test_activity_v1_uploads.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.DELETE.OBJ_svc_test_activity_v1_uploads.>",
    ),
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
    resources: {},
    jobs: {
      "document-process": {
        payload: { schema: "Payload" },
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

Deno.test("jobs provisioning requires NATS", async () => {
  const contract = {
    ...CONTRACT,
    schemas: {
      Payload: { type: "object" },
    },
    resources: {},
    jobs: {
      "document-process": {
        payload: { schema: "Payload" },
      },
    },
  } as TrellisContractV1;

  await assertRejects(
    () =>
      provisionContractResourceBindings(
        undefined,
        contract,
        "documents.default",
      ),
    Error,
    "NATS connection is required to provision jobs resources",
  );
});

Deno.test("jobs resource grants use service-visible queue bindings", () => {
  const grants = getResourcePermissionGrants({
    jobs: {
      namespace: "document_activity_25c0dcc8dbcd",
      workStream: "JOBS_WORK",
      queues: {
        "document-process": {
          queueType: "document-process",
          publishPrefix:
            "trellis.jobs.document_activity_25c0dcc8dbcd.document-process",
          workSubject:
            "trellis.work.document_activity_25c0dcc8dbcd.document-process",
          consumerName: "document_activity_25c0dcc8dbcd-document-process",
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
    },
  });
  assertEquals(
    grants.publish.includes(
      "trellis.jobs.workers.document_activity_25c0dcc8dbcd.>",
    ),
    true,
  );
  assertEquals(
    grants.subscribe.includes(
      "trellis.jobs.document_activity_25c0dcc8dbcd.document-process.*.cancelled",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.DURABLE.CREATE.JOBS_WORK.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.CREATE.JOBS_WORK.>"),
    false,
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
      "activity.default",
    );

    assertEquals(bindings.store?.uploads, {
      name: "svc_activity_def_activity_v1_uploads_4d0bbccb282e",
      ttlMs: 60_000,
      maxTotalBytes: 4096,
    });

    const opened = await TypedStore.open(
      nats.nc,
      bindings.store!.uploads.name,
      {
        bindOnly: true,
        ttlMs: bindings.store!.uploads.ttlMs,
        maxTotalBytes: bindings.store!.uploads.maxTotalBytes,
      },
    );
    const store = opened.match({
      ok: (value: TypedStore) => value,
      err: (error: Error) => {
        throw error;
      },
    });

    const created = await store.create(
      "incoming/test.txt",
      new TextEncoder().encode("hello"),
    );
    assertEquals(created.isOk(), true);

    const entry = await store.get("incoming/test.txt").match({
      ok: (value) => value,
      err: (error: Error) => {
        throw error;
      },
    });

    const bytes = await entry.bytes().match({
      ok: (value) => value,
      err: (error: Error) => {
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
      "activity.default",
    );
    assertEquals(initialBindings.store?.uploads.maxTotalBytes, 4096);

    const updatedBindings = await provisionContractResourceBindings(
      nats.nc,
      updatedContract,
      "activity.default",
    );
    assertEquals(updatedBindings.store?.uploads.maxTotalBytes, 16_384);

    const objectStore = await new Objm(nats.nc).open(
      updatedBindings.store!.uploads.name,
    );
    const status = await objectStore.status();
    assertEquals(status.streamInfo.config.max_bytes, 16_384);
    assertEquals(status.streamInfo.config.max_age, 120_000 * 1_000_000);
  },
});

Deno.test({
  name: "jobs provisioning creates shared built-in jobs resources",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const contract = {
      ...CONTRACT,
      schemas: {
        Payload: { type: "object" },
      },
      resources: {},
      jobs: {
        "document-process": {
          payload: { schema: "Payload" },
        },
      },
    } as TrellisContractV1;

    await provisionContractResourceBindings(
      nats.nc,
      contract,
      "documents.default",
    );

    const jsm = await jetstreamManager(nats.nc);
    const jobs = await jsm.streams.info("JOBS");
    const jobsWork = await jsm.streams.info("JOBS_WORK");
    const jobsAdvisories = await jsm.streams.info("JOBS_ADVISORIES");
    const jobsState = await new Kvm(nats.nc).open("trellis_jobs");
    const jobsStateStatus = await jobsState.status();

    assertEquals(jobs.config.subjects, ["trellis.jobs.>"]);
    assertEquals(jobs.config.retention, "limits");
    assertEquals(jobsWork.config.subjects, ["trellis.work.>"]);
    assertEquals(jobsWork.config.retention, "workqueue");
    assertEquals(Array.isArray(jobsWork.config.sources), true);
    assertEquals(jobsAdvisories.config.subjects, [
      "$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>",
    ]);
    assertEquals(jobsStateStatus.bucket, "trellis_jobs");
  },
});
