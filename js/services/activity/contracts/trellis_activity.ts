import { defineContract } from "@qlever-llc/trellis/contracts";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis/server";
import { trellisAuth } from "../../trellis/catalog/contracts/trellis_auth.ts";
import { trellisCore } from "../../trellis/catalog/contracts/trellis_core.ts";

import {
  ActivityGetRequestSchema,
  ActivityGetResponseSchema,
  ActivityListRequestSchema,
  ActivityListResponseSchema,
  ActivityRecordedEventSchema,
} from "../schemas.ts";

const schemas = {
  ActivityGetRequest: ActivityGetRequestSchema,
  ActivityGetResponse: ActivityGetResponseSchema,
  ActivityListRequest: ActivityListRequestSchema,
  ActivityListResponse: ActivityListResponseSchema,
  ActivityRecordedEvent: ActivityRecordedEventSchema,
  HealthRequest: HealthRpcSchema,
  HealthResponse: HealthResponseSchema,
} as const;

function schemaRef<const TName extends keyof typeof schemas & string>(schema: TName) {
  return { schema } as const;
}

export const activity = defineContract({
  id: "trellis.activity@v1",
  displayName: "Trellis Activity",
  description: "Project authentication activity into queryable audit records.",
  kind: "service",
  schemas,
  uses: {
    auth: trellisAuth.useDefaults({
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
      input: schemaRef("HealthRequest"),
      output: schemaRef("HealthResponse"),
      capabilities: { call: [] },
      errors: ["UnexpectedError"],
    },
    "Activity.List": {
      version: "v1",
      input: schemaRef("ActivityListRequest"),
      output: schemaRef("ActivityListResponse"),
      capabilities: { call: ["admin"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
    "Activity.Get": {
      version: "v1",
      input: schemaRef("ActivityGetRequest"),
      output: schemaRef("ActivityGetResponse"),
      capabilities: { call: ["admin"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
  },
  events: {
    "Activity.Recorded": {
      version: "v1",
      event: schemaRef("ActivityRecordedEvent"),
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
