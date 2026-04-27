import Type, { type Static } from "typebox";

const UserPrincipalSchema = Type.Object({
  type: Type.Literal("user"),
  trellisId: Type.String(),
  origin: Type.String(),
  id: Type.String(),
  name: Type.Optional(Type.String()),
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

export const AuthListSessionsSchema = Type.Object({
  user: Type.Optional(Type.String()),
});
export type AuthListSessionsInput = Static<typeof AuthListSessionsSchema>;

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

export const AuthListSessionsResponseSchema = Type.Object({
  sessions: Type.Array(AuthSessionRowSchema),
});
export type AuthListSessionsResponse = Static<
  typeof AuthListSessionsResponseSchema
>;
