import { assertEquals } from "@std/assert";

import type { TrellisContractV1 } from "@qlever-llc/trellis-contracts";

import {
  getKvResourceRequests,
  getResourcePermissionGrants,
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

  assertEquals(grants.publish.includes("$KV.svc_test_activity_v1_activity.>"), true);
  assertEquals(grants.publish.includes("$JS.API.STREAM.MSG.GET.KV_svc_test_activity_v1_activity"), true);
  assertEquals(grants.publish.includes("$JS.API.$KV.svc_test_activity_v1_activity.>"), true);
  assertEquals(grants.publish.includes("$JS.ACK.KV_svc_test_activity_v1_activity.>"), true);
});
