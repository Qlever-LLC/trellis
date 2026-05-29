// Generated from ./generated/contracts/manifests/trellis.state@v1.json
export const StateAdminDeleteRequestSchema = {
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
    "required": ["scope", "contractId", "contractDigest", "store", "deviceId"],
    "type": "object",
  }],
} as const;

export const StateAdminDeleteResponseSchema = {
  "properties": { "deleted": { "type": "boolean" } },
  "required": ["deleted"],
  "type": "object",
} as const;

export const StateAdminGetRequestSchema = {
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
    "required": ["scope", "contractId", "contractDigest", "store", "deviceId"],
    "type": "object",
  }],
} as const;

export const StateAdminGetResponseSchema = {
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
} as const;

export const StateAdminListRequestSchema = {
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
} as const;

export const StateAdminListResponseSchema = {
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
} as const;

export const StateDeleteRequestSchema = {
  "properties": {
    "expectedRevision": { "minLength": 1, "type": "string" },
    "key": { "minLength": 1, "type": "string" },
    "store": { "minLength": 1, "type": "string" },
  },
  "required": ["store"],
  "type": "object",
} as const;

export const StateDeleteResponseSchema = {
  "properties": { "deleted": { "type": "boolean" } },
  "required": ["deleted"],
  "type": "object",
} as const;

export const StateGetRequestSchema = {
  "properties": {
    "key": { "minLength": 1, "type": "string" },
    "store": { "minLength": 1, "type": "string" },
  },
  "required": ["store"],
  "type": "object",
} as const;

export const StateGetResponseSchema = {
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
} as const;

export const StateListRequestSchema = {
  "properties": {
    "limit": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "prefix": { "minLength": 1, "type": "string" },
    "store": { "minLength": 1, "type": "string" },
  },
  "required": ["limit", "store"],
  "type": "object",
} as const;

export const StateListResponseSchema = {
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
} as const;

export const StatePutRequestSchema = {
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
} as const;

export const StatePutResponseSchema = {
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
} as const;
