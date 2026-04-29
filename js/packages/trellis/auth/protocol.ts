import {
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
} from "@qlever-llc/trellis/contracts";
import type { StaticDecode } from "typebox";
import { Type } from "typebox";
import {
  ClientTransportsSchema,
  SentinelCredsSchema,
  UserParticipantKindSchema,
} from "./schemas.ts";

const IsoDateStringSchema = Type.String({ format: "date-time" });

export const ParticipantKindSchema = Type.Union([
  UserParticipantKindSchema,
  Type.Literal("device"),
  Type.Literal("service"),
]);
export type ParticipantKind = StaticDecode<typeof ParticipantKindSchema>;

export const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });

export const OpenObjectSchema = Type.Unsafe<Record<string, unknown>>({
  type: "object",
});

export const ServiceAppliedDeploymentContractSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  allowedDigests: Type.Array(DigestSchema),
  resourceBindingsByDigest: Type.Optional(
    Type.Record(DigestSchema, ContractResourceBindingsSchema),
  ),
});

export const DeviceAppliedDeploymentContractSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  allowedDigests: Type.Array(DigestSchema),
}, { additionalProperties: false });

export const ServiceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  namespaces: Type.Array(Type.String({ minLength: 1 })),
  disabled: Type.Boolean(),
  appliedContracts: Type.Array(ServiceAppliedDeploymentContractSchema),
});

export const ServiceInstanceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  instanceKey: Type.String({ minLength: 1 }),
  disabled: Type.Boolean(),
  currentContractId: Type.Optional(Type.String({ minLength: 1 })),
  currentContractDigest: Type.Optional(DigestSchema),
  capabilities: Type.Array(Type.String()),
  resourceBindings: Type.Optional(ContractResourceBindingsSchema),
  createdAt: IsoDateStringSchema,
});

export const ApprovalDecisionSchema = Type.Union([
  Type.Literal("approved"),
  Type.Literal("denied"),
]);

export const ContractApprovalViewSchema = Type.Object({
  contractDigest: DigestSchema,
  contractId: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  capabilities: Type.Array(Type.String()),
});

export const ApprovalRecordViewSchema = Type.Object({
  user: Type.String({ minLength: 1 }),
  answer: ApprovalDecisionSchema,
  answeredAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  approval: ContractApprovalViewSchema,
  participantKind: UserParticipantKindSchema,
});

export const InstanceGrantPolicyActorSchema = Type.Object({
  origin: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
});

export const PortalProfileSourceSchema = Type.Object({
  kind: Type.Literal("portal_profile"),
  portalId: Type.String({ minLength: 1 }),
  entryUrl: Type.String({ minLength: 1 }),
});

export const AdminPolicySourceSchema = Type.Object({
  kind: Type.Literal("admin_policy"),
  createdBy: Type.Optional(InstanceGrantPolicyActorSchema),
  updatedBy: Type.Optional(InstanceGrantPolicyActorSchema),
});

export const InstanceGrantPolicySchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  allowedOrigins: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  impliedCapabilities: Type.Array(Type.String()),
  disabled: Type.Boolean(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  source: Type.Union([AdminPolicySourceSchema, PortalProfileSourceSchema]),
});
export type InstanceGrantPolicy = StaticDecode<
  typeof InstanceGrantPolicySchema
>;

export const AuthListInstanceGrantPoliciesSchema = Type.Object({});
export const AuthListInstanceGrantPoliciesResponseSchema = Type.Object({
  policies: Type.Array(InstanceGrantPolicySchema),
});

export const AuthUpsertInstanceGrantPolicySchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  allowedOrigins: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  impliedCapabilities: Type.Array(Type.String()),
});
export const AuthUpsertInstanceGrantPolicyResponseSchema = Type.Object({
  policy: InstanceGrantPolicySchema,
});

export const AuthDisableInstanceGrantPolicySchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
});
export const AuthDisableInstanceGrantPolicyResponseSchema = Type.Object({
  policy: InstanceGrantPolicySchema,
});

