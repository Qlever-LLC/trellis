import Type, { type Static } from "typebox";

export const AuthLogoutSchema = Type.Object(
  {},
  {
    additionalProperties: false,
  },
);
export type AuthLogoutInput = Static<typeof AuthLogoutSchema>;

export const AuthLogoutResponseSchema = Type.Object(
  {
    success: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AuthLogoutResponse = Static<typeof AuthLogoutResponseSchema>;
