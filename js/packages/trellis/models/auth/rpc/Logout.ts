import Type, { type Static } from "typebox";

export const AuthSessionsLogoutSchema = Type.Object(
  {},
  { additionalProperties: true },
);
export type AuthSessionsLogoutInput = Static<typeof AuthSessionsLogoutSchema>;

export const AuthSessionsLogoutResponseSchema = Type.Object(
  {
    success: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AuthSessionsLogoutResponse = Static<
  typeof AuthSessionsLogoutResponseSchema
>;
