// Generated from rust/crates/integration-harness/fixtures/rpc/contract.ts
import type { TrellisAPI } from "@qlever-llc/trellis/contracts";
import { schema } from "@qlever-llc/trellis/contracts";
import * as Types from "./types.ts";
import {
  CallerContextResponseSchema,
  NotFoundErrorDataSchema,
  PingRequestSchema,
  PingResponseSchema,
  TraceContextResponseSchema,
} from "./schemas.ts";

export const OWNED_API = {
  rpc: {
    "Harness.Rust.CallerContext": {
      subject: "rpc.v1.Harness.Rust.CallerContext",
      input: schema<Types.HarnessRustCallerContextInput>(PingRequestSchema),
      output: schema<Types.HarnessRustCallerContextOutput>(
        CallerContextResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["UnexpectedError"] as const,
      declaredErrorTypes: ["UnexpectedError"] as const,
    },
    "Harness.Rust.Ping": {
      subject: "rpc.v1.Harness.Rust.Ping",
      input: schema<Types.HarnessRustPingInput>(PingRequestSchema),
      output: schema<Types.HarnessRustPingOutput>(PingResponseSchema),
      callerCapabilities: [],
      errors: ["NotFoundError", "UnexpectedError"] as const,
      declaredErrorTypes: ["NotFoundError", "UnexpectedError"] as const,
      runtimeErrors: [
        {
          type: "NotFoundError",
          schema: schema<Types.NotFoundErrorData>(NotFoundErrorDataSchema),
          fromSerializable: Types.NotFoundError.fromSerializable,
        },
      ] as const,
    },
    "Harness.Rust.TraceContext": {
      subject: "rpc.v1.Harness.Rust.TraceContext",
      input: schema<Types.HarnessRustTraceContextInput>(PingRequestSchema),
      output: schema<Types.HarnessRustTraceContextOutput>(
        TraceContextResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["UnexpectedError"] as const,
      declaredErrorTypes: ["UnexpectedError"] as const,
    },
    "Harness.Ts.CallerContext": {
      subject: "rpc.v1.Harness.Ts.CallerContext",
      input: schema<Types.HarnessTsCallerContextInput>(PingRequestSchema),
      output: schema<Types.HarnessTsCallerContextOutput>(
        CallerContextResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["UnexpectedError"] as const,
      declaredErrorTypes: ["UnexpectedError"] as const,
    },
    "Harness.Ts.Ping": {
      subject: "rpc.v1.Harness.Ts.Ping",
      input: schema<Types.HarnessTsPingInput>(PingRequestSchema),
      output: schema<Types.HarnessTsPingOutput>(PingResponseSchema),
      callerCapabilities: [],
      errors: ["NotFoundError", "UnexpectedError"] as const,
      declaredErrorTypes: ["NotFoundError", "UnexpectedError"] as const,
      runtimeErrors: [
        {
          type: "NotFoundError",
          schema: schema<Types.NotFoundErrorData>(NotFoundErrorDataSchema),
          fromSerializable: Types.NotFoundError.fromSerializable,
        },
      ] as const,
    },
    "Harness.Ts.TraceContext": {
      subject: "rpc.v1.Harness.Ts.TraceContext",
      input: schema<Types.HarnessTsTraceContextInput>(PingRequestSchema),
      output: schema<Types.HarnessTsTraceContextOutput>(
        TraceContextResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["UnexpectedError"] as const,
      declaredErrorTypes: ["UnexpectedError"] as const,
    },
  },
  operations: {},
  events: {},
  feeds: {},
  subjects: {},
} satisfies TrellisAPI;
