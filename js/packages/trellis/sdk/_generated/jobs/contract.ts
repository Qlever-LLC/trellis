// Generated from ./generated/contracts/manifests/trellis.jobs@v1.json
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

export const CONTRACT_ID = "trellis.jobs@v1" as const;
export const CONTRACT_DIGEST =
  "xDigtrlrF3n3ZNgHVdwDJFcwi0PEJBiDyBG6FnzFzM8" as const;
export const CONTRACT = {
  "capabilities": {
    "trellis.jobs::admin.mutate": {
      "consequence": "Can change background job execution state.",
      "description":
        "Cancel, retry, replay, or dismiss Jobs service work items.",
      "displayName": "Mutate jobs admin data",
    },
    "trellis.jobs::admin.read": {
      "description":
        "View Jobs service health, services, jobs, and dead-letter queues.",
      "displayName": "Read jobs admin data",
    },
  },
  "description": "Trellis-managed background job administration API.",
  "displayName": "Trellis Jobs",
  "docs": {
    "markdown":
      "Provides health, service, job, retry, cancel, and dead-letter queue RPCs for Trellis-managed background work.",
    "summary": "Background job administration APIs.",
  },
  "errors": {
    "NotFoundError": {
      "schema": { "schema": "NotFoundErrorData" },
      "type": "NotFoundError",
    },
  },
  "format": "trellis.contract.v1",
  "id": "trellis.jobs@v1",
  "kind": "service",
  "rpc": {
    "Jobs.Cancel": {
      "capabilities": { "call": ["trellis.jobs::admin.mutate"] },
      "docs": {
        "markdown": "Requests cancellation for one background job.",
        "summary": "Cancel a job.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }, {
        "type": "NotFoundError",
      }],
      "input": { "schema": "JobsCancelRequest" },
      "output": { "schema": "JobsCancelResponse" },
      "subject": "rpc.v1.Jobs.Cancel",
      "version": "v1",
    },
    "Jobs.DismissDLQ": {
      "capabilities": { "call": ["trellis.jobs::admin.mutate"] },
      "docs": {
        "markdown": "Marks one dead-letter job as dismissed.",
        "summary": "Dismiss a dead-letter job.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }, {
        "type": "NotFoundError",
      }],
      "input": { "schema": "JobsDismissDLQRequest" },
      "output": { "schema": "JobsDismissDLQResponse" },
      "subject": "rpc.v1.Jobs.DismissDLQ",
      "version": "v1",
    },
    "Jobs.Get": {
      "capabilities": { "call": ["trellis.jobs::admin.read"] },
      "docs": {
        "markdown": "Returns one background job by id.",
        "summary": "Read a job.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }, {
        "type": "NotFoundError",
      }],
      "input": { "schema": "JobsGetRequest" },
      "output": { "schema": "JobsGetResponse" },
      "subject": "rpc.v1.Jobs.Get",
      "version": "v1",
    },
    "Jobs.GetKey": {
      "capabilities": { "call": ["trellis.jobs::admin.read"] },
      "docs": {
        "markdown":
          "Returns projection-backed keyed concurrency state for one service job key.",
        "summary": "Read keyed job concurrency state.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }, {
        "type": "NotFoundError",
      }],
      "input": { "schema": "JobsGetKeyRequest" },
      "output": { "schema": "JobsGetKeyResponse" },
      "subject": "rpc.v1.Jobs.GetKey",
      "version": "v1",
    },
    "Jobs.Health": {
      "capabilities": { "call": ["trellis.jobs::admin.read"] },
      "docs": {
        "markdown": "Returns Jobs service health and worker status details.",
        "summary": "Read jobs health.",
      },
      "errors": [{ "type": "UnexpectedError" }],
      "input": { "schema": "Empty" },
      "output": { "schema": "JobsHealthResponse" },
      "subject": "rpc.v1.Jobs.Health",
      "version": "v1",
    },
    "Jobs.List": {
      "capabilities": { "call": ["trellis.jobs::admin.read"] },
      "docs": {
        "markdown": "Lists jobs matching the requested filters.",
        "summary": "List jobs.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }],
      "input": { "schema": "JobsListRequest" },
      "output": { "schema": "JobsListResponse" },
      "subject": "rpc.v1.Jobs.List",
      "version": "v1",
    },
    "Jobs.ListDLQ": {
      "capabilities": { "call": ["trellis.jobs::admin.read"] },
      "docs": {
        "markdown": "Lists jobs currently in dead-letter queues.",
        "summary": "List dead-letter jobs.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }],
      "input": { "schema": "JobsListDLQRequest" },
      "output": { "schema": "JobsListDLQResponse" },
      "subject": "rpc.v1.Jobs.ListDLQ",
      "version": "v1",
    },
    "Jobs.ListServices": {
      "capabilities": { "call": ["trellis.jobs::admin.read"] },
      "docs": {
        "markdown": "Lists services that own or execute background job queues.",
        "summary": "List job services.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }],
      "input": { "schema": "JobsListServicesRequest" },
      "output": { "schema": "JobsListServicesResponse" },
      "subject": "rpc.v1.Jobs.ListServices",
      "version": "v1",
    },
    "Jobs.ReplayDLQ": {
      "capabilities": { "call": ["trellis.jobs::admin.mutate"] },
      "docs": {
        "markdown": "Moves one dead-letter job back to processing.",
        "summary": "Replay a dead-letter job.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }, {
        "type": "NotFoundError",
      }],
      "input": { "schema": "JobsReplayDLQRequest" },
      "output": { "schema": "JobsReplayDLQResponse" },
      "subject": "rpc.v1.Jobs.ReplayDLQ",
      "version": "v1",
    },
    "Jobs.Retry": {
      "capabilities": { "call": ["trellis.jobs::admin.mutate"] },
      "docs": {
        "markdown": "Moves a failed job back into retry processing.",
        "summary": "Retry a job.",
      },
      "errors": [{ "type": "UnexpectedError" }, { "type": "ValidationError" }, {
        "type": "NotFoundError",
      }],
      "input": { "schema": "JobsRetryRequest" },
      "output": { "schema": "JobsRetryResponse" },
      "subject": "rpc.v1.Jobs.Retry",
      "version": "v1",
    },
  },
  "schemas": {
    "Empty": { "properties": {}, "type": "object" },
    "Job": {
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
    "JobConcurrencyMetadata": {
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
    "JobContext": {
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
    "JobLogEntry": {
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
    "JobProgress": {
      "properties": {
        "current": { "minimum": 0, "type": "integer" },
        "message": { "type": "string" },
        "step": { "type": "string" },
        "total": { "minimum": 0, "type": "integer" },
      },
      "type": "object",
    },
    "JobQueuePolicyMetadata": {
      "properties": {
        "existingJobId": { "minLength": 1, "type": "string" },
        "outcome": { "minLength": 1, "type": "string" },
        "reason": { "minLength": 1, "type": "string" },
        "replacedJobId": { "minLength": 1, "type": "string" },
      },
      "required": ["outcome"],
      "type": "object",
    },
    "JobState": {
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
    "JobsCancelRequest": {
      "description":
        "Jobs admin ids are globally addressable; callers identify jobs by id only.",
      "properties": { "id": { "minLength": 1, "type": "string" } },
      "required": ["id"],
      "type": "object",
    },
    "JobsCancelResponse": {
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
      },
      "required": ["job"],
      "type": "object",
    },
    "JobsDismissDLQRequest": {
      "description":
        "Jobs admin ids are globally addressable; callers identify jobs by id only.",
      "properties": { "id": { "minLength": 1, "type": "string" } },
      "required": ["id"],
      "type": "object",
    },
    "JobsDismissDLQResponse": {
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
      },
      "required": ["job"],
      "type": "object",
    },
    "JobsGetKeyRequest": {
      "properties": {
        "key": { "minLength": 1, "type": "string" },
        "service": { "minLength": 1, "type": "string" },
        "type": { "minLength": 1, "type": "string" },
      },
      "required": ["service", "type", "key"],
      "type": "object",
    },
    "JobsGetKeyResponse": {
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
    },
    "JobsGetRequest": {
      "description":
        "Jobs admin ids are globally addressable; callers identify jobs by id only.",
      "properties": { "id": { "minLength": 1, "type": "string" } },
      "required": ["id"],
      "type": "object",
    },
    "JobsGetResponse": {
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
      },
      "required": ["job"],
      "type": "object",
    },
    "JobsHealthResponse": {
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
    },
    "JobsListDLQRequest": {
      "properties": {
        "limit": { "minimum": 1, "type": "integer" },
        "offset": { "minimum": 0, "type": "integer" },
        "service": { "minLength": 1, "type": "string" },
        "since": { "format": "date-time", "type": "string" },
        "type": { "minLength": 1, "type": "string" },
      },
      "required": ["limit"],
      "type": "object",
    },
    "JobsListDLQResponse": {
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
    },
    "JobsListRequest": {
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
    },
    "JobsListResponse": {
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
    },
    "JobsListServicesRequest": {
      "properties": {
        "limit": { "minimum": 1, "type": "integer" },
        "offset": { "minimum": 0, "type": "integer" },
      },
      "required": ["limit"],
      "type": "object",
    },
    "JobsListServicesResponse": {
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
    },
    "JobsReplayDLQRequest": {
      "description":
        "Jobs admin ids are globally addressable; callers identify jobs by id only.",
      "properties": { "id": { "minLength": 1, "type": "string" } },
      "required": ["id"],
      "type": "object",
    },
    "JobsReplayDLQResponse": {
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
      },
      "required": ["job"],
      "type": "object",
    },
    "JobsRetryRequest": {
      "description":
        "Jobs admin ids are globally addressable; callers identify jobs by id only.",
      "properties": { "id": { "minLength": 1, "type": "string" } },
      "required": ["id"],
      "type": "object",
    },
    "JobsRetryResponse": {
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
      },
      "required": ["job"],
      "type": "object",
    },
    "NotFoundErrorData": {
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
    },
  },
  "uses": {
    "required": {
      "auth": {
        "contract": "trellis.auth@v1",
        "rpc": { "call": ["Auth.Requests.Validate"] },
      },
      "core": {
        "contract": "trellis.core@v1",
        "rpc": { "call": ["Trellis.Bindings.Get", "Trellis.Catalog"] },
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
