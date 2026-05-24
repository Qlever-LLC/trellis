import {
  ApprovalDecisionSchema,
  AuthRequestsValidateSchema as AuthRequestsValidateRequestSchema,
  type BindResponse,
  BindResponseSchema,
  BindSuccessResponseSchema,
  type ContractApproval as AuthContractApproval,
  ContractApprovalSchema,
  type SentinelCreds,
  SentinelCredsSchema,
} from "@qlever-llc/trellis/auth";
import { Type } from "typebox";
import {
  DeviceActivationActorSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewSchema,
  DeviceDeploymentSchema,
  FlowRegistrationAvailabilitySchema,
  LoginPortalRecordSchema,
  LoginPortalRouteSchema,
  LoginPortalSettingsSchema,
  LoginPortalSummarySchema,
  ServiceDeploymentSchema,
  ServiceInstanceSchema,
} from "../../../packages/trellis/auth/protocol.ts";
import { IsoDateSchema } from "@qlever-llc/trellis/contracts";
import type { StaticDecode } from "typebox";

export const UserParticipantKindSchema = Type.Union([
  Type.Literal("app"),
  Type.Literal("agent"),
]);

const DurableIsoDateStringSchema = Type.String({ format: "date-time" });

export type { BindResponse, SentinelCreds };
export const DeviceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  metadata: Type.Optional(
    Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 })),
  ),
  state: Type.Union([
    Type.Literal("registered"),
    Type.Literal("activated"),
    Type.Literal("revoked"),
    Type.Literal("disabled"),
  ]),
  createdAt: DurableIsoDateStringSchema,
  activatedAt: Type.Union([DurableIsoDateStringSchema, Type.Null()]),
  revokedAt: Type.Union([DurableIsoDateStringSchema, Type.Null()]),
});
export {
  ApprovalDecisionSchema,
  BindResponseSchema,
  BindSuccessResponseSchema,
  ContractApprovalSchema,
  DeviceActivationActorSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewSchema,
  DeviceDeploymentSchema,
  FlowRegistrationAvailabilitySchema,
  LoginPortalRecordSchema,
  LoginPortalRouteSchema,
  LoginPortalSettingsSchema,
  LoginPortalSummarySchema,
  SentinelCredsSchema,
  ServiceDeploymentSchema,
  ServiceInstanceSchema,
};
export type {
  FlowRegistrationAvailability,
  LoginPortalRecord,
  LoginPortalRoute,
  LoginPortalSettings,
  LoginPortalSummary,
} from "../../../packages/trellis/auth/protocol.ts";

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
});
export type AppIdentity = StaticDecode<typeof AppIdentitySchema>;

export const BrowserLoginOAuthStateSchema = Type.Object({
  kind: Type.Literal("browser_login"),
  provider: Type.String(),
  redirectTo: Type.String(),
  codeVerifier: Type.String(),
  sessionKey: SessionKeySchema,
  app: Type.Optional(AppIdentitySchema),
  contract: Type.Object({}, { additionalProperties: true }),
  context: Type.Optional(Type.Object({}, { additionalProperties: true })),
  flowId: Type.String({ minLength: 1 }),
  createdAt: IsoDateSchema,
});

export const AccountFlowOAuthStateSchema = Type.Object({
  kind: Type.Literal("account_flow"),
  provider: Type.String({ minLength: 1 }),
  flowId: Type.String({ minLength: 1 }),
  returnTo: Type.Optional(Type.String({ minLength: 1 })),
  codeVerifier: Type.String({ minLength: 1 }),
  createdAt: IsoDateSchema,
});

export const OAuthStateSchema = Type.Union([
  BrowserLoginOAuthStateSchema,
  AccountFlowOAuthStateSchema,
]);
export type OAuthState = StaticDecode<typeof OAuthStateSchema>;

export const OAuth2TokensSchema = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.Optional(Type.String()),
  expires: Type.Optional(IsoDateSchema),
});
export type OAuth2Tokens = StaticDecode<typeof OAuth2TokensSchema>;

export const OAuthUserSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  email: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  image: Type.Optional(Type.String()),
});
export type OAuthUser = StaticDecode<typeof OAuthUserSchema>;

export const UserAccountSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  name: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  email: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String({ minLength: 1 })),
  capabilityGroups: Type.Array(Type.String({ minLength: 1 })),
  createdAt: DurableIsoDateStringSchema,
  updatedAt: DurableIsoDateStringSchema,
});
export type UserAccount = StaticDecode<typeof UserAccountSchema>;

