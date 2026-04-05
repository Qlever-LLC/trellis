import type { TrellisContractV1 } from "@qlever-llc/trellis-contracts";
import { assertEquals } from "@std/assert";

import {
  getJobsQueueRequests,
  getKvResourceRequests,
  getResourcePermissionGrants,
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

  const grants = getResourcePermissionGrants(bindings);
  assertEquals(
    grants.publish.includes("trellis.jobs.workers.svc_test_documents_v1.>"),
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
