// Generated from rust/crates/integration-harness/fixtures/rpc/contract.ts
export const CallerContextResponseSchema = {
  "properties": {
    "callerType": { "type": "string" },
    "participantKind": { "type": "string" },
    "provider": { "type": "string" },
    "userId": { "type": "string" },
  },
  "required": ["provider", "callerType", "participantKind", "userId"],
  "type": "object",
} as const;

export const NotFoundErrorDataSchema = {
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
} as const;

export const PingRequestSchema = {
  "properties": { "message": { "type": "string" } },
  "required": ["message"],
  "type": "object",
} as const;

export const PingResponseSchema = {
  "properties": { "message": { "type": "string" } },
  "required": ["message"],
  "type": "object",
} as const;

export const TraceContextResponseSchema = {
  "properties": {
    "provider": { "type": "string" },
    "traceId": { "type": "string" },
    "traceparent": { "type": "string" },
  },
  "required": ["provider", "traceId", "traceparent"],
  "type": "object",
} as const;
