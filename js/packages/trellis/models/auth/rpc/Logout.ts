import Type, { type Static } from "typebox";

export const AuthLogoutSchema = Type.Object(
  {},
);
export type AuthLogoutInput = Static<typeof AuthLogoutSchema>;

export const AuthLogoutResponseSchema = Type.Object(
  {
    success: Type.Boolean(),
  },
);
export type AuthLogoutResponse = Static<typeof AuthLogoutResponseSchema>;
