import Type, { type Static } from "typebox";

import type { StateEntry, StateMigrationRequired } from "../State.ts";
import { StateEntrySchema, StateMigrationRequiredSchema } from "../State.ts";

export const StateGetSchema = Type.Object({
  store: Type.String({ minLength: 1 }),
  key: Type.Optional(Type.String({ minLength: 1 })),
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
  StateMigrationRequiredSchema,
]);
export type StateGetResponse =
  | { found: false }
  | { found: true; entry: StateEntry }
  | StateMigrationRequired;
