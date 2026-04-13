import { defineContract } from "@qlever-llc/trellis/contracts";
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
  StateCompareAndSetResponseSchema,
  StateCompareAndSetSchema,
} from "../../../packages/trellis/models/trellis/rpc/StateCompareAndSet.ts";
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
  StateCompareAndSetRequest: StateCompareAndSetSchema,
  StateCompareAndSetResponse: StateCompareAndSetResponseSchema,
  StateListRequest: StateListSchema,
  StateListResponse: StateListResponseSchema,
  StateAdminGetRequest: StateAdminGetSchema,
  StateAdminGetResponse: StateAdminGetResponseSchema,
  StateAdminListRequest: StateAdminListSchema,
  StateAdminListResponse: StateAdminListResponseSchema,
  StateAdminDeleteRequest: StateAdminDeleteSchema,
  StateAdminDeleteResponse: StateAdminDeleteResponseSchema,
} as const;

function schemaRef<const TName extends keyof typeof schemas & string>(schema: TName) {
  return { schema } as const;
}

export const trellisState = defineContract({
  id: "trellis.state@v1",
  displayName: "Trellis State",
  description: "Trellis-managed app state for authenticated app and device participants.",
  kind: "service",
  schemas,
  rpc: {
    "State.Get": {
      version: "v1",
      input: schemaRef("StateGetRequest"),
      output: schemaRef("StateGetResponse"),
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
    "State.Put": {
      version: "v1",
      input: schemaRef("StatePutRequest"),
      output: schemaRef("StatePutResponse"),
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
    "State.Delete": {
      version: "v1",
      input: schemaRef("StateDeleteRequest"),
      output: schemaRef("StateDeleteResponse"),
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
    "State.CompareAndSet": {
      version: "v1",
      input: schemaRef("StateCompareAndSetRequest"),
      output: schemaRef("StateCompareAndSetResponse"),
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
    "State.List": {
      version: "v1",
      input: schemaRef("StateListRequest"),
      output: schemaRef("StateListResponse"),
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
    "State.Admin.Get": {
      version: "v1",
      input: schemaRef("StateAdminGetRequest"),
      output: schemaRef("StateAdminGetResponse"),
      capabilities: { call: ["admin"] },
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
    "State.Admin.List": {
      version: "v1",
      input: schemaRef("StateAdminListRequest"),
      output: schemaRef("StateAdminListResponse"),
      capabilities: { call: ["admin"] },
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
    "State.Admin.Delete": {
      version: "v1",
      input: schemaRef("StateAdminDeleteRequest"),
      output: schemaRef("StateAdminDeleteResponse"),
      capabilities: { call: ["admin"] },
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
  },
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = trellisState;
