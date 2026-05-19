import Type, { type Static } from "typebox";

import {
  StateEntrySchema,
  StateMigrationRequiredSchema,
  StateUserTargetSchema,
} from "../State.ts";

export const StateAdminListSchema = Type.Union([
  Type.Object({
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Integer({ minimum: 0 }),
    scope: Type.Literal("userApp"),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    store: Type.String({ minLength: 1 }),
    user: StateUserTargetSchema,
    prefix: Type.Optional(Type.String({ minLength: 1 })),
  }),
  Type.Object({
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Integer({ minimum: 0 }),
    scope: Type.Literal("deviceApp"),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    store: Type.String({ minLength: 1 }),
    deviceId: Type.String({ minLength: 1 }),
    prefix: Type.Optional(Type.String({ minLength: 1 })),
  }),
]);
export type StateAdminListInput = Static<typeof StateAdminListSchema>;

export const StateAdminListResponseSchema = Type.Object({
  entries: Type.Array(
    Type.Union([
      StateEntrySchema,
      StateMigrationRequiredSchema,
    ]),
    { default: [] },
  ),
  count: Type.Integer({ minimum: 0 }),
  offset: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 0 }),
  nextOffset: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type StateAdminListResponse = Static<
  typeof StateAdminListResponseSchema
>;
