import Type, { type Static } from "typebox";

export const AuthKickConnectionSchema = Type.Object(
  {
    userNkey: Type.String(),
  },
  { additionalProperties: false },
);
export type AuthKickConnectionInput = Static<typeof AuthKickConnectionSchema>;

export const AuthKickConnectionResponseSchema = Type.Object(
  { success: Type.Boolean() },
  { additionalProperties: false },
);
export type AuthKickConnectionResponse = Static<
  typeof AuthKickConnectionResponseSchema
>;
