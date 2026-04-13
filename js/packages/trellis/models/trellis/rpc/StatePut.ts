import Type, { type Static } from "typebox";

import { JsonValueSchema, StateEntrySchema, StateScopeSchema } from "../State.ts";

export const StatePutSchema = Type.Object({
  scope: StateScopeSchema,
  key: Type.String({ minLength: 1 }),
  value: JsonValueSchema,
  ttlMs: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });
export type StatePutInput = Static<typeof StatePutSchema>;

export const StatePutResponseSchema = Type.Object({
  entry: StateEntrySchema,
}, { additionalProperties: false });
export type StatePutResponse = Static<typeof StatePutResponseSchema>;
