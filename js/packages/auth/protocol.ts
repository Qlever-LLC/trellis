import {
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
} from "@trellis/contracts";
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
  kind: Type.String({ minLength: 1 }),
  capabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export const ApprovalRecordViewSchema = Type.Object({
  user: Type.String({ minLength: 1 }),
  answer: ApprovalDecisionSchema,
  answeredAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  approval: ContractApprovalViewSchema,
}, { additionalProperties: false });

export const AuthListServicesSchema = Type.Object({}, { additionalProperties: false });
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
}, { additionalProperties: false });

export const ContractAnalysisKvResourceSchema = Type.Object({
  alias: Type.String({ minLength: 1 }),
  purpose: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
  history: Type.Number(),
  ttlMs: Type.Number(),
  maxValueBytes: Type.Optional(Type.Number()),
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
  rpc: Type.Object({ methods: Type.Array(ContractAnalysisRpcMethodSchema) }, { additionalProperties: false }),
  events: Type.Object({ events: Type.Array(ContractAnalysisEventSchema) }, { additionalProperties: false }),
  subjects: Type.Optional(Type.Object({ subjects: Type.Array(ContractAnalysisSubjectSchema) }, { additionalProperties: false })),
  nats: Type.Object({
    publish: Type.Array(ContractAnalysisNatsRuleSchema),
    subscribe: Type.Array(ContractAnalysisNatsRuleSchema),
  }, { additionalProperties: false }),
  resources: Type.Object({ kv: Type.Array(ContractAnalysisKvResourceSchema) }, { additionalProperties: false }),
}, { additionalProperties: false });

export const InstalledContractSchema = Type.Object({
  digest: DigestSchema,
  id: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  kind: Type.String({ minLength: 1 }),
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
  kind: Type.String({ minLength: 1 }),
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

export const AuthGetInstalledContractSchema = Type.Object({ digest: DigestSchema }, { additionalProperties: false });
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

export const AuthMeSchema = Type.Object({}, { additionalProperties: false });
export const AuthMeResponseSchema = Type.Object({ user: AuthenticatedUserSchema }, { additionalProperties: false });

export const AuthValidateRequestSchema = Type.Object({
  sessionKey: Type.String(),
  proof: Type.String(),
  subject: Type.String(),
  payloadHash: Type.String(),
  capabilities: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });
export const AuthValidateRequestResponseSchema = Type.Object({
  allowed: Type.Boolean(),
  inboxPrefix: Type.String(),
  user: AuthenticatedUserSchema,
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
export const AuthRevokeApprovalResponseSchema = Type.Object({ success: Type.Boolean() }, { additionalProperties: false });

export const UserViewSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export const AuthListUsersSchema = Type.Object({}, { additionalProperties: false });
export const AuthListUsersResponseSchema = Type.Object({ users: Type.Array(UserViewSchema) }, { additionalProperties: false });

export const AuthUpdateUserSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  active: Type.Optional(Type.Boolean()),
  capabilities: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });
export const AuthUpdateUserResponseSchema = Type.Object({ success: Type.Boolean() }, { additionalProperties: false });
