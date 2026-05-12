import Type, { type Static } from "typebox";

const UserPrincipalSchema = Type.Object({
  type: Type.Literal("user"),
  userId: Type.String(),
  identity: Type.Object({
    identityId: Type.String(),
    provider: Type.String(),
    subject: Type.String(),
  }),
  name: Type.String(),
});

const ServicePrincipalSchema = Type.Object({
  type: Type.Literal("service"),
  id: Type.String(),
  name: Type.String(),
  instanceId: Type.String(),
  deploymentId: Type.String(),
});

const DevicePrincipalSchema = Type.Object({
  type: Type.Literal("device"),
  deviceId: Type.String(),
  deviceType: Type.String(),
  runtimePublicKey: Type.String(),
  deploymentId: Type.String(),
});

const SessionRowBaseSchema = {
  key: Type.String(),
  sessionKey: Type.String(),
  createdAt: Type.String(),
  lastAuth: Type.String(),
};

export const AuthSessionsListSchema = Type.Object({
  user: Type.Optional(Type.String()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export type AuthSessionsListInput = Static<typeof AuthSessionsListSchema>;

export const AuthSessionRowSchema = Type.Union([
  Type.Object({
    ...SessionRowBaseSchema,
    participantKind: Type.Literal("app"),
    principal: UserPrincipalSchema,
    contractId: Type.String(),
    contractDisplayName: Type.String(),
  }),
  Type.Object({
    ...SessionRowBaseSchema,
    participantKind: Type.Literal("agent"),
    principal: UserPrincipalSchema,
    contractId: Type.String(),
    contractDisplayName: Type.String(),
  }),
  Type.Object({
    ...SessionRowBaseSchema,
    participantKind: Type.Literal("device"),
    principal: DevicePrincipalSchema,
    contractId: Type.String(),
    contractDisplayName: Type.Optional(Type.String()),
  }),
  Type.Object({
    ...SessionRowBaseSchema,
    participantKind: Type.Literal("service"),
    principal: ServicePrincipalSchema,
  }),
]);
export type AuthSessionRow = Static<typeof AuthSessionRowSchema>;

export const AuthSessionsListResponseSchema = Type.Object({
  sessions: Type.Array(AuthSessionRowSchema),
});
export type AuthSessionsListResponse = Static<
  typeof AuthSessionsListResponseSchema
>;
