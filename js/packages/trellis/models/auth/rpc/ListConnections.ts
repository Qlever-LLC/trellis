import Type, { type Static } from "typebox";
import { PageResponseSchema } from "../../../contract_support/protocol.ts";

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

const ConnectionRowBaseSchema = {
  key: Type.String(),
  userNkey: Type.String(),
  sessionKey: Type.String(),
  serverId: Type.String(),
  clientId: Type.Number(),
  connectedAt: Type.String(),
};

export const AuthConnectionsListSchema = Type.Object({
  user: Type.Optional(Type.String()),
  sessionKey: Type.Optional(Type.String()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export type AuthConnectionsListInput = Static<typeof AuthConnectionsListSchema>;

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

export const AuthConnectionsListResponseSchema = Type.Object({
  ...PageResponseSchema(AuthConnectionRowSchema).properties,
});
export type AuthConnectionsListResponse = Static<
  typeof AuthConnectionsListResponseSchema
>;
