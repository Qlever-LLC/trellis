import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import {
  StateAdminDeleteResponseSchema,
  StateAdminDeleteSchema,
} from "../../../packages/trellis/models/trellis/rpc/StateAdminDelete.ts";
import {
  StateAdminGetResponseSchema,
  StateAdminGetSchema,
} from "../../../packages/trellis/models/trellis/rpc/StateAdminGet.ts";
import {
  StateAdminListResponseSchema,
  StateAdminListSchema,
} from "../../../packages/trellis/models/trellis/rpc/StateAdminList.ts";
import {
  StateDeleteResponseSchema,
  StateDeleteSchema,
} from "../../../packages/trellis/models/trellis/rpc/StateDelete.ts";
import {
  StateGetResponseSchema,
  StateGetSchema,
} from "../../../packages/trellis/models/trellis/rpc/StateGet.ts";
import {
  StateListResponseSchema,
  StateListSchema,
} from "../../../packages/trellis/models/trellis/rpc/StateList.ts";
import {
  StatePutResponseSchema,
  StatePutSchema,
} from "../../../packages/trellis/models/trellis/rpc/StatePut.ts";
import {
  JsonValueSchema,
  StateEntrySchema,
  StateScopeSchema,
  StateUserTargetSchema,
} from "../../../packages/trellis/models/trellis/State.ts";

const schemas = {
  JsonValue: JsonValueSchema,
  StateScope: StateScopeSchema,
  StateEntry: StateEntrySchema,
  StateUserTarget: StateUserTargetSchema,
  StateGetRequest: StateGetSchema,
  StateGetResponse: StateGetResponseSchema,
  StatePutRequest: StatePutSchema,
  StatePutResponse: StatePutResponseSchema,
  StateDeleteRequest: StateDeleteSchema,
  StateDeleteResponse: StateDeleteResponseSchema,
  StateListRequest: StateListSchema,
  StateListResponse: StateListResponseSchema,
  StateAdminGetRequest: StateAdminGetSchema,
  StateAdminGetResponse: StateAdminGetResponseSchema,
  StateAdminListRequest: StateAdminListSchema,
  StateAdminListResponse: StateAdminListResponseSchema,
  StateAdminDeleteRequest: StateAdminDeleteSchema,
  StateAdminDeleteResponse: StateAdminDeleteResponseSchema,
} as const;

export const trellisState = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.state@v1",
    displayName: "Trellis State",
    description: "Trellis-managed app state for authenticated app and device participants.",
    rpc: {
      "State.Get": {
        version: "v1",
        input: ref.schema("StateGetRequest"),
        output: ref.schema("StateGetResponse"),
        errors: [ref.error("AuthError"), ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "State.Put": {
        version: "v1",
        input: ref.schema("StatePutRequest"),
        output: ref.schema("StatePutResponse"),
        errors: [ref.error("AuthError"), ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "State.Delete": {
        version: "v1",
        input: ref.schema("StateDeleteRequest"),
        output: ref.schema("StateDeleteResponse"),
        errors: [ref.error("AuthError"), ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "State.List": {
        version: "v1",
        input: ref.schema("StateListRequest"),
        output: ref.schema("StateListResponse"),
        errors: [ref.error("AuthError"), ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "State.Admin.Get": {
        version: "v1",
        input: ref.schema("StateAdminGetRequest"),
        output: ref.schema("StateAdminGetResponse"),
        capabilities: { call: ["admin"] },
        errors: [ref.error("AuthError"), ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "State.Admin.List": {
        version: "v1",
        input: ref.schema("StateAdminListRequest"),
        output: ref.schema("StateAdminListResponse"),
        capabilities: { call: ["admin"] },
        errors: [ref.error("AuthError"), ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "State.Admin.Delete": {
        version: "v1",
        input: ref.schema("StateAdminDeleteRequest"),
        output: ref.schema("StateAdminDeleteResponse"),
        capabilities: { call: ["admin"] },
        errors: [ref.error("AuthError"), ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
    },
  }),
);

export const CONTRACT_ID = trellisState.CONTRACT_ID;
export const CONTRACT = trellisState.CONTRACT;
export const CONTRACT_DIGEST = trellisState.CONTRACT_DIGEST;
export const API: typeof trellisState.API = trellisState.API;
export const use: typeof trellisState.use = trellisState.use;
export default trellisState;