export const AuthCreateServiceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  namespaces: Type.Array(Type.String({ minLength: 1 })),
});
export const AuthCreateServiceDeploymentResponseSchema = Type.Object({
  deployment: ServiceDeploymentSchema,
});

export const AuthListServiceDeploymentsSchema = Type.Object({
  disabled: Type.Optional(Type.Boolean()),
});
export const AuthListServiceDeploymentsResponseSchema = Type.Object({
  deployments: Type.Array(ServiceDeploymentSchema),
});

export const AuthApplyServiceDeploymentContractSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  contract: OpenObjectSchema,
  expectedDigest: DigestSchema,
});
export const AuthApplyServiceDeploymentContractResponseSchema = Type.Object({
  deployment: ServiceDeploymentSchema,
  contract: Type.Object({
    digest: DigestSchema,
    id: Type.String({ minLength: 1 }),
    displayName: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    installedAt: IsoDateStringSchema,
  }),
});

export const AuthUnapplyServiceDeploymentContractSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  digests: Type.Optional(Type.Array(DigestSchema)),
});
export const AuthUnapplyServiceDeploymentContractResponseSchema = Type.Object({
  deployment: ServiceDeploymentSchema,
});

export const AuthDisableServiceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
});
export const AuthDisableServiceDeploymentResponseSchema = Type.Object({
  deployment: ServiceDeploymentSchema,
});

export const AuthEnableServiceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
});
export const AuthEnableServiceDeploymentResponseSchema = Type.Object({
  deployment: ServiceDeploymentSchema,
});

export const AuthRemoveServiceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
});
export const AuthRemoveServiceDeploymentResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthProvisionServiceInstanceSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  instanceKey: Type.String({ minLength: 1 }),
});
export const AuthProvisionServiceInstanceResponseSchema = Type.Object({
  instance: ServiceInstanceSchema,
});

export const AuthListServiceInstancesSchema = Type.Object({
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  disabled: Type.Optional(Type.Boolean()),
});
export const AuthListServiceInstancesResponseSchema = Type.Object({
  instances: Type.Array(ServiceInstanceSchema),
});

export const AuthDisableServiceInstanceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthDisableServiceInstanceResponseSchema = Type.Object({
  instance: ServiceInstanceSchema,
});

export const AuthEnableServiceInstanceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthEnableServiceInstanceResponseSchema = Type.Object({
  instance: ServiceInstanceSchema,
});

export const AuthRemoveServiceInstanceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthRemoveServiceInstanceResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const ContractAnalysisSummarySchema = Type.Object({
  namespaces: Type.Array(Type.String()),
  rpcMethods: Type.Number(),
  operations: Type.Number(),
  operationControls: Type.Number(),
  events: Type.Number(),
  natsPublish: Type.Number(),
  natsSubscribe: Type.Number(),
  kvResources: Type.Number(),
  storeResources: Type.Number(),
  jobsQueues: Type.Number(),
});

export const ContractAnalysisKvResourceSchema = Type.Object({
  alias: Type.String({ minLength: 1 }),
  purpose: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
  history: Type.Number(),
  ttlMs: Type.Number(),
  maxValueBytes: Type.Optional(Type.Number()),
});

export const ContractAnalysisStoreResourceSchema = Type.Object({
  alias: Type.String({ minLength: 1 }),
  purpose: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
  ttlMs: Type.Number(),
  maxObjectBytes: Type.Optional(Type.Number()),
  maxTotalBytes: Type.Optional(Type.Number()),
});

export const ContractAnalysisJobsQueueSchema = Type.Object({
  queueType: Type.String({ minLength: 1 }),
  payload: Type.Object({ schema: Type.String({ minLength: 1 }) }),
  result: Type.Optional(
    Type.Object({ schema: Type.String({ minLength: 1 }) }),
  ),
  maxDeliver: Type.Number(),
  backoffMs: Type.Array(Type.Number()),
  ackWaitMs: Type.Number(),
  defaultDeadlineMs: Type.Optional(Type.Number()),
  progress: Type.Boolean(),
  logs: Type.Boolean(),
  dlq: Type.Boolean(),
  concurrency: Type.Number(),
});

