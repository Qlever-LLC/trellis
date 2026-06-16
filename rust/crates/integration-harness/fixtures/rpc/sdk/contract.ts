// Generated from rust/crates/integration-harness/fixtures/rpc/contract.ts
import type {
  ContractDependencyUse,
  SdkContractModule,
  TrellisContractV1,
  UseSpec,
} from "@qlever-llc/trellis";
import { API } from "./api.ts";

const CONTRACT_MODULE_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/contract-module",
);

export const CONTRACT_ID = "trellis.integration-harness.rpc@v1" as const;
export const CONTRACT_DIGEST =
  "Atg91ttOf4n5u8LyMJOCWgCggNMNxX6zK554Lorq12I" as const;
export const CONTRACT = {
  "description":
    "Harness-owned service contract for full-stack Rust/TypeScript RPC verification.",
  "displayName": "Trellis Integration Harness RPC",
  "errors": {
    "NotFoundError": {
      "schema": { "schema": "NotFoundErrorData" },
      "type": "NotFoundError",
    },
  },
  "format": "trellis.contract.v1",
  "id": "trellis.integration-harness.rpc@v1",
  "kind": "service",
  "rpc": {
    "Harness.Rust.CallerContext": {
      "capabilities": { "call": [] },
      "errors": [{ "type": "UnexpectedError" }],
      "input": { "schema": "PingRequest" },
      "output": { "schema": "CallerContextResponse" },
      "subject": "rpc.v1.Harness.Rust.CallerContext",
      "version": "v1",
    },
    "Harness.Rust.Ping": {
      "capabilities": { "call": [] },
      "errors": [{ "type": "NotFoundError" }, { "type": "UnexpectedError" }],
      "input": { "schema": "PingRequest" },
      "output": { "schema": "PingResponse" },
      "subject": "rpc.v1.Harness.Rust.Ping",
      "version": "v1",
    },
    "Harness.Rust.TraceContext": {
      "capabilities": { "call": [] },
      "errors": [{ "type": "UnexpectedError" }],
      "input": { "schema": "PingRequest" },
      "output": { "schema": "TraceContextResponse" },
      "subject": "rpc.v1.Harness.Rust.TraceContext",
      "version": "v1",
    },
    "Harness.Ts.CallerContext": {
      "capabilities": { "call": [] },
      "errors": [{ "type": "UnexpectedError" }],
      "input": { "schema": "PingRequest" },
      "output": { "schema": "CallerContextResponse" },
      "subject": "rpc.v1.Harness.Ts.CallerContext",
      "version": "v1",
    },
    "Harness.Ts.Ping": {
      "capabilities": { "call": [] },
      "errors": [{ "type": "NotFoundError" }, { "type": "UnexpectedError" }],
      "input": { "schema": "PingRequest" },
      "output": { "schema": "PingResponse" },
      "subject": "rpc.v1.Harness.Ts.Ping",
      "version": "v1",
    },
    "Harness.Ts.TraceContext": {
      "capabilities": { "call": [] },
      "errors": [{ "type": "UnexpectedError" }],
      "input": { "schema": "PingRequest" },
      "output": { "schema": "TraceContextResponse" },
      "subject": "rpc.v1.Harness.Ts.TraceContext",
      "version": "v1",
    },
  },
  "schemas": {
    "CallerContextResponse": {
      "properties": {
        "callerType": { "type": "string" },
        "participantKind": { "type": "string" },
        "provider": { "type": "string" },
        "userId": { "type": "string" },
      },
      "required": ["provider", "callerType", "participantKind", "userId"],
      "type": "object",
    },
    "NotFoundErrorData": {
      "properties": {
        "context": { "patternProperties": { "^.*$": {} }, "type": "object" },
        "id": { "type": "string" },
        "message": { "type": "string" },
        "resource": { "type": "string" },
        "traceId": { "type": "string" },
        "type": { "const": "NotFoundError", "type": "string" },
      },
      "required": ["id", "type", "message", "resource"],
      "type": "object",
    },
    "PingRequest": {
      "properties": { "message": { "type": "string" } },
      "required": ["message"],
      "type": "object",
    },
    "PingResponse": {
      "properties": { "message": { "type": "string" } },
      "required": ["message"],
      "type": "object",
    },
    "TraceContextResponse": {
      "properties": {
        "provider": { "type": "string" },
        "traceId": { "type": "string" },
        "traceparent": { "type": "string" },
      },
      "required": ["provider", "traceId", "traceparent"],
      "type": "object",
    },
  },
  "uses": {
    "required": {
      "auth": {
        "contract": "trellis.auth@v1",
        "rpc": { "call": ["Auth.Requests.Validate"] },
      },
      "health": {
        "contract": "trellis.health@v1",
        "events": { "publish": ["Health.Heartbeat"] },
      },
    },
  },
} as TrellisContractV1;

function assertSelectedKeysExist(
  kind: "rpc" | "operations" | "events" | "feeds",
  keys: readonly string[] | undefined,
  api: Record<string, unknown>,
) {
  if (!keys) {
    return;
  }

  for (const key of keys) {
    if (!Object.hasOwn(api, key)) {
      throw new Error(
        `Contract '${CONTRACT_ID}' does not expose ${kind} key '${key}'`,
      );
    }
  }
}

function assertValidUseSpec(spec: UseSpec<typeof API.owned>) {
  assertSelectedKeysExist("rpc", spec.rpc?.call, API.owned.rpc);
  assertSelectedKeysExist(
    "operations",
    spec.operations?.call,
    API.owned.operations,
  );
  assertSelectedKeysExist("events", spec.events?.publish, API.owned.events);
  assertSelectedKeysExist("events", spec.events?.subscribe, API.owned.events);
  assertSelectedKeysExist("feeds", spec.feeds?.subscribe, API.owned.feeds);
}

export const sdk: SdkContractModule<typeof CONTRACT_ID, typeof API.owned> = {
  CONTRACT_ID,
  CONTRACT_DIGEST,
  CONTRACT,
  API,
  use: <const TSpec extends UseSpec<typeof API.owned>>(spec: TSpec) => {
    assertValidUseSpec(spec);

    const dependencyUse = {
      contract: CONTRACT_ID,
      ...(spec.rpc?.call ? { rpc: { call: [...spec.rpc.call] } } : {}),
      ...(spec.operations?.call
        ? { operations: { call: [...spec.operations.call] } }
        : {}),
      ...((spec.events?.publish || spec.events?.subscribe)
        ? {
          events: {
            ...(spec.events.publish
              ? { publish: [...spec.events.publish] }
              : {}),
            ...(spec.events.subscribe
              ? { subscribe: [...spec.events.subscribe] }
              : {}),
          },
        }
        : {}),
      ...(spec.feeds?.subscribe
        ? { feeds: { subscribe: [...spec.feeds.subscribe] } }
        : {}),
    };

    Object.defineProperty(dependencyUse, CONTRACT_MODULE_METADATA, {
      value: sdk,
      enumerable: false,
    });

    return dependencyUse as ContractDependencyUse<
      typeof CONTRACT_ID,
      typeof API.owned,
      TSpec
    >;
  },
};

export const use = sdk.use;