export const CapabilityGroupSchema = Type.Object({
  groupKey: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  capabilities: Type.Array(Type.String({ minLength: 1 })),
  includedGroups: Type.Array(Type.String({ minLength: 1 })),
  createdAt: DurableIsoDateStringSchema,
  updatedAt: DurableIsoDateStringSchema,
});
export type CapabilityGroup = StaticDecode<typeof CapabilityGroupSchema>;

export const UserIdentitySchema = Type.Object({
  identityId: Type.String({ minLength: 1 }),
  userId: Type.String({ minLength: 1 }),
  provider: Type.String({ minLength: 1 }),
  subject: Type.String({ minLength: 1 }),
  displayName: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  email: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  emailVerified: Type.Boolean(),
  linkedAt: DurableIsoDateStringSchema,
  lastLoginAt: Type.Union([DurableIsoDateStringSchema, Type.Null()]),
});
export type UserIdentity = StaticDecode<typeof UserIdentitySchema>;

export const LocalCredentialSchema = Type.Object({
  identityId: Type.String({ minLength: 1 }),
  passwordHash: Type.String({ minLength: 1 }),
  passwordAlgorithm: Type.String({ minLength: 1 }),
  passwordParams: Type.Record(Type.String(), Type.Unknown()),
  passwordSetAt: DurableIsoDateStringSchema,
  mustChangePassword: Type.Boolean(),
  failedLoginCount: Type.Integer({ minimum: 0 }),
  lockedUntil: Type.Union([DurableIsoDateStringSchema, Type.Null()]),
  updatedAt: DurableIsoDateStringSchema,
});
export type LocalCredential = StaticDecode<typeof LocalCredentialSchema>;

export const AccountFlowKindSchema = Type.Union([
  Type.Literal("admin_bootstrap"),
  Type.Literal("identity_link"),
  Type.Literal("local_password_reset"),
]);
export type AccountFlowKind = StaticDecode<typeof AccountFlowKindSchema>;

export const AccountFlowSchema = Type.Object({
  flowIdHash: Type.String({ minLength: 1 }),
  kind: AccountFlowKindSchema,
  targetUserId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  targetIdentityId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  targetLocalUsername: Type.Union([
    Type.String({ minLength: 1 }),
    Type.Null(),
  ]),
  createdByUserId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  allowedProviders: Type.Union([
    Type.Array(Type.String({ minLength: 1 })),
    Type.Null(),
  ]),
  capabilities: Type.Union([
    Type.Array(Type.String({ minLength: 1 })),
    Type.Null(),
  ]),
  profileHint: Type.Union([
    Type.Record(Type.String(), Type.Unknown()),
    Type.Null(),
  ]),
  returnTo: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
  createdAt: DurableIsoDateStringSchema,
  expiresAt: DurableIsoDateStringSchema,
  consumedAt: Type.Union([DurableIsoDateStringSchema, Type.Null()]),
});
export type AccountFlow = StaticDecode<typeof AccountFlowSchema>;

export const SessionIdentitySchema = Type.Object({
  identityId: Type.String({ minLength: 1 }),
  provider: Type.String({ minLength: 1 }),
  subject: Type.String({ minLength: 1 }),
});
export type SessionIdentity = StaticDecode<typeof SessionIdentitySchema>;

export const PendingAuthSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  identity: SessionIdentitySchema,
  user: OAuthUserSchema,
  sessionKey: SessionKeySchema,
  redirectTo: Type.String(),
  app: Type.Optional(AppIdentitySchema),
  contract: Type.Object({}, { additionalProperties: true }),
  createdAt: IsoDateSchema,
});
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
  deploymentId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  qrMac: Type.String({ minLength: 1 }),
});
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
  portalId: Type.Optional(Type.String({ minLength: 1 })),
  deviceActivation: Type.Optional(DeviceActivationFlowStateSchema),
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
});
export type AuthBrowserFlow = StaticDecode<typeof AuthBrowserFlowSchema>;

export const DeviceProvisioningSecretSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  activationKey: Type.String({ minLength: 1 }),
  createdAt: IsoDateSchema,
});
export type DeviceProvisioningSecret = StaticDecode<
  typeof DeviceProvisioningSecretSchema
>;

export const DeviceActivationReviewRecordSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  operationId: Type.String({ minLength: 1 }),
  flowId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  requestedBy: DeviceActivationActorSchema,
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("approved"),
    Type.Literal("rejected"),
  ]),
  requestedAt: IsoDateSchema,
  decidedAt: Type.Union([IsoDateSchema, Type.Null()]),
  reason: Type.Optional(Type.String({ minLength: 1 })),
});
export type DeviceActivationReviewRecord = StaticDecode<
  typeof DeviceActivationReviewRecordSchema
