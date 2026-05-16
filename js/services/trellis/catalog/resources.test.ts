import { jetstreamManager } from "@nats-io/jetstream";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Objm } from "@nats-io/obj";
import { TypedStore } from "@qlever-llc/trellis";
import { assertEquals, assertRejects } from "@std/assert";
import { NatsTest } from "../../../packages/trellis/testing/nats.ts";
import { CONTRACT as TRELLIS_JOBS_CONTRACT } from "#trellis-generated-sdk/jobs";

import {
  getJobsQueueRequests,
  getKvResourceRequests,
  getResourcePermissionGrants,
  getStoreResourceRequests,
  provisionContractResourceBindings,
  purgeContractResourceBindings,
  reconcileKvResourceConfig,
  reconcileStoreResourceConfig,
  type ResourcePurgeManager,
} from "./resources.ts";

const CONTRACT = {
  format: "trellis.contract.v1",
  id: "audit@v1",
  displayName: "Audit",
  description: "Store audit entries in KV.",
  kind: "service",
  schemas: {
    AuditEntry: { type: "object" },
  },
  resources: {
    kv: {
      audit: {
        purpose: "Store audit entries",
        schema: { schema: "AuditEntry" },
      },
    },
  },
} as TrellisContractV1;

function isEnvFlagEnabled(name: string): boolean {
  try {
    return Deno.env.get(name) === "1";
  } catch {
    return false;
  }
}

const RUN_NATS_TESTS = isEnvFlagEnabled("TRELLIS_TEST_NATS");

