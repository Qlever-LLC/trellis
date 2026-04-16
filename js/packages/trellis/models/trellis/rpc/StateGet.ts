import Type, { type Static } from "typebox";

import { StateEntrySchema, StateScopeSchema } from "../State.ts";

export const StateGetSchema = Type.Object({
  scope: StateScopeSchema,
  key: Type.String({ minLength: 1 }),
});
export type StateGetInput = Static<typeof StateGetSchema>;

export const StateGetResponseSchema = Type.Union([
  Type.Object({
    found: Type.Literal(false),
  }),
  Type.Object({
    found: Type.Literal(true),
    entry: StateEntrySchema,
  }),
]);
export type StateGetResponse = Static<typeof StateGetResponseSchema>;
