import Type, { type Static } from "typebox";

import { JsonValueSchema, StateEntrySchema, StateScopeSchema } from "../State.ts";

export const StateCompareAndSetSchema = Type.Object({
  scope: StateScopeSchema,
  key: Type.String({ minLength: 1 }),
  expectedRevision: Type.Union([
    Type.String({ minLength: 1 }),
    Type.Null(),
  ]),
  value: JsonValueSchema,
  ttlMs: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });
export type StateCompareAndSetInput = Static<typeof StateCompareAndSetSchema>;

export const StateCompareAndSetResponseSchema = Type.Union([
  Type.Object({
    applied: Type.Literal(true),
    entry: StateEntrySchema,
  }, { additionalProperties: false }),
  Type.Object({
    applied: Type.Literal(false),
    found: Type.Boolean(),
    entry: Type.Optional(StateEntrySchema),
  }, { additionalProperties: false }),
]);
export type StateCompareAndSetResponse = Static<typeof StateCompareAndSetResponseSchema>;