export const ContractAnalysisRpcMethodSchema = Type.Object({
  key: Type.String(),
  subject: Type.String(),
  wildcardSubject: Type.String(),
  callerCapabilities: Type.Array(Type.String()),
});

export const ContractAnalysisOperationSchema = Type.Object({
  key: Type.String(),
  subject: Type.String(),
  wildcardSubject: Type.String(),
  controlSubject: Type.String(),
  wildcardControlSubject: Type.String(),
  callCapabilities: Type.Array(Type.String()),
  readCapabilities: Type.Array(Type.String()),
  cancelCapabilities: Type.Array(Type.String()),
  cancel: Type.Boolean(),
});

export const ContractAnalysisOperationControlSchema = Type.Object({
  key: Type.String(),
  action: Type.Union([
    Type.Literal("get"),
    Type.Literal("wait"),
    Type.Literal("watch"),
    Type.Literal("cancel"),
  ]),
  subject: Type.String(),
  wildcardSubject: Type.String(),
  requiredCapabilities: Type.Array(Type.String()),
});

export const ContractAnalysisEventSchema = Type.Object({
  key: Type.String(),
  subject: Type.String(),
  wildcardSubject: Type.String(),
  publishCapabilities: Type.Array(Type.String()),
  subscribeCapabilities: Type.Array(Type.String()),
});

export const ContractAnalysisSubjectSchema = Type.Object({
  key: Type.String(),
  subject: Type.String(),
  publishCapabilities: Type.Array(Type.String()),
  subscribeCapabilities: Type.Array(Type.String()),
});

export const ContractAnalysisNatsRuleSchema = Type.Object({
  kind: Type.String(),
  subject: Type.String(),
  wildcardSubject: Type.String(),
  requiredCapabilities: Type.Array(Type.String()),
});

export const ContractAnalysisSchema = Type.Object({
  namespaces: Type.Array(Type.String()),
  rpc: Type.Object({ methods: Type.Array(ContractAnalysisRpcMethodSchema) }),
  operations: Type.Object({
    operations: Type.Array(ContractAnalysisOperationSchema),
    control: Type.Array(ContractAnalysisOperationControlSchema),
  }),
  events: Type.Object({ events: Type.Array(ContractAnalysisEventSchema) }),
  subjects: Type.Optional(
    Type.Object({ subjects: Type.Array(ContractAnalysisSubjectSchema) }),
  ),
  nats: Type.Object({
    publish: Type.Array(ContractAnalysisNatsRuleSchema),
    subscribe: Type.Array(ContractAnalysisNatsRuleSchema),
  }),
  resources: Type.Object({
    kv: Type.Array(ContractAnalysisKvResourceSchema),
    store: Type.Array(ContractAnalysisStoreResourceSchema),
    jobs: Type.Array(ContractAnalysisJobsQueueSchema),
  }),
});

export const InstalledContractSchema = Type.Object({
  digest: DigestSchema,
  id: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  installedAt: IsoDateStringSchema,
  analysisSummary: Type.Optional(ContractAnalysisSummarySchema),
});

export const InstalledContractDetailSchema = Type.Object({
  digest: DigestSchema,
  id: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  installedAt: IsoDateStringSchema,
  analysisSummary: Type.Optional(ContractAnalysisSummarySchema),
  analysis: Type.Optional(ContractAnalysisSchema),
  resources: Type.Optional(ContractResourcesSchema),
  contract: OpenObjectSchema,
});

export const AuthListInstalledContractsSchema = Type.Object({});
export const AuthListInstalledContractsResponseSchema = Type.Object({
  contracts: Type.Array(InstalledContractSchema),
});

