// Generated from ./generated/contracts/manifests/trellis.jobs@v1.json
import type { TrellisAPI } from "../../../contracts.ts";
import { schema } from "../../../contracts.ts";
import * as Types from "./types.ts";
import {
  EmptySchema,
  JobsCancelRequestSchema,
  JobsCancelResponseSchema,
  JobsDismissDLQRequestSchema,
  JobsDismissDLQResponseSchema,
  JobsGetKeyRequestSchema,
  JobsGetKeyResponseSchema,
  JobsGetRequestSchema,
  JobsGetResponseSchema,
  JobsHealthResponseSchema,
  JobsListDLQRequestSchema,
  JobsListDLQResponseSchema,
  JobsListRequestSchema,
  JobsListResponseSchema,
  JobsListServicesRequestSchema,
  JobsListServicesResponseSchema,
  JobsReplayDLQRequestSchema,
  JobsReplayDLQResponseSchema,
  JobsRetryRequestSchema,
  JobsRetryResponseSchema,
  NotFoundErrorDataSchema,
} from "./schemas.ts";

export const OWNED_API = {
  rpc: {
    "Jobs.Cancel": {
      subject: "rpc.v1.Jobs.Cancel",
      input: schema<Types.JobsCancelInput>(JobsCancelRequestSchema),
      output: schema<Types.JobsCancelOutput>(JobsCancelResponseSchema),
      callerCapabilities: ["trellis.jobs::admin.mutate"] as const,
      errors: ["UnexpectedError", "ValidationError", "NotFoundError"] as const,
      declaredErrorTypes: [
        "UnexpectedError",
        "ValidationError",
        "NotFoundError",
      ] as const,
      runtimeErrors: [
        {
          type: "NotFoundError",
          schema: schema<Types.NotFoundErrorData>(NotFoundErrorDataSchema),
          fromSerializable: Types.NotFoundError.fromSerializable,
        },
      ] as const,
    },
    "Jobs.DismissDLQ": {
      subject: "rpc.v1.Jobs.DismissDLQ",
      input: schema<Types.JobsDismissDLQInput>(JobsDismissDLQRequestSchema),
      output: schema<Types.JobsDismissDLQOutput>(JobsDismissDLQResponseSchema),
      callerCapabilities: ["trellis.jobs::admin.mutate"] as const,
      errors: ["UnexpectedError", "ValidationError", "NotFoundError"] as const,
      declaredErrorTypes: [
        "UnexpectedError",
        "ValidationError",
        "NotFoundError",
      ] as const,
      runtimeErrors: [
        {
          type: "NotFoundError",
          schema: schema<Types.NotFoundErrorData>(NotFoundErrorDataSchema),
          fromSerializable: Types.NotFoundError.fromSerializable,
        },
      ] as const,
    },
    "Jobs.Get": {
      subject: "rpc.v1.Jobs.Get",
      input: schema<Types.JobsGetInput>(JobsGetRequestSchema),
      output: schema<Types.JobsGetOutput>(JobsGetResponseSchema),
      callerCapabilities: ["trellis.jobs::admin.read"] as const,
      errors: ["UnexpectedError", "ValidationError", "NotFoundError"] as const,
      declaredErrorTypes: [
        "UnexpectedError",
        "ValidationError",
        "NotFoundError",
      ] as const,
      runtimeErrors: [
        {
          type: "NotFoundError",
          schema: schema<Types.NotFoundErrorData>(NotFoundErrorDataSchema),
          fromSerializable: Types.NotFoundError.fromSerializable,
        },
      ] as const,
    },
    "Jobs.GetKey": {
      subject: "rpc.v1.Jobs.GetKey",
      input: schema<Types.JobsGetKeyInput>(JobsGetKeyRequestSchema),
      output: schema<Types.JobsGetKeyOutput>(JobsGetKeyResponseSchema),
      callerCapabilities: ["trellis.jobs::admin.read"] as const,
      errors: ["UnexpectedError", "ValidationError", "NotFoundError"] as const,
      declaredErrorTypes: [
        "UnexpectedError",
        "ValidationError",
        "NotFoundError",
      ] as const,
      runtimeErrors: [
        {
          type: "NotFoundError",
          schema: schema<Types.NotFoundErrorData>(NotFoundErrorDataSchema),
          fromSerializable: Types.NotFoundError.fromSerializable,
        },
      ] as const,
    },
    "Jobs.Health": {
      subject: "rpc.v1.Jobs.Health",
      input: schema<Types.JobsHealthInput>(EmptySchema),
      output: schema<Types.JobsHealthOutput>(JobsHealthResponseSchema),
      callerCapabilities: ["trellis.jobs::admin.read"] as const,
      errors: ["UnexpectedError"] as const,
      declaredErrorTypes: ["UnexpectedError"] as const,
    },
    "Jobs.List": {
      subject: "rpc.v1.Jobs.List",
      input: schema<Types.JobsListInput>(JobsListRequestSchema),
      output: schema<Types.JobsListOutput>(JobsListResponseSchema),
      callerCapabilities: ["trellis.jobs::admin.read"] as const,
      errors: ["UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: ["UnexpectedError", "ValidationError"] as const,
    },
    "Jobs.ListDLQ": {
      subject: "rpc.v1.Jobs.ListDLQ",
      input: schema<Types.JobsListDLQInput>(JobsListDLQRequestSchema),
      output: schema<Types.JobsListDLQOutput>(JobsListDLQResponseSchema),
      callerCapabilities: ["trellis.jobs::admin.read"] as const,
      errors: ["UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: ["UnexpectedError", "ValidationError"] as const,
    },
    "Jobs.ListServices": {
      subject: "rpc.v1.Jobs.ListServices",
      input: schema<Types.JobsListServicesInput>(JobsListServicesRequestSchema),
      output: schema<Types.JobsListServicesOutput>(
        JobsListServicesResponseSchema,
      ),
      callerCapabilities: ["trellis.jobs::admin.read"] as const,
      errors: ["UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: ["UnexpectedError", "ValidationError"] as const,
    },
    "Jobs.ReplayDLQ": {
      subject: "rpc.v1.Jobs.ReplayDLQ",
      input: schema<Types.JobsReplayDLQInput>(JobsReplayDLQRequestSchema),
      output: schema<Types.JobsReplayDLQOutput>(JobsReplayDLQResponseSchema),
      callerCapabilities: ["trellis.jobs::admin.mutate"] as const,
      errors: ["UnexpectedError", "ValidationError", "NotFoundError"] as const,
      declaredErrorTypes: [
        "UnexpectedError",
        "ValidationError",
        "NotFoundError",
      ] as const,
      runtimeErrors: [
        {
          type: "NotFoundError",
          schema: schema<Types.NotFoundErrorData>(NotFoundErrorDataSchema),
          fromSerializable: Types.NotFoundError.fromSerializable,
        },
      ] as const,
    },
    "Jobs.Retry": {
      subject: "rpc.v1.Jobs.Retry",
      input: schema<Types.JobsRetryInput>(JobsRetryRequestSchema),
      output: schema<Types.JobsRetryOutput>(JobsRetryResponseSchema),
      callerCapabilities: ["trellis.jobs::admin.mutate"] as const,
      errors: ["UnexpectedError", "ValidationError", "NotFoundError"] as const,
      declaredErrorTypes: [
        "UnexpectedError",
        "ValidationError",
        "NotFoundError",
      ] as const,
      runtimeErrors: [
        {
          type: "NotFoundError",
          schema: schema<Types.NotFoundErrorData>(NotFoundErrorDataSchema),
          fromSerializable: Types.NotFoundError.fromSerializable,
        },
      ] as const,
    },
  },
  operations: {},
  events: {},
  feeds: {},
  subjects: {},
} satisfies TrellisAPI;
