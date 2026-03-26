import { EventHeaderSchema } from "@qlever-llc/trellis-contracts";
import { type StaticDecode, Type } from "typebox";

export const ActivityKindSchema = Type.Union([
  Type.Literal("auth.connect"),
  Type.Literal("auth.disconnect"),
  Type.Literal("auth.session_revoked"),
  Type.Literal("auth.connection_kicked"),
]);

export const ActivityEntrySchema = Type.Object({
  id: Type.String(),
  kind: ActivityKindSchema,
  occurredAt: Type.String({ format: "date-time" }),
  principalOrigin: Type.String(),
  principalId: Type.String(),
  principalLabel: Type.String(),
  summary: Type.String(),
  sessionKey: Type.Optional(Type.String()),
  userNkey: Type.Optional(Type.String()),
  actor: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false });

export type ActivityEntry = StaticDecode<typeof ActivityEntrySchema>;

export const ActivityListRequestSchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  kind: Type.Optional(ActivityKindSchema),
}, { additionalProperties: false });

export const ActivityListResponseSchema = Type.Object({
  entries: Type.Array(ActivityEntrySchema),
}, { additionalProperties: false });

export const ActivityGetRequestSchema = Type.Object({
  id: Type.String(),
}, { additionalProperties: false });

export const ActivityGetResponseSchema = Type.Object({
  entry: ActivityEntrySchema,
}, { additionalProperties: false });

export const ActivityRecordedEventSchema = Type.Object({
  header: EventHeaderSchema.properties.header,
  id: Type.String(),
  kind: ActivityKindSchema,
  occurredAt: Type.String({ format: "date-time" }),
  principalOrigin: Type.String(),
  principalId: Type.String(),
  principalLabel: Type.String(),
  summary: Type.String(),
  sessionKey: Type.Optional(Type.String()),
  userNkey: Type.Optional(Type.String()),
  actor: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false });