export const AuthGetInstalledContractSchema = Type.Object({
  digest: DigestSchema,
});
export const AuthGetInstalledContractResponseSchema = Type.Object({
  contract: InstalledContractDetailSchema,
});

export const AuthenticatedUserSchema = Type.Object({
  id: Type.String(),
  origin: Type.String(),
  active: Type.Boolean(),
  name: Type.String(),
  email: Type.String(),
  image: Type.Optional(Type.String()),
  capabilities: Type.Array(Type.String()),
  lastLogin: Type.Optional(IsoDateStringSchema),
});
export type AuthenticatedUser = StaticDecode<typeof AuthenticatedUserSchema>;

export const AuthMeSchema = Type.Object({});

export const AuthValidateRequestSchema = Type.Object({
  sessionKey: Type.String(),
  proof: Type.String(),
  subject: Type.String(),
  payloadHash: Type.String(),
  capabilities: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });
export const AuthenticatedServiceSchema = Type.Object({
  type: Type.Literal("service"),
  id: Type.String(),
  name: Type.String(),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
});
export type AuthenticatedService = StaticDecode<
  typeof AuthenticatedServiceSchema
>;

export const AuthenticatedDeviceSchema = Type.Object({
  type: Type.Literal("device"),
  deviceId: Type.String({ minLength: 1 }),
  deviceType: Type.String({ minLength: 1 }),
  runtimePublicKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
});
export type AuthenticatedDevice = StaticDecode<
  typeof AuthenticatedDeviceSchema
>;

const NullableAuthenticatedUserSchema = Type.Union([
  AuthenticatedUserSchema,
  Type.Null(),
]);

const NullableAuthenticatedDeviceSchema = Type.Union([
  AuthenticatedDeviceSchema,
  Type.Null(),
]);

const NullableAuthenticatedServiceSchema = Type.Union([
  AuthenticatedServiceSchema,
  Type.Null(),
]);

export const AuthMeResponseSchema = Type.Object({
  participantKind: ParticipantKindSchema,
  user: NullableAuthenticatedUserSchema,
  device: NullableAuthenticatedDeviceSchema,
  service: NullableAuthenticatedServiceSchema,
});
export type AuthMeResponse = StaticDecode<typeof AuthMeResponseSchema>;

export const CallerViewSchema = Type.Union([
  Type.Object({
    type: Type.Literal("user"),
    participantKind: UserParticipantKindSchema,
    trellisId: Type.String(),
    id: Type.String(),
    origin: Type.String(),
    active: Type.Boolean(),
    name: Type.String(),
    email: Type.String(),
    image: Type.Optional(Type.String()),
    capabilities: Type.Array(Type.String()),
  }),
  AuthenticatedServiceSchema,
  AuthenticatedDeviceSchema,
]);

export const AuthValidateRequestResponseSchema = Type.Object({
  allowed: Type.Boolean(),
  inboxPrefix: Type.String(),
  caller: CallerViewSchema,
});

export const AuthListApprovalsSchema = Type.Object({
  user: Type.Optional(Type.String({ minLength: 1 })),
  digest: Type.Optional(DigestSchema),
});
export const AuthListApprovalsResponseSchema = Type.Object({
  approvals: Type.Array(ApprovalRecordViewSchema),
});

export const AuthRevokeApprovalSchema = Type.Object({
  contractDigest: DigestSchema,
  user: Type.Optional(Type.String({ minLength: 1 })),
});
export const AuthRevokeApprovalResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const UserGrantViewSchema = Type.Object({
  contractDigest: DigestSchema,
  contractId: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  participantKind: UserParticipantKindSchema,
  capabilities: Type.Array(Type.String()),
  grantedAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});
export type UserGrantView = StaticDecode<typeof UserGrantViewSchema>;

export const AuthListUserGrantsSchema = Type.Object({});
export const AuthListUserGrantsResponseSchema = Type.Object({
  grants: Type.Array(UserGrantViewSchema),
});

