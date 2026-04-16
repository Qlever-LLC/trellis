import Type, { type Static } from "typebox";

export const AuthRevokeSessionSchema = Type.Object(
  {
    sessionKey: Type.String(),
  },
);
export type AuthRevokeSessionInput = Static<typeof AuthRevokeSessionSchema>;

export const AuthRevokeSessionResponseSchema = Type.Object(
  { success: Type.Boolean() },
);
export type AuthRevokeSessionResponse = Static<
  typeof AuthRevokeSessionResponseSchema
>;
