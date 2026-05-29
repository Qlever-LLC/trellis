// Generated from ./generated/contracts/manifests/trellis.core@v1.json
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

export const CONTRACT_ID = "trellis.core@v1" as const;
export const CONTRACT_DIGEST =
  "L4HW6uUIxDhK1Kpa_PUxpumoMberMgiCgJTNN5Qvje0" as const;
export const CONTRACT = {
  "capabilities": {
    "trellis.core::catalog.read": {
      "description": "List the installed Trellis contract catalog.",
      "displayName": "Read contract catalog",
    },
    "trellis.core::contract.read": {
      "description": "Read installed contract manifests and metadata.",
      "displayName": "Read installed contracts",
    },
  },
  "description":
    "Trellis runtime RPCs available to all connected participants.",
  "displayName": "Trellis Core",
  "docs": {
    "markdown":
      "Exposes the Trellis catalog, contract details, runtime bindings, and surface availability checks used by platform participants.",
    "summary": "Runtime catalog and binding APIs.",
  },
  "format": "trellis.contract.v1",
  "id": "trellis.core@v1",
  "kind": "service",
  "rpc": {
    "Trellis.Bindings.Get": {
      "capabilities": { "call": ["service"] },
      "docs": {
        "markdown":
          "Returns runtime resource bindings for the caller's active service contract.",
        "summary": "Read service resource bindings.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }],
      "input": { "schema": "TrellisBindingsGetRequest" },
      "internal": true,
      "output": { "schema": "TrellisBindingsGetResponse" },
      "subject": "rpc.v1.Trellis.Bindings.Get",
      "version": "v1",
    },
    "Trellis.Catalog": {
      "capabilities": { "call": ["trellis.core::catalog.read"] },
      "docs": {
        "markdown":
          "Returns the active contract catalog entries available in the deployment.",
        "summary": "List visible contracts.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }],
      "input": { "schema": "TrellisCatalogRequest" },
      "output": { "schema": "TrellisCatalogResponse" },
      "subject": "rpc.v1.Trellis.Catalog",
      "version": "v1",
    },
    "Trellis.Contract.Get": {
      "capabilities": { "call": ["trellis.core::contract.read"] },
      "docs": {
        "markdown":
          "Returns the normalized contract manifest for a known contract digest.",
        "summary": "Read one contract manifest.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }],
      "input": { "schema": "TrellisContractGetRequest" },
      "output": { "schema": "TrellisContractGetResponse" },
      "subject": "rpc.v1.Trellis.Contract.Get",
      "version": "v1",
    },
    "Trellis.Surface.Status": {
      "capabilities": { "call": ["trellis.core::catalog.read"] },
      "docs": {
        "markdown":
          "Reports capability and deployment authority status for a contract-owned surface.",
        "summary": "Inspect surface availability.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }],
      "input": { "schema": "TrellisSurfaceStatusRequest" },
      "output": { "schema": "TrellisSurfaceStatusResponse" },
      "subject": "rpc.v1.Trellis.Surface.Status",
      "version": "v1",
    },
  },
  "schemas": {
    "TrellisBindingsGetRequest": {
      "properties": {
        "contractId": { "minLength": 1, "type": "string" },
        "digest": { "pattern": "^[A-Za-z0-9_-]+$", "type": "string" },
      },
      "type": "object",
    },
    "TrellisBindingsGetResponse": {
      "properties": {
        "binding": {
          "properties": {
            "contractId": { "minLength": 1, "type": "string" },
            "digest": { "pattern": "^[A-Za-z0-9_-]+$", "type": "string" },
            "resources": {
              "properties": {
                "eventConsumers": {
                  "patternProperties": {
                    "^.*$": {
                      "properties": {
                        "ackWaitMs": { "minimum": 1, "type": "integer" },
                        "backoffMs": {
                          "items": { "minimum": 0, "type": "integer" },
                          "type": "array",
                        },
                        "concurrency": { "minimum": 1, "type": "integer" },
                        "consumerName": { "minLength": 1, "type": "string" },
                        "filterSubjects": {
                          "items": { "minLength": 1, "type": "string" },
                          "type": "array",
                        },
                        "maxDeliver": { "minimum": 1, "type": "integer" },
                        "ordering": { "const": "strict", "type": "string" },
                        "replay": {
                          "anyOf": [{ "const": "new", "type": "string" }, {
                            "const": "all",
                            "type": "string",
                          }],
                        },
                        "stream": { "minLength": 1, "type": "string" },
                      },
                      "required": [
                        "stream",
                        "consumerName",
                        "filterSubjects",
                        "replay",
                        "ordering",
                        "concurrency",
                        "ackWaitMs",
                        "maxDeliver",
                        "backoffMs",
                      ],
                      "type": "object",
                    },
                  },
                  "type": "object",
                },
                "jobs": {
                  "properties": {
                    "namespace": { "minLength": 1, "type": "string" },
                    "queues": {
                      "patternProperties": {
                        "^.*$": {
                          "properties": {
                            "ackWaitMs": { "minimum": 1, "type": "integer" },
                            "backoffMs": {
                              "items": { "minimum": 0, "type": "integer" },
                              "type": "array",
                            },
                            "concurrency": { "minimum": 1, "type": "integer" },
                            "consumerName": {
                              "minLength": 1,
                              "type": "string",
                            },
                            "defaultDeadlineMs": {
                              "minimum": 1,
                              "type": "integer",
                            },
                            "dlq": { "type": "boolean" },
                            "logs": { "type": "boolean" },
                            "maxDeliver": { "minimum": 1, "type": "integer" },
                            "payload": {
                              "properties": {
                                "schema": { "minLength": 1, "type": "string" },
                              },
                              "required": ["schema"],
                              "type": "object",
                            },
                            "progress": { "type": "boolean" },
                            "publishPrefix": {
                              "minLength": 1,
                              "type": "string",
                            },
                            "queueType": { "minLength": 1, "type": "string" },
                            "result": {
                              "properties": {
                                "schema": { "minLength": 1, "type": "string" },
                              },
                              "required": ["schema"],
                              "type": "object",
                            },
                            "workSubject": { "minLength": 1, "type": "string" },
                          },
                          "required": [
                            "queueType",
                            "publishPrefix",
                            "workSubject",
                            "consumerName",
                            "payload",
                            "maxDeliver",
                            "backoffMs",
                            "ackWaitMs",
                            "progress",
                            "logs",
                            "dlq",
                            "concurrency",
                          ],
                          "type": "object",
                        },
                      },
                      "type": "object",
                    },
                    "workStream": { "minLength": 1, "type": "string" },
                  },
                  "required": ["namespace", "queues"],
                  "type": "object",
                },
                "kv": {
                  "patternProperties": {
                    "^.*$": {
                      "properties": {
                        "bucket": { "minLength": 1, "type": "string" },
                        "history": { "minimum": 1, "type": "integer" },
                        "maxValueBytes": { "minimum": 1, "type": "integer" },
                        "ttlMs": { "minimum": 0, "type": "integer" },
                      },
                      "required": ["bucket", "history", "ttlMs"],
                      "type": "object",
                    },
                  },
                  "type": "object",
                },
                "store": {
                  "patternProperties": {
                    "^.*$": {
                      "properties": {
                        "maxObjectBytes": { "minimum": 1, "type": "integer" },
                        "maxTotalBytes": { "minimum": 1, "type": "integer" },
                        "name": { "minLength": 1, "type": "string" },
                        "ttlMs": { "minimum": 0, "type": "integer" },
                      },
                      "required": ["name", "ttlMs"],
                      "type": "object",
                    },
                  },
                  "type": "object",
                },
              },
              "type": "object",
            },
          },
          "required": ["contractId", "digest", "resources"],
          "type": "object",
        },
        "eventConsumers": {
          "patternProperties": {
            "^.*$": {
              "properties": {
                "ackWaitMs": { "minimum": 1, "type": "integer" },
                "backoffMs": {
                  "items": { "minimum": 0, "type": "integer" },
                  "type": "array",
                },
                "concurrency": { "minimum": 1, "type": "integer" },
                "consumerName": { "minLength": 1, "type": "string" },
                "filterSubjects": {
                  "items": { "minLength": 1, "type": "string" },
                  "type": "array",
                },
                "maxDeliver": { "minimum": 1, "type": "integer" },
                "ordering": { "const": "strict", "type": "string" },
                "replay": {
                  "anyOf": [{ "const": "new", "type": "string" }, {
                    "const": "all",
                    "type": "string",
                  }],
                },
                "stream": { "minLength": 1, "type": "string" },
              },
              "required": [
                "stream",
                "consumerName",
                "filterSubjects",
                "replay",
                "ordering",
                "concurrency",
                "ackWaitMs",
                "maxDeliver",
                "backoffMs",
              ],
              "type": "object",
            },
          },
          "type": "object",
        },
      },
      "type": "object",
    },
    "TrellisCatalogRequest": { "properties": {}, "type": "object" },
    "TrellisCatalogResponse": {
      "properties": {
        "catalog": {
          "properties": {
            "contracts": {
              "items": {
                "properties": {
                  "description": { "minLength": 1, "type": "string" },
                  "digest": { "type": "string" },
                  "displayName": { "minLength": 1, "type": "string" },
                  "id": { "type": "string" },
                },
                "required": ["id", "digest", "displayName", "description"],
                "type": "object",
              },
              "type": "array",
            },
            "format": { "const": "trellis.catalog.v1", "type": "string" },
            "issues": {
              "items": {
                "properties": {
                  "actions": {
                    "items": {
                      "properties": {
                        "action": {
                          "anyOf": [{
                            "const": "keep-current",
                            "type": "string",
                          }, { "const": "force-replace", "type": "string" }],
                        },
                        "deploymentIds": {
                          "items": { "type": "string" },
                          "type": "array",
                        },
                        "description": { "minLength": 1, "type": "string" },
                        "digests": {
                          "items": { "type": "string" },
                          "type": "array",
                        },
                        "label": { "minLength": 1, "type": "string" },
                        "risk": {
                          "anyOf": [{
                            "const": "recommended",
                            "type": "string",
                          }, { "const": "dangerous", "type": "string" }],
                        },
                      },
                      "required": [
                        "action",
                        "label",
                        "description",
                        "risk",
                        "deploymentIds",
                        "digests",
                      ],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "conflictingDeploymentIds": {
                    "items": { "type": "string" },
                    "type": "array",
                  },
                  "conflictingDigest": { "type": "string" },
                  "conflictingDigests": {
                    "items": { "type": "string" },
                    "type": "array",
                  },
                  "contractId": { "type": "string" },
                  "deploymentIds": {
                    "items": { "type": "string" },
                    "type": "array",
                  },
                  "digest": { "type": "string" },
                  "effectiveDeploymentIds": {
                    "items": { "type": "string" },
                    "type": "array",
                  },
                  "effectiveDigests": {
                    "items": { "type": "string" },
                    "type": "array",
                  },
                  "issueId": { "minLength": 1, "type": "string" },
                  "kind": {
                    "anyOf": [
                      { "const": "missing-active-contract", "type": "string" },
                      { "const": "invalid-active-contract", "type": "string" },
                      {
                        "const": "incompatible-active-contract",
                        "type": "string",
                      },
                      {
                        "const": "invalid-active-contract-uses",
                        "type": "string",
                      },
                    ],
                  },
                  "message": { "minLength": 1, "type": "string" },
                },
                "required": [
                  "issueId",
                  "kind",
                  "message",
                  "deploymentIds",
                  "actions",
                ],
                "type": "object",
              },
              "type": "array",
            },
          },
          "required": ["format", "contracts"],
          "type": "object",
        },
      },
      "required": ["catalog"],
      "type": "object",
    },
    "TrellisContractGetRequest": {
      "properties": {
        "digest": { "pattern": "^[A-Za-z0-9_-]+$", "type": "string" },
      },
      "required": ["digest"],
      "type": "object",
    },
    "TrellisContractGetResponse": {
      "properties": {
        "contract": {
          "properties": {
            "description": { "minLength": 1, "type": "string" },
            "displayName": { "minLength": 1, "type": "string" },
            "docs": {
              "properties": {
                "markdown": { "type": "string" },
                "summary": { "type": "string" },
              },
              "required": ["markdown"],
              "type": "object",
            },
            "errors": {
              "patternProperties": { "^.*$": { "type": "object" } },
              "type": "object",
            },
            "events": {
              "patternProperties": { "^.*$": { "type": "object" } },
              "type": "object",
            },
            "exports": {
              "properties": {
                "schemas": {
                  "items": { "minLength": 1, "type": "string" },
                  "type": "array",
                },
              },
              "type": "object",
            },
            "format": { "const": "trellis.contract.v1", "type": "string" },
            "id": { "minLength": 1, "type": "string" },
            "jobs": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "ackWaitMs": { "minimum": 1, "type": "integer" },
                    "backoffMs": {
                      "items": { "minimum": 0, "type": "integer" },
                      "type": "array",
                    },
                    "concurrency": { "minimum": 1, "type": "integer" },
                    "defaultDeadlineMs": { "minimum": 1, "type": "integer" },
                    "dlq": { "type": "boolean" },
                    "docs": {
                      "properties": {
                        "markdown": { "type": "string" },
                        "summary": { "type": "string" },
                      },
                      "required": ["markdown"],
                      "type": "object",
                    },
                    "logs": { "type": "boolean" },
                    "maxDeliver": { "minimum": 1, "type": "integer" },
                    "payload": {
                      "properties": {
                        "schema": { "minLength": 1, "type": "string" },
                      },
                      "required": ["schema"],
                      "type": "object",
                    },
                    "progress": { "type": "boolean" },
                    "result": {
                      "properties": {
                        "schema": { "minLength": 1, "type": "string" },
                      },
                      "required": ["schema"],
                      "type": "object",
                    },
                  },
                  "required": ["payload"],
                  "type": "object",
                },
              },
              "type": "object",
            },
            "kind": {
              "anyOf": [
                { "const": "service", "type": "string" },
                { "const": "app", "type": "string" },
                { "const": "device", "type": "string" },
                { "const": "agent", "type": "string" },
              ],
            },
            "operations": {
              "patternProperties": { "^.*$": { "type": "object" } },
              "type": "object",
            },
            "resources": {
              "additionalProperties": false,
              "properties": {
                "kv": {
                  "patternProperties": {
                    "^.*$": {
                      "properties": {
                        "docs": {
                          "properties": {
                            "markdown": { "type": "string" },
                            "summary": { "type": "string" },
                          },
                          "required": ["markdown"],
                          "type": "object",
                        },
                        "history": {
                          "default": 1,
                          "minimum": 1,
                          "type": "integer",
                        },
                        "maxValueBytes": { "minimum": 1, "type": "integer" },
                        "purpose": { "minLength": 1, "type": "string" },
                        "required": { "default": true, "type": "boolean" },
                        "schema": {
                          "properties": {
                            "schema": { "minLength": 1, "type": "string" },
                          },
                          "required": ["schema"],
                          "type": "object",
                        },
                        "ttlMs": {
                          "default": 0,
                          "minimum": 0,
                          "type": "integer",
                        },
                      },
                      "required": ["purpose", "schema"],
                      "type": "object",
                    },
                  },
                  "type": "object",
                },
                "store": {
                  "patternProperties": {
                    "^.*$": {
                      "properties": {
                        "docs": {
                          "properties": {
                            "markdown": { "type": "string" },
                            "summary": { "type": "string" },
                          },
                          "required": ["markdown"],
                          "type": "object",
                        },
                        "maxObjectBytes": { "minimum": 1, "type": "integer" },
                        "maxTotalBytes": { "minimum": 1, "type": "integer" },
                        "purpose": { "minLength": 1, "type": "string" },
                        "required": { "default": true, "type": "boolean" },
                        "ttlMs": {
                          "default": 0,
                          "minimum": 0,
                          "type": "integer",
                        },
                      },
                      "required": ["purpose"],
                      "type": "object",
                    },
                  },
                  "type": "object",
                },
              },
              "type": "object",
            },
            "rpc": {
              "patternProperties": { "^.*$": { "type": "object" } },
              "type": "object",
            },
            "schemas": {
              "patternProperties": {
                "^.*$": {
                  "anyOf": [{ "type": "object" }, { "type": "boolean" }],
                },
              },
              "type": "object",
            },
            "state": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "acceptedVersions": {
                      "patternProperties": {
                        "^.*$": {
                          "properties": {
                            "schema": { "minLength": 1, "type": "string" },
                          },
                          "required": ["schema"],
                          "type": "object",
                        },
                      },
                      "type": "object",
                    },
                    "docs": {
                      "properties": {
                        "markdown": { "type": "string" },
                        "summary": { "type": "string" },
                      },
                      "required": ["markdown"],
                      "type": "object",
                    },
                    "kind": {
                      "anyOf": [{ "const": "value", "type": "string" }, {
                        "const": "map",
                        "type": "string",
                      }],
                    },
                    "schema": {
                      "properties": {
                        "schema": { "minLength": 1, "type": "string" },
                      },
                      "required": ["schema"],
                      "type": "object",
                    },
                    "stateVersion": { "minLength": 1, "type": "string" },
                  },
                  "required": ["kind", "schema"],
                  "type": "object",
                },
              },
              "type": "object",
            },
            "uses": {
              "patternProperties": { "^.*$": { "type": "object" } },
              "type": "object",
            },
          },
          "required": ["format", "id", "displayName", "description", "kind"],
          "type": "object",
        },
      },
      "required": ["contract"],
      "type": "object",
    },
    "TrellisSurfaceStatusRequest": {
      "properties": {
        "action": {
          "anyOf": [
            { "const": "call", "type": "string" },
            { "const": "publish", "type": "string" },
            { "const": "subscribe", "type": "string" },
            { "const": "observe", "type": "string" },
          ],
        },
        "contractId": { "minLength": 1, "type": "string" },
        "kind": {
          "anyOf": [
            { "const": "rpc", "type": "string" },
            { "const": "operation", "type": "string" },
            { "const": "event", "type": "string" },
            { "const": "feed", "type": "string" },
          ],
        },
        "surface": { "minLength": 1, "type": "string" },
      },
      "required": ["contractId", "kind", "surface"],
      "type": "object",
    },
    "TrellisSurfaceStatusResponse": {
      "properties": {
        "status": {
          "anyOf": [{
            "properties": {
              "liveImplementer": { "type": "boolean" },
              "runtime": {
                "anyOf": [{ "const": "live", "type": "string" }, {
                  "const": "no_live_implementer",
                  "type": "string",
                }, { "const": "disabled", "type": "string" }],
              },
              "state": { "const": "available", "type": "string" },
            },
            "required": ["state", "liveImplementer", "runtime"],
            "type": "object",
          }, {
            "properties": {
              "reason": {
                "anyOf": [{
                  "const": "authority_unavailable",
                  "type": "string",
                }],
              },
              "state": { "const": "unavailable", "type": "string" },
            },
            "required": ["state", "reason"],
            "type": "object",
          }, {
            "properties": {
              "missingCapabilities": {
                "items": { "type": "string" },
                "type": "array",
              },
              "state": { "const": "unauthorized", "type": "string" },
            },
            "required": ["state", "missingCapabilities"],
            "type": "object",
          }, {
            "properties": {
              "contractId": { "minLength": 1, "type": "string" },
              "state": { "const": "unknown_contract", "type": "string" },
            },
            "required": ["state", "contractId"],
            "type": "object",
          }, {
            "properties": {
              "contractId": { "minLength": 1, "type": "string" },
              "kind": { "minLength": 1, "type": "string" },
              "state": { "const": "unknown_surface", "type": "string" },
              "surface": { "minLength": 1, "type": "string" },
            },
            "required": ["state", "contractId", "kind", "surface"],
            "type": "object",
          }],
        },
      },
      "required": ["status"],
      "type": "object",
    },
  },
  "uses": {
    "required": {
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