export const AuthRevokeUserGrantSchema = Type.Object({
  contractDigest: DigestSchema,
});
export const AuthRevokeUserGrantResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const PortalSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  entryUrl: Type.String({ minLength: 1 }),
  disabled: Type.Boolean(),
});
export type Portal = StaticDecode<typeof PortalSchema>;

export const PortalProfileSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  entryUrl: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  allowedOrigins: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  impliedCapabilities: Type.Array(Type.String()),
  disabled: Type.Boolean(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});
export type PortalProfile = StaticDecode<typeof PortalProfileSchema>;

const NullablePortalIdSchema = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Null(),
]);

export const LoginPortalDefaultSchema = Type.Object({
  portalId: NullablePortalIdSchema,
});
export type LoginPortalDefault = StaticDecode<typeof LoginPortalDefaultSchema>;

export const DevicePortalDefaultSchema = Type.Object({
  portalId: NullablePortalIdSchema,
});
export type DevicePortalDefault = StaticDecode<
  typeof DevicePortalDefaultSchema
>;

export const LoginPortalSelectionSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  portalId: NullablePortalIdSchema,
});
export type LoginPortalSelection = StaticDecode<
  typeof LoginPortalSelectionSchema
>;

export const DevicePortalSelectionSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  portalId: NullablePortalIdSchema,
});
export type DevicePortalSelection = StaticDecode<
  typeof DevicePortalSelectionSchema
>;

export const PortalFlowStateSchema = Type.Union([
  Type.Object({
    status: Type.Literal("choose_provider"),
    flowId: Type.String({ minLength: 1 }),
    providers: Type.Array(Type.Object({
      id: Type.String({ minLength: 1 }),
      displayName: Type.String({ minLength: 1 }),
    })),
    app: Type.Object({
      contractId: Type.String({ minLength: 1 }),
      contractDigest: DigestSchema,
      displayName: Type.String({ minLength: 1 }),
      description: Type.String({ minLength: 1 }),
      context: Type.Optional(OpenObjectSchema),
    }),
  }),
  Type.Object({
    status: Type.Literal("approval_required"),
    flowId: Type.String({ minLength: 1 }),
    user: Type.Object({
      origin: Type.String({ minLength: 1 }),
      id: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String({ minLength: 1 })),
      email: Type.Optional(Type.String({ minLength: 1 })),
      image: Type.Optional(Type.String({ minLength: 1 })),
    }),
    approval: ContractApprovalViewSchema,
  }),
  Type.Object({
    status: Type.Literal("approval_denied"),
    flowId: Type.String({ minLength: 1 }),
    approval: ContractApprovalViewSchema,
    returnLocation: Type.Optional(Type.String({ minLength: 1 })),
  }),
  Type.Object({
    status: Type.Literal("insufficient_capabilities"),
    flowId: Type.String({ minLength: 1 }),
    user: Type.Optional(Type.Object({
      origin: Type.String({ minLength: 1 }),
      id: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String({ minLength: 1 })),
    })),
    approval: ContractApprovalViewSchema,
    missingCapabilities: Type.Array(Type.String()),
    userCapabilities: Type.Array(Type.String()),
    returnLocation: Type.Optional(Type.String({ minLength: 1 })),
  }),
  Type.Object({
    status: Type.Literal("redirect"),
    location: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    status: Type.Literal("expired"),
  }),
]);
export type PortalFlowState = StaticDecode<typeof PortalFlowStateSchema>;
export type PortalFlowChooseProviderState = Extract<
  PortalFlowState,
  { status: "choose_provider" }
>;
export type PortalFlowApprovalRequiredState = Extract<
  PortalFlowState,
  { status: "approval_required" }
>;
export type PortalFlowApprovalDeniedState = Extract<
  PortalFlowState,
  { status: "approval_denied" }
>;
export type PortalFlowInsufficientCapabilitiesState = Extract<
  PortalFlowState,
  { status: "insufficient_capabilities" }
