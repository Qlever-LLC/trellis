import Type, { type Static } from "typebox";

export const AuthSessionsLogoutSchema = Type.Object(
  {},
);
export type AuthSessionsLogoutInput = Static<typeof AuthSessionsLogoutSchema>;

export const AuthSessionsLogoutResponseSchema = Type.Object(
  {
    success: Type.Boolean(),
  },
);
export type AuthSessionsLogoutResponse = Static<typeof AuthSessionsLogoutResponseSchema>;
