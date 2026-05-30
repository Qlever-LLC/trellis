// Generated from ./generated/contracts/manifests/trellis.state@v1.json
import type {
  ContractDependencyUse,
  SdkContractModule,
  TrellisContractV1,
  UseSpec,
} from "../../../index.ts";
import { API } from "./api.ts";

const CONTRACT_MODULE_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/contract-module",
);

export const CONTRACT_ID = "trellis.state@v1" as const;
export const CONTRACT_DIGEST =
  "XfWDYLTBlYFjDqMPBEXrTBccZbFvHp0MnqscehdRKT4" as const;
export const CONTRACT = {
  "description":
    "Trellis-managed app state for authenticated app and device participants.",
  "displayName": "Trellis State",
  "docs": {
    "markdown":
      "Provides authenticated read, write, list, delete, and admin inspection APIs for Trellis-managed participant state.",
    "summary": "Participant state storage APIs.",
  },
  "format": "trellis.contract.v1",
  "id": "trellis.state@v1",
  "kind": "service",
  "rpc": {
    "State.Admin.Delete": {
      "capabilities": { "call": ["admin"] },
      "docs": {
        "markdown":
          "Deletes one state value across participants for authorized administrators.",
        "summary": "Admin delete a state value.",
      },
      "errors": [{ "type": "AuthError" }, { "type": "UnexpectedError" }, {
        "type": "ValidationError",
      }],
      "input": { "schema": "StateAdminDeleteRequest" },
      "output": { "schema": "StateAdminDeleteResponse" },
      "subject": "rpc.v1.State.Admin.Delete",
      "version": "v1",
    },
    "State.Admin.Get": {
      "capabilities": { "call": ["admin"] },
      "docs": {
        "markdown":
          "Returns one state value across participants for authorized administrators.",
        "summary": "Admin read a state value.",
      },
      "errors": [{ "type": "AuthError" }, { "type": "UnexpectedError" }, {
        "type": "ValidationError",
      }],
      "input": { "schema": "StateAdminGetRequest" },
      "output": { "schema": "StateAdminGetResponse" },
      "subject": "rpc.v1.State.Admin.Get",
      "version": "v1",
    },
    "State.Admin.List": {
      "capabilities": { "call": ["admin"] },
      "docs": {
        "markdown":
          "Lists state values across participants for authorized administrators.",
        "summary": "Admin list state values.",
      },
      "errors": [{ "type": "AuthError" }, { "type": "UnexpectedError" }, {
        "type": "ValidationError",
      }],
      "input": { "schema": "StateAdminListRequest" },
      "output": { "schema": "StateAdminListResponse" },
      "subject": "rpc.v1.State.Admin.List",
      "version": "v1",
    },
    "State.Delete": {
      "docs": {
        "markdown":
          "Deletes one state value from the caller's authorized scope.",
        "summary": "Delete a state value.",
      },
      "errors": [{ "type": "AuthError" }, { "type": "UnexpectedError" }, {
        "type": "ValidationError",
      }],
      "input": { "schema": "StateDeleteRequest" },
      "output": { "schema": "StateDeleteResponse" },
      "subject": "rpc.v1.State.Delete",
      "version": "v1",
    },
    "State.Get": {
      "docs": {
        "markdown": "Returns one state value in the caller's authorized scope.",
        "summary": "Read a state value.",
      },
      "errors": [{ "type": "AuthError" }, { "type": "UnexpectedError" }, {
        "type": "ValidationError",
      }],
      "input": { "schema": "StateGetRequest" },
      "output": { "schema": "StateGetResponse" },
      "subject": "rpc.v1.State.Get",
      "version": "v1",
    },
    "State.List": {
      "docs": {
        "markdown":
          "Lists state values visible to the caller for the requested scope and prefix.",
        "summary": "List state values.",
      },
      "errors": [{ "type": "AuthError" }, { "type": "UnexpectedError" }, {
        "type": "ValidationError",
      }],
      "input": { "schema": "StateListRequest" },
      "output": { "schema": "StateListResponse" },
      "subject": "rpc.v1.State.List",
      "version": "v1",
    },
    "State.Put": {
      "docs": {
        "markdown":
          "Creates or replaces one state value in an authorized scope.",
        "summary": "Write a state value.",
      },
      "errors": [{ "type": "AuthError" }, { "type": "UnexpectedError" }, {
        "type": "ValidationError",
      }],
      "input": { "schema": "StatePutRequest" },
      "output": { "schema": "StatePutResponse" },
      "subject": "rpc.v1.State.Put",
      "version": "v1",
    },
  },
  "schemas": {
    "JsonValue": {},
    "StateAdminDeleteRequest": {
      "anyOf": [{
        "properties": {
          "contractDigest": { "minLength": 1, "type": "string" },
          "contractId": { "minLength": 1, "type": "string" },
          "expectedRevision": { "minLength": 1, "type": "string" },
          "key": { "minLength": 1, "type": "string" },
          "scope": { "const": "userApp", "type": "string" },
          "store": { "minLength": 1, "type": "string" },
          "user": {
            "properties": {
              "id": { "minLength": 1, "type": "string" },
              "origin": { "minLength": 1, "type": "string" },
              "userId": { "minLength": 1, "type": "string" },
            },
            "required": ["origin", "id"],
            "type": "object",
          },
        },
        "required": ["scope", "contractId", "contractDigest", "store", "user"],
        "type": "object",
      }, {
        "properties": {
          "contractDigest": { "minLength": 1, "type": "string" },
          "contractId": { "minLength": 1, "type": "string" },
          "deviceId": { "minLength": 1, "type": "string" },
          "expectedRevision": { "minLength": 1, "type": "string" },
          "key": { "minLength": 1, "type": "string" },
          "scope": { "const": "deviceApp", "type": "string" },
          "store": { "minLength": 1, "type": "string" },
        },
        "required": [
          "scope",
          "contractId",
          "contractDigest",
          "store",
          "deviceId",
        ],
        "type": "object",
      }],
    },
    "StateAdminDeleteResponse": {
      "properties": { "deleted": { "type": "boolean" } },
      "required": ["deleted"],
      "type": "object",
    },
    "StateAdminGetRequest": {
      "anyOf": [{
        "properties": {
          "contractDigest": { "minLength": 1, "type": "string" },
          "contractId": { "minLength": 1, "type": "string" },
          "key": { "minLength": 1, "type": "string" },
          "scope": { "const": "userApp", "type": "string" },
          "store": { "minLength": 1, "type": "string" },
          "user": {
            "properties": {
              "id": { "minLength": 1, "type": "string" },
              "origin": { "minLength": 1, "type": "string" },
              "userId": { "minLength": 1, "type": "string" },
            },
            "required": ["origin", "id"],
            "type": "object",
          },
        },
        "required": ["scope", "contractId", "contractDigest", "store", "user"],
        "type": "object",
      }, {
        "properties": {
          "contractDigest": { "minLength": 1, "type": "string" },
          "contractId": { "minLength": 1, "type": "string" },
          "deviceId": { "minLength": 1, "type": "string" },
          "key": { "minLength": 1, "type": "string" },
          "scope": { "const": "deviceApp", "type": "string" },
          "store": { "minLength": 1, "type": "string" },
        },
        "required": [
          "scope",
          "contractId",
          "contractDigest",
          "store",
          "deviceId",
        ],
        "type": "object",
      }],
    },
    "StateAdminGetResponse": {
      "anyOf": [{
        "properties": { "found": { "const": false, "type": "boolean" } },
        "required": ["found"],
        "type": "object",
      }, {
        "properties": {
          "entry": {
            "properties": {
              "expiresAt": { "format": "date-time", "type": "string" },
              "key": { "minLength": 1, "type": "string" },
              "revision": { "minLength": 1, "type": "string" },
              "updatedAt": { "format": "date-time", "type": "string" },
              "value": {},
            },
            "required": ["value", "revision", "updatedAt"],
            "type": "object",
          },
          "found": { "const": true, "type": "boolean" },
        },
        "required": ["found", "entry"],
        "type": "object",
      }, {
        "properties": {
          "currentStateVersion": { "minLength": 1, "type": "string" },
          "entry": {
            "properties": {
              "expiresAt": { "format": "date-time", "type": "string" },
              "key": { "minLength": 1, "type": "string" },
              "revision": { "minLength": 1, "type": "string" },
              "updatedAt": { "format": "date-time", "type": "string" },
              "value": {},
            },
            "required": ["value", "revision", "updatedAt"],
            "type": "object",
          },
          "migrationRequired": { "const": true, "type": "boolean" },
          "stateVersion": { "minLength": 1, "type": "string" },
          "writerContractDigest": { "minLength": 1, "type": "string" },
        },
        "required": [
          "migrationRequired",
          "entry",
          "stateVersion",
          "currentStateVersion",
          "writerContractDigest",
        ],
        "type": "object",
      }],
    },
    "StateAdminListRequest": {
      "anyOf": [{
        "properties": {
          "contractDigest": { "minLength": 1, "type": "string" },
          "contractId": { "minLength": 1, "type": "string" },
          "limit": { "minimum": 0, "type": "integer" },
          "offset": { "minimum": 0, "type": "integer" },
          "prefix": { "minLength": 1, "type": "string" },
          "scope": { "const": "userApp", "type": "string" },
          "store": { "minLength": 1, "type": "string" },
          "user": {
            "properties": {
              "id": { "minLength": 1, "type": "string" },
              "origin": { "minLength": 1, "type": "string" },
              "userId": { "minLength": 1, "type": "string" },
            },
            "required": ["origin", "id"],
            "type": "object",
          },
        },
        "required": [
          "limit",
          "scope",
          "contractId",
          "contractDigest",
          "store",
          "user",
        ],
        "type": "object",
      }, {
        "properties": {
          "contractDigest": { "minLength": 1, "type": "string" },
          "contractId": { "minLength": 1, "type": "string" },
          "deviceId": { "minLength": 1, "type": "string" },
          "limit": { "minimum": 0, "type": "integer" },
          "offset": { "minimum": 0, "type": "integer" },
          "prefix": { "minLength": 1, "type": "string" },
          "scope": { "const": "deviceApp", "type": "string" },
          "store": { "minLength": 1, "type": "string" },
        },
        "required": [
          "limit",
          "scope",
          "contractId",
          "contractDigest",
          "store",
          "deviceId",
        ],
        "type": "object",
      }],
    },
    "StateAdminListResponse": {
      "properties": {
        "count": { "minimum": 0, "type": "integer" },
        "entries": {
          "default": [],
          "items": {
            "anyOf": [{
              "properties": {
                "expiresAt": { "format": "date-time", "type": "string" },
                "key": { "minLength": 1, "type": "string" },
                "revision": { "minLength": 1, "type": "string" },
                "updatedAt": { "format": "date-time", "type": "string" },
                "value": {},
              },
              "required": ["value", "revision", "updatedAt"],
              "type": "object",
            }, {
              "properties": {
                "currentStateVersion": { "minLength": 1, "type": "string" },
                "entry": {
                  "properties": {
                    "expiresAt": { "format": "date-time", "type": "string" },
                    "key": { "minLength": 1, "type": "string" },
                    "revision": { "minLength": 1, "type": "string" },
                    "updatedAt": { "format": "date-time", "type": "string" },
                    "value": {},
                  },
                  "required": ["value", "revision", "updatedAt"],
                  "type": "object",
                },
                "migrationRequired": { "const": true, "type": "boolean" },
                "stateVersion": { "minLength": 1, "type": "string" },
                "writerContractDigest": { "minLength": 1, "type": "string" },
              },
              "required": [
                "migrationRequired",
                "entry",
                "stateVersion",
                "currentStateVersion",
                "writerContractDigest",
              ],
              "type": "object",
            }],
          },
          "type": "array",
        },
        "limit": { "minimum": 0, "type": "integer" },
        "nextOffset": { "minimum": 0, "type": "integer" },
        "offset": { "minimum": 0, "type": "integer" },
      },
      "required": ["entries", "count", "offset", "limit"],
      "type": "object",
    },
    "StateDeleteRequest": {
      "properties": {
        "expectedRevision": { "minLength": 1, "type": "string" },
        "key": { "minLength": 1, "type": "string" },
        "store": { "minLength": 1, "type": "string" },
      },
      "required": ["store"],
      "type": "object",
    },
    "StateDeleteResponse": {
      "properties": { "deleted": { "type": "boolean" } },
      "required": ["deleted"],
      "type": "object",
    },
    "StateEntry": {
      "properties": {
        "expiresAt": { "format": "date-time", "type": "string" },
        "key": { "minLength": 1, "type": "string" },
        "revision": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
        "value": {},
      },
      "required": ["value", "revision", "updatedAt"],
      "type": "object",
    },
    "StateGetRequest": {
      "properties": {
        "key": { "minLength": 1, "type": "string" },
        "store": { "minLength": 1, "type": "string" },
      },
      "required": ["store"],
      "type": "object",
    },
    "StateGetResponse": {
      "anyOf": [{
        "properties": { "found": { "const": false, "type": "boolean" } },
        "required": ["found"],
        "type": "object",
      }, {
        "properties": {
          "entry": {
            "properties": {
              "expiresAt": { "format": "date-time", "type": "string" },
              "key": { "minLength": 1, "type": "string" },
              "revision": { "minLength": 1, "type": "string" },
              "updatedAt": { "format": "date-time", "type": "string" },
              "value": {},
            },
            "required": ["value", "revision", "updatedAt"],
            "type": "object",
          },
          "found": { "const": true, "type": "boolean" },
        },
        "required": ["found", "entry"],
        "type": "object",
      }, {
        "properties": {
          "currentStateVersion": { "minLength": 1, "type": "string" },
          "entry": {
            "properties": {
              "expiresAt": { "format": "date-time", "type": "string" },
              "key": { "minLength": 1, "type": "string" },
              "revision": { "minLength": 1, "type": "string" },
              "updatedAt": { "format": "date-time", "type": "string" },
              "value": {},
            },
            "required": ["value", "revision", "updatedAt"],
            "type": "object",
          },
          "migrationRequired": { "const": true, "type": "boolean" },
          "stateVersion": { "minLength": 1, "type": "string" },
          "writerContractDigest": { "minLength": 1, "type": "string" },
        },
        "required": [
          "migrationRequired",
          "entry",
          "stateVersion",
          "currentStateVersion",
          "writerContractDigest",
        ],
        "type": "object",
      }],
    },
    "StateListRequest": {
      "properties": {
        "limit": { "minimum": 0, "type": "integer" },
        "offset": { "minimum": 0, "type": "integer" },
        "prefix": { "minLength": 1, "type": "string" },
        "store": { "minLength": 1, "type": "string" },
      },
      "required": ["limit", "store"],
      "type": "object",
    },
    "StateListResponse": {
      "properties": {
        "count": { "minimum": 0, "type": "integer" },
        "entries": {
          "default": [],
          "items": {
            "anyOf": [{
              "properties": {
                "expiresAt": { "format": "date-time", "type": "string" },
                "key": { "minLength": 1, "type": "string" },
                "revision": { "minLength": 1, "type": "string" },
                "updatedAt": { "format": "date-time", "type": "string" },
                "value": {},
              },
              "required": ["value", "revision", "updatedAt"],
              "type": "object",
            }, {
              "properties": {
                "currentStateVersion": { "minLength": 1, "type": "string" },
                "entry": {
                  "properties": {
                    "expiresAt": { "format": "date-time", "type": "string" },
                    "key": { "minLength": 1, "type": "string" },
                    "revision": { "minLength": 1, "type": "string" },
                    "updatedAt": { "format": "date-time", "type": "string" },
                    "value": {},
                  },
                  "required": ["value", "revision", "updatedAt"],
                  "type": "object",
                },
                "migrationRequired": { "const": true, "type": "boolean" },
                "stateVersion": { "minLength": 1, "type": "string" },
                "writerContractDigest": { "minLength": 1, "type": "string" },
              },
              "required": [
                "migrationRequired",
                "entry",
                "stateVersion",
                "currentStateVersion",
                "writerContractDigest",
              ],
              "type": "object",
            }],
          },
          "type": "array",
        },
        "limit": { "minimum": 0, "type": "integer" },
        "nextOffset": { "minimum": 0, "type": "integer" },
        "offset": { "minimum": 0, "type": "integer" },
      },
      "required": ["entries", "count", "offset", "limit"],
      "type": "object",
    },
    "StateMigrationRequired": {
      "properties": {
        "currentStateVersion": { "minLength": 1, "type": "string" },
        "entry": {
          "properties": {
            "expiresAt": { "format": "date-time", "type": "string" },
            "key": { "minLength": 1, "type": "string" },
            "revision": { "minLength": 1, "type": "string" },
            "updatedAt": { "format": "date-time", "type": "string" },
            "value": {},
          },
          "required": ["value", "revision", "updatedAt"],
          "type": "object",
        },
        "migrationRequired": { "const": true, "type": "boolean" },
        "stateVersion": { "minLength": 1, "type": "string" },
        "writerContractDigest": { "minLength": 1, "type": "string" },
      },
      "required": [
        "migrationRequired",
        "entry",
        "stateVersion",
        "currentStateVersion",
        "writerContractDigest",
      ],
      "type": "object",
    },
    "StatePutRequest": {
      "properties": {
        "expectedRevision": {
          "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
        },
        "key": { "minLength": 1, "type": "string" },
        "store": { "minLength": 1, "type": "string" },
        "ttlMs": { "minimum": 1, "type": "integer" },
        "value": {},
      },
      "required": ["store", "value"],
      "type": "object",
    },
    "StatePutResponse": {
      "anyOf": [{
        "properties": {
          "applied": { "const": true, "type": "boolean" },
          "entry": {
            "properties": {
              "expiresAt": { "format": "date-time", "type": "string" },
              "key": { "minLength": 1, "type": "string" },
              "revision": { "minLength": 1, "type": "string" },
              "updatedAt": { "format": "date-time", "type": "string" },
              "value": {},
            },
            "required": ["value", "revision", "updatedAt"],
            "type": "object",
          },
        },
        "required": ["applied", "entry"],
        "type": "object",
      }, {
        "properties": {
          "applied": { "const": false, "type": "boolean" },
          "entry": {
            "anyOf": [{
              "properties": {
                "expiresAt": { "format": "date-time", "type": "string" },
                "key": { "minLength": 1, "type": "string" },
                "revision": { "minLength": 1, "type": "string" },
                "updatedAt": { "format": "date-time", "type": "string" },
                "value": {},
              },
              "required": ["value", "revision", "updatedAt"],
              "type": "object",
            }, {
              "properties": {
                "currentStateVersion": { "minLength": 1, "type": "string" },
                "entry": {
                  "properties": {
                    "expiresAt": { "format": "date-time", "type": "string" },
                    "key": { "minLength": 1, "type": "string" },
                    "revision": { "minLength": 1, "type": "string" },
                    "updatedAt": { "format": "date-time", "type": "string" },
                    "value": {},
                  },
                  "required": ["value", "revision", "updatedAt"],
                  "type": "object",
                },
                "migrationRequired": { "const": true, "type": "boolean" },
                "stateVersion": { "minLength": 1, "type": "string" },
                "writerContractDigest": { "minLength": 1, "type": "string" },
              },
              "required": [
                "migrationRequired",
                "entry",
                "stateVersion",
                "currentStateVersion",
                "writerContractDigest",
              ],
              "type": "object",
            }],
          },
          "found": { "type": "boolean" },
        },
        "required": ["applied", "found"],
        "type": "object",
      }],
    },
    "StateScope": {
      "anyOf": [{ "const": "userApp", "type": "string" }, {
        "const": "deviceApp",
        "type": "string",
      }],
    },
    "StateUserTarget": {
      "properties": {
        "id": { "minLength": 1, "type": "string" },
        "origin": { "minLength": 1, "type": "string" },
        "userId": { "minLength": 1, "type": "string" },
      },
      "required": ["origin", "id"],
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