>;
export type PortalFlowRedirectState = Extract<
  PortalFlowState,
  { status: "redirect" }
>;
export type PortalFlowExpiredState = Extract<
  PortalFlowState,
  { status: "expired" }
>;
export type PortalFlowApp = PortalFlowChooseProviderState["app"];
export type PortalFlowProvider =
  PortalFlowChooseProviderState["providers"][number];
export type PortalFlowApproval = PortalFlowApprovalRequiredState["approval"];
export type PortalFlowUser = PortalFlowApprovalRequiredState["user"];

export const DeviceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  reviewMode: Type.Optional(
    Type.Union([Type.Literal("none"), Type.Literal("required")]),
  ),
  disabled: Type.Boolean(),
  appliedContracts: Type.Array(DeviceAppliedDeploymentContractSchema),
});

export const DeviceMetadataSchema = Type.Record(
  Type.String({ minLength: 1 }),
  Type.String({ minLength: 1 }),
);

export const DeviceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  metadata: Type.Optional(DeviceMetadataSchema),
  state: Type.Union([
    Type.Literal("registered"),
    Type.Literal("activated"),
    Type.Literal("revoked"),
    Type.Literal("disabled"),
  ]),
  currentContractId: Type.Optional(Type.String({ minLength: 1 })),
  currentContractDigest: Type.Optional(DigestSchema),
  createdAt: IsoDateStringSchema,
  activatedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  revokedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
});

export const DeviceActivationActorSchema = Type.Object({
  origin: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
});
export type DeviceActivationActor = StaticDecode<
  typeof DeviceActivationActorSchema
>;

export const DeviceActivationRecordSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  activatedBy: Type.Optional(DeviceActivationActorSchema),
  state: Type.Union([Type.Literal("activated"), Type.Literal("revoked")]),
  activatedAt: IsoDateStringSchema,
  revokedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
});
export type DeviceActivationRecord = StaticDecode<
  typeof DeviceActivationRecordSchema
>;

export const DeviceActivationReviewSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("approved"),
    Type.Literal("rejected"),
  ]),
  requestedAt: IsoDateStringSchema,
  decidedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  reason: Type.Optional(Type.String({ minLength: 1 })),
});

export const AuthDeviceActivationReviewRequestedEventSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  flowId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  requestedAt: IsoDateStringSchema,
  requestedBy: Type.Object({
    origin: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
  }),
});

export const DeviceConnectInfoSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  transports: ClientTransportsSchema,
  transport: Type.Object({
    sentinel: SentinelCredsSchema,
  }),
  auth: Type.Object({
    mode: Type.Literal("device_identity"),
    iatSkewSeconds: Type.Number(),
  }),
});

export const AuthCreatePortalSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  entryUrl: Type.String({ minLength: 1 }),
});
export const AuthCreatePortalResponseSchema = Type.Object({
  portal: PortalSchema,
});
export const AuthListPortalsSchema = Type.Object({});
export const AuthListPortalsResponseSchema = Type.Object({
  portals: Type.Array(PortalSchema),
});
export const AuthDisablePortalSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
});
export const AuthDisablePortalResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthListPortalProfilesSchema = Type.Object({});
export const AuthListPortalProfilesResponseSchema = Type.Object({
  profiles: Type.Array(PortalProfileSchema),
});
export const AuthSetPortalProfileSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  entryUrl: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  allowedOrigins: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export const AuthSetPortalProfileResponseSchema = Type.Object({
  profile: PortalProfileSchema,
});
export const AuthDisablePortalProfileSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
});
export const AuthDisablePortalProfileResponseSchema = Type.Object({
  profile: PortalProfileSchema,
});

