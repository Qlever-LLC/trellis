import Type, { type Static } from "typebox";

import { StateEntrySchema, StateScopeSchema } from "../State.ts";

export const StateGetSchema = Type.Object({
  scope: StateScopeSchema,
  key: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type StateGetInput = Static<typeof StateGetSchema>;

export const StateGetResponseSchema = Type.Union([
  Type.Object({
    found: Type.Literal(false),
  }, { additionalProperties: false }),
  Type.Object({
    found: Type.Literal(true),
    entry: StateEntrySchema,
  }, { additionalProperties: false }),
]);
export type StateGetResponse = Static<typeof StateGetResponseSchema>;
