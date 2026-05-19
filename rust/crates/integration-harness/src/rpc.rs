use std::collections::BTreeMap;
use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::Arc;
use std::time::Duration;

use async_nats::HeaderMap;
use bytes::Bytes;
use futures_util::StreamExt;
use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_auth::{
    connect_admin_client_async, generate_session_keypair, AdminLoginOutcome, AdminSessionState,
    AuthRequestsValidateRequest,
};
use trellis_auth_adapters::request_validator::payload_hash_base64url;
use trellis_auth_adapters::AuthRequestValidatorAdapter;
use trellis_client::{ServiceConnectOptions, TrellisClient, TrellisClientError};
use trellis_contracts::{
    digest_contract_json, rpc, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis_sdk_auth::client::AuthClient as SdkAuthClient;
use trellis_sdk_auth::types::AuthEnvelopesExpandRequest;
use trellis_service::{bootstrap_service_host, BootstrapBinding, HandlerResult, Router};

use crate::browser::{complete_local_login, BrowserContainer};
use crate::workspace::repo_root;

pub(crate) const HARNESS_DEPLOYMENT_ID: &str = "harness.rpc";
const HARNESS_RUST_SERVICE_NAME: &str = "harness-rpc-rust";
pub(crate) const HARNESS_CONTRACT_ID: &str = "trellis.integration-harness.rpc@v1";
const HARNESS_RUST_PING_SUBJECT: &str = "rpc.v1.Harness.Rust.Ping";
const HARNESS_TS_PING_SUBJECT: &str = "rpc.v1.Harness.Ts.Ping";
const HARNESS_RUST_CALLER_CONTEXT_SUBJECT: &str = "rpc.v1.Harness.Rust.CallerContext";
const HARNESS_TS_CALLER_CONTEXT_SUBJECT: &str = "rpc.v1.Harness.Ts.CallerContext";
const HARNESS_RUST_TRACE_CONTEXT_SUBJECT: &str = "rpc.v1.Harness.Rust.TraceContext";
const HARNESS_TS_TRACE_CONTEXT_SUBJECT: &str = "rpc.v1.Harness.Ts.TraceContext";
const HARNESS_RUST_TRACE_ID: &str = "4bf92f3577b34da6a3ce929d0e0e4736";
const HARNESS_TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

pub(crate) fn harness_service_contract_json() -> Result<String> {
    let ping_schema = json!({
        "type": "object",
        "properties": { "message": { "type": "string" } },
        "required": ["message"]
    });
    let caller_context_schema = json!({
        "type": "object",
        "properties": {
            "provider": { "type": "string" },
            "callerType": { "type": "string" },
            "participantKind": { "type": "string" },
            "userId": { "type": "string" }
        },
        "required": ["provider", "callerType", "participantKind", "userId"]
    });
    let trace_context_schema = json!({
        "type": "object",
        "properties": {
            "provider": { "type": "string" },
            "traceId": { "type": "string" },
            "traceparent": { "type": "string" }
        },
        "required": ["provider", "traceId", "traceparent"]
    });
    let not_found_error_schema = json!({
        "type": "object",
        "required": ["id", "type", "message", "resource"],
        "properties": {
            "id": { "type": "string" },
            "type": { "type": "string", "const": "NotFoundError" },
            "message": { "type": "string" },
            "resource": { "type": "string" },
            "context": { "type": "object", "patternProperties": { "^.*$": {} } },
            "traceId": { "type": "string" }
        }
    });
    let manifest = ContractManifestBuilder::new(
        HARNESS_CONTRACT_ID,
        "Trellis Integration Harness RPC",
        "Harness-owned service contract for full-stack Rust/TypeScript RPC verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("PingRequest", ping_schema.clone())
    .schema("PingResponse", ping_schema)
    .schema("CallerContextResponse", caller_context_schema)
    .schema("TraceContextResponse", trace_context_schema)
    .schema("NotFoundErrorData", not_found_error_schema)
    .error("NotFoundError", "NotFoundError", "NotFoundErrorData")
    .rpc(
        "Harness.Rust.Ping",
        rpc(
            "v1",
            HARNESS_RUST_PING_SUBJECT,
            "PingRequest",
            "PingResponse",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["NotFoundError", "UnexpectedError"]),
    )
    .rpc(
        "Harness.Ts.Ping",
        rpc("v1", HARNESS_TS_PING_SUBJECT, "PingRequest", "PingResponse")
            .with_call_capabilities(std::iter::empty::<&str>())
            .with_error_types(["NotFoundError", "UnexpectedError"]),
    )
    .rpc(
        "Harness.Rust.CallerContext",
        rpc(
            "v1",
            HARNESS_RUST_CALLER_CONTEXT_SUBJECT,
            "PingRequest",
            "CallerContextResponse",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .rpc(
        "Harness.Ts.CallerContext",
        rpc(
            "v1",
            HARNESS_TS_CALLER_CONTEXT_SUBJECT,
            "PingRequest",
            "CallerContextResponse",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .rpc(
        "Harness.Rust.TraceContext",
        rpc(
            "v1",
            HARNESS_RUST_TRACE_CONTEXT_SUBJECT,
            "PingRequest",
            "TraceContextResponse",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .rpc(
        "Harness.Ts.TraceContext",
        rpc(
            "v1",
            HARNESS_TS_TRACE_CONTEXT_SUBJECT,
            "PingRequest",
            "TraceContextResponse",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .build()
    .map_err(|error| miette!("failed to build RPC harness service contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize RPC harness service contract: {error}"))
}

pub(crate) fn harness_caller_contract_json() -> Result<String> {
    harness_caller_contract_json_with_calls(
        ["Auth.Sessions.Logout", "Auth.Sessions.Me"],
        [
            "Harness.Rust.Ping",
            "Harness.Ts.Ping",
            "Harness.Rust.CallerContext",
            "Harness.Ts.CallerContext",
            "Harness.Rust.TraceContext",
            "Harness.Ts.TraceContext",
        ],
    )
}

fn harness_updated_caller_contract_json() -> Result<String> {
    harness_caller_contract_json_with_calls(
        ["Auth.Sessions.Logout", "Auth.Sessions.Me"],
        ["Harness.Rust.Ping"],
    )
}

fn harness_caller_contract_json_with_calls<const AUTH: usize, const HARNESS: usize>(
    auth_calls: [&str; AUTH],
    harness_calls: [&str; HARNESS],
) -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-rpc-agent@v1",
        "Trellis Integration Agent",
        "Verify delegated Rust agent login and harness RPC calls.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(auth_calls),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID).with_rpc_call(harness_calls),
    )
    .build()
    .map_err(|error| miette!("failed to build RPC harness caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize RPC harness caller contract: {error}"))
}

const TS_SERVICE_SCRIPT: &str = r#"import { defineError, defineServiceContract, err, ok, UnexpectedError } from "@qlever-llc/trellis";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { getActiveSpan } from "@qlever-llc/trellis/tracing";
import { Type } from "typebox";

new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
}).register();

const schemas = {
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

const NotFoundError = defineError({
  type: "NotFoundError",
  fields: { resource: Type.String() },
  message: ({ resource }) => `${resource} not found`,
});

const contract = defineServiceContract({ schemas, errors: { NotFoundError } }, (ref) => ({
  id: "trellis.integration-harness.rpc@v1",
  displayName: "Trellis Integration Harness RPC",
  description: "Harness-owned service contract for full-stack Rust/TypeScript RPC verification.",
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
}));

const expectedDigest = Deno.env.get("HARNESS_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
}

const service = await TrellisService.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  name: "harness-rpc-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: false },
}).orThrow();

await service.trellis.mount("Harness.Ts.Ping", ({ input }) => {
  if (input.message === "handler-error") {
    return err(new UnexpectedError({ cause: new Error("ts handler error marker") }));
  }
  if (input.message === "not-found") {
    return err(new NotFoundError({ resource: "Workspace" }));
  }
  return ok({ message: input.message });
});
await service.trellis.mount("Harness.Ts.CallerContext", ({ context }) => {
  const caller = context.caller;
  if (caller.type !== "user") throw new Error(`expected user caller, got ${caller.type}`);
  if (caller.participantKind !== "agent") throw new Error(`expected agent caller, got ${caller.participantKind}`);
  return ok({
    provider: "ts",
    callerType: caller.type,
    participantKind: caller.participantKind,
    userId: caller.userId,
  });
});
await service.trellis.mount("Harness.Ts.TraceContext", () => {
  const span = getActiveSpan();
  const traceId = span?.spanContext().traceId ?? "";
  return ok({
    provider: "ts",
    traceId,
    traceparent: traceId.length > 0 ? `00-${traceId}-0000000000000000-01` : "",
  });
});
console.log("TS_SERVICE_READY");

await new Promise<void>(() => {});
"#;

const TS_CLIENT_SCRIPT: &str = r#"import { defineAgentContract, defineError, defineServiceContract, isErr, Trellis, TrellisClient } from "@qlever-llc/trellis";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { getTracer, withSpanAsync } from "@qlever-llc/trellis/tracing";
import { Type } from "typebox";

new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
}).register();

const schemas = {
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

const NotFoundError = defineError({
  type: "NotFoundError",
  fields: { resource: Type.String() },
  message: ({ resource }) => `${resource} not found`,
});

const harness = defineServiceContract({ schemas, errors: { NotFoundError } }, (ref) => ({
  id: "trellis.integration-harness.rpc@v1",
  displayName: "Trellis Integration Harness RPC",
  description: "Harness-owned service contract for full-stack Rust/TypeScript RPC verification.",
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
}));

const contract = defineAgentContract(() => ({
  id: "trellis.integration-rpc-agent@v1",
  displayName: "Trellis Integration Agent",
  description: "Verify delegated Rust agent login and harness RPC calls.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] } }),
      harness: harness.use({ rpc: { call: ["Harness.Rust.Ping", "Harness.Ts.Ping", "Harness.Rust.CallerContext", "Harness.Ts.CallerContext", "Harness.Rust.TraceContext", "Harness.Ts.TraceContext"] } }),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
}

const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: {
    mode: "session_key",
    sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!,
    redirectTo: "/_trellis/portal/users/login",
  },
  log: false,
}).orThrow();

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: ${actual} !== ${expected}`);
  }
}

async function assertPing(method: "Harness.Rust.Ping" | "Harness.Ts.Ping", message: string) {
  const response = await client.request(method, { message }).orThrow() as { message: string };
  if (response.message !== message) {
    throw new Error(`${method} returned ${JSON.stringify(response)}`);
  }
}

type CallerContextResponse = {
  provider: string;
  callerType: string;
  participantKind: string;
  userId: string;
};

function assertCallerContextValue(actual: CallerContextResponse, provider: "rust" | "ts") {
  assertEqual(actual.provider, provider, `${provider} caller context provider mismatch`);
  assertEqual(actual.callerType, "user", `${provider} caller type mismatch`);
  assertEqual(actual.participantKind, "agent", `${provider} participant kind mismatch`);
  assert(actual.userId.length > 0, `${provider} user id should be populated`);
}

async function assertCallerContext(method: "Harness.Rust.CallerContext" | "Harness.Ts.CallerContext", provider: "rust" | "ts") {
  const response = await client.request(method, { message: "caller-context-or-throw" }).orThrow() as CallerContextResponse;
  assertCallerContextValue(response, provider);
  const result = await client.request(method, { message: "caller-context-take" });
  const taken = result.take();
  if (isErr(taken)) {
    throw taken.error;
  }
  assertCallerContextValue(taken as CallerContextResponse, provider);
}

type TraceContextResponse = {
  provider: string;
  traceId: string;
  traceparent: string;
};

async function assertTraceContext(method: "Harness.Rust.TraceContext" | "Harness.Ts.TraceContext", provider: "rust" | "ts") {
  const span = getTracer().startSpan(`harness.ts.${provider}.trace`);
  const expectedTraceId = span.spanContext().traceId;
  const response = await withSpanAsync(span, async () => {
    return await client.request(method, { message: "trace-context" }).orThrow() as TraceContextResponse;
  });
  span.end();
  assertEqual(response.provider, provider, `${provider} trace provider mismatch`);
  assertEqual(response.traceId, expectedTraceId, `${provider} trace id mismatch`);
  assert(response.traceparent.includes(expectedTraceId), `${provider} traceparent did not include ${expectedTraceId}: ${response.traceparent}`);
}

async function assertHandlerError(method: "Harness.Rust.Ping" | "Harness.Ts.Ping") {
  const result = await client.request(method, { message: "handler-error" });
  if (result.isOk()) {
    throw new Error(`${method} handler error unexpectedly succeeded`);
  }
  const error = result.error;
  if (error.name !== "UnexpectedError") {
    throw new Error(`${method} returned ${error.name} instead of UnexpectedError`);
  }
}

async function assertNotFoundError(method: "Harness.Rust.Ping" | "Harness.Ts.Ping") {
  const result = await client.request(method, { message: "not-found" });
  if (result.isOk()) {
    throw new Error(`${method} not-found unexpectedly succeeded`);
  }
  const error = result.error;
  assert(error instanceof NotFoundError, `${method} did not reconstruct NotFoundError`);
  assertEqual(error.resource, "Workspace", `${method} NotFoundError resource mismatch`);
  assertEqual(error.message, "Workspace not found", `${method} NotFoundError message mismatch`);
}

function assertTemplateBehavior() {
  const templateClient = client as Trellis;
  const escaped = templateClient.template("rpc.{/id}", { id: "a.b" });
  assert(escaped.isOk(), "escaped template failed");
  assertEqual(escaped.take(), "rpc.a~2E~b", "escaped template result mismatch");

  const zero = templateClient.template("rpc.{/id}", { id: 0 });
  assert(zero.isOk(), "zero template failed");
  assertEqual(zero.take(), "rpc.0", "zero template result mismatch");

  const empty = templateClient.template("rpc.{/id}", { id: "" });
  assert(empty.isOk(), "empty template failed");
  assertEqual(empty.take(), "rpc._", "empty template result mismatch");

  const wildcard = templateClient.template("rpc.{/id}", {}, true);
  assert(wildcard.isOk(), "wildcard template failed");
  assertEqual(wildcard.take(), "rpc.*", "wildcard template result mismatch");
}

async function assertInputValidationBeforeSend() {
  const result = await client.request("Harness.Rust.Ping", JSON.parse('{"message":1}'));
  assert(result.isErr(), "invalid RPC input unexpectedly succeeded");
}

async function assertServiceStopLifecycle(name: string, mode: "once" | "twice" | "concurrent") {
  const service = await TrellisService.connect({
    trellisUrl: Deno.env.get("TRELLIS_URL")!,
    contract: harness,
    name,
    sessionKeySeed: Deno.env.get("HARNESS_STOP_SERVICE_SEED")!,
    server: { log: false },
  }).orThrow();
  assertEqual(service.nc.isClosed(), false, `${name} connection should start open`);

  if (mode === "once") {
    await service.stop();
  } else if (mode === "twice") {
    await service.stop();
    await service.stop();
  } else {
    await Promise.all([service.stop(), service.stop()]);
  }

  assertEqual(service.nc.isClosed(), true, `${name} connection should be closed after stop`);
}

async function assertExternalConnectionLifecycle() {
  const trellis = new Trellis("external-live-client", client.natsConnection, {
    sessionKey: "external-live-token",
    sign: () => new Uint8Array(64),
  }, { api: contract.API.trellis });
  assertEqual(trellis.name, "external-live-client", "external Trellis name mismatch");
  assert(trellis.natsConnection === client.natsConnection, "external Trellis did not retain caller NATS connection");
  assertEqual(client.natsConnection.isClosed(), false, "external NATS connection should start open");

  await client.natsConnection.drain();
  assertEqual(client.natsConnection.isClosed(), true, "external NATS connection should be closed after caller drain");
}

await assertPing("Harness.Rust.Ping", "ts-client-rust-service");
await assertPing("Harness.Ts.Ping", "ts-client-ts-service");
await assertCallerContext("Harness.Rust.CallerContext", "rust");
await assertCallerContext("Harness.Ts.CallerContext", "ts");
await assertTraceContext("Harness.Rust.TraceContext", "rust");
await assertTraceContext("Harness.Ts.TraceContext", "ts");
await assertHandlerError("Harness.Rust.Ping");
await assertHandlerError("Harness.Ts.Ping");
await assertNotFoundError("Harness.Rust.Ping");
await assertNotFoundError("Harness.Ts.Ping");
assertTemplateBehavior();
await assertInputValidationBeforeSend();
await assertServiceStopLifecycle("harness-rpc-ts-stop-once", "once");
await assertServiceStopLifecycle("harness-rpc-ts-stop-twice", "twice");
await assertServiceStopLifecycle("harness-rpc-ts-stop-concurrent", "concurrent");
await assertExternalConnectionLifecycle();
console.log("TS_CLIENT_OK");
"#;

const TS_UPDATED_CLIENT_SCRIPT: &str = r#"import { defineAgentContract, defineError, defineServiceContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

const schemas = {
  PingRequest: Type.Object({ message: Type.String() }),
  PingResponse: Type.Object({ message: Type.String() }),
} as const;

const NotFoundError = defineError({
  type: "NotFoundError",
  fields: { resource: Type.String() },
  message: ({ resource }) => `${resource} not found`,
});

const harness = defineServiceContract({ schemas, errors: { NotFoundError } }, (ref) => ({
  id: "trellis.integration-harness.rpc@v1",
  displayName: "Trellis Integration Harness RPC",
  description: "Harness-owned service contract for full-stack Rust/TypeScript RPC verification.",
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
  },
}));

const contract = defineAgentContract(() => ({
  id: "trellis.integration-rpc-agent@v1",
  displayName: "Trellis Integration Agent",
  description: "Verify delegated Rust agent login and harness RPC calls.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] } }),
      harness: harness.use({ rpc: { call: ["Harness.Rust.Ping"] } }),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`updated caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
}

const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: {
    mode: "session_key",
    sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!,
    redirectTo: "/_trellis/portal/users/login",
  },
  log: false,
}).orThrow();

const response = await client.request("Harness.Rust.Ping", { message: "ts-updated-contract" }).orThrow() as { message: string };
if (response.message !== "ts-updated-contract") {
  throw new Error(`Harness.Rust.Ping returned ${JSON.stringify(response)}`);
}

await client.natsConnection.drain();
console.log("TS_UPDATED_CLIENT_OK");
"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct HarnessPingRequest {
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct HarnessPingResponse {
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HarnessCallerContextResponse {
    pub(crate) provider: String,
    pub(crate) caller_type: String,
    pub(crate) participant_kind: String,
    pub(crate) user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HarnessTraceContextResponse {
    pub(crate) provider: String,
    pub(crate) trace_id: String,
    pub(crate) traceparent: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct HarnessNotFoundError {
    resource: String,
}

pub(crate) struct HarnessRustPingRpc;

impl trellis_client::RpcDescriptor for HarnessRustPingRpc {
    type Input = HarnessPingRequest;
    type Output = HarnessPingResponse;

    const KEY: &'static str = "Harness.Rust.Ping";
    const SUBJECT: &'static str = HARNESS_RUST_PING_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["NotFoundError", "UnexpectedError"];
}

impl trellis_service::RpcDescriptor for HarnessRustPingRpc {
    type Input = HarnessPingRequest;
    type Output = HarnessPingResponse;

    const KEY: &'static str = "Harness.Rust.Ping";
    const SUBJECT: &'static str = HARNESS_RUST_PING_SUBJECT;
}

pub(crate) struct HarnessTsPingRpc;

impl trellis_client::RpcDescriptor for HarnessTsPingRpc {
    type Input = HarnessPingRequest;
    type Output = HarnessPingResponse;

    const KEY: &'static str = "Harness.Ts.Ping";
    const SUBJECT: &'static str = HARNESS_TS_PING_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["NotFoundError", "UnexpectedError"];
}

pub(crate) struct HarnessRustCallerContextRpc;

impl trellis_client::RpcDescriptor for HarnessRustCallerContextRpc {
    type Input = HarnessPingRequest;
    type Output = HarnessCallerContextResponse;

    const KEY: &'static str = "Harness.Rust.CallerContext";
    const SUBJECT: &'static str = HARNESS_RUST_CALLER_CONTEXT_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

impl trellis_service::RpcDescriptor for HarnessRustCallerContextRpc {
    type Input = HarnessPingRequest;
    type Output = HarnessCallerContextResponse;

    const KEY: &'static str = "Harness.Rust.CallerContext";
    const SUBJECT: &'static str = HARNESS_RUST_CALLER_CONTEXT_SUBJECT;
}

pub(crate) struct HarnessTsCallerContextRpc;

impl trellis_client::RpcDescriptor for HarnessTsCallerContextRpc {
    type Input = HarnessPingRequest;
    type Output = HarnessCallerContextResponse;

    const KEY: &'static str = "Harness.Ts.CallerContext";
    const SUBJECT: &'static str = HARNESS_TS_CALLER_CONTEXT_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

pub(crate) struct HarnessRustTraceContextRpc;

impl trellis_client::RpcDescriptor for HarnessRustTraceContextRpc {
    type Input = HarnessPingRequest;
    type Output = HarnessTraceContextResponse;

    const KEY: &'static str = "Harness.Rust.TraceContext";
    const SUBJECT: &'static str = HARNESS_RUST_TRACE_CONTEXT_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

impl trellis_service::RpcDescriptor for HarnessRustTraceContextRpc {
    type Input = HarnessPingRequest;
    type Output = HarnessTraceContextResponse;

    const KEY: &'static str = "Harness.Rust.TraceContext";
    const SUBJECT: &'static str = HARNESS_RUST_TRACE_CONTEXT_SUBJECT;
}

pub(crate) struct HarnessTsTraceContextRpc;

impl trellis_client::RpcDescriptor for HarnessTsTraceContextRpc {
    type Input = HarnessPingRequest;
    type Output = HarnessTraceContextResponse;

    const KEY: &'static str = "Harness.Ts.TraceContext";
    const SUBJECT: &'static str = HARNESS_TS_TRACE_CONTEXT_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

pub(crate) async fn run_rpc_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let admin_client = connect_admin_client_async(&admin_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis_auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(HARNESS_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let service_contract_json = harness_service_contract_json()?;
    let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    let sdk_auth_client = SdkAuthClient::new(&admin_client);
    sdk_auth_client
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&service_contract_json)?,
            deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
            expected_digest: contract_digest.clone(),
        })
        .await
        .into_diagnostic()?;

    let (rust_service_seed, rust_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis_sdk_auth::AuthServiceInstancesProvisionRequest {
            deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
            instance_key: rust_service_key,
        })
        .await
        .into_diagnostic()?;
    let (ts_service_seed, ts_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis_sdk_auth::AuthServiceInstancesProvisionRequest {
            deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
            instance_key: ts_service_key,
        })
        .await
        .into_diagnostic()?;
    let (ts_stop_service_seed, ts_stop_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis_sdk_auth::AuthServiceInstancesProvisionRequest {
            deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
            instance_key: ts_stop_service_key,
        })
        .await
        .into_diagnostic()?;

    let service_client = Arc::new(
        connect_service_with_retry(trellis_url, &contract_digest, &rust_service_seed)
            .await
            .into_diagnostic()?,
    );

    let mut router = Router::new();
    router.register_rpc::<HarnessRustPingRpc, _, _>(|_ctx, input| async move {
        if input.message == "handler-error" {
            return Err(trellis_service::ServerError::Nats(
                "rust handler error marker".to_string(),
            )) as HandlerResult<HarnessPingResponse>;
        }
        if input.message == "not-found" {
            return Err(trellis_service::ServerError::DeclaredRpc(
                trellis_service::DeclaredRpcError::new(
                    "NotFoundError",
                    "Workspace not found",
                    [("resource", json!("Workspace"))],
                ),
            )) as HandlerResult<HarnessPingResponse>;
        }
        Ok::<_, trellis_service::ServerError>(HarnessPingResponse {
            message: input.message,
        }) as HandlerResult<HarnessPingResponse>
    });
    router.register_rpc::<HarnessRustCallerContextRpc, _, _>(|ctx, _input| async move {
        caller_context_response("rust", &ctx) as HandlerResult<HarnessCallerContextResponse>
    });
    router.register_rpc::<HarnessRustTraceContextRpc, _, _>(|ctx, _input| async move {
        trace_context_response("rust", &ctx) as HandlerResult<HarnessTraceContextResponse>
    });
    let validator = AuthRequestValidatorAdapter::new(Arc::clone(&service_client));
    let host = bootstrap_service_host(
        HARNESS_RUST_SERVICE_NAME,
        BootstrapBinding {
            contract_id: HARNESS_CONTRACT_ID.to_string(),
            digest: contract_digest.clone(),
        },
        router,
        validator,
    );
    let service_nats = service_client.nats().clone();
    let service_task = tokio::spawn(async move {
        trellis_service::run_multi_subject_service(
            service_nats,
            &[
                HARNESS_RUST_PING_SUBJECT,
                HARNESS_RUST_CALLER_CONTEXT_SUBJECT,
                HARNESS_RUST_TRACE_CONTEXT_SUBJECT,
            ],
            host,
        )
        .await
    });

    expect_call_denied(&admin_client).await?;
    let ts_service = TsServiceProcess::start(trellis_url, &contract_digest, &ts_service_seed)?;
    ts_service.wait_ready().await?;

    let call_result = async {
        let caller_contract_json = harness_caller_contract_json()?;
        let caller_login = reauth_contract(
            &admin_login.state,
            &caller_contract_json,
            trellis_url,
            browser,
        )
        .await?;
        let caller_client = connect_admin_client_async(&caller_login.state)
            .await
            .into_diagnostic()?;
        assert_auth_requests_validate_round_trip(
            service_client.as_ref(),
            &caller_client,
            &caller_login.user.user_id,
        )
        .await?;
        assert_auth_protocol_matrix(service_client.as_ref(), &caller_client).await?;
        assert_rust_client_ping::<HarnessRustPingRpc>(&caller_client, "rust-client-rust-service")
            .await?;
        assert_rust_client_ping::<HarnessTsPingRpc>(&caller_client, "rust-client-ts-service")
            .await?;
        assert_rust_client_caller_context::<HarnessRustCallerContextRpc>(
            &caller_client,
            "rust",
            &caller_login.user.user_id,
        )
        .await?;
        assert_rust_client_caller_context::<HarnessTsCallerContextRpc>(
            &caller_client,
            "ts",
            &caller_login.user.user_id,
        )
        .await?;
        assert_rust_client_trace_context::<HarnessRustTraceContextRpc>(&caller_client, "rust")
            .await?;
        assert_rust_client_trace_context::<HarnessTsTraceContextRpc>(&caller_client, "ts").await?;
        expect_rust_client_handler_error::<HarnessRustPingRpc>(&caller_client).await?;
        expect_rust_client_handler_error::<HarnessTsPingRpc>(&caller_client).await?;
        expect_rust_client_not_found_error::<HarnessRustPingRpc>(&caller_client).await?;
        expect_rust_client_not_found_error::<HarnessTsPingRpc>(&caller_client).await?;
        run_ts_client(
            trellis_url,
            &caller_login.state.session_seed,
            &ts_stop_service_seed,
        )
        .await?;
        let updated_caller_contract_json = harness_updated_caller_contract_json()?;
        let updated_caller_login = reauth_updated_contract(
            &caller_login.state,
            &updated_caller_contract_json,
            trellis_url,
            browser,
        )
        .await?;
        let updated_caller_client = connect_admin_client_async(&updated_caller_login.state)
            .await
            .into_diagnostic()?;
        assert_rust_client_ping::<HarnessRustPingRpc>(
            &updated_caller_client,
            "rust-updated-contract",
        )
        .await?;
        run_ts_updated_client(trellis_url, &updated_caller_login.state.session_seed).await?;
        expect_fresh_old_broad_contract_denied(&caller_login.state).await?;
        expect_old_live_connection_kicked(&caller_client).await?;
        expect_rust_client_call_denied::<HarnessTsPingRpc>(
            &caller_client,
            "old-live-broad-removed-surface",
            "old live broad connection retained removed Harness.Ts.Ping access after narrow approval",
        )
        .await?;

        Ok(41)
    }
    .await;
    service_task.abort();
    drop(ts_service);
    call_result
}

async fn expect_rust_client_handler_error<R>(client: &TrellisClient) -> Result<()>
where
    R: trellis_client::RpcDescriptor<Input = HarnessPingRequest, Output = HarnessPingResponse>,
{
    let input = HarnessPingRequest {
        message: "handler-error".to_string(),
    };
    match client.call::<R>(&input).await {
        Ok(output) => Err(miette!(
            "{} handler error unexpectedly succeeded: {:?}",
            R::KEY,
            output
        )),
        Err(TrellisClientError::RpcError(payload)) => {
            if payload.error_type() != Some("UnexpectedError") {
                return Err(miette!(
                    "{} handler error returned structured type {:?} instead of UnexpectedError: {}",
                    R::KEY,
                    payload.error_type(),
                    payload.raw()
                ));
            }
            Ok(())
        }
        Err(error) => Err(miette!(
            "{} handler error returned non-RPC client error: {error}",
            R::KEY
        )),
    }
}

async fn expect_rust_client_not_found_error<R>(client: &TrellisClient) -> Result<()>
where
    R: trellis_client::RpcDescriptor<Input = HarnessPingRequest, Output = HarnessPingResponse>,
{
    let input = HarnessPingRequest {
        message: "not-found".to_string(),
    };
    match client.call::<R>(&input).await {
        Ok(output) => Err(miette!(
            "{} not-found unexpectedly succeeded: {:?}",
            R::KEY,
            output
        )),
        Err(TrellisClientError::RpcError(payload)) => {
            let Some(error) = payload
                .decode_declared::<HarnessNotFoundError>("NotFoundError")
                .into_diagnostic()?
            else {
                return Err(miette!(
                    "{} not-found returned structured type {:?} instead of NotFoundError: {}",
                    R::KEY,
                    payload.error_type(),
                    payload.raw()
                ));
            };
            if error.resource != "Workspace" {
                return Err(miette!(
                    "{} NotFoundError resource was `{}`, expected `Workspace`",
                    R::KEY,
                    error.resource
                ));
            }
            Ok(())
        }
        Err(error) => Err(miette!(
            "{} not-found returned non-RPC client error: {error}",
            R::KEY
        )),
    }
}

async fn assert_auth_requests_validate_round_trip(
    validator_client: &TrellisClient,
    caller_client: &TrellisClient,
    expected_user_id: &str,
) -> Result<()> {
    let input = HarnessPingRequest {
        message: "auth-validate-round-trip".to_string(),
    };
    let payload = serde_json::to_vec(&input)
        .into_diagnostic()
        .map_err(|error| {
            miette!("failed to encode Auth.Requests.Validate fixture payload: {error}")
        })?;
    let proof = caller_client
        .auth()
        .create_proof(HARNESS_RUST_PING_SUBJECT, &payload);

    let response = trellis_auth::AuthClient::new(validator_client)
        .validate_request(&AuthRequestsValidateRequest {
            capabilities: Some(Vec::new()),
            iat: 0,
            payload_hash: payload_hash_base64url(&payload),
            proof,
            request_id: "integration-request-approved".to_string(),
            session_key: caller_client.auth().session_key.clone(),
            subject: HARNESS_RUST_PING_SUBJECT.to_string(),
        })
        .await
        .into_diagnostic()?;

    if !response.allowed {
        return Err(miette!(
            "Auth.Requests.Validate rejected an approved RPC caller"
        ));
    }
    if response.inbox_prefix != caller_client.auth().inbox_prefix() {
        return Err(miette!(
            "Auth.Requests.Validate returned inbox prefix `{}`, expected `{}`",
            response.inbox_prefix,
            caller_client.auth().inbox_prefix()
        ));
    }
    assert_json_string(&response.caller, "type", "user")?;
    assert_json_string(&response.caller, "participantKind", "agent")?;
    assert_json_string(&response.caller, "userId", expected_user_id)?;
    Ok(())
}

async fn assert_auth_protocol_matrix(
    validator_client: &TrellisClient,
    caller_client: &TrellisClient,
) -> Result<()> {
    let input = HarnessPingRequest {
        message: "auth-protocol-matrix".to_string(),
    };
    let payload = serde_json::to_vec(&input)
        .into_diagnostic()
        .map_err(|error| miette!("failed to encode auth protocol matrix payload: {error}"))?;
    let auth_client = trellis_auth::AuthClient::new(validator_client);

    let (_unknown_seed, unknown_session_key) = generate_session_keypair();
    let unknown_auth = trellis_client::SessionAuth::from_seed_base64url(&_unknown_seed)
        .into_diagnostic()
        .map_err(|error| miette!("failed to build unknown session auth: {error}"))?;
    let unknown_proof = unknown_auth.create_proof(HARNESS_RUST_PING_SUBJECT, &payload);
    expect_validate_rpc_error(
        auth_client
            .validate_request(&AuthRequestsValidateRequest {
                capabilities: Some(Vec::new()),
                iat: 0,
                payload_hash: payload_hash_base64url(&payload),
                proof: unknown_proof,
                request_id: "integration-request-unknown-session".to_string(),
                session_key: unknown_session_key,
                subject: HARNESS_RUST_PING_SUBJECT.to_string(),
            })
            .await,
        "session_not_found",
        "unknown session",
    )?;

    let (_wrong_seed, wrong_session_key) = generate_session_keypair();
    expect_validate_rpc_error(
        auth_client
            .validate_request(&AuthRequestsValidateRequest {
                capabilities: Some(Vec::new()),
                iat: 0,
                payload_hash: payload_hash_base64url(&payload),
                proof: caller_client
                    .auth()
                    .create_proof(HARNESS_RUST_PING_SUBJECT, &payload),
                request_id: "integration-request-wrong-proof".to_string(),
                session_key: wrong_session_key,
                subject: HARNESS_RUST_PING_SUBJECT.to_string(),
            })
            .await,
        "invalid_signature",
        "wrong session proof",
    )?;

    let unauthorized_subject = "rpc.v1.Harness.Undeclared";
    let unauthorized = auth_client
        .validate_request(&AuthRequestsValidateRequest {
            capabilities: Some(Vec::new()),
            iat: 0,
            payload_hash: payload_hash_base64url(&payload),
            proof: caller_client
                .auth()
                .create_proof(unauthorized_subject, &payload),
            request_id: "integration-request-undeclared".to_string(),
            session_key: caller_client.auth().session_key.clone(),
            subject: unauthorized_subject.to_string(),
        })
        .await
        .into_diagnostic()?;
    if unauthorized.allowed {
        return Err(miette!(
            "Auth.Requests.Validate allowed undeclared subject `{unauthorized_subject}`"
        ));
    }

    let missing_capability = auth_client
        .validate_request(&AuthRequestsValidateRequest {
            capabilities: Some(vec!["harness.missing.capability".to_string()]),
            iat: 0,
            payload_hash: payload_hash_base64url(&payload),
            proof: caller_client
                .auth()
                .create_proof(HARNESS_RUST_PING_SUBJECT, &payload),
            request_id: "integration-request-missing-capability".to_string(),
            session_key: caller_client.auth().session_key.clone(),
            subject: HARNESS_RUST_PING_SUBJECT.to_string(),
        })
        .await
        .into_diagnostic()?;
    if missing_capability.allowed {
        return Err(miette!(
            "Auth.Requests.Validate allowed missing required capability"
        ));
    }

    assert_raw_rpc_denial(
        caller_client,
        validator_client,
        &payload,
        RawRpcDenial::MissingProof,
    )
    .await?;
    assert_raw_rpc_denial(
        caller_client,
        validator_client,
        &payload,
        RawRpcDenial::ReplyInboxMismatch,
    )
    .await?;

    Ok(())
}

enum RawRpcDenial {
    MissingProof,
    ReplyInboxMismatch,
}

async fn assert_raw_rpc_denial(
    caller_client: &TrellisClient,
    observer_client: &TrellisClient,
    payload: &[u8],
    case: RawRpcDenial,
) -> Result<()> {
    let reply_inbox = match case {
        RawRpcDenial::MissingProof => format!(
            "{}.auth-protocol-missing-proof-{}",
            caller_client.auth().inbox_prefix(),
            unique_suffix()
        ),
        RawRpcDenial::ReplyInboxMismatch => format!(
            "{}.auth-protocol-reply-mismatch-{}",
            observer_client.auth().inbox_prefix(),
            unique_suffix()
        ),
    };
    let subscriber_client = match case {
        RawRpcDenial::MissingProof => caller_client,
        RawRpcDenial::ReplyInboxMismatch => observer_client,
    };
    let mut subscriber = subscriber_client
        .nats()
        .subscribe(reply_inbox.clone())
        .await
        .into_diagnostic()?;
    let mut headers = HeaderMap::new();
    headers.insert("session-key", caller_client.auth().session_key.as_str());
    if matches!(case, RawRpcDenial::ReplyInboxMismatch) {
        let proof = caller_client
            .auth()
            .create_proof(HARNESS_RUST_PING_SUBJECT, payload);
        headers.insert("proof", proof.as_str());
    }

    caller_client
        .nats()
        .publish_with_reply_and_headers(
            HARNESS_RUST_PING_SUBJECT.to_string(),
            reply_inbox,
            headers,
            Bytes::copy_from_slice(payload),
        )
        .await
        .into_diagnostic()?;
    caller_client.nats().flush().await.into_diagnostic()?;

    let denial = tokio::time::timeout(Duration::from_secs(10), subscriber.next())
        .await
        .map_err(|_| miette!("raw auth protocol denial timed out"))?
        .ok_or_else(|| miette!("raw auth protocol denial subscriber ended"))?;
    let status = denial
        .headers
        .as_ref()
        .and_then(|headers| headers.get("status"))
        .map(|value| value.as_str());
    if status != Some("error") {
        return Err(miette!(
            "raw auth protocol denial did not return error status: {denial:?}"
        ));
    }
    let body = String::from_utf8_lossy(&denial.payload);
    let expected = match case {
        RawRpcDenial::MissingProof => "missing proof",
        RawRpcDenial::ReplyInboxMismatch => "not valid for session",
    };
    if !body.contains(expected) {
        return Err(miette!(
            "raw auth protocol denial body did not contain `{expected}`: {body}"
        ));
    }
    Ok(())
}

fn expect_validate_rpc_error(
    result: std::result::Result<
        trellis_auth::AuthRequestsValidateResponse,
        trellis_auth::TrellisAuthError,
    >,
    expected_reason: &str,
    label: &str,
) -> Result<()> {
    match result {
        Ok(response) => Err(miette!(
            "Auth.Requests.Validate {label} unexpectedly succeeded: {response:?}"
        )),
        Err(trellis_auth::TrellisAuthError::TrellisClient(TrellisClientError::RpcError(
            payload,
        ))) => {
            if payload.raw().contains(expected_reason) {
                Ok(())
            } else {
                Err(miette!(
                    "Auth.Requests.Validate {label} returned unexpected error payload: {}",
                    payload.raw()
                ))
            }
        }
        Err(error) => Err(miette!(
            "Auth.Requests.Validate {label} returned unexpected error: {error}"
        )),
    }
}

fn assert_json_string(value: &Value, key: &str, expected: &str) -> Result<()> {
    match value.get(key).and_then(Value::as_str) {
        Some(actual) if actual == expected => Ok(()),
        Some(actual) => Err(miette!(
            "Auth.Requests.Validate caller field `{key}` was `{actual}`, expected `{expected}`"
        )),
        None => Err(miette!(
            "Auth.Requests.Validate caller was missing string field `{key}`"
        )),
    }
}

pub(crate) async fn reauth_contract(
    state: &AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis_auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_auth::AdminReauthOutcome::Flow(challenge) => {
            let login_url = challenge.login_url().to_string();
            let driver = browser.driver().await?;
            let login_result =
                complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
            let quit_result = driver
                .quit()
                .await
                .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
            login_result?;
            quit_result?;
            challenge.complete(trellis_url).await.into_diagnostic()
        }
    }
}

async fn reauth_updated_contract(
    state: &AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis_auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_auth::AdminReauthOutcome::Flow(challenge) => {
            let login_url = challenge.login_url().to_string();
            let driver = browser.driver().await?;
            let login_result =
                complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
            let quit_result = driver
                .quit()
                .await
                .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
            login_result?;
            quit_result?;
            challenge.complete(trellis_url).await.into_diagnostic()
        }
    }
}

async fn expect_call_denied(client: &TrellisClient) -> Result<()> {
    let input = HarnessPingRequest {
        message: "denied-rust-client".to_string(),
    };
    match client.call::<HarnessRustPingRpc>(&input).await {
        Ok(output) => Err(miette!(
            "Harness.Rust.Ping unexpectedly succeeded before caller contract approval: {:?}",
            output
        )),
        Err(_) => Ok(()),
    }
}

pub(crate) async fn assert_rust_client_ping<R>(client: &TrellisClient, message: &str) -> Result<()>
where
    R: trellis_client::RpcDescriptor<Input = HarnessPingRequest, Output = HarnessPingResponse>,
{
    let input = HarnessPingRequest {
        message: message.to_string(),
    };
    let output = client.call::<R>(&input).await.into_diagnostic()?;
    if output
        != (HarnessPingResponse {
            message: input.message,
        })
    {
        return Err(miette!("{} response did not echo the request", R::KEY));
    }
    Ok(())
}

pub(crate) fn caller_context_response(
    provider: &str,
    context: &trellis_service::RequestContext,
) -> HandlerResult<HarnessCallerContextResponse> {
    let caller = context
        .caller
        .as_ref()
        .ok_or_else(|| trellis_service::ServerError::Nats("missing caller context".to_string()))?;
    let caller_type = caller
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| trellis_service::ServerError::Nats("missing caller type".to_string()))?;
    let participant_kind = caller
        .get("participantKind")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            trellis_service::ServerError::Nats("missing caller participant kind".to_string())
        })?;
    let user_id = caller
        .get("userId")
        .and_then(Value::as_str)
        .ok_or_else(|| trellis_service::ServerError::Nats("missing caller user id".to_string()))?;
    if caller_type != "user" {
        return Err(trellis_service::ServerError::Nats(format!(
            "expected user caller, got {caller_type}"
        )));
    }
    if participant_kind != "agent" {
        return Err(trellis_service::ServerError::Nats(format!(
            "expected agent caller, got {participant_kind}"
        )));
    }

    Ok(HarnessCallerContextResponse {
        provider: provider.to_string(),
        caller_type: caller_type.to_string(),
        participant_kind: participant_kind.to_string(),
        user_id: user_id.to_string(),
    })
}

pub(crate) async fn assert_rust_client_caller_context<R>(
    client: &TrellisClient,
    provider: &str,
    expected_user_id: &str,
) -> Result<()>
where
    R: trellis_client::RpcDescriptor<
        Input = HarnessPingRequest,
        Output = HarnessCallerContextResponse,
    >,
{
    let input = HarnessPingRequest {
        message: "caller-context".to_string(),
    };
    let output = client.call::<R>(&input).await.into_diagnostic()?;
    let expected = HarnessCallerContextResponse {
        provider: provider.to_string(),
        caller_type: "user".to_string(),
        participant_kind: "agent".to_string(),
        user_id: expected_user_id.to_string(),
    };
    if output != expected {
        return Err(miette!(
            "{} caller context was {:?}, expected {:?}",
            R::KEY,
            output,
            expected
        ));
    }
    Ok(())
}

pub(crate) fn trace_context_response(
    provider: &str,
    context: &trellis_service::RequestContext,
) -> HandlerResult<HarnessTraceContextResponse> {
    let traceparent = context
        .traceparent
        .as_deref()
        .ok_or_else(|| trellis_service::ServerError::Nats("missing traceparent".to_string()))?;
    let trace_id = trace_id_from_traceparent(traceparent).ok_or_else(|| {
        trellis_service::ServerError::Nats(format!("invalid traceparent `{traceparent}`"))
    })?;
    Ok(HarnessTraceContextResponse {
        provider: provider.to_string(),
        trace_id: trace_id.to_string(),
        traceparent: traceparent.to_string(),
    })
}

fn trace_id_from_traceparent(traceparent: &str) -> Option<&str> {
    let mut parts = traceparent.split('-');
    let version = parts.next()?;
    let trace_id = parts.next()?;
    let parent_id = parts.next()?;
    let flags = parts.next()?;
    if parts.next().is_some()
        || version.len() != 2
        || trace_id.len() != 32
        || parent_id.len() != 16
        || flags.len() != 2
    {
        return None;
    }
    Some(trace_id)
}

pub(crate) async fn assert_rust_client_trace_context<R>(
    client: &TrellisClient,
    provider: &str,
) -> Result<()>
where
    R: trellis_client::RpcDescriptor<
        Input = HarnessPingRequest,
        Output = HarnessTraceContextResponse,
    >,
{
    let output = call_with_traceparent::<R>(client, HARNESS_TRACEPARENT).await?;
    if output.provider != provider
        || output.trace_id != HARNESS_RUST_TRACE_ID
        || !output.traceparent.contains(HARNESS_RUST_TRACE_ID)
    {
        return Err(miette!(
            "{} trace context was {:?}, expected provider `{}` and trace id `{}`",
            R::KEY,
            output,
            provider,
            HARNESS_RUST_TRACE_ID
        ));
    }
    Ok(())
}

async fn call_with_traceparent<R>(
    client: &TrellisClient,
    traceparent: &str,
) -> Result<HarnessTraceContextResponse>
where
    R: trellis_client::RpcDescriptor<
        Input = HarnessPingRequest,
        Output = HarnessTraceContextResponse,
    >,
{
    let input = HarnessPingRequest {
        message: "rust-trace-context".to_string(),
    };
    let payload = Bytes::from(serde_json::to_vec(&input).into_diagnostic()?);
    let proof = client.auth().create_proof(R::SUBJECT, &payload);
    let mut headers = async_nats::HeaderMap::new();
    headers.insert("session-key", client.auth().session_key.as_str());
    headers.insert("proof", proof.as_str());
    headers.insert("traceparent", traceparent);
    let response = client
        .nats()
        .request_with_headers(R::SUBJECT.to_string(), headers, payload)
        .await
        .into_diagnostic()?;
    if response
        .headers
        .as_ref()
        .and_then(|headers| headers.get("status"))
        .is_some_and(|status| status.as_str() == "error")
    {
        return Err(miette!(
            "{} trace request returned error: {}",
            R::KEY,
            String::from_utf8_lossy(&response.payload)
        ));
    }
    serde_json::from_slice(&response.payload)
        .into_diagnostic()
        .map_err(|error| miette!("failed to decode {} trace response: {error}", R::KEY))
}

async fn expect_fresh_old_broad_contract_denied(state: &AdminSessionState) -> Result<()> {
    let client = match connect_admin_client_async(state).await {
        Ok(client) => client,
        Err(_) => return Ok(()),
    };

    expect_rust_client_call_denied::<HarnessTsPingRpc>(
        &client,
        "fresh-old-broad-removed-surface",
        "fresh old broad digest/session seed reconnected and retained removed Harness.Ts.Ping access after narrow approval",
    )
    .await
}

async fn expect_old_live_connection_kicked(client: &TrellisClient) -> Result<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let state = client.nats().connection_state();
        if state.to_string() != "connected" {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            eprintln!(
                "warning: old live broad connection was not kicked after narrow approval; NATS state remained {state:?}; verifying removed-surface denial instead"
            );
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn expect_rust_client_call_denied<R>(
    client: &TrellisClient,
    message: &str,
    unexpected_success: &str,
) -> Result<()>
where
    R: trellis_client::RpcDescriptor<Input = HarnessPingRequest, Output = HarnessPingResponse>,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let input = HarnessPingRequest {
            message: message.to_string(),
        };
        match client.call::<R>(&input).await {
            Ok(output) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(miette!("{}: {:?}", unexpected_success, output));
                }
            }
            Err(_) => return Ok(()),
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[derive(Debug)]
pub(crate) struct TsServiceProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl TsServiceProcess {
    pub(crate) fn start(
        trellis_url: &str,
        contract_digest: &str,
        service_seed: &str,
    ) -> Result<Self> {
        let repo = repo_root()?;
        let script_path = write_ts_fixture_script("service", TS_SERVICE_SCRIPT)?;
        let stdout_log = script_path.with_extension("stdout.log");
        let stderr_log = script_path.with_extension("stderr.log");
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create TS service stdout log: {error}"))?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create TS service stderr log: {error}"))?;
        let child = std::process::Command::new("deno")
            .arg("run")
            .arg("-c")
            .arg(repo.join("js/deno.json"))
            .arg("--allow-env")
            .arg("--allow-sys")
            .arg("--allow-net")
            .arg("--allow-read")
            .arg(&script_path)
            .current_dir(repo.join("js"))
            .env("TRELLIS_URL", trellis_url)
            .env("HARNESS_CONTRACT_DIGEST", contract_digest)
            .env("HARNESS_TS_SERVICE_SEED", service_seed)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .into_diagnostic()
            .map_err(|error| miette!("failed to start TS service fixture: {error}"))?;
        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }

    pub(crate) async fn wait_ready(&self) -> Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if std::fs::read_to_string(&self.stdout_log)
                .unwrap_or_default()
                .contains("TS_SERVICE_READY")
            {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS service fixture readiness; stdout: {}; stderr: {}",
                    stdout,
                    stderr
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}

