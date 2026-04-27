import {
  ApprovalDecisionSchema,
  AuthValidateRequestSchema as AuthValidateRequestRequestSchema,
  type BindRequest,
  BindRequestSchema,
  type BindResponse,
  BindResponseSchema,
  BindSuccessResponseSchema,
  ContractApprovalSchema,
  type LoginQuery,
  LoginQuerySchema,
  type SentinelCreds,
  SentinelCredsSchema,
} from "@qlever-llc/trellis/auth";
import { Type } from "typebox";
import {
  DeviceActivationActorSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewSchema,
  DevicePortalDefaultSchema,
  DevicePortalSelectionSchema,
  DeviceProfileSchema,
  DeviceSchema,
  InstanceGrantPolicySchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  PortalProfileSchema,
  PortalSchema,
  ServiceInstanceSchema,
  ServiceProfileSchema,
} from "../../../../packages/trellis/auth/protocol.ts";
import { IsoDateSchema } from "@qlever-llc/trellis/contracts";
import type { StaticDecode } from "typebox";

export const UserParticipantKindSchema = Type.Union([
  Type.Literal("app"),
  Type.Literal("agent"),
]);

export type { BindRequest, BindResponse, LoginQuery, SentinelCreds };
export {
  ApprovalDecisionSchema,
  BindRequestSchema,
  BindResponseSchema,
  BindSuccessResponseSchema,
  ContractApprovalSchema,
  DeviceActivationActorSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewSchema,
  DevicePortalDefaultSchema,
  DevicePortalSelectionSchema,
  DeviceProfileSchema,
  DeviceSchema,
  InstanceGrantPolicySchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  LoginQuerySchema,
  PortalProfileSchema,
  PortalSchema,
  SentinelCredsSchema,
  ServiceInstanceSchema,
  ServiceProfileSchema,
};

export const SessionKeySchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{43}$",
});

export const SignatureSchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{86}$",
});

export type SessionKey = StaticDecode<typeof SessionKeySchema>;

export const AppIdentitySchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  origin: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
export type AppIdentity = StaticDecode<typeof AppIdentitySchema>;

export const OAuthStateSchema = Type.Object({
  provider: Type.String(),
  redirectTo: Type.String(),
  codeVerifier: Type.String(),
  sessionKey: SessionKeySchema,
  app: Type.Optional(AppIdentitySchema),
  contract: Type.Object({}, { additionalProperties: true }),
  context: Type.Optional(Type.Object({}, { additionalProperties: true })),
  flowId: Type.Optional(Type.String({ minLength: 1 })),
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
  app: Type.Optional(AppIdentitySchema),
  contract: Type.Object({}, { additionalProperties: true }),
  createdAt: IsoDateSchema,
}, { additionalProperties: false });
export type PendingAuth = StaticDecode<typeof PendingAuthSchema>;

export const AuthBrowserFlowKindSchema = Type.Union([
  Type.Literal("login"),
  Type.Literal("device_activation"),
]);
export type AuthBrowserFlowKind = StaticDecode<
  typeof AuthBrowserFlowKindSchema
>;

export const DeviceActivationFlowStateSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  qrMac: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type DeviceActivationFlowState = StaticDecode<
  typeof DeviceActivationFlowStateSchema
>;

export const AuthBrowserFlowSchema = Type.Object({
  flowId: Type.String({ minLength: 1 }),
  kind: AuthBrowserFlowKindSchema,
  sessionKey: Type.Optional(SessionKeySchema),
  redirectTo: Type.Optional(Type.String({ minLength: 1 })),
  app: Type.Optional(AppIdentitySchema),
  context: Type.Optional(Type.Object({}, { additionalProperties: true })),
  contract: Type.Optional(Type.Object({}, { additionalProperties: true })),
  provider: Type.Optional(Type.String({ minLength: 1 })),
  authToken: Type.Optional(Type.String({ minLength: 1 })),
  deviceActivation: Type.Optional(DeviceActivationFlowStateSchema),
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
}, { additionalProperties: false });
export type AuthBrowserFlow = StaticDecode<typeof AuthBrowserFlowSchema>;

export const DeviceProvisioningSecretSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  activationKey: Type.String({ minLength: 1 }),
  createdAt: IsoDateSchema,
}, { additionalProperties: false });
export type DeviceProvisioningSecret = StaticDecode<
  typeof DeviceProvisioningSecretSchema
>;

export const DeviceActivationReviewRecordSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  flowId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  requestedBy: Type.Object({
    origin: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("approved"),
    Type.Literal("rejected"),
  ]),
  requestedAt: IsoDateSchema,
  decidedAt: Type.Union([IsoDateSchema, Type.Null()]),
  reason: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
export type DeviceActivationReviewRecord = StaticDecode<
  typeof DeviceActivationReviewRecordSchema
>;

export type ApprovalDecision = StaticDecode<typeof ApprovalDecisionSchema>;
export type ContractApproval = StaticDecode<typeof ContractApprovalSchema>;
export type UserParticipantKind = StaticDecode<
  typeof UserParticipantKindSchema
>;
export type InstanceGrantPolicy = StaticDecode<
  typeof InstanceGrantPolicySchema
>;
export type PortalProfile = StaticDecode<typeof PortalProfileSchema>;

export const SessionApprovalSourceSchema = Type.Union([
  Type.Literal("stored_approval"),
  Type.Literal("admin_policy"),
  Type.Literal("portal_profile"),
]);
export type SessionApprovalSource = StaticDecode<
  typeof SessionApprovalSourceSchema
>;

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
export type ContractApprovalRecord = StaticDecode<
  typeof ContractApprovalRecordSchema
>;

export type BindSuccessResponse = StaticDecode<
  typeof BindSuccessResponseSchema
>;

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
  participantKind: UserParticipantKindSchema,
  contractDigest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
  contractId: Type.String({ minLength: 1 }),
  contractDisplayName: Type.String({ minLength: 1 }),
  contractDescription: Type.String({ minLength: 1 }),
  app: Type.Optional(AppIdentitySchema),
  approvalSource: Type.Optional(SessionApprovalSourceSchema),
  delegatedCapabilities: Type.Array(Type.String()),
  delegatedPublishSubjects: Type.Array(Type.String()),
  delegatedSubscribeSubjects: Type.Array(Type.String()),
}, { additionalProperties: false });
export type UserSession = StaticDecode<typeof UserSessionSchema>;

export const ServiceSessionSchema = Type.Object({
  type: Type.Literal("service"),
  ...SessionBaseFields,
  instanceId: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  instanceKey: Type.String({ minLength: 1 }),
  currentContractId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  currentContractDigest: Type.Union([
    Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
    Type.Null(),
  ]),
}, { additionalProperties: false });
export type ServiceSession = StaticDecode<typeof ServiceSessionSchema>;

export const DeviceSessionSchema = Type.Object({
  type: Type.Literal("device"),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
  delegatedCapabilities: Type.Array(Type.String()),
  delegatedPublishSubjects: Type.Array(Type.String()),
  delegatedSubscribeSubjects: Type.Array(Type.String()),
  createdAt: IsoDateSchema,
  lastAuth: IsoDateSchema,
  activatedAt: Type.Union([IsoDateSchema, Type.Null()]),
  revokedAt: Type.Union([IsoDateSchema, Type.Null()]),
}, { additionalProperties: false });
export type DeviceSession = StaticDecode<typeof DeviceSessionSchema>;

export const SessionSchema = Type.Union([
  UserSessionSchema,
  ServiceSessionSchema,
  DeviceSessionSchema,
]);
export type Session = StaticDecode<typeof SessionSchema>;

export const ConnectionSchema = Type.Object({
  serverId: Type.String(),
  clientId: Type.Number(),
  connectedAt: IsoDateSchema,
}, { additionalProperties: false });
export type Connection = StaticDecode<typeof ConnectionSchema>;

export const AuthLogoutRequestSchema = Type.Object({}, {
  additionalProperties: false,
});
export type AuthLogoutRequest = StaticDecode<typeof AuthLogoutRequestSchema>;

export const AuthLogoutResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });
export type AuthLogoutResponse = StaticDecode<typeof AuthLogoutResponseSchema>;

export { AuthValidateRequestRequestSchema };
