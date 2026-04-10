import {
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
} from "@qlever-llc/trellis/contracts";
import type { StaticDecode } from "typebox";
import { Type } from "typebox";

const IsoDateStringSchema = Type.String({ format: "date-time" });

export const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });

export const OpenObjectSchema = Type.Unsafe<Record<string, unknown>>({
  type: "object",
});

export const ServiceViewSchema = Type.Object({
  sessionKey: Type.String(),
  displayName: Type.String(),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
  namespaces: Type.Array(Type.String()),
  description: Type.String(),
  contractId: Type.Optional(Type.String()),
  contractDigest: Type.Optional(DigestSchema),
  resourceBindings: Type.Optional(ContractResourceBindingsSchema),
  createdAt: IsoDateStringSchema,
}, { additionalProperties: false });

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
}, { additionalProperties: false });

export const ApprovalRecordViewSchema = Type.Object({
  user: Type.String({ minLength: 1 }),
  answer: ApprovalDecisionSchema,
  answeredAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  approval: ContractApprovalViewSchema,
}, { additionalProperties: false });

export const AuthListServicesSchema = Type.Object({}, {
  additionalProperties: false,
});
export const AuthListServicesResponseSchema = Type.Object({
  services: Type.Array(ServiceViewSchema),
}, { additionalProperties: false });

export const AuthInstallServiceSchema = Type.Object({
  sessionKey: Type.String(),
  displayName: Type.String({ minLength: 1 }),
  active: Type.Optional(Type.Boolean()),
  namespaces: Type.Array(Type.String()),
  description: Type.String({ minLength: 1 }),
  contract: OpenObjectSchema,
}, { additionalProperties: false });
export const AuthInstallServiceResponseSchema = Type.Object({
  success: Type.Boolean(),
  sessionKey: Type.String(),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  resourceBindings: ContractResourceBindingsSchema,
}, { additionalProperties: false });

export const AuthUpgradeServiceContractSchema = Type.Object({
  sessionKey: Type.String(),
  contract: OpenObjectSchema,
}, { additionalProperties: false });
export const AuthUpgradeServiceContractResponseSchema = Type.Object({
  success: Type.Boolean(),
  sessionKey: Type.String(),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  resourceBindings: ContractResourceBindingsSchema,
}, { additionalProperties: false });

export const ContractAnalysisSummarySchema = Type.Object({
  namespaces: Type.Array(Type.String()),
  rpcMethods: Type.Number(),
  events: Type.Number(),
  natsPublish: Type.Number(),
  natsSubscribe: Type.Number(),
  kvResources: Type.Number(),
  jobsQueues: Type.Number(),
  streamResources: Type.Number(),
}, { additionalProperties: false });

export const ContractAnalysisKvResourceSchema = Type.Object({
  alias: Type.String({ minLength: 1 }),
  purpose: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
  history: Type.Number(),
  ttlMs: Type.Number(),
  maxValueBytes: Type.Optional(Type.Number()),
}, { additionalProperties: false });

export const ContractAnalysisJobsQueueSchema = Type.Object({
  queueType: Type.String({ minLength: 1 }),
  payload: Type.Object({ schema: Type.String({ minLength: 1 }) }, {
    additionalProperties: false,
  }),
  result: Type.Optional(
    Type.Object({ schema: Type.String({ minLength: 1 }) }, {
      additionalProperties: false,
    }),
  ),
  maxDeliver: Type.Number(),
  backoffMs: Type.Array(Type.Number()),
  ackWaitMs: Type.Number(),
  defaultDeadlineMs: Type.Optional(Type.Number()),
  progress: Type.Boolean(),
  logs: Type.Boolean(),
  dlq: Type.Boolean(),
  concurrency: Type.Number(),
}, { additionalProperties: false });