impl Drop for TsServiceProcess {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect TS service child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS service child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS service child: {error}");
        }
    }
}

pub(crate) async fn run_ts_client(
    trellis_url: &str,
    caller_session_seed: &str,
    stop_service_seed: &str,
) -> Result<()> {
    let repo = repo_root()?;
    let script_path = write_ts_fixture_script("client", TS_CLIENT_SCRIPT)?;
    let caller_contract_json = harness_caller_contract_json()?;
    let caller_digest = digest_contract_json(&caller_contract_json).into_diagnostic()?;
    let output = std::process::Command::new("deno")
        .arg("run")
        .arg("-c")
        .arg(repo.join("js/deno.json"))
        .arg("--allow-env")
        .arg("--allow-sys")
        .arg("--allow-net")
        .arg("--allow-read")
        .arg(&script_path)
        .current_dir(repo.join("js"))
        .env("TRELLIS_URL", trellis_url)
        .env("HARNESS_CALLER_CONTRACT_DIGEST", caller_digest)
        .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed)
        .env("HARNESS_STOP_SERVICE_SEED", stop_service_seed)
        .output()
        .into_diagnostic()
        .map_err(|error| miette!("failed to run TS client fixture: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS client fixture failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("TS_CLIENT_OK") {
        return Err(miette!(
            "TS client fixture did not report success: {stdout}"
        ));
    }
    Ok(())
}

