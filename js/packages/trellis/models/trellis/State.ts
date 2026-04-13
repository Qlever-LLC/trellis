import Type, { type StaticDecode } from "typebox";

import type { JsonValue as TrellisJsonValue } from "../../contracts.ts";

export const StateScopeSchema = Type.Union([
  Type.Literal("userApp"),
  Type.Literal("deviceApp"),
]);
export type StateScope = StaticDecode<typeof StateScopeSchema>;

export const JsonValueSchema = Type.Unknown();
export type JsonValue = TrellisJsonValue;

export const StateEntrySchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  value: JsonValueSchema,
  revision: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ format: "date-time" }),
  expiresAt: Type.Optional(Type.String({ format: "date-time" })),
}, { additionalProperties: false });
export type StateEntry = StaticDecode<typeof StateEntrySchema>;

export const StateUserTargetSchema = Type.Object({
  origin: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type StateUserTarget = StaticDecode<typeof StateUserTargetSchema>;
