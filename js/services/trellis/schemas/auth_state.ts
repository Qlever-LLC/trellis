import {
  ApprovalDecisionSchema,AuthValidateRequestSchema as AuthValidateRequestRequestSchema, 
  type BindRequest,
  BindRequestSchema,
  type BindResponse,
  BindResponseSchema,
  BindSuccessResponseSchema,
  ContractApprovalSchema,
  type LoginQuery,
  LoginQuerySchema,
  type SentinelCreds,
  SentinelCredsSchema
} from "@trellis/auth";
import { IsoDateSchema } from "@trellis/contracts";
import type { StaticDecode } from "typebox";
import { Type } from "typebox";

export {
  ApprovalDecisionSchema,
  BindRequestSchema,
  BindResponseSchema,
  BindSuccessResponseSchema,
  ContractApprovalSchema,
  LoginQuerySchema,
  SentinelCredsSchema,
};
export type { BindRequest, BindResponse, LoginQuery, SentinelCreds };

export const SessionKeySchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{43}$",
});

export const SignatureSchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{86}$",
});

export type SessionKey = StaticDecode<typeof SessionKeySchema>;

export const OAuthStateSchema = Type.Object({
  redirectTo: Type.String(),
  codeVerifier: Type.String(),
  sessionKey: SessionKeySchema,
  contract: Type.Object({}, { additionalProperties: true }),
  createdAt: IsoDateSchema,
}, { additionalProperties: false });
export type OAuthState = StaticDecode<typeof OAuthStateSchema>;

export const OAuth2TokensSchema = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.Optional(Type.String()),
  expires: Type.Optional(IsoDateSchema),
}, { additionalProperties: false });
export type OAuth2Tokens = StaticDecode<typeof OAuth2TokensSchema>;

export const OAuthUserSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  email: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  image: Type.Optional(Type.String()),
}, { additionalProperties: false });
export type OAuthUser = StaticDecode<typeof OAuthUserSchema>;

export const PendingAuthSchema = Type.Object({
  user: OAuthUserSchema,
  sessionKey: SessionKeySchema,
  redirectTo: Type.String(),
  contract: Type.Object({}, { additionalProperties: true }),
  createdAt: IsoDateSchema,
}, { additionalProperties: false });
export type PendingAuth = StaticDecode<typeof PendingAuthSchema>;

export type ApprovalDecision = StaticDecode<typeof ApprovalDecisionSchema>;
export type ContractApproval = StaticDecode<typeof ContractApprovalSchema>;

export const ContractApprovalRecordSchema = Type.Object({
  userTrellisId: Type.String({ minLength: 1 }),
  origin: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
  answer: ApprovalDecisionSchema,
  answeredAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  approval: ContractApprovalSchema,
  publishSubjects: Type.Array(Type.String()),
  subscribeSubjects: Type.Array(Type.String()),
}, { additionalProperties: false });
export type ContractApprovalRecord = StaticDecode<typeof ContractApprovalRecordSchema>;

export const BindingTokenRecordSchema = Type.Object({
  sessionKey: SessionKeySchema,
  kind: Type.Union([Type.Literal("initial"), Type.Literal("renew")]),
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
}, { additionalProperties: false });
export type BindingTokenRecord = StaticDecode<typeof BindingTokenRecordSchema>;

export type BindSuccessResponse = StaticDecode<typeof BindSuccessResponseSchema>;

const SessionBaseFields = {
  trellisId: Type.String(),
  origin: Type.String(),
  id: Type.String(),
  email: Type.String(),
  name: Type.String(),
  image: Type.Optional(Type.String()),
  createdAt: IsoDateSchema,
  lastAuth: IsoDateSchema,
};

export const UserSessionSchema = Type.Object({
  type: Type.Literal("user"),
  ...SessionBaseFields,
  contractDigest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
  contractId: Type.String({ minLength: 1 }),
  contractDisplayName: Type.String({ minLength: 1 }),
  contractDescription: Type.String({ minLength: 1 }),
  contractKind: Type.String({ minLength: 1 }),
  delegatedCapabilities: Type.Array(Type.String()),
  delegatedPublishSubjects: Type.Array(Type.String()),
  delegatedSubscribeSubjects: Type.Array(Type.String()),
}, { additionalProperties: false });
export type UserSession = StaticDecode<typeof UserSessionSchema>;

export const ServiceSessionSchema = Type.Object({
  type: Type.Literal("service"),
  ...SessionBaseFields,
}, { additionalProperties: false });
export type ServiceSession = StaticDecode<typeof ServiceSessionSchema>;

export const SessionSchema = Type.Union([UserSessionSchema, ServiceSessionSchema]);
export type Session = StaticDecode<typeof SessionSchema>;

export const ConnectionSchema = Type.Object({
  serverId: Type.String(),
  clientId: Type.Number(),
  connectedAt: IsoDateSchema,
}, { additionalProperties: false });
export type Connection = StaticDecode<typeof ConnectionSchema>;

export const AuthLogoutRequestSchema = Type.Object({}, { additionalProperties: false });
export type AuthLogoutRequest = StaticDecode<typeof AuthLogoutRequestSchema>;

export const AuthLogoutResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });
export type AuthLogoutResponse = StaticDecode<typeof AuthLogoutResponseSchema>;

export const AuthRenewBindingTokenRequestSchema = Type.Object({}, { additionalProperties: false });
export type AuthRenewBindingTokenRequest = StaticDecode<typeof AuthRenewBindingTokenRequestSchema>;

export const AuthRenewBindingTokenResponseSchema = BindSuccessResponseSchema;
export type AuthRenewBindingTokenResponse = BindSuccessResponse;

export { AuthValidateRequestRequestSchema };
