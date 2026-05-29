// Generated from ./generated/contracts/manifests/trellis.state@v1.json
import type { TrellisAPI } from "@qlever-llc/trellis/contracts";
import { schema } from "@qlever-llc/trellis/contracts";
import type * as Types from "./types.ts";
import {
  StateAdminDeleteRequestSchema,
  StateAdminDeleteResponseSchema,
  StateAdminGetRequestSchema,
  StateAdminGetResponseSchema,
  StateAdminListRequestSchema,
  StateAdminListResponseSchema,
  StateDeleteRequestSchema,
  StateDeleteResponseSchema,
  StateGetRequestSchema,
  StateGetResponseSchema,
  StateListRequestSchema,
  StateListResponseSchema,
  StatePutRequestSchema,
  StatePutResponseSchema,
} from "./schemas.ts";

export const OWNED_API = {
  rpc: {
    "State.Admin.Delete": {
      subject: "rpc.v1.State.Admin.Delete",
      input: schema<Types.StateAdminDeleteInput>(StateAdminDeleteRequestSchema),
      output: schema<Types.StateAdminDeleteOutput>(
        StateAdminDeleteResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "State.Admin.Get": {
      subject: "rpc.v1.State.Admin.Get",
      input: schema<Types.StateAdminGetInput>(StateAdminGetRequestSchema),
      output: schema<Types.StateAdminGetOutput>(StateAdminGetResponseSchema),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "State.Admin.List": {
      subject: "rpc.v1.State.Admin.List",
      input: schema<Types.StateAdminListInput>(StateAdminListRequestSchema),
      output: schema<Types.StateAdminListOutput>(StateAdminListResponseSchema),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "State.Delete": {
      subject: "rpc.v1.State.Delete",
      input: schema<Types.StateDeleteInput>(StateDeleteRequestSchema),
      output: schema<Types.StateDeleteOutput>(StateDeleteResponseSchema),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "State.Get": {
      subject: "rpc.v1.State.Get",
      input: schema<Types.StateGetInput>(StateGetRequestSchema),
      output: schema<Types.StateGetOutput>(StateGetResponseSchema),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "State.List": {
      subject: "rpc.v1.State.List",
      input: schema<Types.StateListInput>(StateListRequestSchema),
      output: schema<Types.StateListOutput>(StateListResponseSchema),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "State.Put": {
      subject: "rpc.v1.State.Put",
      input: schema<Types.StatePutInput>(StatePutRequestSchema),
      output: schema<Types.StatePutOutput>(StatePutResponseSchema),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
  },
  operations: {},
  events: {},
  feeds: {},
  subjects: {},
} satisfies TrellisAPI;
