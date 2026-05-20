import Type, { type Static } from "typebox";

export const AuthIdentityEnvelopesRevokeSchema = Type.Object({
  identityEnvelopeId: Type.String({ minLength: 1 }),
});
export type AuthIdentityEnvelopesRevokeInput = Static<
  typeof AuthIdentityEnvelopesRevokeSchema
>;

export const AuthIdentityEnvelopesRevokeResponseSchema = Type.Object({
  success: Type.Boolean(),
});
export type AuthIdentityEnvelopesRevokeResponse = Static<
  typeof AuthIdentityEnvelopesRevokeResponseSchema
>;
