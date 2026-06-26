import type { StaticDecode } from "typebox";
import { Type } from "typebox";
import { canonicalizeJsonValue } from "./utils.ts";

const SessionKeySchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{43}$",
});

const SignatureSchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{86}$",
});

export const AuthLogoutResponseModeSchema = Type.Union([
  Type.Literal("json"),
  Type.Literal("redirect"),
]);

export type AuthLogoutResponseMode = StaticDecode<
  typeof AuthLogoutResponseModeSchema
>;

export type LogoutSignaturePayloadInput = {
  iat: number;
  providerLogout?: boolean;
  federatedProviderLogout?: boolean;
  returnTo?: string;
  responseMode?: AuthLogoutResponseMode;
};

/** Builds the canonical value signed for POST-based HTTP logout requests. */
export function buildLogoutSignaturePayload(
  input: LogoutSignaturePayloadInput,
): string {
  const payload: Record<string, boolean | number | string> = { iat: input.iat };
  if (input.providerLogout !== undefined) {
    payload.providerLogout = input.providerLogout;
  }
  if (input.federatedProviderLogout !== undefined) {
    payload.federatedProviderLogout = input.federatedProviderLogout;
  }
  if (input.returnTo !== undefined) {
    payload.returnTo = input.returnTo;
  }
  if (input.responseMode !== undefined) {
    payload.responseMode = input.responseMode;
  }
  return canonicalizeJsonValue(payload);
}

export const ContractDigestSchema = Type.String({
  pattern: "^[A-Za-z0-9_-]+$",
});

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

export const ContractApprovalCapabilitySchema = Type.Object({
  displayName: Type.String(),
  description: Type.String(),
  consequence: Type.Optional(Type.String()),
});

export type ContractApprovalCapability = StaticDecode<
  typeof ContractApprovalCapabilitySchema
>;

export const ContractApprovalSchema = Type.Object({
  contractDigest: ContractDigestSchema,
  contractId: Type.String(),
  displayName: Type.String(),
  description: Type.String(),
  participantKind: UserParticipantKindSchema,
  capabilities: Type.Record(Type.String(), ContractApprovalCapabilitySchema),
});

export type ContractApproval = StaticDecode<typeof ContractApprovalSchema>;

/** Returns the raw global capability keys required by an approval. */
export function approvalCapabilityKeys(approval: ContractApproval): string[] {
  return Object.keys(approval.capabilities);
}

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
  contractDigest: Type.Optional(ContractDigestSchema),
  contract: Type.Optional(OpenObjectSchema),
  context: Type.Optional(OpenObjectSchema),
});

export const AuthLogoutRequestSchema = Type.Object({
  sessionKey: SessionKeySchema,
  iat: Type.Integer(),
  sig: SignatureSchema,
  providerLogout: Type.Optional(Type.Boolean()),
  federatedProviderLogout: Type.Optional(Type.Boolean()),
  returnTo: Type.Optional(Type.String({ minLength: 1 })),
  responseMode: Type.Optional(AuthLogoutResponseModeSchema),
}, { additionalProperties: true });

export const AuthLogoutResponseSchema = Type.Object({
  success: Type.Literal(true),
  redirectTo: Type.Optional(
    Type.String({ format: "uri", pattern: "^https?://", minLength: 1 }),
  ),
}, { additionalProperties: false });

export type AuthLogoutRequest = StaticDecode<typeof AuthLogoutRequestSchema>;
export type AuthLogoutResponse = StaticDecode<typeof AuthLogoutResponseSchema>;

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
  contractDigest: ContractDigestSchema,
});

export type NatsAuthTokenV1 = StaticDecode<typeof NatsAuthTokenV1Schema>;
