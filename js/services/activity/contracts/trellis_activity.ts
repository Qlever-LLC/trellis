import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis/health";
import { trellisAuth } from "../../trellis/contracts/trellis_auth.ts";
import { trellisCore } from "../../trellis/contracts/trellis_core.ts";

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

export const activity = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.activity@v1",
    displayName: "Trellis Activity",
    description: "Project authentication activity into queryable audit records.",
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
        input: ref.schema("HealthRequest"),
        output: ref.schema("HealthResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Activity.List": {
        version: "v1",
        input: ref.schema("ActivityListRequest"),
        output: ref.schema("ActivityListResponse"),
        capabilities: { call: ["admin"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "Activity.Get": {
        version: "v1",
        input: ref.schema("ActivityGetRequest"),
        output: ref.schema("ActivityGetResponse"),
        capabilities: { call: ["admin"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
    },
    events: {
      "Activity.Recorded": {
        version: "v1",
        event: ref.schema("ActivityRecordedEvent"),
        capabilities: {
          publish: ["service:events:activity"],
          subscribe: ["service:events:activity"],
        },
      },
    },
  }),
);

export const CONTRACT_ID = activity.CONTRACT_ID;
export const CONTRACT = activity.CONTRACT;
export const CONTRACT_DIGEST = activity.CONTRACT_DIGEST;
export const API: typeof activity.API = activity.API;
export const use: typeof activity.use = activity.use;
export type ActivityApi = typeof API;
export type ActivityOwnedApi = typeof API.owned;
export type ActivityTrellisApi = typeof API.trellis;
export default activity;
