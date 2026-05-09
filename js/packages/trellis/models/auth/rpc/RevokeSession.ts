import Type, { type Static } from "typebox";

export const AuthSessionsRevokeSchema = Type.Object(
  {
    sessionKey: Type.String(),
  },
);
export type AuthSessionsRevokeInput = Static<typeof AuthSessionsRevokeSchema>;

export const AuthSessionsRevokeResponseSchema = Type.Object(
  { success: Type.Boolean() },
);
export type AuthSessionsRevokeResponse = Static<
  typeof AuthSessionsRevokeResponseSchema
>;
