// Generated from ./generated/contracts/manifests/trellis.activity@v1.json
import type { TrellisAPI } from "@trellis/contracts";
import { schema } from "@trellis/contracts";
import * as Types from "./types.ts";
import { SCHEMAS } from "./schemas.ts";

export const OWNED_API = {
  rpc: {
    "Activity.Get": {
      subject: "rpc.v1.Activity.Get",
      input: schema<Types.ActivityGetInput>(SCHEMAS.rpc["Activity.Get"].input),
      output: schema<Types.ActivityGetOutput>(SCHEMAS.rpc["Activity.Get"].output),
      callerCapabilities: ["admin"],
      errors: ["ValidationError","UnexpectedError"] as const,
    },
    "Activity.Health": {
      subject: "rpc.v1.Activity.Health",
      input: schema<Types.ActivityHealthInput>(SCHEMAS.rpc["Activity.Health"].input),
      output: schema<Types.ActivityHealthOutput>(SCHEMAS.rpc["Activity.Health"].output),
      callerCapabilities: [],
      errors: ["UnexpectedError"] as const,
    },
    "Activity.List": {
      subject: "rpc.v1.Activity.List",
      input: schema<Types.ActivityListInput>(SCHEMAS.rpc["Activity.List"].input),
      output: schema<Types.ActivityListOutput>(SCHEMAS.rpc["Activity.List"].output),
      callerCapabilities: ["admin"],
      errors: ["ValidationError","UnexpectedError"] as const,
    },
  },
  events: {
    "Activity.Recorded": {
      subject: "events.v1.Activity.Recorded",
      event: schema<Types.ActivityRecordedEvent>(SCHEMAS.events["Activity.Recorded"].event),
      publishCapabilities: ["service:events:activity"],
      subscribeCapabilities: ["service:events:activity"],
    },
  },
  subjects: {
  },
} satisfies TrellisAPI;

const EMPTY_API = { rpc: {}, events: {}, subjects: {} } as const satisfies TrellisAPI;

export const API = {
  owned: OWNED_API,
  used: EMPTY_API,
  trellis: OWNED_API,
} as const;

export type OwnedApi = typeof API.owned;
export type Api = typeof API.trellis;
export type ApiViews = typeof API;

