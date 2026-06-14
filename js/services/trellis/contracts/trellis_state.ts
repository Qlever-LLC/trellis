import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import Type from "typebox";
import {
  StateAdminDeleteRequestSchema as StateAdminDeleteSchema,
  StateAdminDeleteResponseSchema,
  StateAdminGetRequestSchema as StateAdminGetSchema,
  StateAdminGetResponseSchema,
  StateAdminListRequestSchema as StateAdminListSchema,
  StateAdminListResponseSchema,
  StateDeleteRequestSchema as StateDeleteSchema,
  StateDeleteResponseSchema,
  StateGetRequestSchema as StateGetSchema,
  StateGetResponseSchema,
  StateListRequestSchema as StateListSchema,
  StateListResponseSchema,
  StatePutRequestSchema as StatePutSchema,
  StatePutResponseSchema,
} from "@qlever-llc/trellis/sdk/state";

const JsonValueSchema = Type.Unknown();
const StateScopeSchema = Type.Union([
  Type.Literal("userApp"),
  Type.Literal("deviceApp"),
]);
const StateEntrySchema = Type.Object({
  key: Type.Optional(Type.String({ minLength: 1 })),
  value: JsonValueSchema,
  revision: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ format: "date-time" }),
  expiresAt: Type.Optional(Type.String({ format: "date-time" })),
});
const StateMigrationRequiredSchema = Type.Object({
  migrationRequired: Type.Literal(true),
  entry: StateEntrySchema,
  stateVersion: Type.String({ minLength: 1 }),
  currentStateVersion: Type.String({ minLength: 1 }),
  writerContractDigest: Type.String({ minLength: 1 }),
});
const StateUserTargetSchema = Type.Object({
  origin: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
  userId: Type.Optional(Type.String({ minLength: 1 })),
});

const schemas = {
  JsonValue: JsonValueSchema,
  StateScope: StateScopeSchema,
  StateEntry: StateEntrySchema,
  StateMigrationRequired: StateMigrationRequiredSchema,
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
    description:
      "Trellis-managed app state for authenticated app and device participants.",
    docs: {
      summary: "Participant state storage APIs.",
      markdown:
        "Provides authenticated read, write, list, delete, and admin inspection APIs for Trellis-managed participant state.",
    },
    rpc: {
      "State.Get": {
        version: "v1",
        input: ref.schema("StateGetRequest"),
        output: ref.schema("StateGetResponse"),
        errors: [
          ref.error("AuthError"),
          ref.error("ValidationError"),
          ref.error("UnexpectedError"),
        ],
        docs: {
          summary: "Read a state value.",
          markdown: "Returns one state value in the caller's authorized scope.",
        },
      },
      "State.Put": {
        version: "v1",
        input: ref.schema("StatePutRequest"),
        output: ref.schema("StatePutResponse"),
        errors: [
          ref.error("AuthError"),
          ref.error("ValidationError"),
          ref.error("UnexpectedError"),
        ],
        docs: {
          summary: "Write a state value.",
          markdown:
            "Creates or replaces one state value in an authorized scope.",
        },
      },
      "State.Delete": {
        version: "v1",
        input: ref.schema("StateDeleteRequest"),
        output: ref.schema("StateDeleteResponse"),
        errors: [
          ref.error("AuthError"),
          ref.error("ValidationError"),
          ref.error("UnexpectedError"),
        ],
        docs: {
          summary: "Delete a state value.",
          markdown:
            "Deletes one state value from the caller's authorized scope.",
        },
      },
      "State.List": {
        version: "v1",
        input: ref.schema("StateListRequest"),
        output: ref.schema("StateListResponse"),
        errors: [
          ref.error("AuthError"),
          ref.error("ValidationError"),
          ref.error("UnexpectedError"),
        ],
        docs: {
          summary: "List state values.",
          markdown:
            "Lists state values visible to the caller for the requested scope and prefix.",
        },
      },
      "State.Admin.Get": {
        version: "v1",
        input: ref.schema("StateAdminGetRequest"),
        output: ref.schema("StateAdminGetResponse"),
        capabilities: { call: ["admin"] },
        errors: [
          ref.error("AuthError"),
          ref.error("ValidationError"),
          ref.error("UnexpectedError"),
        ],
        docs: {
          summary: "Admin read a state value.",
          markdown:
            "Returns one state value across participants for authorized administrators.",
        },
      },
      "State.Admin.List": {
        version: "v1",
        input: ref.schema("StateAdminListRequest"),
        output: ref.schema("StateAdminListResponse"),
        capabilities: { call: ["admin"] },
        errors: [
          ref.error("AuthError"),
          ref.error("ValidationError"),
          ref.error("UnexpectedError"),
        ],
        docs: {
          summary: "Admin list state values.",
          markdown:
            "Lists state values across participants for authorized administrators.",
        },
      },
      "State.Admin.Delete": {
        version: "v1",
        input: ref.schema("StateAdminDeleteRequest"),
        output: ref.schema("StateAdminDeleteResponse"),
        capabilities: { call: ["admin"] },
        errors: [
          ref.error("AuthError"),
          ref.error("ValidationError"),
          ref.error("UnexpectedError"),
        ],
        docs: {
          summary: "Admin delete a state value.",
          markdown:
            "Deletes one state value across participants for authorized administrators.",
        },
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
