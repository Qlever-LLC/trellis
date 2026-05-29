// Generated from ./generated/contracts/manifests/trellis.health@v1.json
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

export const CONTRACT_ID = "trellis.health@v1" as const;
export const CONTRACT_DIGEST =
  "RHDzeH2V6Nltzk6WklCLbTIK48hF0hNuO9Qk6-BosT4" as const;
export const CONTRACT = {
  "description":
    "Expose shared Trellis heartbeat events for service observability.",
  "displayName": "Trellis Health",
  "docs": {
    "markdown":
      "Defines the heartbeat event services publish so operators can observe service liveness.",
    "summary": "Service heartbeat events.",
  },
  "events": {
    "Health.Heartbeat": {
      "docs": {
        "markdown":
          "Emitted by services to report runtime identity, uptime, and health metadata.",
        "summary": "Publish service liveness.",
      },
      "event": { "schema": "HealthHeartbeat" },
      "subject": "events.v1.Health.Heartbeat",
      "version": "v1",
    },
  },
  "format": "trellis.contract.v1",
  "id": "trellis.health@v1",
  "kind": "service",
  "schemas": {
    "HealthHeartbeat": {
      "properties": {
        "checks": {
          "items": {
            "properties": {
              "error": { "type": "string" },
              "info": { "patternProperties": { "^.*$": {} }, "type": "object" },
              "latencyMs": { "type": "number" },
              "name": { "type": "string" },
              "status": {
                "anyOf": [{ "const": "ok", "type": "string" }, {
                  "const": "failed",
                  "type": "string",
                }],
              },
              "summary": { "type": "string" },
            },
            "required": ["name", "status", "latencyMs"],
            "type": "object",
          },
          "type": "array",
        },
        "header": {
          "properties": {
            "id": { "type": "string" },
            "time": { "format": "date-time", "type": "string" },
          },
          "required": ["id", "time"],
          "type": "object",
        },
        "service": {
          "properties": {
            "contractDigest": { "type": "string" },
            "contractId": { "type": "string" },
            "info": { "patternProperties": { "^.*$": {} }, "type": "object" },
            "instanceId": { "type": "string" },
            "kind": {
              "anyOf": [{ "const": "service", "type": "string" }, {
                "const": "device",
                "type": "string",
              }],
            },
            "name": { "type": "string" },
            "publishIntervalMs": { "minimum": 1, "type": "integer" },
            "runtime": {
              "anyOf": [
                { "const": "deno", "type": "string" },
                { "const": "node", "type": "string" },
                { "const": "rust", "type": "string" },
                { "const": "unknown", "type": "string" },
              ],
            },
            "runtimeVersion": { "type": "string" },
            "startedAt": { "format": "date-time", "type": "string" },
            "version": { "type": "string" },
          },
          "required": [
            "name",
            "kind",
            "instanceId",
            "contractId",
            "contractDigest",
            "startedAt",
            "publishIntervalMs",
            "runtime",
          ],
          "type": "object",
        },
        "status": {
          "anyOf": [{ "const": "healthy", "type": "string" }, {
            "const": "unhealthy",
            "type": "string",
          }, { "const": "degraded", "type": "string" }],
        },
        "summary": { "type": "string" },
      },
      "required": ["header", "service", "status", "checks"],
      "type": "object",
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
