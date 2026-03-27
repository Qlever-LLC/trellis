// Generated from ./generated/contracts/manifests/trellis.jobs@v1.json
import type { TrellisAPI } from "@qlever-llc/trellis-contracts";
import { schema } from "@qlever-llc/trellis-contracts";
import * as Types from "./types.ts";
import { SCHEMAS } from "./schemas.ts";

export const OWNED_API = {
  rpc: {
    "Jobs.Cancel": {
      subject: "rpc.v1.Jobs.Cancel",
      input: schema<Types.JobsCancelInput>(SCHEMAS.rpc["Jobs.Cancel"].input),
      output: schema<Types.JobsCancelOutput>(SCHEMAS.rpc["Jobs.Cancel"].output),
      callerCapabilities: ["jobs.admin"],
      errors: ["ValidationError","UnexpectedError"] as const,
    },
    "Jobs.Get": {
      subject: "rpc.v1.Jobs.Get",
      input: schema<Types.JobsGetInput>(SCHEMAS.rpc["Jobs.Get"].input),
      output: schema<Types.JobsGetOutput>(SCHEMAS.rpc["Jobs.Get"].output),
      callerCapabilities: ["jobs.read"],
      errors: ["ValidationError","UnexpectedError"] as const,
    },
    "Jobs.Health": {
      subject: "rpc.v1.Jobs.Health",
      input: schema<Types.JobsHealthInput>(SCHEMAS.rpc["Jobs.Health"].input),
      output: schema<Types.JobsHealthOutput>(SCHEMAS.rpc["Jobs.Health"].output),
      callerCapabilities: [],
      errors: ["UnexpectedError"] as const,
    },
    "Jobs.List": {
      subject: "rpc.v1.Jobs.List",
      input: schema<Types.JobsListInput>(SCHEMAS.rpc["Jobs.List"].input),
      output: schema<Types.JobsListOutput>(SCHEMAS.rpc["Jobs.List"].output),
      callerCapabilities: ["jobs.read"],
      errors: ["ValidationError","UnexpectedError"] as const,
    },
    "Jobs.ListServices": {
      subject: "rpc.v1.Jobs.ListServices",
      input: schema<Types.JobsListServicesInput>(SCHEMAS.rpc["Jobs.ListServices"].input),
      output: schema<Types.JobsListServicesOutput>(SCHEMAS.rpc["Jobs.ListServices"].output),
      callerCapabilities: ["jobs.read"],
      errors: ["UnexpectedError"] as const,
    },
    "Jobs.Retry": {
      subject: "rpc.v1.Jobs.Retry",
      input: schema<Types.JobsRetryInput>(SCHEMAS.rpc["Jobs.Retry"].input),
      output: schema<Types.JobsRetryOutput>(SCHEMAS.rpc["Jobs.Retry"].output),
      callerCapabilities: ["jobs.admin"],
      errors: ["ValidationError","UnexpectedError"] as const,
    },
  },
  events: {
  },
  subjects: {
    "Jobs.Stream": {
      subject: "trellis.jobs.>",
      publishCapabilities: ["service:jobs"],
      subscribeCapabilities: ["jobs.read"],
    },
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