export const AuthGetLoginPortalDefaultSchema = Type.Object({});
export const AuthGetLoginPortalDefaultResponseSchema = Type.Object({
  defaultPortal: LoginPortalDefaultSchema,
});
export const AuthSetLoginPortalDefaultSchema = Type.Object({
  portalId: NullablePortalIdSchema,
});
export const AuthSetLoginPortalDefaultResponseSchema = Type.Object({
  defaultPortal: LoginPortalDefaultSchema,
});
export const AuthListLoginPortalSelectionsSchema = Type.Object({});
export const AuthListLoginPortalSelectionsResponseSchema = Type.Object({
  selections: Type.Array(LoginPortalSelectionSchema),
});
export const AuthSetLoginPortalSelectionSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  portalId: NullablePortalIdSchema,
});
export const AuthSetLoginPortalSelectionResponseSchema = Type.Object({
  selection: LoginPortalSelectionSchema,
});
export const AuthClearLoginPortalSelectionSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
});
export const AuthClearLoginPortalSelectionResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthGetDevicePortalDefaultSchema = Type.Object({});
export const AuthGetDevicePortalDefaultResponseSchema = Type.Object({
  defaultPortal: DevicePortalDefaultSchema,
});
export const AuthSetDevicePortalDefaultSchema = Type.Object({
  portalId: NullablePortalIdSchema,
});
export const AuthSetDevicePortalDefaultResponseSchema = Type.Object({
  defaultPortal: DevicePortalDefaultSchema,
});
export const AuthListDevicePortalSelectionsSchema = Type.Object({});
export const AuthListDevicePortalSelectionsResponseSchema = Type.Object({
  selections: Type.Array(DevicePortalSelectionSchema),
});
export const AuthSetDevicePortalSelectionSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  portalId: NullablePortalIdSchema,
});
export const AuthSetDevicePortalSelectionResponseSchema = Type.Object({
  selection: DevicePortalSelectionSchema,
});
export const AuthClearDevicePortalSelectionSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
});
export const AuthClearDevicePortalSelectionResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthCreateDeviceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  reviewMode: Type.Optional(
    Type.Union([Type.Literal("none"), Type.Literal("required")]),
  ),
});
export const AuthCreateDeviceDeploymentResponseSchema = Type.Object({
  deployment: DeviceDeploymentSchema,
});
export const AuthListDeviceDeploymentsSchema = Type.Object({
  disabled: Type.Optional(Type.Boolean()),
});
export const AuthListDeviceDeploymentsResponseSchema = Type.Object({
  deployments: Type.Array(DeviceDeploymentSchema),
});
export const AuthApplyDeviceDeploymentContractSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  contract: OpenObjectSchema,
  expectedDigest: DigestSchema,
});
export const AuthApplyDeviceDeploymentContractResponseSchema = Type.Object({
  deployment: DeviceDeploymentSchema,
  contract: Type.Object({
    digest: DigestSchema,
    id: Type.String({ minLength: 1 }),
    displayName: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    installedAt: IsoDateStringSchema,
  }),
});
export const AuthUnapplyDeviceDeploymentContractSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  digests: Type.Optional(Type.Array(DigestSchema)),
});
export const AuthUnapplyDeviceDeploymentContractResponseSchema = Type.Object({
  deployment: DeviceDeploymentSchema,
});
export const AuthDisableDeviceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
});
export const AuthDisableDeviceDeploymentResponseSchema = Type.Object({
  deployment: DeviceDeploymentSchema,
});
export const AuthEnableDeviceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
});
export const AuthEnableDeviceDeploymentResponseSchema = Type.Object({
  deployment: DeviceDeploymentSchema,
});
export const AuthRemoveDeviceDeploymentSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
});
export const AuthRemoveDeviceDeploymentResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthProvisionDeviceInstanceSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  activationKey: Type.String({ minLength: 1 }),
  metadata: Type.Optional(DeviceMetadataSchema),
});
export const AuthProvisionDeviceInstanceResponseSchema = Type.Object({
  instance: DeviceSchema,
});
export const AuthListDeviceInstancesSchema = Type.Object({
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(Type.Union([
    Type.Literal("registered"),
    Type.Literal("activated"),
    Type.Literal("revoked"),
    Type.Literal("disabled"),
  ])),
});
export const AuthListDeviceInstancesResponseSchema = Type.Object({
  instances: Type.Array(DeviceSchema),
});
export const AuthDisableDeviceInstanceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthDisableDeviceInstanceResponseSchema = Type.Object({
  instance: DeviceSchema,
});
export const AuthEnableDeviceInstanceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthEnableDeviceInstanceResponseSchema = Type.Object({
  instance: DeviceSchema,
});
export const AuthRemoveDeviceInstanceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthRemoveDeviceInstanceResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthActivateDeviceSchema = Type.Object({
  flowId: Type.String({ minLength: 1 }),
});
export const AuthActivateDeviceProgressSchema = Type.Object({
  status: Type.Literal("pending_review"),
  reviewId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  requestedAt: IsoDateStringSchema,
});
export const AuthActivateDeviceResponseSchema = Type.Union([
  Type.Object({
    status: Type.Literal("activated"),
    instanceId: Type.String({ minLength: 1 }),
    deploymentId: Type.String({ minLength: 1 }),
    activatedAt: IsoDateStringSchema,
    confirmationCode: Type.Optional(Type.String({ minLength: 1 })),
  }),
  Type.Object({
    status: Type.Literal("rejected"),
    reason: Type.Optional(Type.String({ minLength: 1 })),
  }),
]);

