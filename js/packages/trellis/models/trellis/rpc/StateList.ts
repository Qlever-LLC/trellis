import Type, { type Static } from "typebox";

import { StateEntrySchema, StateMigrationRequiredSchema } from "../State.ts";

export const StateListSchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0 }),
  store: Type.String({ minLength: 1 }),
  prefix: Type.Optional(Type.String({ minLength: 1 })),
});
export type StateListInput = Static<typeof StateListSchema>;

export const StateListResponseSchema = Type.Object({
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
export type StateListResponse = Static<typeof StateListResponseSchema>;
