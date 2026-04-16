import { Type } from "typebox";

export const HealthRpcSchema = Type.Object({});

export const HealthInfoSchema = Type.Record(Type.String(), Type.Unknown());

export const HealthCheckResultSchema = Type.Object({
  name: Type.String(),
  status: Type.Union([Type.Literal("ok"), Type.Literal("failed")]),
  error: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  info: Type.Optional(HealthInfoSchema),
  latencyMs: Type.Number(),
});

export const HealthResponseSchema = Type.Object({
  status: Type.Union([
    Type.Literal("healthy"),
    Type.Literal("unhealthy"),
    Type.Literal("degraded"),
  ]),
  service: Type.String(),
  timestamp: Type.String({ format: "date-time" }),
  checks: Type.Array(HealthCheckResultSchema),
});

export const HealthHeartbeatHeaderSchema = Type.Object({
  id: Type.String(),
  time: Type.String({ format: "date-time" }),
});

export const HealthHeartbeatServiceSchema = Type.Object({
  name: Type.String(),
  kind: Type.Union([Type.Literal("service"), Type.Literal("device")]),
  instanceId: Type.String(),
  contractId: Type.String(),
  contractDigest: Type.String(),
  startedAt: Type.String({ format: "date-time" }),
  publishIntervalMs: Type.Integer({ minimum: 1 }),
  runtime: Type.Union([
    Type.Literal("deno"),
    Type.Literal("node"),
    Type.Literal("rust"),
    Type.Literal("unknown"),
  ]),
  runtimeVersion: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  info: Type.Optional(HealthInfoSchema),
});

export const HealthHeartbeatSchema = Type.Object({
  header: HealthHeartbeatHeaderSchema,
  service: HealthHeartbeatServiceSchema,
  status: Type.Union([
    Type.Literal("healthy"),
    Type.Literal("unhealthy"),
    Type.Literal("degraded"),
  ]),
  summary: Type.Optional(Type.String()),
  checks: Type.Array(HealthCheckResultSchema),
});
