import Type, { type Static } from "typebox";

import { StateEntrySchema, StateUserTargetSchema } from "../State.ts";

export const StateAdminGetSchema = Type.Union([
  Type.Object({
    scope: Type.Literal("userApp"),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    store: Type.String({ minLength: 1 }),
    user: StateUserTargetSchema,
    key: Type.Optional(Type.String({ minLength: 1 })),
  }),
  Type.Object({
    scope: Type.Literal("deviceApp"),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    store: Type.String({ minLength: 1 }),
    deviceId: Type.String({ minLength: 1 }),
    key: Type.Optional(Type.String({ minLength: 1 })),
  }),
]);
export type StateAdminGetInput = Static<typeof StateAdminGetSchema>;

export const StateAdminGetResponseSchema = Type.Union([
  Type.Object({
    found: Type.Literal(false),
  }),
  Type.Object({
    found: Type.Literal(true),
    entry: StateEntrySchema,
  }),
]);
export type StateAdminGetResponse = Static<typeof StateAdminGetResponseSchema>;
