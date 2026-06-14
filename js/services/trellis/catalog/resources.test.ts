import {
  parseContractManifest,
  type TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { assertEquals, assertRejects } from "@std/assert";
import { CONTRACT as TRELLIS_JOBS_CONTRACT } from "#trellis-generated-sdk/jobs";

import {
  existingResourceNamesFromBindings,
  generateInternalResourceName,
  getEventConsumerGroupRequests,
  getJobsQueueRequests,
  getKvResourceRequests,
  getResourcePermissionGrants,
  getStoreResourceRequests,
  provisionContractResourceBindings,
  provisionContractResources,
  type ProvisionedContractResources,
  purgeContractResourceBindings,
  reconcileEventConsumerConfig,
  reconcileJobsQueueConsumerConfig,
  reconcileKvResourceConfig,
  reconcileStoreResourceConfig,
  type ResourcePurgeManager,
  rollbackProvisionedContractResources,
} from "./resources.ts";

function eventDependencyContract(): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "events.example@v1",
    displayName: "Events",
    description: "Event dependency.",
    kind: "service",
    schemas: { Empty: { type: "object" } },
    events: {
      Changed: {
        version: "v1",
        subject: "events.v1.Example.Changed.{id}",
        params: ["id"],
        event: { schema: "Empty" },
      },
      Deleted: {
        version: "v1",
        subject: "events.v1.Example.Deleted.{id}",
        params: ["id"],
        event: { schema: "Empty" },
      },
    },
  };
}

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

Deno.test("internal resource names are opaque Trellis-owned identifiers", () => {
  const names = [
    generateInternalResourceName("kv"),
    generateInternalResourceName("store"),
    generateInternalResourceName("eventConsumer"),
    generateInternalResourceName("jobsNamespace"),
    generateInternalResourceName("jobsQueue"),
  ];

  for (const name of names) {
    assertEquals(/^tr_[a-z]+_[0-9a-z]+$/.test(name), true);
    assertEquals(name.includes("billing"), false);
    assertEquals(name.includes("audit"), false);
    assertEquals(name.includes("cache"), false);
  }
  assertEquals(new Set(names).size, names.length);
});

Deno.test("existing resource names are extracted from stored bindings", () => {
  assertEquals(
    existingResourceNamesFromBindings([
      {
        kind: "kv",
        alias: "cache",
        binding: { bucket: "tr_kv_existing", history: 1, ttlMs: 0 },
      },
      {
        kind: "store",
        alias: "uploads",
        binding: { name: "tr_obj_existing", ttlMs: 0 },
      },
      {
        kind: "event-consumer",
        alias: "ingest",
        binding: { consumerName: "tr_cons_existing", stream: "trellis" },
      },
      {
        kind: "jobs",
        alias: "reconcile",
        binding: {
          namespace: "tr_jobs_existing",
          publishPrefix: "trellis.jobs.tr_jobs_existing.tr_jq_existing",
          workSubject: "trellis.work.tr_jobs_existing.tr_jq_existing",
          consumerName: "tr_jobs_existing_tr_jq_existing",
        },
      },
    ]),
    {
      kv: { cache: "tr_kv_existing" },
      store: { uploads: "tr_obj_existing" },
      eventConsumers: { ingest: "tr_cons_existing" },
      jobs: {
        namespace: "tr_jobs_existing",
        queues: {
          reconcile: {
            publishPrefix: "trellis.jobs.tr_jobs_existing.tr_jq_existing",
            workSubject: "trellis.work.tr_jobs_existing.tr_jq_existing",
            consumerName: "tr_jobs_existing_tr_jq_existing",
          },
        },
      },
    },
  );
});

