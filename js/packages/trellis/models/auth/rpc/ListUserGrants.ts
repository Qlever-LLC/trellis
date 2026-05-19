import Type, { type Static } from "typebox";
import { PageResponseSchema } from "../../../contract_support/protocol.ts";

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });
const IsoDateStringSchema = Type.String({ format: "date-time" });
const UserParticipantKindSchema = Type.Union([
  Type.Literal("app"),
  Type.Literal("agent"),
]);
const IdentityAnchorSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("web"),
    contractId: Type.String({ minLength: 1 }),
    origin: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    kind: Type.Literal("cli"),
    contractId: Type.String({ minLength: 1 }),
    sessionPublicKey: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    kind: Type.Literal("native"),
    contractId: Type.String({ minLength: 1 }),
    sessionPublicKey: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    kind: Type.Literal("device-user"),
    contractId: Type.String({ minLength: 1 }),
    devicePublicKey: Type.String({ minLength: 1 }),
  }),
]);
const ContractEvidenceSchema = Type.Object({
  contractDigest: DigestSchema,
  contractId: Type.String({ minLength: 1 }),
});

export const AuthIdentitiesGrantsListSchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export type AuthIdentitiesGrantsListInput = Static<
  typeof AuthIdentitiesGrantsListSchema
>;

export const AuthUserGrantRowSchema = Type.Object({
  identityEnvelopeId: Type.String({ minLength: 1 }),
  identityAnchor: IdentityAnchorSchema,
  contractEvidence: ContractEvidenceSchema,
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  participantKind: UserParticipantKindSchema,
  capabilities: Type.Array(Type.String()),
  grantedAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});
export type AuthUserGrantRow = Static<typeof AuthUserGrantRowSchema>;

export const AuthIdentitiesGrantsListResponseSchema = Type.Object({
  ...PageResponseSchema(AuthUserGrantRowSchema).properties,
});
export type AuthIdentitiesGrantsListResponse = Static<
  typeof AuthIdentitiesGrantsListResponseSchema
>;
