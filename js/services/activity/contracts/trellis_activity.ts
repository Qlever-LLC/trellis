import { defineContract } from "@trellis/contracts";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@trellis/server";
import { trellisAuth } from "../../trellis/contracts/trellis_auth.ts";
import { trellisCore } from "../../trellis/contracts/trellis_core.ts";

import {
  ActivityGetRequestSchema,
  ActivityGetResponseSchema,
  ActivityListRequestSchema,
  ActivityListResponseSchema,
  ActivityRecordedEventSchema,
} from "../schemas.ts";

export const activity = defineContract({
  id: "trellis.activity@v1",
  displayName: "Trellis Activity",
  description: "Project authentication activity into queryable audit records.",
  kind: "service",
  uses: {
    auth: trellisAuth.use({
      events: {
        subscribe: [
          "Auth.Connect",
          "Auth.ConnectionKicked",
          "Auth.Disconnect",
          "Auth.SessionRevoked",
        ],
      },
    }),
    core: trellisCore.use({
      rpc: {
        call: ["Trellis.Bindings.Get", "Trellis.Catalog"],
      },
    }),
  },
  resources: {
    kv: {
      activity: {
        purpose: "Store normalized audit activity entries for the service projection.",
        history: 1,
        ttlMs: 0,
      },
    },
  },
  rpc: {
    "Activity.Health": {
      version: "v1",
      inputSchema: HealthRpcSchema,
      outputSchema: HealthResponseSchema,
      capabilities: { call: [] },
      errors: ["UnexpectedError"],
    },
    "Activity.List": {
      version: "v1",
      inputSchema: ActivityListRequestSchema,
      outputSchema: ActivityListResponseSchema,
      capabilities: { call: ["admin"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
    "Activity.Get": {
      version: "v1",
      inputSchema: ActivityGetRequestSchema,
      outputSchema: ActivityGetResponseSchema,
      capabilities: { call: ["admin"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
  },
  events: {
    "Activity.Recorded": {
      version: "v1",
      eventSchema: ActivityRecordedEventSchema,
      capabilities: {
        publish: ["service:events:activity"],
        subscribe: ["service:events:activity"],
      },
    },
  },
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = activity;
export type ActivityApi = typeof API;
export type ActivityOwnedApi = typeof API.owned;
export type ActivityTrellisApi = typeof API.trellis;
