import Type, { type StaticDecode } from "typebox";

import type { JsonValue as TrellisJsonValue } from "../../contracts.ts";

export const StateStoreKindSchema = Type.Union([
  Type.Literal("value"),
  Type.Literal("map"),
]);
export type StateStoreKind = "value" | "map";

export const StateScopeSchema = Type.Union([
  Type.Literal("userApp"),
  Type.Literal("deviceApp"),
]);
export type StateScope = "userApp" | "deviceApp";

export const JsonValueSchema = Type.Unknown();
export type JsonValue = TrellisJsonValue;

export const StateEntrySchema = Type.Object({
  key: Type.Optional(Type.String({ minLength: 1 })),
  value: JsonValueSchema,
  revision: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ format: "date-time" }),
  expiresAt: Type.Optional(Type.String({ format: "date-time" })),
});
export type StateEntry = {
  key?: string;
  value: TrellisJsonValue;
  revision: string;
  updatedAt: string;
  expiresAt?: string;
};

export const StateUserTargetSchema = Type.Object({
  origin: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
});
export type StateUserTarget = StaticDecode<typeof StateUserTargetSchema>;
