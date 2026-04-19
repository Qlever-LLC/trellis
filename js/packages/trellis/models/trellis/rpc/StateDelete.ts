import Type, { type Static } from "typebox";

export const StateDeleteSchema = Type.Object({
  store: Type.String({ minLength: 1 }),
  key: Type.Optional(Type.String({ minLength: 1 })),
  expectedRevision: Type.Optional(Type.String({ minLength: 1 })),
});
export type StateDeleteInput = Static<typeof StateDeleteSchema>;

export const StateDeleteResponseSchema = Type.Object({
  deleted: Type.Boolean(),
});
export type StateDeleteResponse = Static<typeof StateDeleteResponseSchema>;
