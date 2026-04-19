import Type, { type Static } from "typebox";

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });
const IsoDateStringSchema = Type.String({ format: "date-time" });
const UserParticipantKindSchema = Type.Union([
  Type.Literal("app"),
  Type.Literal("agent"),
]);

export const AuthListUserGrantsSchema = Type.Object({});
export type AuthListUserGrantsInput = Static<typeof AuthListUserGrantsSchema>;

export const AuthUserGrantRowSchema = Type.Object({
  contractDigest: DigestSchema,
  contractId: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  participantKind: UserParticipantKindSchema,
  capabilities: Type.Array(Type.String()),
  grantedAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});
export type AuthUserGrantRow = Static<typeof AuthUserGrantRowSchema>;

export const AuthListUserGrantsResponseSchema = Type.Object({
  grants: Type.Array(AuthUserGrantRowSchema),
});
export type AuthListUserGrantsResponse = Static<
  typeof AuthListUserGrantsResponseSchema
>;
