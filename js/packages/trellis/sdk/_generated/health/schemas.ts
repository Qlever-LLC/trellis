// Generated from ./generated/contracts/manifests/trellis.health@v1.json
export const HealthHeartbeatSchema = {
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
  "required": ["service", "status", "checks"],
  "type": "object",
} as const;
