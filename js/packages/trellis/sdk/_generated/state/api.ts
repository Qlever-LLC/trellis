// Generated from ./generated/contracts/manifests/trellis.state@v1.json
import { OWNED_API } from "./owned_api.ts";
import { OWNED_API as HealthApi } from "../health/mod.ts";

export { OWNED_API };

export type UsedApi = {
  rpc: {};
  operations: {};
  events: {
    readonly "Health.Heartbeat": typeof HealthApi.events["Health.Heartbeat"];
  };
  feeds: {};
  subjects: {};
};

export const USED_API: UsedApi = {
  rpc: {},
  operations: {},
  events: {
    get "Health.Heartbeat"() {
      return HealthApi.events["Health.Heartbeat"];
    },
  },
  feeds: {},
  subjects: {},
};

export type OwnedApi = typeof OWNED_API;
export type Api = {
  rpc: OwnedApi["rpc"] & UsedApi["rpc"];
  operations: OwnedApi["operations"] & UsedApi["operations"];
  events: OwnedApi["events"] & UsedApi["events"];
  feeds: OwnedApi["feeds"] & UsedApi["feeds"];
  subjects: OwnedApi["subjects"] & UsedApi["subjects"];
};

export const API = {
  owned: OWNED_API,
  used: USED_API,
} as const;

export type ApiViews = typeof API;