Deno.test("resource requests apply KV defaults", () => {
  assertEquals(getKvResourceRequests(CONTRACT), [
    {
      alias: "audit",
      purpose: "Store audit entries",
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
        "audit.default",
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
        audit: {
          purpose: "Store audit entries",
          schema: { schema: "AuditEntry" },
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
      "audit.default",
    ),
    {},
  );
});

Deno.test("resource purge deletes bound KV buckets and object stores", async () => {
  const deletedKvBuckets: string[] = [];
  const deletedObjectStores: string[] = [];
  const manager: ResourcePurgeManager = {
    async deleteKvBucket(bucket) {
      deletedKvBuckets.push(bucket);
    },
    async deleteObjectStore(name) {
      deletedObjectStores.push(name);
    },
  };

  await purgeContractResourceBindings([
    {
      kv: {
        cache: { bucket: "svc_billing_cache", history: 1, ttlMs: 0 },
        state: { bucket: "svc_billing_state", history: 3, ttlMs: 1000 },
      },
      store: {
        uploads: { name: "svc_billing_uploads", ttlMs: 0 },
      },
    },
    {
      kv: {
        audit: { bucket: "svc_billing_audit", history: 1, ttlMs: 0 },
      },
      store: {
        exports: { name: "svc_billing_exports", ttlMs: 60_000 },
      },
    },
  ], manager);

  assertEquals(deletedKvBuckets, [
    "svc_billing_cache",
    "svc_billing_state",
    "svc_billing_audit",
  ]);
  assertEquals(deletedObjectStores, [
    "svc_billing_uploads",
    "svc_billing_exports",
  ]);
});

Deno.test("resource purge deletes duplicate physical resources once", async () => {
  const deletedKvBuckets: string[] = [];
  const deletedObjectStores: string[] = [];
  const manager: ResourcePurgeManager = {
    async deleteKvBucket(bucket) {
      deletedKvBuckets.push(bucket);
    },
    async deleteObjectStore(name) {
      deletedObjectStores.push(name);
    },
  };

  await purgeContractResourceBindings([
    {
      kv: {
        cache: { bucket: "svc_billing_shared", history: 1, ttlMs: 0 },
        state: { bucket: "svc_billing_shared", history: 3, ttlMs: 1000 },
      },
      store: {
        uploads: { name: "svc_billing_files", ttlMs: 0 },
      },
    },
    {
      kv: {
        cache: { bucket: "svc_billing_shared", history: 1, ttlMs: 0 },
      },
      store: {
        exports: { name: "svc_billing_files", ttlMs: 60_000 },
      },
    },
  ], manager);

  assertEquals(deletedKvBuckets, ["svc_billing_shared"]);
  assertEquals(deletedObjectStores, ["svc_billing_files"]);
});

Deno.test("resource purge ignores jobs bindings", async () => {
  const deletedKvBuckets: string[] = [];
  const deletedObjectStores: string[] = [];
  const manager: ResourcePurgeManager = {
    async deleteKvBucket(bucket) {
      deletedKvBuckets.push(bucket);
    },
    async deleteObjectStore(name) {
      deletedObjectStores.push(name);
    },
  };

  await purgeContractResourceBindings([
    {
      jobs: {
        namespace: "billing_jobs",
        workStream: "JOBS_WORK",
        queues: {},
      },
    },
  ], manager);

  assertEquals(deletedKvBuckets, []);
  assertEquals(deletedObjectStores, []);
});

Deno.test("required resources still require NATS when optional resources are present", async () => {
  const contract = {
    ...CONTRACT,
    resources: {
      kv: {
        audit: {
          purpose: "Store audit entries",
          schema: { schema: "AuditEntry" },
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
        "audit.default",
      ),
    Error,
    "NATS connection is required to provision store resources",
  );
});

Deno.test("resource permission grants include only bound KV usage subjects", () => {
  const grants = getResourcePermissionGrants({
    kv: {
      audit: {
        bucket: "svc_test_audit_v1_audit",
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
    grants.publish.includes("$KV.svc_test_audit_v1_audit.>"),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.INFO.KV_svc_test_audit_v1_audit",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.CREATE.KV_svc_test_audit_v1_audit",
    ),
    false,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.MSG.GET.KV_svc_test_audit_v1_audit",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.DIRECT.GET.KV_svc_test_audit_v1_audit",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.DIRECT.GET.KV_svc_test_audit_v1_audit.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.$KV.svc_test_audit_v1_audit.>"),
    true,
  );
  // KV watches in the current NATS client create and delete ephemeral consumers.
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.CREATE.KV_svc_test_audit_v1_audit",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.CREATE.KV_svc_test_audit_v1_audit.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.DURABLE.CREATE.KV_svc_test_audit_v1_audit.>",
    ),
    false,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.DELETE.KV_svc_test_audit_v1_audit.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.ACK.KV_svc_test_audit_v1_audit.>"),
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
          name: "KV_audit",
          subjects: ["$KV.audit.>"],
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
    name: "KV_audit",
    config: {
      max_msgs_per_subject: 3,
      max_age: 60_000 * 1_000_000,
      max_msg_size: 1024,
    },
  }]);
});

Deno.test("KV reconciliation applies configured replica count", async () => {
  const updates: Array<{ name: string; numReplicas: number }> = [];

  await reconcileKvResourceConfig(
    {
      update(name, config) {
        updates.push({ name, numReplicas: config.num_replicas });
        return Promise.resolve();
      },
    },
    {
      streamInfo: {
        config: {
          name: "KV_activity",
          max_msgs_per_subject: 1,
          max_age: 0,
          max_msg_size: -1,
          num_replicas: 1,
        },
      },
    },
    { history: 1, ttlMs: 0 },
    { jetstreamReplicas: 3 },
  );

  assertEquals(updates, [{ name: "KV_activity", numReplicas: 3 }]);
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
      "$JS.API.CONSUMER.CREATE.OBJ_svc_test_activity_v1_uploads",
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

Deno.test("store reconciliation resets omitted object-store total bytes to unlimited", async () => {
  const updates: Array<
    {
      name: string;
      config: {
        max_age: number;
        max_bytes: number;
      };
    }
  > = [];

  await reconcileStoreResourceConfig(
    {
      update(name, config) {
        updates.push({
          name,
          config: {
            max_age: config.max_age,
            max_bytes: config.max_bytes,
          },
        });
        return Promise.resolve();
      },
    },
    {
      streamInfo: {
        config: {
          name: "OBJ_uploads",
          subjects: ["$O.uploads.>"],
          retention: "limits",
          max_consumers: -1,
          max_msgs_per_subject: -1,
          max_msgs: -1,
          max_age: 60_000 * 1_000_000,
          max_bytes: 4096,
          max_msg_size: -1,
          storage: "file",
          discard: "old",
          num_replicas: 1,
          duplicate_window: 0,
          sealed: false,
          deny_delete: false,
          deny_purge: false,
          allow_rollup_hdrs: false,
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
    { ttlMs: 0 },
  );

  assertEquals(updates, [{
    name: "OBJ_uploads",
    config: {
      max_age: 0,
      max_bytes: -1,
    },
  }]);
});

Deno.test("store reconciliation applies configured replica count", async () => {
  const updates: Array<{ name: string; numReplicas: number }> = [];

  await reconcileStoreResourceConfig(
    {
      update(name, config) {
        updates.push({ name, numReplicas: config.num_replicas });
        return Promise.resolve();
      },
    },
    {
      streamInfo: {
        config: {
          name: "OBJ_uploads",
          max_age: 0,
          max_bytes: -1,
          num_replicas: 1,
        },
      },
    },
    { ttlMs: 0 },
    { jetstreamReplicas: 3 },
  );

  assertEquals(updates, [{ name: "OBJ_uploads", numReplicas: 3 }]);
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

Deno.test("Jobs admin contract infrastructure provisioning requires NATS", async () => {
  await assertRejects(
    () =>
      provisionContractResourceBindings(
        undefined,
        TRELLIS_JOBS_CONTRACT,
        "trellis.jobs",
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
    grants.subscribe.includes(
      "trellis.jobs.document_activity_25c0dcc8dbcd.document-process.*.*",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.CREATE.JOBS_WORK.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.INFO.JOBS_WORK.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.MSG.NEXT.JOBS_WORK.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.ACK.JOBS_WORK.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.DURABLE.CREATE.JOBS_WORK.>"),
    false,
  );
  assertEquals(grants.publish.includes("$JS.API.STREAM.INFO.JOBS_WORK"), false);
  assertEquals(grants.publish.includes("$JS.API.STREAM.MSG.GET.JOBS"), true);
  assertEquals(grants.publish.includes("$JS.API.STREAM.INFO.JOBS"), false);
  assertEquals(grants.publish.includes("$JS.API.DIRECT.GET.JOBS"), true);
  assertEquals(grants.publish.includes("$JS.API.DIRECT.GET.JOBS.>"), true);
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
      "audit.default",
    );

    assertEquals(bindings.store?.uploads, {
      name: "svc_audit_def_audit_v1_uploads_4d0bbccb282e",
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
      "audit.default",
    );
    assertEquals(initialBindings.store?.uploads.maxTotalBytes, 4096);

    const updatedBindings = await provisionContractResourceBindings(
      nats.nc,
      updatedContract,
      "audit.default",
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

    assertEquals(jobs.config.subjects, ["trellis.jobs.>"]);
    assertEquals(jobs.config.retention, "limits");
    assertEquals(jobs.config.allow_direct, true);
    assertEquals(jobsWork.config.subjects, ["trellis.work.>"]);
    assertEquals(jobsWork.config.retention, "workqueue");
    assertEquals(Array.isArray(jobsWork.config.sources), true);
    assertEquals(jobsAdvisories.config.subjects, [
      "$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>",
    ]);
  },
});

Deno.test({
  name:
    "Jobs admin contract provisioning creates shared built-in jobs resources",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const bindings = await provisionContractResourceBindings(
      nats.nc,
      TRELLIS_JOBS_CONTRACT,
      "trellis.jobs",
    );

    const jsm = await jetstreamManager(nats.nc);
    const jobs = await jsm.streams.info("JOBS");
    const jobsWork = await jsm.streams.info("JOBS_WORK");
    const jobsAdvisories = await jsm.streams.info("JOBS_ADVISORIES");

    assertEquals(bindings, {});
    assertEquals(jobs.config.subjects, ["trellis.jobs.>"]);
    assertEquals(jobsWork.config.subjects, ["trellis.work.>"]);
    assertEquals(jobsAdvisories.config.subjects, [
      "$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>",
    ]);
  },
});
