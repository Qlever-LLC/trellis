// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
import { OWNED_API } from "./owned_api.ts";

export { OWNED_API };

export type UsedApi = {
  rpc: {};
  operations: {};
  events: {};
  feeds: {};
  subjects: {};
};

export const USED_API: UsedApi = {
  rpc: {},
  operations: {},
  events: {},
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