>;

export type ApprovalDecision = StaticDecode<typeof ApprovalDecisionSchema>;
export type ContractApproval = AuthContractApproval;
export type UserParticipantKind = StaticDecode<
  typeof UserParticipantKindSchema
>;
export const DeploymentEnvelopeKindSchema = Type.Union([
  Type.Literal("service"),
  Type.Literal("device"),
  Type.Literal("app"),
  Type.Literal("cli"),
  Type.Literal("native"),
  Type.Literal("device-user"),
]);
export type DeploymentEnvelopeKind = StaticDecode<
  typeof DeploymentEnvelopeKindSchema
>;

export const EnvelopeSurfaceKindSchema = Type.Union([
  Type.Literal("rpc"),
  Type.Literal("operation"),
  Type.Literal("event"),
  Type.Literal("feed"),
]);
export type EnvelopeSurfaceKind = StaticDecode<
  typeof EnvelopeSurfaceKindSchema
>;

export const EnvelopeSurfaceActionSchema = Type.Union([
  Type.Literal("call"),
  Type.Literal("publish"),
  Type.Literal("subscribe"),
  Type.Literal("observe"),
  Type.Literal("cancel"),
]);
export type EnvelopeSurfaceAction = StaticDecode<
  typeof EnvelopeSurfaceActionSchema
>;

export const EnvelopeResourceKindSchema = Type.Union([
  Type.Literal("kv"),
  Type.Literal("store"),
  Type.Literal("jobs"),
  Type.Literal("transfer"),
]);
export type EnvelopeResourceKind = StaticDecode<
  typeof EnvelopeResourceKindSchema
>;

export const EnvelopeBoundaryContractSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
});
export type EnvelopeBoundaryContract = StaticDecode<
  typeof EnvelopeBoundaryContractSchema
>;

export const EnvelopeBoundarySurfaceSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  kind: EnvelopeSurfaceKindSchema,
  name: Type.String({ minLength: 1 }),
  action: EnvelopeSurfaceActionSchema,
  required: Type.Boolean(),
});
export type EnvelopeBoundarySurface = StaticDecode<
  typeof EnvelopeBoundarySurfaceSchema
>;

export const EnvelopeBoundaryResourceSchema = Type.Object({
  kind: EnvelopeResourceKindSchema,
  alias: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
});
export type EnvelopeBoundaryResource = StaticDecode<
  typeof EnvelopeBoundaryResourceSchema
>;

export const EnvelopeBoundarySchema = Type.Object({
  contracts: Type.Array(EnvelopeBoundaryContractSchema),
  surfaces: Type.Array(EnvelopeBoundarySurfaceSchema),
  capabilities: Type.Array(Type.String({ minLength: 1 })),
  resources: Type.Array(EnvelopeBoundaryResourceSchema),
});
export type EnvelopeBoundary = StaticDecode<typeof EnvelopeBoundarySchema>;
export const EnvelopeDeltaSchema = EnvelopeBoundarySchema;
export type EnvelopeDelta = EnvelopeBoundary;

export const DeploymentEnvelopeSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  kind: DeploymentEnvelopeKindSchema,
  disabled: Type.Boolean(),
  createdAt: DurableIsoDateStringSchema,
  updatedAt: DurableIsoDateStringSchema,
  boundary: EnvelopeBoundarySchema,
});
export type DeploymentEnvelope = StaticDecode<typeof DeploymentEnvelopeSchema>;

export const DeploymentPortalRouteSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  portalId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  entryUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  disabled: Type.Boolean(),
  updatedAt: DurableIsoDateStringSchema,
});
export type DeploymentPortalRoute = StaticDecode<
  typeof DeploymentPortalRouteSchema
>;

export const DeploymentGrantOverrideIdentityKindSchema = Type.Union([
  Type.Literal("web"),
  Type.Literal("session"),
]);
export type DeploymentGrantOverrideIdentityKind = StaticDecode<
  typeof DeploymentGrantOverrideIdentityKindSchema
>;

