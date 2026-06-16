import { defineError, defineServiceContract } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

export const schemas = {
  PingRequest: Type.Object({ message: Type.String() }),
  PingResponse: Type.Object({ message: Type.String() }),
  CallerContextResponse: Type.Object({
    provider: Type.String(),
    callerType: Type.String(),
    participantKind: Type.String(),
    userId: Type.String(),
  }),
  TraceContextResponse: Type.Object({
    provider: Type.String(),
    traceId: Type.String(),
    traceparent: Type.String(),
  }),
} as const;

export const NotFoundError = defineError({
  type: "NotFoundError",
  fields: { resource: Type.String() },
  message: ({ resource }) => `${resource} not found`,
});

export const contract = defineServiceContract(
  { schemas, errors: { NotFoundError } },
  (ref) => ({
    id: "trellis.integration-harness.rpc@v1",
    displayName: "Trellis Integration Harness RPC",
    description:
      "Harness-owned service contract for full-stack Rust/TypeScript RPC verification.",
    uses: {
      required: {
        auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
      },
    },
    rpc: {
      "Harness.Rust.Ping": {
        version: "v1",
        subject: "rpc.v1.Harness.Rust.Ping",
        input: ref.schema("PingRequest"),
        output: ref.schema("PingResponse"),
        capabilities: { call: [] },
        errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
      },
      "Harness.Ts.Ping": {
        version: "v1",
        subject: "rpc.v1.Harness.Ts.Ping",
        input: ref.schema("PingRequest"),
        output: ref.schema("PingResponse"),
        capabilities: { call: [] },
        errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
      },
      "Harness.Rust.CallerContext": {
        version: "v1",
        subject: "rpc.v1.Harness.Rust.CallerContext",
        input: ref.schema("PingRequest"),
        output: ref.schema("CallerContextResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Harness.Ts.CallerContext": {
        version: "v1",
        subject: "rpc.v1.Harness.Ts.CallerContext",
        input: ref.schema("PingRequest"),
        output: ref.schema("CallerContextResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Harness.Rust.TraceContext": {
        version: "v1",
        subject: "rpc.v1.Harness.Rust.TraceContext",
        input: ref.schema("PingRequest"),
        output: ref.schema("TraceContextResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Harness.Ts.TraceContext": {
        version: "v1",
        subject: "rpc.v1.Harness.Ts.TraceContext",
        input: ref.schema("PingRequest"),
        output: ref.schema("TraceContextResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
    },
  }),
);

export const CONTRACT_ID = contract.CONTRACT_ID;
export const CONTRACT = contract.CONTRACT;
export const CONTRACT_DIGEST = contract.CONTRACT_DIGEST;

export default contract;
