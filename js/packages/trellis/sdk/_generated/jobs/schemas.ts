// Generated from ./generated/contracts/manifests/trellis.jobs@v1.json
export const EmptySchema = { "properties": {}, "type": "object" } as const;

export const JobsCancelRequestSchema = {
  "description":
    "Jobs admin ids are globally addressable; callers identify jobs by id only.",
  "properties": { "id": { "minLength": 1, "type": "string" } },
  "required": ["id"],
  "type": "object",
} as const;

export const JobsCancelResponseSchema = {
  "properties": {
    "job": {
      "properties": {
        "completedAt": { "format": "date-time", "type": "string" },
        "concurrency": {
          "properties": {
            "heartbeatAt": { "format": "date-time", "type": "string" },
            "key": { "minLength": 1, "type": "string" },
            "keyHash": { "minLength": 1, "type": "string" },
            "leaseExpiresAt": { "format": "date-time", "type": "string" },
            "staleTakeoverCount": { "minimum": 0, "type": "integer" },
          },
          "required": ["key", "keyHash"],
          "type": "object",
        },
        "context": {
          "properties": {
            "requestId": { "minLength": 1, "type": "string" },
            "traceId": { "pattern": "^[0-9a-f]{32}$", "type": "string" },
            "traceparent": {
              "pattern": "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
              "type": "string",
            },
            "tracestate": { "minLength": 1, "type": "string" },
          },
          "required": ["requestId", "traceId", "traceparent"],
          "type": "object",
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "deadline": { "format": "date-time", "type": "string" },
        "id": { "minLength": 1, "type": "string" },
        "lastError": { "type": "string" },
        "logs": {
          "items": {
            "properties": {
              "level": {
                "anyOf": [{ "const": "info", "type": "string" }, {
                  "const": "warn",
                  "type": "string",
                }, { "const": "error", "type": "string" }],
              },
              "message": { "type": "string" },
              "timestamp": { "format": "date-time", "type": "string" },
            },
            "required": ["timestamp", "level", "message"],
            "type": "object",
          },
          "type": "array",
        },
        "maxTries": { "minimum": 1, "type": "integer" },
        "payload": {},
        "progress": {
          "properties": {
            "current": { "minimum": 0, "type": "integer" },
            "message": { "type": "string" },
            "step": { "type": "string" },
            "total": { "minimum": 0, "type": "integer" },
          },
          "type": "object",
        },
        "queuePolicy": {
          "properties": {
            "existingJobId": { "minLength": 1, "type": "string" },
            "outcome": { "minLength": 1, "type": "string" },
            "reason": { "minLength": 1, "type": "string" },
            "replacedJobId": { "minLength": 1, "type": "string" },
          },
          "required": ["outcome"],
          "type": "object",
        },
        "result": {},
        "service": { "minLength": 1, "type": "string" },
        "startedAt": { "format": "date-time", "type": "string" },
        "state": {
          "anyOf": [
            { "const": "pending", "type": "string" },
            { "const": "active", "type": "string" },
            { "const": "retry", "type": "string" },
            { "const": "completed", "type": "string" },
            { "const": "failed", "type": "string" },
            { "const": "cancelled", "type": "string" },
            { "const": "expired", "type": "string" },
            { "const": "dead", "type": "string" },
            { "const": "dismissed", "type": "string" },
          ],
        },
        "tries": { "minimum": 0, "type": "integer" },
        "type": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "id",
        "context",
        "service",
        "type",
        "state",
        "payload",
        "createdAt",
        "updatedAt",
        "tries",
        "maxTries",
      ],
      "type": "object",
    },
  },
  "required": ["job"],
  "type": "object",
} as const;

export const JobsDismissDLQRequestSchema = {
  "description":
    "Jobs admin ids are globally addressable; callers identify jobs by id only.",
  "properties": { "id": { "minLength": 1, "type": "string" } },
  "required": ["id"],
  "type": "object",
} as const;

export const JobsDismissDLQResponseSchema = {
  "properties": {
    "job": {
      "properties": {
        "completedAt": { "format": "date-time", "type": "string" },
        "concurrency": {
          "properties": {
            "heartbeatAt": { "format": "date-time", "type": "string" },
            "key": { "minLength": 1, "type": "string" },
            "keyHash": { "minLength": 1, "type": "string" },
            "leaseExpiresAt": { "format": "date-time", "type": "string" },
            "staleTakeoverCount": { "minimum": 0, "type": "integer" },
          },
          "required": ["key", "keyHash"],
          "type": "object",
        },
        "context": {
          "properties": {
            "requestId": { "minLength": 1, "type": "string" },
            "traceId": { "pattern": "^[0-9a-f]{32}$", "type": "string" },
            "traceparent": {
              "pattern": "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
              "type": "string",
            },
            "tracestate": { "minLength": 1, "type": "string" },
          },
          "required": ["requestId", "traceId", "traceparent"],
          "type": "object",
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "deadline": { "format": "date-time", "type": "string" },
        "id": { "minLength": 1, "type": "string" },
        "lastError": { "type": "string" },
        "logs": {
          "items": {
            "properties": {
              "level": {
                "anyOf": [{ "const": "info", "type": "string" }, {
                  "const": "warn",
                  "type": "string",
                }, { "const": "error", "type": "string" }],
              },
              "message": { "type": "string" },
              "timestamp": { "format": "date-time", "type": "string" },
            },
            "required": ["timestamp", "level", "message"],
            "type": "object",
          },
          "type": "array",
        },
        "maxTries": { "minimum": 1, "type": "integer" },
        "payload": {},
        "progress": {
          "properties": {
            "current": { "minimum": 0, "type": "integer" },
            "message": { "type": "string" },
            "step": { "type": "string" },
            "total": { "minimum": 0, "type": "integer" },
          },
          "type": "object",
        },
        "queuePolicy": {
          "properties": {
            "existingJobId": { "minLength": 1, "type": "string" },
            "outcome": { "minLength": 1, "type": "string" },
            "reason": { "minLength": 1, "type": "string" },
            "replacedJobId": { "minLength": 1, "type": "string" },
          },
          "required": ["outcome"],
          "type": "object",
        },
        "result": {},
        "service": { "minLength": 1, "type": "string" },
        "startedAt": { "format": "date-time", "type": "string" },
        "state": {
          "anyOf": [
            { "const": "pending", "type": "string" },
            { "const": "active", "type": "string" },
            { "const": "retry", "type": "string" },
            { "const": "completed", "type": "string" },
            { "const": "failed", "type": "string" },
            { "const": "cancelled", "type": "string" },
            { "const": "expired", "type": "string" },
            { "const": "dead", "type": "string" },
            { "const": "dismissed", "type": "string" },
          ],
        },
        "tries": { "minimum": 0, "type": "integer" },
        "type": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "id",
        "context",
        "service",
        "type",
        "state",
        "payload",
        "createdAt",
        "updatedAt",
        "tries",
        "maxTries",
      ],
      "type": "object",
    },
  },
  "required": ["job"],
  "type": "object",
} as const;

export const JobsGetKeyRequestSchema = {
  "properties": {
    "key": { "minLength": 1, "type": "string" },
    "service": { "minLength": 1, "type": "string" },
    "type": { "minLength": 1, "type": "string" },
  },
  "required": ["service", "type", "key"],
  "type": "object",
} as const;

export const JobsGetKeyResponseSchema = {
  "properties": {
    "active": {
      "items": {
        "properties": {
          "heartbeatAgeMs": { "minimum": 0, "type": "integer" },
          "heartbeatAt": { "format": "date-time", "type": "string" },
          "instanceId": { "type": "string" },
          "jobId": { "minLength": 1, "type": "string" },
          "leaseExpiresAt": { "format": "date-time", "type": "string" },
          "startedAt": { "format": "date-time", "type": "string" },
        },
        "required": [
          "jobId",
          "instanceId",
          "startedAt",
          "heartbeatAt",
          "heartbeatAgeMs",
          "leaseExpiresAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "key": { "minLength": 1, "type": "string" },
    "keyHash": { "minLength": 1, "type": "string" },
    "latestPolicyReason": { "minLength": 1, "type": "string" },
    "queued": {
      "items": {
        "properties": {
          "createdAt": { "format": "date-time", "type": "string" },
          "jobId": { "minLength": 1, "type": "string" },
        },
        "required": ["jobId", "createdAt"],
        "type": "object",
      },
      "type": "array",
    },
    "queuedDepth": { "minimum": 0, "type": "integer" },
    "service": { "minLength": 1, "type": "string" },
    "staleTakeoverCount": { "minimum": 0, "type": "integer" },
    "type": { "minLength": 1, "type": "string" },
  },
  "required": [
    "service",
    "type",
    "key",
    "keyHash",
    "active",
    "queued",
    "queuedDepth",
    "staleTakeoverCount",
  ],
  "type": "object",
} as const;

export const JobsGetRequestSchema = {
  "description":
    "Jobs admin ids are globally addressable; callers identify jobs by id only.",
  "properties": { "id": { "minLength": 1, "type": "string" } },
  "required": ["id"],
  "type": "object",
} as const;

export const JobsGetResponseSchema = {
  "properties": {
    "job": {
      "properties": {
        "completedAt": { "format": "date-time", "type": "string" },
        "concurrency": {
          "properties": {
            "heartbeatAt": { "format": "date-time", "type": "string" },
            "key": { "minLength": 1, "type": "string" },
            "keyHash": { "minLength": 1, "type": "string" },
            "leaseExpiresAt": { "format": "date-time", "type": "string" },
            "staleTakeoverCount": { "minimum": 0, "type": "integer" },
          },
          "required": ["key", "keyHash"],
          "type": "object",
        },
        "context": {
          "properties": {
            "requestId": { "minLength": 1, "type": "string" },
            "traceId": { "pattern": "^[0-9a-f]{32}$", "type": "string" },
            "traceparent": {
              "pattern": "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
              "type": "string",
            },
            "tracestate": { "minLength": 1, "type": "string" },
          },
          "required": ["requestId", "traceId", "traceparent"],
          "type": "object",
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "deadline": { "format": "date-time", "type": "string" },
        "id": { "minLength": 1, "type": "string" },
        "lastError": { "type": "string" },
        "logs": {
          "items": {
            "properties": {
              "level": {
                "anyOf": [{ "const": "info", "type": "string" }, {
                  "const": "warn",
                  "type": "string",
                }, { "const": "error", "type": "string" }],
              },
              "message": { "type": "string" },
              "timestamp": { "format": "date-time", "type": "string" },
            },
            "required": ["timestamp", "level", "message"],
            "type": "object",
          },
          "type": "array",
        },
        "maxTries": { "minimum": 1, "type": "integer" },
        "payload": {},
        "progress": {
          "properties": {
            "current": { "minimum": 0, "type": "integer" },
            "message": { "type": "string" },
            "step": { "type": "string" },
            "total": { "minimum": 0, "type": "integer" },
          },
          "type": "object",
        },
        "queuePolicy": {
          "properties": {
            "existingJobId": { "minLength": 1, "type": "string" },
            "outcome": { "minLength": 1, "type": "string" },
            "reason": { "minLength": 1, "type": "string" },
            "replacedJobId": { "minLength": 1, "type": "string" },
          },
          "required": ["outcome"],
          "type": "object",
        },
        "result": {},
        "service": { "minLength": 1, "type": "string" },
        "startedAt": { "format": "date-time", "type": "string" },
        "state": {
          "anyOf": [
            { "const": "pending", "type": "string" },
            { "const": "active", "type": "string" },
            { "const": "retry", "type": "string" },
            { "const": "completed", "type": "string" },
            { "const": "failed", "type": "string" },
            { "const": "cancelled", "type": "string" },
            { "const": "expired", "type": "string" },
            { "const": "dead", "type": "string" },
            { "const": "dismissed", "type": "string" },
          ],
        },
        "tries": { "minimum": 0, "type": "integer" },
        "type": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "id",
        "context",
        "service",
        "type",
        "state",
        "payload",
        "createdAt",
        "updatedAt",
        "tries",
        "maxTries",
      ],
      "type": "object",
    },
  },
  "required": ["job"],
  "type": "object",
} as const;

export const JobsHealthResponseSchema = {
  "properties": {
    "checks": {
      "items": { "patternProperties": { "^.*$": {} }, "type": "object" },
      "type": "array",
    },
    "service": { "minLength": 1, "type": "string" },
    "status": {},
    "timestamp": { "format": "date-time", "type": "string" },
  },
  "required": ["service", "status", "timestamp", "checks"],
  "type": "object",
} as const;

export const JobsListDLQRequestSchema = {
  "properties": {
    "limit": { "minimum": 1, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "service": { "minLength": 1, "type": "string" },
    "since": { "format": "date-time", "type": "string" },
    "type": { "minLength": 1, "type": "string" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const JobsListDLQResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "items": {
        "properties": {
          "completedAt": { "format": "date-time", "type": "string" },
          "concurrency": {
            "properties": {
              "heartbeatAt": { "format": "date-time", "type": "string" },
              "key": { "minLength": 1, "type": "string" },
              "keyHash": { "minLength": 1, "type": "string" },
              "leaseExpiresAt": { "format": "date-time", "type": "string" },
              "staleTakeoverCount": { "minimum": 0, "type": "integer" },
            },
            "required": ["key", "keyHash"],
            "type": "object",
          },
          "context": {
            "properties": {
              "requestId": { "minLength": 1, "type": "string" },
              "traceId": { "pattern": "^[0-9a-f]{32}$", "type": "string" },
              "traceparent": {
                "pattern":
                  "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
                "type": "string",
              },
              "tracestate": { "minLength": 1, "type": "string" },
            },
            "required": ["requestId", "traceId", "traceparent"],
            "type": "object",
          },
          "createdAt": { "format": "date-time", "type": "string" },
          "deadline": { "format": "date-time", "type": "string" },
          "id": { "minLength": 1, "type": "string" },
          "lastError": { "type": "string" },
          "logs": {
            "items": {
              "properties": {
                "level": {
                  "anyOf": [{ "const": "info", "type": "string" }, {
                    "const": "warn",
                    "type": "string",
                  }, { "const": "error", "type": "string" }],
                },
                "message": { "type": "string" },
                "timestamp": { "format": "date-time", "type": "string" },
              },
              "required": ["timestamp", "level", "message"],
              "type": "object",
            },
            "type": "array",
          },
          "maxTries": { "minimum": 1, "type": "integer" },
          "payload": {},
          "progress": {
            "properties": {
              "current": { "minimum": 0, "type": "integer" },
              "message": { "type": "string" },
              "step": { "type": "string" },
              "total": { "minimum": 0, "type": "integer" },
            },
            "type": "object",
          },
          "queuePolicy": {
            "properties": {
              "existingJobId": { "minLength": 1, "type": "string" },
              "outcome": { "minLength": 1, "type": "string" },
              "reason": { "minLength": 1, "type": "string" },
              "replacedJobId": { "minLength": 1, "type": "string" },
            },
            "required": ["outcome"],
            "type": "object",
          },
          "result": {},
          "service": { "minLength": 1, "type": "string" },
          "startedAt": { "format": "date-time", "type": "string" },
          "state": {
            "anyOf": [
              { "const": "pending", "type": "string" },
              { "const": "active", "type": "string" },
              { "const": "retry", "type": "string" },
              { "const": "completed", "type": "string" },
              { "const": "failed", "type": "string" },
              { "const": "cancelled", "type": "string" },
              { "const": "expired", "type": "string" },
              { "const": "dead", "type": "string" },
              { "const": "dismissed", "type": "string" },
            ],
          },
          "tries": { "minimum": 0, "type": "integer" },
          "type": { "minLength": 1, "type": "string" },
          "updatedAt": { "format": "date-time", "type": "string" },
        },
        "required": [
          "id",
          "context",
          "service",
          "type",
          "state",
          "payload",
          "createdAt",
          "updatedAt",
          "tries",
          "maxTries",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 1, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const JobsListRequestSchema = {
  "properties": {
    "limit": { "minimum": 1, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "service": { "minLength": 1, "type": "string" },
    "since": { "format": "date-time", "type": "string" },
    "state": {
      "items": {
        "anyOf": [
          { "const": "pending", "type": "string" },
          { "const": "active", "type": "string" },
          { "const": "retry", "type": "string" },
          { "const": "completed", "type": "string" },
          { "const": "failed", "type": "string" },
          { "const": "cancelled", "type": "string" },
          { "const": "expired", "type": "string" },
          { "const": "dead", "type": "string" },
          { "const": "dismissed", "type": "string" },
        ],
      },
      "type": "array",
    },
    "type": { "minLength": 1, "type": "string" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const JobsListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "items": {
        "properties": {
          "completedAt": { "format": "date-time", "type": "string" },
          "concurrency": {
            "properties": {
              "heartbeatAt": { "format": "date-time", "type": "string" },
              "key": { "minLength": 1, "type": "string" },
              "keyHash": { "minLength": 1, "type": "string" },
              "leaseExpiresAt": { "format": "date-time", "type": "string" },
              "staleTakeoverCount": { "minimum": 0, "type": "integer" },
            },
            "required": ["key", "keyHash"],
            "type": "object",
          },
          "context": {
            "properties": {
              "requestId": { "minLength": 1, "type": "string" },
              "traceId": { "pattern": "^[0-9a-f]{32}$", "type": "string" },
              "traceparent": {
                "pattern":
                  "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
                "type": "string",
              },
              "tracestate": { "minLength": 1, "type": "string" },
            },
            "required": ["requestId", "traceId", "traceparent"],
            "type": "object",
          },
          "createdAt": { "format": "date-time", "type": "string" },
          "deadline": { "format": "date-time", "type": "string" },
          "id": { "minLength": 1, "type": "string" },
          "lastError": { "type": "string" },
          "logs": {
            "items": {
              "properties": {
                "level": {
                  "anyOf": [{ "const": "info", "type": "string" }, {
                    "const": "warn",
                    "type": "string",
                  }, { "const": "error", "type": "string" }],
                },
                "message": { "type": "string" },
                "timestamp": { "format": "date-time", "type": "string" },
              },
              "required": ["timestamp", "level", "message"],
              "type": "object",
            },
            "type": "array",
          },
          "maxTries": { "minimum": 1, "type": "integer" },
          "payload": {},
          "progress": {
            "properties": {
              "current": { "minimum": 0, "type": "integer" },
              "message": { "type": "string" },
              "step": { "type": "string" },
              "total": { "minimum": 0, "type": "integer" },
            },
            "type": "object",
          },
          "queuePolicy": {
            "properties": {
              "existingJobId": { "minLength": 1, "type": "string" },
              "outcome": { "minLength": 1, "type": "string" },
              "reason": { "minLength": 1, "type": "string" },
              "replacedJobId": { "minLength": 1, "type": "string" },
            },
            "required": ["outcome"],
            "type": "object",
          },
          "result": {},
          "service": { "minLength": 1, "type": "string" },
          "startedAt": { "format": "date-time", "type": "string" },
          "state": {
            "anyOf": [
              { "const": "pending", "type": "string" },
              { "const": "active", "type": "string" },
              { "const": "retry", "type": "string" },
              { "const": "completed", "type": "string" },
              { "const": "failed", "type": "string" },
              { "const": "cancelled", "type": "string" },
              { "const": "expired", "type": "string" },
              { "const": "dead", "type": "string" },
              { "const": "dismissed", "type": "string" },
            ],
          },
          "tries": { "minimum": 0, "type": "integer" },
          "type": { "minLength": 1, "type": "string" },
          "updatedAt": { "format": "date-time", "type": "string" },
        },
        "required": [
          "id",
          "context",
          "service",
          "type",
          "state",
          "payload",
          "createdAt",
          "updatedAt",
          "tries",
          "maxTries",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 1, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const JobsListServicesRequestSchema = {
  "properties": {
    "limit": { "minimum": 1, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const JobsListServicesResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "items": {
        "properties": {
          "healthy": { "type": "boolean" },
          "name": { "minLength": 1, "type": "string" },
          "workers": {
            "items": {
              "properties": {
                "concurrency": { "minimum": 1, "type": "integer" },
                "instanceId": { "minLength": 1, "type": "string" },
                "jobType": { "minLength": 1, "type": "string" },
                "service": { "minLength": 1, "type": "string" },
                "timestamp": { "format": "date-time", "type": "string" },
                "version": { "minLength": 1, "type": "string" },
              },
              "required": ["service", "jobType", "instanceId", "timestamp"],
              "type": "object",
            },
            "type": "array",
          },
        },
        "required": ["name", "healthy", "workers"],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 1, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const JobsReplayDLQRequestSchema = {
  "description":
    "Jobs admin ids are globally addressable; callers identify jobs by id only.",
  "properties": { "id": { "minLength": 1, "type": "string" } },
  "required": ["id"],
  "type": "object",
} as const;

export const JobsReplayDLQResponseSchema = {
  "properties": {
    "job": {
      "properties": {
        "completedAt": { "format": "date-time", "type": "string" },
        "concurrency": {
          "properties": {
            "heartbeatAt": { "format": "date-time", "type": "string" },
            "key": { "minLength": 1, "type": "string" },
            "keyHash": { "minLength": 1, "type": "string" },
            "leaseExpiresAt": { "format": "date-time", "type": "string" },
            "staleTakeoverCount": { "minimum": 0, "type": "integer" },
          },
          "required": ["key", "keyHash"],
          "type": "object",
        },
        "context": {
          "properties": {
            "requestId": { "minLength": 1, "type": "string" },
            "traceId": { "pattern": "^[0-9a-f]{32}$", "type": "string" },
            "traceparent": {
              "pattern": "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
              "type": "string",
            },
            "tracestate": { "minLength": 1, "type": "string" },
          },
          "required": ["requestId", "traceId", "traceparent"],
          "type": "object",
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "deadline": { "format": "date-time", "type": "string" },
        "id": { "minLength": 1, "type": "string" },
        "lastError": { "type": "string" },
        "logs": {
          "items": {
            "properties": {
              "level": {
                "anyOf": [{ "const": "info", "type": "string" }, {
                  "const": "warn",
                  "type": "string",
                }, { "const": "error", "type": "string" }],
              },
              "message": { "type": "string" },
              "timestamp": { "format": "date-time", "type": "string" },
            },
            "required": ["timestamp", "level", "message"],
            "type": "object",
          },
          "type": "array",
        },
        "maxTries": { "minimum": 1, "type": "integer" },
        "payload": {},
        "progress": {
          "properties": {
            "current": { "minimum": 0, "type": "integer" },
            "message": { "type": "string" },
            "step": { "type": "string" },
            "total": { "minimum": 0, "type": "integer" },
          },
          "type": "object",
        },
        "queuePolicy": {
          "properties": {
            "existingJobId": { "minLength": 1, "type": "string" },
            "outcome": { "minLength": 1, "type": "string" },
            "reason": { "minLength": 1, "type": "string" },
            "replacedJobId": { "minLength": 1, "type": "string" },
          },
          "required": ["outcome"],
          "type": "object",
        },
        "result": {},
        "service": { "minLength": 1, "type": "string" },
        "startedAt": { "format": "date-time", "type": "string" },
        "state": {
          "anyOf": [
            { "const": "pending", "type": "string" },
            { "const": "active", "type": "string" },
            { "const": "retry", "type": "string" },
            { "const": "completed", "type": "string" },
            { "const": "failed", "type": "string" },
            { "const": "cancelled", "type": "string" },
            { "const": "expired", "type": "string" },
            { "const": "dead", "type": "string" },
            { "const": "dismissed", "type": "string" },
          ],
        },
        "tries": { "minimum": 0, "type": "integer" },
        "type": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "id",
        "context",
        "service",
        "type",
        "state",
        "payload",
        "createdAt",
        "updatedAt",
        "tries",
        "maxTries",
      ],
      "type": "object",
    },
  },
  "required": ["job"],
  "type": "object",
} as const;

export const JobsRetryRequestSchema = {
  "description":
    "Jobs admin ids are globally addressable; callers identify jobs by id only.",
  "properties": { "id": { "minLength": 1, "type": "string" } },
  "required": ["id"],
  "type": "object",
} as const;

export const JobsRetryResponseSchema = {
  "properties": {
    "job": {
      "properties": {
        "completedAt": { "format": "date-time", "type": "string" },
        "concurrency": {
          "properties": {
            "heartbeatAt": { "format": "date-time", "type": "string" },
            "key": { "minLength": 1, "type": "string" },
            "keyHash": { "minLength": 1, "type": "string" },
            "leaseExpiresAt": { "format": "date-time", "type": "string" },
            "staleTakeoverCount": { "minimum": 0, "type": "integer" },
          },
          "required": ["key", "keyHash"],
          "type": "object",
        },
        "context": {
          "properties": {
            "requestId": { "minLength": 1, "type": "string" },
            "traceId": { "pattern": "^[0-9a-f]{32}$", "type": "string" },
            "traceparent": {
              "pattern": "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
              "type": "string",
            },
            "tracestate": { "minLength": 1, "type": "string" },
          },
          "required": ["requestId", "traceId", "traceparent"],
          "type": "object",
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "deadline": { "format": "date-time", "type": "string" },
        "id": { "minLength": 1, "type": "string" },
        "lastError": { "type": "string" },
        "logs": {
          "items": {
            "properties": {
              "level": {
                "anyOf": [{ "const": "info", "type": "string" }, {
                  "const": "warn",
                  "type": "string",
                }, { "const": "error", "type": "string" }],
              },
              "message": { "type": "string" },
              "timestamp": { "format": "date-time", "type": "string" },
            },
            "required": ["timestamp", "level", "message"],
            "type": "object",
          },
          "type": "array",
        },
        "maxTries": { "minimum": 1, "type": "integer" },
        "payload": {},
        "progress": {
          "properties": {
            "current": { "minimum": 0, "type": "integer" },
            "message": { "type": "string" },
            "step": { "type": "string" },
            "total": { "minimum": 0, "type": "integer" },
          },
          "type": "object",
        },
        "queuePolicy": {
          "properties": {
            "existingJobId": { "minLength": 1, "type": "string" },
            "outcome": { "minLength": 1, "type": "string" },
            "reason": { "minLength": 1, "type": "string" },
            "replacedJobId": { "minLength": 1, "type": "string" },
          },
          "required": ["outcome"],
          "type": "object",
        },
        "result": {},
        "service": { "minLength": 1, "type": "string" },
        "startedAt": { "format": "date-time", "type": "string" },
        "state": {
          "anyOf": [
            { "const": "pending", "type": "string" },
            { "const": "active", "type": "string" },
            { "const": "retry", "type": "string" },
            { "const": "completed", "type": "string" },
            { "const": "failed", "type": "string" },
            { "const": "cancelled", "type": "string" },
            { "const": "expired", "type": "string" },
            { "const": "dead", "type": "string" },
            { "const": "dismissed", "type": "string" },
          ],
        },
        "tries": { "minimum": 0, "type": "integer" },
        "type": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "id",
        "context",
        "service",
        "type",
        "state",
        "payload",
        "createdAt",
        "updatedAt",
        "tries",
        "maxTries",
      ],
      "type": "object",
    },
  },
  "required": ["job"],
  "type": "object",
} as const;

export const NotFoundErrorDataSchema = {
  "properties": {
    "context": { "patternProperties": { "^.*$": {} }, "type": "object" },
    "id": { "minLength": 1, "type": "string" },
    "jobId": { "minLength": 1, "type": "string" },
    "message": { "type": "string" },
    "resource": { "minLength": 1, "type": "string" },
    "traceId": { "type": "string" },
    "type": { "const": "NotFoundError", "type": "string" },
  },
  "required": ["id", "type", "message", "resource"],
  "type": "object",
} as const;