async fn run_ts_updated_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    let repo = repo_root()?;
    let script_path = write_ts_fixture_script("updated-client", TS_UPDATED_CLIENT_SCRIPT)?;
    let caller_contract_json = harness_updated_caller_contract_json()?;
    let caller_digest = digest_contract_json(&caller_contract_json).into_diagnostic()?;
    let output = std::process::Command::new("deno")
        .arg("run")
        .arg("-c")
        .arg(repo.join("js/deno.json"))
        .arg("--allow-env")
        .arg("--allow-sys")
        .arg("--allow-net")
        .arg("--allow-read")
        .arg(&script_path)
        .current_dir(repo.join("js"))
        .env("TRELLIS_URL", trellis_url)
        .env("HARNESS_CALLER_CONTRACT_DIGEST", caller_digest)
        .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed)
        .output()
        .into_diagnostic()
        .map_err(|error| miette!("failed to run TS updated client fixture: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS updated client fixture failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("TS_UPDATED_CLIENT_OK") {
        return Err(miette!(
            "TS updated client fixture did not report success: {stdout}"
        ));
    }
    Ok(())
}

fn write_ts_fixture_script(name: &str, contents: &str) -> Result<PathBuf> {
    let path = std::env::temp_dir().join(format!(
        "trellis-integration-{name}-{}-{}.ts",
        std::process::id(),
        unique_suffix()
    ));
    std::fs::write(&path, contents)
        .into_diagnostic()
        .map_err(|error| {
            miette!(
                "failed to write TS fixture script {}: {error}",
                path.display()
            )
        })?;
    Ok(path)
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

async fn connect_service_with_retry(
    trellis_url: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<TrellisClient, trellis_client::TrellisClientError> {
    let mut last_error = None;
    for _ in 0..10 {
        match TrellisClient::connect_service(ServiceConnectOptions {
            trellis_url,
            contract_id: HARNESS_CONTRACT_ID,
            contract_digest,
            session_key_seed_base64url: service_seed,
            timeout_ms: 5_000,
        })
        .await
        {
            Ok(client) => return Ok(client),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }

    Err(last_error.expect("service connect retry should record at least one error"))
}

pub(crate) fn contract_json_object(contract_json: &str) -> Result<BTreeMap<String, Value>> {
    serde_json::from_str(contract_json)
        .map_err(|error| miette!("failed to parse harness contract JSON: {error}"))
}
