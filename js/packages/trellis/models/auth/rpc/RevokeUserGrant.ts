import Type, { type Static } from "typebox";

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });

export const AuthRevokeUserGrantSchema = Type.Object({
  contractDigest: DigestSchema,
});
export type AuthRevokeUserGrantInput = Static<typeof AuthRevokeUserGrantSchema>;

export const AuthRevokeUserGrantResponseSchema = Type.Object({
  success: Type.Boolean(),
});
export type AuthRevokeUserGrantResponse = Static<
  typeof AuthRevokeUserGrantResponseSchema
>;