export const DeploymentGrantOverrideSchema = Type.Union([
  Type.Object({
    deploymentId: Type.String({ minLength: 1 }),
    identityKind: Type.Literal("web"),
    grantKind: Type.Literal("capability"),
    contractId: Type.String({ minLength: 1 }),
    origin: Type.String({ minLength: 1 }),
    sessionPublicKey: Type.Null(),
    capability: Type.String({ minLength: 1 }),
    capabilityGroupKey: Type.Null(),
  }),
  Type.Object({
    deploymentId: Type.String({ minLength: 1 }),
    identityKind: Type.Literal("web"),
    grantKind: Type.Literal("capability-group"),
    contractId: Type.String({ minLength: 1 }),
    origin: Type.String({ minLength: 1 }),
    sessionPublicKey: Type.Null(),
    capability: Type.Null(),
    capabilityGroupKey: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    deploymentId: Type.String({ minLength: 1 }),
    identityKind: Type.Literal("session"),
    grantKind: Type.Literal("capability"),
    contractId: Type.String({ minLength: 1 }),
    origin: Type.Null(),
    sessionPublicKey: Type.String({ minLength: 1 }),
    capability: Type.String({ minLength: 1 }),
    capabilityGroupKey: Type.Null(),
  }),
  Type.Object({
    deploymentId: Type.String({ minLength: 1 }),
    identityKind: Type.Literal("session"),
    grantKind: Type.Literal("capability-group"),
    contractId: Type.String({ minLength: 1 }),
    origin: Type.Null(),
    sessionPublicKey: Type.String({ minLength: 1 }),
    capability: Type.Null(),
    capabilityGroupKey: Type.String({ minLength: 1 }),
  }),
]);
export type DeploymentGrantOverride = StaticDecode<
  typeof DeploymentGrantOverrideSchema
>;

export const DeploymentResourceBindingSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  kind: EnvelopeResourceKindSchema,
  alias: Type.String({ minLength: 1 }),
  binding: Type.Record(Type.String(), Type.Unknown()),
  limits: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  createdAt: DurableIsoDateStringSchema,
  updatedAt: DurableIsoDateStringSchema,
});
export type DeploymentResourceBinding = StaticDecode<
  typeof DeploymentResourceBindingSchema
>;

export const DeploymentContractEvidenceSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: Type.String({ minLength: 1 }),
  contract: Type.Record(Type.String(), Type.Unknown()),
  firstSeenAt: DurableIsoDateStringSchema,
  lastSeenAt: DurableIsoDateStringSchema,
  ignoredAt: Type.Optional(
    Type.Union([DurableIsoDateStringSchema, Type.Null()]),
  ),
  ignoredBy: Type.Optional(
    Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  ),
  ignoreReason: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
});
export type DeploymentContractEvidence = StaticDecode<
  typeof DeploymentContractEvidenceSchema
>;

export const EnvelopeExpansionRequestStateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
]);
export type EnvelopeExpansionRequestState = StaticDecode<
  typeof EnvelopeExpansionRequestStateSchema
>;

export const EnvelopeExpansionRequestActorKindSchema = Type.Union([
  Type.Literal("service"),
  Type.Literal("device"),
  Type.Literal("user"),
  Type.Literal("admin"),
  Type.Literal("automation"),
]);
export type EnvelopeExpansionRequestActorKind = StaticDecode<
  typeof EnvelopeExpansionRequestActorKindSchema
>;

export const EnvelopeExpansionRequestSchema = Type.Object({
  requestId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  requestedByKind: EnvelopeExpansionRequestActorKindSchema,
  requestedBy: Type.Record(Type.String(), Type.Unknown()),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: Type.String({ minLength: 1 }),
  contract: Type.Record(Type.String(), Type.Unknown()),
  state: EnvelopeExpansionRequestStateSchema,
  createdAt: DurableIsoDateStringSchema,
  decidedAt: Type.Union([DurableIsoDateStringSchema, Type.Null()]),
  decidedBy: Type.Union([
    Type.Record(Type.String(), Type.Unknown()),
    Type.Null(),
  ]),
  decisionReason: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  delta: EnvelopeDeltaSchema,
});
export type EnvelopeExpansionRequest = StaticDecode<
  typeof EnvelopeExpansionRequestSchema
>;

export const EnvelopeExpansionRequestStateUpdateSchema = Type.Object({
  requestId: Type.String({ minLength: 1 }),
  state: EnvelopeExpansionRequestStateSchema,
  decidedAt: Type.Union([DurableIsoDateStringSchema, Type.Null()]),
  decidedBy: Type.Union([
    Type.Record(Type.String(), Type.Unknown()),
    Type.Null(),
  ]),
  decisionReason: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});
