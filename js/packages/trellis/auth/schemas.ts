import type { StaticDecode } from "typebox";
import { Type } from "typebox";

const SessionKeySchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{43}$",
});

const SignatureSchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{86}$",
});

export const ContractDigestSchema = Type.String({
  pattern: "^[A-Za-z0-9_-]+$",
});

export const LoginQuerySchema = Type.Object({
  provider: Type.Optional(Type.String({ minLength: 1 })),
  redirectTo: Type.String(),
  sessionKey: SessionKeySchema,
  sig: SignatureSchema,
  contract: Type.String({ minLength: 1 }),
  context: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

export type LoginQuery = StaticDecode<typeof LoginQuerySchema>;

const OpenObjectSchema = Type.Object({}, { additionalProperties: true });

export const SentinelCredsSchema = Type.Object({
  jwt: Type.String(),
  seed: Type.String(),
});

export type SentinelCreds = StaticDecode<typeof SentinelCredsSchema>;

export const ClientTransportEndpointsSchema = Type.Object({
  natsServers: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

export type ClientTransportEndpoints = StaticDecode<
  typeof ClientTransportEndpointsSchema
>;

export const ClientTransportsSchema = Type.Object({
  native: Type.Optional(ClientTransportEndpointsSchema),
  websocket: Type.Optional(ClientTransportEndpointsSchema),
});

export type ClientTransports = StaticDecode<typeof ClientTransportsSchema>;

export const ApprovalDecisionSchema = Type.Union([
  Type.Literal("approved"),
  Type.Literal("denied"),
]);

export type ApprovalDecision = StaticDecode<typeof ApprovalDecisionSchema>;

export const UserParticipantKindSchema = Type.Union([
  Type.Literal("app"),
  Type.Literal("agent"),
]);

export type UserParticipantKind = StaticDecode<
  typeof UserParticipantKindSchema
>;

export const ContractApprovalSchema = Type.Object({
  contractDigest: ContractDigestSchema,
  contractId: Type.String(),
  displayName: Type.String(),
  description: Type.String(),
  participantKind: UserParticipantKindSchema,
  capabilities: Type.Array(Type.String()),
});

export type ContractApproval = StaticDecode<typeof ContractApprovalSchema>;

export const BindRequestSchema = Type.Object({
  authToken: Type.String(),
  sessionKey: SessionKeySchema,
  sig: SignatureSchema,
}, { additionalProperties: false });

export type BindRequest = StaticDecode<typeof BindRequestSchema>;

export const BindSuccessResponseSchema = Type.Object({
  status: Type.Literal("bound"),
  inboxPrefix: Type.String(),
  expires: Type.String({ format: "date-time" }),
  sentinel: SentinelCredsSchema,
  transports: ClientTransportsSchema,
});

export const BindInsufficientCapabilitiesResponseSchema = Type.Object({
  status: Type.Literal("insufficient_capabilities"),
  approval: ContractApprovalSchema,
  missingCapabilities: Type.Array(Type.String()),
  userCapabilities: Type.Array(Type.String()),
});

export const BindResponseSchema = Type.Union([
  BindSuccessResponseSchema,
  BindInsufficientCapabilitiesResponseSchema,
]);

export type BindResponse = StaticDecode<typeof BindResponseSchema>;
export type BindSuccessResponse = StaticDecode<
  typeof BindSuccessResponseSchema
>;
export type BindInsufficientCapabilitiesResponse = StaticDecode<
  typeof BindInsufficientCapabilitiesResponseSchema
>;

export const AuthStartRequestSchema = Type.Object({
  provider: Type.Optional(Type.String({ minLength: 1 })),
  redirectTo: Type.String(),
  sessionKey: SessionKeySchema,
  sig: SignatureSchema,
  contract: OpenObjectSchema,
  context: Type.Optional(OpenObjectSchema),
}, { additionalProperties: false });

export const AuthStartFlowResponseSchema = Type.Object({
  status: Type.Literal("flow_started"),
  flowId: Type.String({ minLength: 1 }),
  loginUrl: Type.String({ minLength: 1 }),
});

export const AuthStartResponseSchema = Type.Union([
  BindSuccessResponseSchema,
  AuthStartFlowResponseSchema,
]);

export type AuthStartRequest = StaticDecode<typeof AuthStartRequestSchema>;
export type AuthStartFlowResponse = StaticDecode<
  typeof AuthStartFlowResponseSchema
>;
export type AuthStartResponse = StaticDecode<typeof AuthStartResponseSchema>;

export const NatsAuthTokenV1Schema = Type.Object({
  v: Type.Literal(1),
  sessionKey: SessionKeySchema,
  sig: SignatureSchema,
  iat: Type.Integer(),
  contractDigest: Type.Optional(ContractDigestSchema),
}, { additionalProperties: false });

export type NatsAuthTokenV1 = StaticDecode<typeof NatsAuthTokenV1Schema>;
