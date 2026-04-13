import Type, { type Static } from "typebox";

import { StateScopeSchema } from "../State.ts";

export const StateDeleteSchema = Type.Object({
  scope: StateScopeSchema,
  key: Type.String({ minLength: 1 }),
  expectedRevision: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
export type StateDeleteInput = Static<typeof StateDeleteSchema>;

export const StateDeleteResponseSchema = Type.Object({
  deleted: Type.Boolean(),
}, { additionalProperties: false });
export type StateDeleteResponse = Static<typeof StateDeleteResponseSchema>;