export const ContractAnalysisStreamResourceSchema = Type.Object({
  alias: Type.String({ minLength: 1 }),
  purpose: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
  retention: Type.Optional(Type.String({ minLength: 1 })),
  storage: Type.Optional(Type.String({ minLength: 1 })),
  numReplicas: Type.Optional(Type.Number()),
  maxAgeMs: Type.Optional(Type.Number()),
  maxBytes: Type.Optional(Type.Number()),
  maxMsgs: Type.Optional(Type.Number()),
  discard: Type.Optional(Type.String({ minLength: 1 })),
  subjects: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  sources: Type.Optional(Type.Array(Type.Object({
    fromAlias: Type.String({ minLength: 1 }),
    streamName: Type.String({ minLength: 1 }),
    filterSubject: Type.Optional(Type.String({ minLength: 1 })),
    subjectTransformDest: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });

export const ContractAnalysisRpcMethodSchema = Type.Object({
  key: Type.String(),
  subject: Type.String(),
  wildcardSubject: Type.String(),
  callerCapabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export const ContractAnalysisEventSchema = Type.Object({
  key: Type.String(),
  subject: Type.String(),
  wildcardSubject: Type.String(),
  publishCapabilities: Type.Array(Type.String()),
  subscribeCapabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export const ContractAnalysisSubjectSchema = Type.Object({
  key: Type.String(),
  subject: Type.String(),
  publishCapabilities: Type.Array(Type.String()),
  subscribeCapabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export const ContractAnalysisNatsRuleSchema = Type.Object({
  kind: Type.String(),
  subject: Type.String(),
  wildcardSubject: Type.String(),
  requiredCapabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export const ContractAnalysisSchema = Type.Object({
  namespaces: Type.Array(Type.String()),
  rpc: Type.Object({ methods: Type.Array(ContractAnalysisRpcMethodSchema) }, {
    additionalProperties: false,
  }),
  events: Type.Object({ events: Type.Array(ContractAnalysisEventSchema) }, {
    additionalProperties: false,
  }),
  subjects: Type.Optional(
    Type.Object({ subjects: Type.Array(ContractAnalysisSubjectSchema) }, {
      additionalProperties: false,
    }),
  ),
  nats: Type.Object({
    publish: Type.Array(ContractAnalysisNatsRuleSchema),
    subscribe: Type.Array(ContractAnalysisNatsRuleSchema),
  }, { additionalProperties: false }),
  resources: Type.Object({
    kv: Type.Array(ContractAnalysisKvResourceSchema),
    jobs: Type.Array(ContractAnalysisJobsQueueSchema),
    streams: Type.Array(ContractAnalysisStreamResourceSchema),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const InstalledContractSchema = Type.Object({
  digest: DigestSchema,
  id: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  sessionKey: Type.Optional(Type.String()),
  installedAt: IsoDateStringSchema,
  analysisSummary: Type.Optional(ContractAnalysisSummarySchema),
  resourceBindings: Type.Optional(ContractResourceBindingsSchema),
}, { additionalProperties: false });

export const InstalledContractDetailSchema = Type.Object({
  digest: DigestSchema,
  id: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  sessionKey: Type.Optional(Type.String()),
  installedAt: IsoDateStringSchema,
  analysisSummary: Type.Optional(ContractAnalysisSummarySchema),
  analysis: Type.Optional(ContractAnalysisSchema),
  resources: Type.Optional(ContractResourcesSchema),
  resourceBindings: Type.Optional(ContractResourceBindingsSchema),
  contract: OpenObjectSchema,
}, { additionalProperties: false });

export const AuthListInstalledContractsSchema = Type.Object({
  sessionKey: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const AuthListInstalledContractsResponseSchema = Type.Object({
  contracts: Type.Array(InstalledContractSchema),
}, { additionalProperties: false });

export const AuthGetInstalledContractSchema = Type.Object({
  digest: DigestSchema,
}, { additionalProperties: false });
export const AuthGetInstalledContractResponseSchema = Type.Object({
  contract: InstalledContractDetailSchema,
}, { additionalProperties: false });

export const AuthenticatedUserSchema = Type.Object({
  id: Type.String(),
  origin: Type.String(),
  active: Type.Boolean(),
  name: Type.String(),
  email: Type.String(),
  image: Type.Optional(Type.String()),
  capabilities: Type.Array(Type.String()),
  lastLogin: Type.Optional(IsoDateStringSchema),
}, { additionalProperties: false });
export type AuthenticatedUser = StaticDecode<typeof AuthenticatedUserSchema>;

export const AuthMeSchema = Type.Object({}, { additionalProperties: false });

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
}, { additionalProperties: false });
export type AuthenticatedService = StaticDecode<typeof AuthenticatedServiceSchema>;

export const AuthenticatedDeviceSchema = Type.Object({
  type: Type.Literal("device"),
  deviceId: Type.String({ minLength: 1 }),
  deviceType: Type.String({ minLength: 1 }),
  runtimePublicKey: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export const AuthenticatedWorkloadSchema = Type.Object({
  type: Type.Literal("workload"),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
}, { additionalProperties: false });
export type AuthenticatedWorkload = StaticDecode<typeof AuthenticatedWorkloadSchema>;

const NullableAuthenticatedUserSchema = Type.Union([
  AuthenticatedUserSchema,
  Type.Null(),
]);

const NullableAuthenticatedWorkloadSchema = Type.Union([
  AuthenticatedWorkloadSchema,
  Type.Null(),
]);

const NullableAuthenticatedServiceSchema = Type.Union([
  AuthenticatedServiceSchema,
  Type.Null(),
]);

export const AuthMeResponseSchema = Type.Object({
  user: NullableAuthenticatedUserSchema,
  workload: NullableAuthenticatedWorkloadSchema,
  service: NullableAuthenticatedServiceSchema,
}, { additionalProperties: false });
export type AuthMeResponse = StaticDecode<typeof AuthMeResponseSchema>;

export const CallerViewSchema = Type.Union([
  Type.Object({
    type: Type.Literal("user"),
    id: Type.String(),
    origin: Type.String(),
    active: Type.Boolean(),
    name: Type.String(),
    email: Type.String(),
    image: Type.Optional(Type.String()),
    capabilities: Type.Array(Type.String()),
  }, { additionalProperties: false }),
  AuthenticatedServiceSchema,
  AuthenticatedWorkloadSchema,
]);

export const AuthValidateRequestResponseSchema = Type.Object({
  allowed: Type.Boolean(),
  inboxPrefix: Type.String(),
  caller: CallerViewSchema,
}, { additionalProperties: false });

export const AuthListApprovalsSchema = Type.Object({
  user: Type.Optional(Type.String({ minLength: 1 })),
  digest: Type.Optional(DigestSchema),
}, { additionalProperties: false });
export const AuthListApprovalsResponseSchema = Type.Object({
  approvals: Type.Array(ApprovalRecordViewSchema),
}, { additionalProperties: false });

export const AuthRevokeApprovalSchema = Type.Object({
  contractDigest: DigestSchema,
  user: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
export const AuthRevokeApprovalResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });

export const PortalSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  appContractId: Type.Optional(Type.String({ minLength: 1 })),
  entryUrl: Type.String({ minLength: 1 }),
  disabled: Type.Boolean(),
}, { additionalProperties: false });

const NullablePortalIdSchema = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Null(),
]);

export const LoginPortalDefaultSchema = Type.Object({
  portalId: NullablePortalIdSchema,
}, { additionalProperties: false });
export type LoginPortalDefault = StaticDecode<typeof LoginPortalDefaultSchema>;

export const WorkloadPortalDefaultSchema = Type.Object({
  portalId: NullablePortalIdSchema,
}, { additionalProperties: false });
export type WorkloadPortalDefault = StaticDecode<typeof WorkloadPortalDefaultSchema>;

export const LoginPortalSelectionSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  portalId: NullablePortalIdSchema,
}, { additionalProperties: false });
export type LoginPortalSelection = StaticDecode<typeof LoginPortalSelectionSchema>;

export const WorkloadPortalSelectionSchema = Type.Object({
  profileId: Type.String({ minLength: 1 }),
  portalId: NullablePortalIdSchema,
}, { additionalProperties: false });
export type WorkloadPortalSelection = StaticDecode<typeof WorkloadPortalSelectionSchema>;

export const PortalFlowStateSchema = Type.Union([
  Type.Object({
    status: Type.Literal("choose_provider"),
    flowId: Type.String({ minLength: 1 }),
    providers: Type.Array(Type.Object({
      id: Type.String({ minLength: 1 }),
      displayName: Type.String({ minLength: 1 }),
    }, { additionalProperties: false })),
    app: Type.Object({
      contractId: Type.String({ minLength: 1 }),
      contractDigest: DigestSchema,
      displayName: Type.String({ minLength: 1 }),
      description: Type.String({ minLength: 1 }),
      context: Type.Optional(OpenObjectSchema),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("approval_required"),
    flowId: Type.String({ minLength: 1 }),
    user: Type.Object({
      origin: Type.String({ minLength: 1 }),
      id: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String({ minLength: 1 })),
      email: Type.Optional(Type.String({ minLength: 1 })),
      image: Type.Optional(Type.String({ minLength: 1 })),
    }, { additionalProperties: false }),
    approval: ContractApprovalViewSchema,
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("approval_denied"),
    flowId: Type.String({ minLength: 1 }),
    approval: ContractApprovalViewSchema,
    returnLocation: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("insufficient_capabilities"),
    flowId: Type.String({ minLength: 1 }),
    user: Type.Optional(Type.Object({
      origin: Type.String({ minLength: 1 }),
      id: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String({ minLength: 1 })),
    }, { additionalProperties: false })),
    approval: ContractApprovalViewSchema,
    missingCapabilities: Type.Array(Type.String()),
    userCapabilities: Type.Array(Type.String()),
    returnLocation: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("redirect"),
    location: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("expired"),
  }, { additionalProperties: false }),
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
export type PortalFlowRedirectState = Extract<PortalFlowState, { status: "redirect" }>;
export type PortalFlowExpiredState = Extract<PortalFlowState, { status: "expired" }>;
export type PortalFlowApp = PortalFlowChooseProviderState["app"];
export type PortalFlowProvider = PortalFlowChooseProviderState["providers"][number];
export type PortalFlowApproval = PortalFlowApprovalRequiredState["approval"];
export type PortalFlowUser = PortalFlowApprovalRequiredState["user"];

export const WorkloadProfileSchema = Type.Object({
  profileId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  allowedDigests: Type.Array(DigestSchema),
  reviewMode: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("required")])),
  disabled: Type.Boolean(),
}, { additionalProperties: false });

export const WorkloadSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  state: Type.Union([
    Type.Literal("registered"),
    Type.Literal("activated"),
    Type.Literal("revoked"),
    Type.Literal("disabled"),
  ]),
  createdAt: IsoDateStringSchema,
  activatedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  revokedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
}, { additionalProperties: false });

export const WorkloadActivationActorSchema = Type.Object({
  origin: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type WorkloadActivationActor = StaticDecode<typeof WorkloadActivationActorSchema>;

export const WorkloadActivationRecordSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  activatedBy: Type.Optional(WorkloadActivationActorSchema),
  state: Type.Union([Type.Literal("activated"), Type.Literal("revoked")]),
  activatedAt: IsoDateStringSchema,
  revokedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
}, { additionalProperties: false });
export type WorkloadActivationRecord = StaticDecode<typeof WorkloadActivationRecordSchema>;

export const WorkloadActivationReviewSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("approved"),
    Type.Literal("rejected"),
  ]),
  requestedAt: IsoDateStringSchema,
  decidedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  reason: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

export const AuthWorkloadActivationReviewRequestedEventSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  handoffId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  requestedAt: IsoDateStringSchema,
  requestedBy: Type.Object({
    origin: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const WorkloadConnectInfoSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  profileId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  transport: Type.Object({
    natsServers: Type.Array(Type.String({ minLength: 1 })),
    sentinel: Type.Object({
      jwt: Type.String({ minLength: 1 }),
      seed: Type.String({ minLength: 1 }),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  auth: Type.Object({
    mode: Type.Literal("workload_identity"),
    iatSkewSeconds: Type.Number(),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const AuthCreatePortalSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  appContractId: Type.Optional(Type.String({ minLength: 1 })),
  entryUrl: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthCreatePortalResponseSchema = Type.Object({
  portal: PortalSchema,
}, { additionalProperties: false });
export const AuthListPortalsSchema = Type.Object({}, { additionalProperties: false });
export const AuthListPortalsResponseSchema = Type.Object({
  portals: Type.Array(PortalSchema),
}, { additionalProperties: false });
export const AuthDisablePortalSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthDisablePortalResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });

export const AuthGetLoginPortalDefaultSchema = Type.Object({}, { additionalProperties: false });
export const AuthGetLoginPortalDefaultResponseSchema = Type.Object({
  defaultPortal: LoginPortalDefaultSchema,
}, { additionalProperties: false });
export const AuthSetLoginPortalDefaultSchema = Type.Object({
  portalId: NullablePortalIdSchema,
}, { additionalProperties: false });
export const AuthSetLoginPortalDefaultResponseSchema = Type.Object({
  defaultPortal: LoginPortalDefaultSchema,
}, { additionalProperties: false });
export const AuthListLoginPortalSelectionsSchema = Type.Object({}, { additionalProperties: false });
export const AuthListLoginPortalSelectionsResponseSchema = Type.Object({
  selections: Type.Array(LoginPortalSelectionSchema),
}, { additionalProperties: false });
export const AuthSetLoginPortalSelectionSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  portalId: NullablePortalIdSchema,
}, { additionalProperties: false });
export const AuthSetLoginPortalSelectionResponseSchema = Type.Object({
  selection: LoginPortalSelectionSchema,
}, { additionalProperties: false });
export const AuthClearLoginPortalSelectionSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthClearLoginPortalSelectionResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });

export const AuthGetWorkloadPortalDefaultSchema = Type.Object({}, { additionalProperties: false });
export const AuthGetWorkloadPortalDefaultResponseSchema = Type.Object({
  defaultPortal: WorkloadPortalDefaultSchema,
}, { additionalProperties: false });
export const AuthSetWorkloadPortalDefaultSchema = Type.Object({
  portalId: NullablePortalIdSchema,
}, { additionalProperties: false });
export const AuthSetWorkloadPortalDefaultResponseSchema = Type.Object({
  defaultPortal: WorkloadPortalDefaultSchema,
}, { additionalProperties: false });
export const AuthListWorkloadPortalSelectionsSchema = Type.Object({}, { additionalProperties: false });
export const AuthListWorkloadPortalSelectionsResponseSchema = Type.Object({
  selections: Type.Array(WorkloadPortalSelectionSchema),
}, { additionalProperties: false });
export const AuthSetWorkloadPortalSelectionSchema = Type.Object({
  profileId: Type.String({ minLength: 1 }),
  portalId: NullablePortalIdSchema,
}, { additionalProperties: false });
export const AuthSetWorkloadPortalSelectionResponseSchema = Type.Object({
  selection: WorkloadPortalSelectionSchema,
}, { additionalProperties: false });
export const AuthClearWorkloadPortalSelectionSchema = Type.Object({
  profileId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthClearWorkloadPortalSelectionResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });

export const AuthCreateWorkloadProfileSchema = Type.Object({
  profileId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  allowedDigests: Type.Array(DigestSchema),
  reviewMode: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("required")])),
  contract: Type.Optional(Type.Object({}, { additionalProperties: true })),
}, { additionalProperties: false });
export const AuthCreateWorkloadProfileResponseSchema = Type.Object({
  profile: WorkloadProfileSchema,
}, { additionalProperties: false });
export const AuthListWorkloadProfilesSchema = Type.Object({
  contractId: Type.Optional(Type.String({ minLength: 1 })),
  disabled: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export const AuthListWorkloadProfilesResponseSchema = Type.Object({
  profiles: Type.Array(WorkloadProfileSchema),
}, { additionalProperties: false });
export const AuthDisableWorkloadProfileSchema = Type.Object({
  profileId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthDisableWorkloadProfileResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });

export const AuthProvisionWorkloadInstanceSchema = Type.Object({
  profileId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  activationKey: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthProvisionWorkloadInstanceResponseSchema = Type.Object({
  instance: WorkloadSchema,
}, { additionalProperties: false });
export const AuthListWorkloadInstancesSchema = Type.Object({
  profileId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(Type.Union([
    Type.Literal("registered"),
    Type.Literal("activated"),
    Type.Literal("revoked"),
    Type.Literal("disabled"),
  ])),
}, { additionalProperties: false });
export const AuthListWorkloadInstancesResponseSchema = Type.Object({
  instances: Type.Array(WorkloadSchema),
}, { additionalProperties: false });
export const AuthDisableWorkloadInstanceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthDisableWorkloadInstanceResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });

export const AuthActivateWorkloadSchema = Type.Object({
  handoffId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthActivateWorkloadResponseSchema = Type.Union([
  Type.Object({
    status: Type.Literal("activated"),
    instanceId: Type.String({ minLength: 1 }),
    profileId: Type.String({ minLength: 1 }),
    activatedAt: IsoDateStringSchema,
    confirmationCode: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("pending_review"),
    reviewId: Type.String({ minLength: 1 }),
    instanceId: Type.String({ minLength: 1 }),
    profileId: Type.String({ minLength: 1 }),
    requestedAt: IsoDateStringSchema,
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("rejected"),
    reason: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }),
]);
export const AuthGetWorkloadActivationStatusSchema = Type.Object({
  handoffId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthGetWorkloadActivationStatusResponseSchema = AuthActivateWorkloadResponseSchema;

export const WaitForWorkloadActivationResponseSchema = Type.Union([
  Type.Object({ status: Type.Literal("pending") }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("activated"),
    activatedAt: IsoDateStringSchema,
    confirmationCode: Type.Optional(Type.String({ minLength: 1 })),
    connectInfo: WorkloadConnectInfoSchema,
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("rejected"),
    reason: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }),
]);

export const AuthGetWorkloadConnectInfoSchema = Type.Object({
  publicIdentityKey: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  iat: Type.Number(),
  sig: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthGetWorkloadConnectInfoResponseSchema = Type.Object({
  status: Type.Literal("ready"),
  connectInfo: WorkloadConnectInfoSchema,
}, { additionalProperties: false });

export const AuthListWorkloadActivationsSchema = Type.Object({
  instanceId: Type.Optional(Type.String({ minLength: 1 })),
  profileId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(Type.Union([Type.Literal("activated"), Type.Literal("revoked")])),
}, { additionalProperties: false });
export const AuthListWorkloadActivationsResponseSchema = Type.Object({
  activations: Type.Array(WorkloadActivationRecordSchema),
}, { additionalProperties: false });
export const AuthRevokeWorkloadActivationSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const AuthRevokeWorkloadActivationResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });
export const AuthListWorkloadActivationReviewsSchema = Type.Object({
  instanceId: Type.Optional(Type.String({ minLength: 1 })),
  profileId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(Type.Union([
    Type.Literal("pending"),
    Type.Literal("approved"),
    Type.Literal("rejected"),
  ])),
}, { additionalProperties: false });
export const AuthListWorkloadActivationReviewsResponseSchema = Type.Object({
  reviews: Type.Array(WorkloadActivationReviewSchema),
}, { additionalProperties: false });
export const AuthDecideWorkloadActivationReviewSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  decision: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
  reason: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
export const AuthDecideWorkloadActivationReviewResponseSchema = Type.Object({
  review: WorkloadActivationReviewSchema,
  activation: Type.Optional(WorkloadActivationRecordSchema),
  confirmationCode: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

export const UserViewSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export const AuthListUsersSchema = Type.Object({}, {
  additionalProperties: false,
});
export const AuthListUsersResponseSchema = Type.Object({
  users: Type.Array(UserViewSchema),
}, { additionalProperties: false });

export const AuthUpdateUserSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  active: Type.Optional(Type.Boolean()),
  capabilities: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });
export const AuthUpdateUserResponseSchema = Type.Object({
  success: Type.Boolean(),
}, { additionalProperties: false });