export const WaitForDeviceActivationResponseSchema = Type.Union([
  Type.Object({ status: Type.Literal("pending") }),
  Type.Object({
    status: Type.Literal("activated"),
    activatedAt: IsoDateStringSchema,
    confirmationCode: Type.Optional(Type.String({ minLength: 1 })),
    connectInfo: DeviceConnectInfoSchema,
  }),
  Type.Object({
    status: Type.Literal("rejected"),
    reason: Type.Optional(Type.String({ minLength: 1 })),
  }),
]);

export const AuthGetDeviceConnectInfoSchema = Type.Object({
  publicIdentityKey: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  iat: Type.Number(),
  sig: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthGetDeviceConnectInfoResponseSchema = Type.Object({
  status: Type.Literal("ready"),
  connectInfo: DeviceConnectInfoSchema,
});

export const AuthListDeviceActivationsSchema = Type.Object({
  instanceId: Type.Optional(Type.String({ minLength: 1 })),
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(
    Type.Union([Type.Literal("activated"), Type.Literal("revoked")]),
  ),
});
export const AuthListDeviceActivationsResponseSchema = Type.Object({
  activations: Type.Array(DeviceActivationRecordSchema),
});
export const AuthRevokeDeviceActivationSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthRevokeDeviceActivationResponseSchema = Type.Object({
  success: Type.Boolean(),
});
export const AuthListDeviceActivationReviewsSchema = Type.Object({
  instanceId: Type.Optional(Type.String({ minLength: 1 })),
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(Type.Union([
    Type.Literal("pending"),
    Type.Literal("approved"),
    Type.Literal("rejected"),
  ])),
});
export const AuthListDeviceActivationReviewsResponseSchema = Type.Object({
  reviews: Type.Array(DeviceActivationReviewSchema),
});
export const AuthDecideDeviceActivationReviewSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  decision: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
  reason: Type.Optional(Type.String({ minLength: 1 })),
});
export const AuthDecideDeviceActivationReviewResponseSchema = Type.Object({
  review: DeviceActivationReviewSchema,
  activation: Type.Optional(DeviceActivationRecordSchema),
  confirmationCode: Type.Optional(Type.String({ minLength: 1 })),
});

export const UserViewSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
});

export const AuthListUsersSchema = Type.Object({});
export const AuthListUsersResponseSchema = Type.Object({
  users: Type.Array(UserViewSchema),
});

export const AuthUpdateUserSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  active: Type.Optional(Type.Boolean()),
  capabilities: Type.Optional(Type.Array(Type.String())),
});
export const AuthUpdateUserResponseSchema = Type.Object({
  success: Type.Boolean(),
});
