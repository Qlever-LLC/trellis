import Type, { type Static } from "typebox";

export const AuthIdentityGrantsRevokeSchema = Type.Object({
  identityGrantId: Type.String({ minLength: 1 }),
});
export type AuthIdentityGrantsRevokeInput = Static<
  typeof AuthIdentityGrantsRevokeSchema
>;

export const AuthIdentityGrantsRevokeResponseSchema = Type.Object({
  success: Type.Boolean(),
});
export type AuthIdentityGrantsRevokeResponse = Static<
  typeof AuthIdentityGrantsRevokeResponseSchema
>;