export type EnvelopeExpansionRequestStateUpdate = StaticDecode<
  typeof EnvelopeExpansionRequestStateUpdateSchema
>;

export const SessionApprovalSourceSchema = Type.Union([
  Type.Literal("stored_approval"),
  Type.Literal("deployment_grant"),
]);
export type SessionApprovalSource = StaticDecode<
  typeof SessionApprovalSourceSchema
>;

export const IdentityAnchorSchema = Type.Union([
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
export type IdentityAnchor = StaticDecode<typeof IdentityAnchorSchema>;

export const IdentityEnvelopeRecordSchema = Type.Object({
  identityEnvelopeId: Type.String({ minLength: 1 }),
  userTrellisId: Type.String({ minLength: 1 }),
  origin: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
  identityAnchor: IdentityAnchorSchema,
  answer: ApprovalDecisionSchema,
  answeredAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  approvalEvidence: ContractApprovalSchema,
  publishSubjects: Type.Array(Type.String()),
  subscribeSubjects: Type.Array(Type.String()),
});
export type IdentityEnvelopeRecord = {
  identityEnvelopeId: string;
  userTrellisId: string;
  origin: string;
  id: string;
  identityAnchor: IdentityAnchor;
  answer: ApprovalDecision;
  answeredAt: Date;
  updatedAt: Date;
  approvalEvidence: ContractApproval;
  publishSubjects: string[];
  subscribeSubjects: string[];
};

export type BindSuccessResponse = StaticDecode<
  typeof BindSuccessResponseSchema
>;

export const UserProjectionSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
  capabilityGroups: Type.Array(Type.String()),
});
export type UserProjectionEntry = StaticDecode<typeof UserProjectionSchema>;

export const UserSessionSchema = Type.Object({
  type: Type.Literal("user"),
  userId: Type.String({ minLength: 1 }),
  identity: SessionIdentitySchema,
  email: Type.String(),
  name: Type.String(),
  image: Type.Optional(Type.String()),
  createdAt: IsoDateSchema,
  lastAuth: IsoDateSchema,
  participantKind: UserParticipantKindSchema,
  identityEnvelopeId: Type.Optional(Type.String({ minLength: 1 })),
  contractDigest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
  contractId: Type.String({ minLength: 1 }),
  contractDisplayName: Type.String({ minLength: 1 }),
  contractDescription: Type.String({ minLength: 1 }),
  app: Type.Optional(AppIdentitySchema),
  approvalSource: Type.Optional(SessionApprovalSourceSchema),
  identityEnvelope: Type.Optional(EnvelopeBoundarySchema),
  delegatedCapabilities: Type.Array(Type.String()),
  delegatedPublishSubjects: Type.Array(Type.String()),
  delegatedSubscribeSubjects: Type.Array(Type.String()),
});
export type UserSession = StaticDecode<typeof UserSessionSchema>;

export const ServiceSessionSchema = Type.Object({
  type: Type.Literal("service"),
  trellisId: Type.String(),
  origin: Type.String(),
  id: Type.String(),
  email: Type.String(),
  name: Type.String(),
  image: Type.Optional(Type.String()),
  createdAt: IsoDateSchema,
  lastAuth: IsoDateSchema,
  instanceId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  instanceKey: Type.String({ minLength: 1 }),
  currentContractId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  currentContractDigest: Type.Union([
    Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
    Type.Null(),
  ]),
});
export type ServiceSession = StaticDecode<typeof ServiceSessionSchema>;

export const DeviceSessionSchema = Type.Object({
  type: Type.Literal("device"),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
  delegatedCapabilities: Type.Array(Type.String()),
  delegatedPublishSubjects: Type.Array(Type.String()),
  delegatedSubscribeSubjects: Type.Array(Type.String()),
  createdAt: IsoDateSchema,
  lastAuth: IsoDateSchema,
  activatedAt: Type.Union([IsoDateSchema, Type.Null()]),
  revokedAt: Type.Union([IsoDateSchema, Type.Null()]),
});
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
});
export type Connection = StaticDecode<typeof ConnectionSchema>;

export const AuthSessionsLogoutRequestSchema = Type.Object({});
export type AuthSessionsLogoutRequest = StaticDecode<
  typeof AuthSessionsLogoutRequestSchema
>;

export const AuthSessionsLogoutResponseSchema = Type.Object({
  success: Type.Boolean(),
});
export type AuthSessionsLogoutResponse = StaticDecode<
  typeof AuthSessionsLogoutResponseSchema
>;

export { AuthRequestsValidateRequestSchema };