Deno.test("resource requests apply store defaults and runtime object limits", () => {
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

Deno.test("event consumer requests resolve approved subscribe filters", () => {
  const contract = {
    ...CONTRACT,
    uses: {
      required: {
        events: {
          contract: "events.example@v1",
          events: { subscribe: ["Changed", "Deleted"] },
        },
      },
    },
    eventConsumers: {
      ingest: {
        uses: { events: ["Changed", "Deleted"] },
        replay: "all" as const,
        ackWaitMs: 1000,
        maxDeliver: 2,
        backoffMs: [100, 200],
      },
    },
  };

  assertEquals(
    getEventConsumerGroupRequests(contract, {
      knownContractEntries: [{
        digest: "events-digest",
        contract: eventDependencyContract(),
      }],
      authorityNeeds: {
        surfaces: [
          {
            contractId: "events.example@v1",
            kind: "event",
            name: "Changed",
            action: "subscribe",
          },
          {
            contractId: "events.example@v1",
            kind: "event",
            name: "Deleted",
            action: "subscribe",
          },
        ],
      },
    }),
    [{
      alias: "ingest",
      stream: "trellis",
      filterSubjects: [
        "events.v1.Example.Changed.*",
        "events.v1.Example.Deleted.*",
      ],
      replay: "all",
      ordering: "strict",
      concurrency: 1,
      ackWaitMs: 1000,
      maxDeliver: 2,
      backoffMs: [100],
    }],
  );
});

Deno.test("event consumer requests resolve owned event filters without dependency authority", () => {
  const contract = parseContractManifest({
    ...CONTRACT,
    events: {
      Created: {
        version: "v1",
        subject: "events.v1.Audit.Created.{/id}",
        params: ["/id"],
        event: { schema: "AuditEntry" },
      },
    },
    uses: {
      required: {
        unused: {
          contract: "events.example@v1",
          events: { subscribe: ["Changed"] },
        },
      },
    },
    eventConsumers: {
      ingest: {
        self: ["Created"],
      },
    },
  });

  assertEquals(getEventConsumerGroupRequests(contract), [{
    alias: "ingest",
    stream: "trellis",
    filterSubjects: ["events.v1.Audit.Created.*"],
    replay: "new",
    ordering: "strict",
    concurrency: 1,
    ackWaitMs: 300000,
    maxDeliver: 6,
    backoffMs: [5000, 30000, 120000, 600000, 1800000],
  }]);
});

Deno.test("event consumer requests resolve mixed owned and dependency filters", () => {
  const contract = parseContractManifest({
    ...CONTRACT,
    events: {
      Created: {
        version: "v1",
        subject: "events.v1.Audit.Created.{/id}",
        params: ["/id"],
        event: { schema: "AuditEntry" },
      },
    },
    uses: {
      required: {
        events: {
          contract: "events.example@v1",
          events: { subscribe: ["Changed"] },
        },
      },
    },
    eventConsumers: {
      ingest: {
        uses: { events: ["Changed"] },
        self: ["Created"],
      },
    },
  });

  assertEquals(
    getEventConsumerGroupRequests(contract, {
      knownContractEntries: [{
        digest: "events-digest",
        contract: eventDependencyContract(),
      }],
      authorityNeeds: {
        surfaces: [{
          contractId: "events.example@v1",
          kind: "event",
          name: "Changed",
          action: "subscribe",
        }],
      },
    }),
    [{
      alias: "ingest",
      stream: "trellis",
      filterSubjects: [
        "events.v1.Audit.Created.*",
        "events.v1.Example.Changed.*",
      ],
      replay: "new",
      ordering: "strict",
      concurrency: 1,
      ackWaitMs: 300000,
      maxDeliver: 6,
      backoffMs: [5000, 30000, 120000, 600000, 1800000],
    }],
  );
});

Deno.test("event consumer requests ignore incompatible unused dependency schemas", () => {
  const currentDependency = eventDependencyContract();
  const staleDependency = {
    ...currentDependency,
    schemas: {
      ...currentDependency.schemas,
      BillingConfirmSubscriptionCheckoutResponseSchema: {
        type: "object",
        properties: { legacy: { type: "string" } },
      },
    },
  } satisfies TrellisContractV1;
  const currentDependencyWithUnusedSchema = {
    ...currentDependency,
    schemas: {
      ...currentDependency.schemas,
      BillingConfirmSubscriptionCheckoutResponseSchema: {
        type: "object",
        properties: { current: { type: "number" } },
      },
    },
  } satisfies TrellisContractV1;
  const contract = {
    ...CONTRACT,
    uses: {
      required: {
        events: {
          contract: "events.example@v1",
          events: { subscribe: ["Changed"] },
        },
      },
    },
    eventConsumers: {
      ingest: {
        uses: { events: ["Changed"] },
      },
    },
  };

  assertEquals(
    getEventConsumerGroupRequests(contract, {
      knownContractEntries: [
        {
          digest: "events-current",
          contract: currentDependencyWithUnusedSchema,
        },
        { digest: "events-stale", contract: staleDependency },
      ],
      authorityNeeds: {
        surfaces: [{
          contractId: "events.example@v1",
          kind: "event",
          name: "Changed",
          action: "subscribe",
        }],
      },
    }),
    [{
      alias: "ingest",
      stream: "trellis",
      filterSubjects: ["events.v1.Example.Changed.*"],
      replay: "new",
      ordering: "strict",
      concurrency: 1,
      ackWaitMs: 300000,
      maxDeliver: 6,
      backoffMs: [5000, 30000, 120000, 600000, 1800000],
    }],
  );
});

Deno.test("event consumer requests ignore unrelated uses during dependency resolution", () => {
  const contract = {
    ...CONTRACT,
    uses: {
      required: {
        auth: {
          contract: "trellis.auth@v1",
          rpc: { call: ["Auth.Requests.Validate"] },
        },
        events: {
          contract: "events.example@v1",
          events: { subscribe: ["Changed"] },
        },
      },
    },
    eventConsumers: {
      ingest: {
        uses: { events: ["Changed"] },
      },
    },
  };

  assertEquals(
    getEventConsumerGroupRequests(contract, {
      knownContractEntries: [{
        digest: "events-digest",
        contract: eventDependencyContract(),
      }],
      authorityNeeds: {
        surfaces: [{
          contractId: "events.example@v1",
          kind: "event",
          name: "Changed",
          action: "subscribe",
        }],
      },
    }),
    [{
      alias: "ingest",
      stream: "trellis",
      filterSubjects: ["events.v1.Example.Changed.*"],
      replay: "new",
      ordering: "strict",
      concurrency: 1,
      ackWaitMs: 300000,
      maxDeliver: 6,
      backoffMs: [5000, 30000, 120000, 600000, 1800000],
    }],
  );
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

Deno.test("optional KV resources require NATS during provisioning", async () => {
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
    "NATS connection is required to provision KV resources",
  );
});

Deno.test("optional store resources require NATS during provisioning", async () => {
  const contract = {
    ...CONTRACT,
    resources: {
      store: {
        uploads: {
          purpose: "Temporary uploaded files awaiting processing",
          required: false,
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

Deno.test("resource provisioning reports empty created and adopted sets", async () => {
  const result = await provisionContractResources(
    undefined,
    {
      ...CONTRACT,
      resources: {},
    } as TrellisContractV1,
    "audit.default",
  );

  assertEquals(result, {
    bindings: {},
    created: [],
    adopted: [],
  });
});

Deno.test("resource rollback deletes only resources created by the attempt", async () => {
  const deletedKvBuckets: string[] = [];
  const deletedObjectStores: string[] = [];
  const deletedConsumers: Array<{ stream: string; consumerName: string }> = [];
  const manager: ResourcePurgeManager = {
    async deleteKvBucket(bucket) {
      deletedKvBuckets.push(bucket);
    },
    async deleteObjectStore(name) {
      deletedObjectStores.push(name);
    },
    async deleteEventConsumer(stream, consumerName) {
      deletedConsumers.push({ stream, consumerName });
    },
  };
  const result: ProvisionedContractResources = {
    bindings: {
      jobs: {
        namespace: "billing_jobs",
        workStream: "JOBS_WORK",
        queues: {},
      },
    },
    created: [
      { kind: "kv", alias: "cache", name: "svc_billing_cache" },
      { kind: "store", alias: "uploads", name: "svc_billing_uploads" },
      {
        kind: "eventConsumer",
        alias: "ingest",
        stream: "trellis",
        name: "svc_billing_ingest",
      },
      {
        kind: "jobsQueueConsumer",
        alias: "reconcile",
        stream: "JOBS_WORK",
        name: "svc_billing_reconcile",
      },
    ],
    adopted: [
      { kind: "kv", alias: "state", name: "svc_billing_state" },
      { kind: "store", alias: "exports", name: "svc_billing_exports" },
      {
        kind: "eventConsumer",
        alias: "replay",
        stream: "trellis",
        name: "svc_billing_replay",
      },
    ],
  };

  await rollbackProvisionedContractResources(result, manager);

  assertEquals(deletedKvBuckets, ["svc_billing_cache"]);
  assertEquals(deletedObjectStores, ["svc_billing_uploads"]);
  assertEquals(deletedConsumers, [{
    stream: "trellis",
    consumerName: "svc_billing_ingest",
  }, {
    stream: "JOBS_WORK",
    consumerName: "svc_billing_reconcile",
  }]);
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
    "NATS connection is required to provision KV resources",
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

Deno.test("resource permission grants include exact event consumer subjects", () => {
  const grants = getResourcePermissionGrants({
    eventConsumers: {
      ingest: {
        stream: "trellis",
        consumerName: "svc_dep_contract_ingest_abcd",
        filterSubjects: ["events.v1.Example.Changed.*"],
        replay: "new",
        ordering: "strict",
        concurrency: 1,
        ackWaitMs: 300000,
        maxDeliver: 5,
        backoffMs: [5000],
      },
    },
  });

  assertEquals(grants.publish.includes("$JS.API.INFO"), true);
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.INFO.trellis.svc_dep_contract_ingest_abcd",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.CONSUMER.MSG.NEXT.trellis.svc_dep_contract_ingest_abcd",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.ACK.trellis.svc_dep_contract_ingest_abcd.>"),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.DURABLE.CREATE.trellis.>"),
    false,
  );
});

Deno.test("event consumer reconciliation updates changed consumer config", async () => {
  const requestedConfig: Record<string, unknown> = {
    durable_name: "svc_events_ingest",
    ack_policy: "explicit",
    deliver_policy: "all",
    filter_subjects: ["events.v1.Example.Changed.*"],
    ack_wait: 45_000_000_000,
    max_deliver: 8,
    max_ack_pending: 2,
    backoff: [1_000_000_000, 5_000_000_000],
  };
  const updates: Array<{
    stream: string;
    consumerName: string;
    config: Record<string, unknown>;
  }> = [];

  await reconcileEventConsumerConfig(
    {
      info() {
        return Promise.reject(new Error("info should not be called"));
      },
      update(stream, consumerName, config) {
        updates.push({ stream, consumerName, config });
        return Promise.resolve({
          config: { ...config, ack_wait: 1_000_000_000 },
        });
      },
    },
    "trellis",
    "svc_events_ingest",
    requestedConfig,
  );

  assertEquals(updates, [{
    stream: "trellis",
    consumerName: "svc_events_ingest",
    config: requestedConfig,
  }]);
});

Deno.test("event consumer reconciliation adopts matching existing config", async () => {
  const requestedConfig: Record<string, unknown> = {
    durable_name: "svc_events_ingest",
    ack_policy: "explicit",
    deliver_policy: "new",
    filter_subjects: ["events.v1.Example.Changed.*"],
    ack_wait: 300_000_000_000,
    max_deliver: 5,
    max_ack_pending: 1,
    backoff: [5_000_000_000],
  };

  await reconcileEventConsumerConfig(
    {
      info(stream, consumerName) {
        assertEquals(stream, "trellis");
        assertEquals(consumerName, "svc_events_ingest");
        return Promise.resolve({
          config: { ...requestedConfig, ack_wait: 5_000_000_000 },
        });
      },
    },
    "trellis",
    "svc_events_ingest",
    requestedConfig,
  );
});

Deno.test("event consumer reconciliation rejects stale existing config without update", async () => {
  const requestedConfig: Record<string, unknown> = {
    durable_name: "svc_events_ingest",
    ack_policy: "explicit",
    deliver_policy: "all",
    filter_subjects: ["events.v1.Example.Changed.*"],
    ack_wait: 300_000_000_000,
    max_deliver: 5,
    max_ack_pending: 1,
    backoff: [5_000_000_000],
  };

  await assertRejects(
    () =>
      reconcileEventConsumerConfig(
        {
          info() {
            return Promise.resolve({
              config: {
                ...requestedConfig,
                filter_subjects: ["events.v1.Example.Deleted.*"],
              },
            });
          },
        },
        "trellis",
        "svc_events_ingest",
        requestedConfig,
      ),
    Error,
    "event consumer 'trellis.svc_events_ingest' config drift for 'filter_subjects'",
  );
});

Deno.test("jobs queue consumer reconciliation updates changed consumer config", async () => {
  const requestedConfig: Record<string, unknown> = {
    durable_name: "svc_refresh",
    ack_policy: "explicit",
    filter_subject: "trellis.work.svc.refresh",
    ack_wait: 45_000_000_000,
    max_deliver: 8,
    max_ack_pending: 2,
    backoff: [1_000_000_000, 5_000_000_000],
  };
  const updates: Array<{
    stream: string;
    consumerName: string;
    config: Record<string, unknown>;
  }> = [];

  await reconcileJobsQueueConsumerConfig(
    {
      info() {
        return Promise.reject(new Error("info should not be called"));
      },
      update(stream, consumerName, config) {
        updates.push({ stream, consumerName, config });
        return Promise.resolve({
          config: { ...config, ack_wait: 1_000_000_000 },
        });
      },
    },
    "JOBS_WORK",
    "svc_refresh",
    requestedConfig,
  );

  assertEquals(updates, [{
    stream: "JOBS_WORK",
    consumerName: "svc_refresh",
    config: requestedConfig,
  }]);
});

Deno.test("jobs queue consumer reconciliation rejects stale existing config without update", async () => {
  const requestedConfig: Record<string, unknown> = {
    durable_name: "svc_refresh",
    ack_policy: "explicit",
    filter_subject: "trellis.work.svc.refresh",
    ack_wait: 300_000_000_000,
    max_deliver: 5,
    max_ack_pending: 1,
    backoff: [5_000_000_000],
  };

  await assertRejects(
    () =>
      reconcileJobsQueueConsumerConfig(
        {
          info() {
            return Promise.resolve({
              config: {
                ...requestedConfig,
                filter_subject: "trellis.work.svc.rebuild",
              },
            });
          },
        },
        "JOBS_WORK",
        "svc_refresh",
        requestedConfig,
      ),
    Error,
    "jobs queue consumer 'JOBS_WORK.svc_refresh' config drift for 'filter_subject'",
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

Deno.test("jobs resource requests normalize keyed queue defaults", () => {
  const contract = {
    ...CONTRACT,
    schemas: {
      Payload: { type: "object" },
    },
    resources: {},
    jobs: {
      "sync-tickets": {
        payload: { schema: "Payload" },
        ackWaitMs: 90_000,
        concurrency: 8,
        keyConcurrency: {
          key: ["zendesk", "/origin", "tickets"],
        },
      },
    },
  } as TrellisContractV1;

  assertEquals(getJobsQueueRequests(contract), [
    {
      queueType: "sync-tickets",
      payload: { schema: "Payload" },
      maxDeliver: 5,
      backoffMs: [5000, 30000, 120000, 600000, 1800000],
      ackWaitMs: 90_000,
      progress: true,
      logs: true,
      dlq: true,
      concurrency: 8,
      keyConcurrency: {
        key: ["zendesk", "/origin", "tickets"],
        maxActive: 1,
        heartbeatIntervalMs: 30_000,
        heartbeatTtlMs: 90_000,
        stalePolicy: "fail-stale",
      },
      queue: {
        maxQueuedPerKey: 0,
        whenFull: "reject",
      },
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
    grants.publish.includes(
      "trellis.work.document_activity_25c0dcc8dbcd.document-process",
    ),
    false,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.CREATE.JOBS_WORK.>"),
    false,
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
  assertEquals(
    grants.publish.includes("$KV.JOBS_KEYS_document_activity_25c0dcc8dbcd.>"),
    true,
  );
  assertEquals(grants.publish.includes("$KV.JOBS_KEYS.>"), false);
  assertEquals(
    grants.publish.includes(
      "$JS.API.$KV.JOBS_KEYS_document_activity_25c0dcc8dbcd.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.STREAM.MSG.GET.KV_JOBS_KEYS_document_activity_25c0dcc8dbcd",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes(
      "$JS.API.DIRECT.GET.KV_JOBS_KEYS_document_activity_25c0dcc8dbcd.>",
    ),
    true,
  );
  assertEquals(
    grants.publish.includes("$JS.API.STREAM.MSG.GET.KV_JOBS_KEYS"),
    false,
  );
  assertEquals(
    grants.publish.includes("$JS.API.DIRECT.GET.KV_JOBS_KEYS"),
    false,
  );
  assertEquals(
    grants.publish.includes("$JS.API.DIRECT.GET.KV_JOBS_KEYS.>"),
    false,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.CREATE.KV_JOBS_KEYS.>"),
    false,
  );
  assertEquals(
    grants.publish.includes("$JS.API.CONSUMER.MSG.NEXT.KV_JOBS_KEYS.>"),
    false,
  );
});
