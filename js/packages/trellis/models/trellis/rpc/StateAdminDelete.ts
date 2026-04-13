import Type, { type Static } from "typebox";

import { StateUserTargetSchema } from "../State.ts";

export const StateAdminDeleteSchema = Type.Union([
  Type.Object({
    scope: Type.Literal("userApp"),
    contractId: Type.String({ minLength: 1 }),
    user: StateUserTargetSchema,
    key: Type.String({ minLength: 1 }),
    expectedRevision: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }),
  Type.Object({
    scope: Type.Literal("deviceApp"),
    contractId: Type.String({ minLength: 1 }),
    deviceId: Type.String({ minLength: 1 }),
    key: Type.String({ minLength: 1 }),
    expectedRevision: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }),
]);
export type StateAdminDeleteInput = Static<typeof StateAdminDeleteSchema>;

export const StateAdminDeleteResponseSchema = Type.Object({
  deleted: Type.Boolean(),
}, { additionalProperties: false });
export type StateAdminDeleteResponse = Static<typeof StateAdminDeleteResponseSchema>;
