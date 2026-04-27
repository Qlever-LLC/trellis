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

const ConnectionRowBaseSchema = {
  key: Type.String(),
  userNkey: Type.String(),
  sessionKey: Type.String(),
  serverId: Type.String(),
  clientId: Type.Number(),
  connectedAt: Type.String(),
};

export const AuthListConnectionsSchema = Type.Object({
  user: Type.Optional(Type.String()),
  sessionKey: Type.Optional(Type.String()),
});
export type AuthListConnectionsInput = Static<typeof AuthListConnectionsSchema>;

export const AuthConnectionRowSchema = Type.Union([
  Type.Object({
    ...ConnectionRowBaseSchema,
    participantKind: Type.Literal("app"),
    principal: UserPrincipalSchema,
    contractId: Type.String(),
    contractDisplayName: Type.String(),
  }),
  Type.Object({
    ...ConnectionRowBaseSchema,
    participantKind: Type.Literal("agent"),
    principal: UserPrincipalSchema,
    contractId: Type.String(),
    contractDisplayName: Type.String(),
  }),
  Type.Object({
    ...ConnectionRowBaseSchema,
    participantKind: Type.Literal("device"),
    principal: DevicePrincipalSchema,
    contractId: Type.String(),
    contractDisplayName: Type.Optional(Type.String()),
  }),
  Type.Object({
    ...ConnectionRowBaseSchema,
    participantKind: Type.Literal("service"),
    principal: ServicePrincipalSchema,
  }),
]);
export type AuthConnectionRow = Static<typeof AuthConnectionRowSchema>;

export const AuthListConnectionsResponseSchema = Type.Object({
  connections: Type.Array(AuthConnectionRowSchema),
});
export type AuthListConnectionsResponse = Static<
  typeof AuthListConnectionsResponseSchema
>;
