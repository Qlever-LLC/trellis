import { Type } from "typebox";

export const HealthRpcSchema = Type.Object({}, { additionalProperties: false });

export const HealthCheckResultSchema = Type.Object({
  name: Type.String(),
  status: Type.Union([Type.Literal("ok"), Type.Literal("failed")]),
  error: Type.Optional(Type.String()),
  latencyMs: Type.Number(),
}, { additionalProperties: false });

export const HealthResponseSchema = Type.Object({
  status: Type.Union([
    Type.Literal("healthy"),
    Type.Literal("unhealthy"),
    Type.Literal("degraded"),
  ]),
  service: Type.String(),
  timestamp: Type.String({ format: "date-time" }),
  checks: Type.Array(HealthCheckResultSchema),
}, { additionalProperties: false });
