import Type, { type Static } from "typebox";

export const AuthRevokeSessionSchema = Type.Object(
  {
    sessionKey: Type.String(),
  },
  { additionalProperties: false },
);
export type AuthRevokeSessionInput = Static<typeof AuthRevokeSessionSchema>;

export const AuthRevokeSessionResponseSchema = Type.Object(
  { success: Type.Boolean() },
  { additionalProperties: false },
);
export type AuthRevokeSessionResponse = Static<
  typeof AuthRevokeSessionResponseSchema
>;
