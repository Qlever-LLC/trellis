import Type, { type Static } from "typebox";

import { StateUserTargetSchema } from "../State.ts";

export const StateAdminDeleteSchema = Type.Union([
  Type.Object({
    scope: Type.Literal("userApp"),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    store: Type.String({ minLength: 1 }),
    user: StateUserTargetSchema,
    key: Type.Optional(Type.String({ minLength: 1 })),
    expectedRevision: Type.Optional(Type.String({ minLength: 1 })),
  }),
  Type.Object({
    scope: Type.Literal("deviceApp"),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    store: Type.String({ minLength: 1 }),
    deviceId: Type.String({ minLength: 1 }),
    key: Type.Optional(Type.String({ minLength: 1 })),
    expectedRevision: Type.Optional(Type.String({ minLength: 1 })),
  }),
]);
export type StateAdminDeleteInput = Static<typeof StateAdminDeleteSchema>;

export const StateAdminDeleteResponseSchema = Type.Object({
  deleted: Type.Boolean(),
});
export type StateAdminDeleteResponse = Static<
  typeof StateAdminDeleteResponseSchema
>;
