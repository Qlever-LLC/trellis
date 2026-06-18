import { ContractResourceBindingsSchema } from "../contracts.ts";
import type { StaticDecode } from "typebox";
import { Type } from "typebox";
import { PageResponseSchema } from "../contract_support/protocol.ts";
import {
  ClientTransportsSchema,
  ContractApprovalCapabilitySchema,
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

export const ServiceDeploymentSchema = Type.Unsafe<{
  deploymentId: string;
  namespaces: string[];
  contractCompatibilityMode?: "strict" | "mutable-dev";
  disabled: boolean;
}>(Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  namespaces: Type.Array(Type.String({ minLength: 1 })),
  contractCompatibilityMode: Type.Optional(
    Type.Union([Type.Literal("strict"), Type.Literal("mutable-dev")]),
  ),
  disabled: Type.Boolean(),
}));

export const ServiceInstanceSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  instanceKey: Type.String({ minLength: 1 }),
  disabled: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
  resourceBindings: Type.Optional(ContractResourceBindingsSchema),
  createdAt: IsoDateStringSchema,
});

export const ApprovalDecisionSchema = Type.Union([
  Type.Literal("approved"),
  Type.Literal("denied"),
]);

export const IdentityAnchorViewSchema = Type.Union([
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

export const ContractEvidenceViewSchema = Type.Object({
  contractDigest: DigestSchema,
  contractId: Type.String({ minLength: 1 }),
});

export const ApprovalEvidenceViewSchema = Type.Object({
  contractDigest: DigestSchema,
  contractId: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  capabilities: Type.Record(Type.String(), ContractApprovalCapabilitySchema),
});

export const IdentityGrantApprovalViewSchema = Type.Object({
  identityGrantId: Type.String({ minLength: 1 }),
  identityAnchor: IdentityAnchorViewSchema,
  contractEvidence: ContractEvidenceViewSchema,
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  capabilities: Type.Record(Type.String(), ContractApprovalCapabilitySchema),
});

export const ApprovalRecordViewSchema = Type.Object({
  user: Type.String({ minLength: 1 }),
  answer: ApprovalDecisionSchema,
  answeredAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  identityGrantId: Type.String({ minLength: 1 }),
  identityAnchor: IdentityAnchorViewSchema,
  contractEvidence: ContractEvidenceViewSchema,
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  capabilities: Type.Record(Type.String(), ContractApprovalCapabilitySchema),
  participantKind: UserParticipantKindSchema,
});

export const DeploymentAuthorityKindSchema = Type.Union([
  Type.Literal("service"),
  Type.Literal("device"),
  Type.Literal("app"),
  Type.Literal("cli"),
  Type.Literal("native"),
  Type.Literal("device-user"),
]);
export type DeploymentAuthorityKind = StaticDecode<
  typeof DeploymentAuthorityKindSchema
>;

export const DeploymentAuthoritySurfaceKindSchema = Type.Union([
  Type.Literal("rpc"),
  Type.Literal("operation"),
  Type.Literal("event"),
  Type.Literal("feed"),
]);
export type DeploymentAuthoritySurfaceKind = StaticDecode<
  typeof DeploymentAuthoritySurfaceKindSchema
>;

export const DeploymentAuthoritySurfaceActionSchema = Type.Union([
  Type.Literal("call"),
  Type.Literal("publish"),
  Type.Literal("subscribe"),
  Type.Literal("observe"),
  Type.Literal("cancel"),
]);
export type DeploymentAuthoritySurfaceAction = StaticDecode<
  typeof DeploymentAuthoritySurfaceActionSchema
>;

export const DeploymentAuthorityResourceKindSchema = Type.Union([
  Type.Literal("kv"),
  Type.Literal("store"),
  Type.Literal("jobs"),
  Type.Literal("event-consumer"),
  Type.Literal("transfer"),
]);
export type DeploymentAuthorityResourceKind = StaticDecode<
  typeof DeploymentAuthorityResourceKindSchema
>;

export const DeploymentAuthoritySurfaceSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  kind: DeploymentAuthoritySurfaceKindSchema,
  name: Type.String({ minLength: 1 }),
  action: Type.Optional(DeploymentAuthoritySurfaceActionSchema),
});
export type DeploymentAuthoritySurface = StaticDecode<
  typeof DeploymentAuthoritySurfaceSchema
>;

export const DeploymentAuthorityCapabilitySchema = Type.String({
  minLength: 1,
});
export type DeploymentAuthorityCapability = StaticDecode<
  typeof DeploymentAuthorityCapabilitySchema
>;

export const DeploymentAuthorityCapabilityDirectionSchema = Type.Union([
  Type.Literal("creates"),
  Type.Literal("given"),
]);
export type DeploymentAuthorityCapabilityDirection = StaticDecode<
  typeof DeploymentAuthorityCapabilityDirectionSchema
>;

export const DeploymentAuthorityResourceSchema = Type.Object({
  kind: DeploymentAuthorityResourceKindSchema,
  alias: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
  definition: Type.Optional(OpenObjectSchema),
});
export type DeploymentAuthorityResource = StaticDecode<
  typeof DeploymentAuthorityResourceSchema
>;

export const DeploymentAuthorityContractNeedSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
});
export type DeploymentAuthorityContractNeed = StaticDecode<
  typeof DeploymentAuthorityContractNeedSchema
>;

export const DeploymentAuthoritySurfaceNeedSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  kind: DeploymentAuthoritySurfaceKindSchema,
  name: Type.String({ minLength: 1 }),
  action: Type.Optional(DeploymentAuthoritySurfaceActionSchema),
  required: Type.Boolean(),
});
export type DeploymentAuthoritySurfaceNeed = StaticDecode<
  typeof DeploymentAuthoritySurfaceNeedSchema
>;

export const DeploymentAuthorityCapabilityNeedSchema = Type.Object({
  capability: DeploymentAuthorityCapabilitySchema,
  required: Type.Boolean(),
});
export type DeploymentAuthorityCapabilityNeed = StaticDecode<
  typeof DeploymentAuthorityCapabilityNeedSchema
>;

export const DeploymentAuthorityResourceNeedSchema = Type.Object({
  kind: DeploymentAuthorityResourceKindSchema,
  alias: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
  definition: Type.Optional(OpenObjectSchema),
});
export type DeploymentAuthorityResourceNeed = StaticDecode<
  typeof DeploymentAuthorityResourceNeedSchema
>;

export const DeploymentAuthorityNeedsSchema = Type.Object({
  contracts: Type.Array(DeploymentAuthorityContractNeedSchema),
  surfaces: Type.Array(DeploymentAuthoritySurfaceNeedSchema),
  capabilities: Type.Array(DeploymentAuthorityCapabilityNeedSchema),
  resources: Type.Array(DeploymentAuthorityResourceNeedSchema),
});
export type DeploymentAuthorityNeeds = StaticDecode<
  typeof DeploymentAuthorityNeedsSchema
>;

export const DeploymentAuthoritySchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  kind: DeploymentAuthorityKindSchema,
  disabled: Type.Boolean(),
  desiredState: Type.Object({
    needs: DeploymentAuthorityNeedsSchema,
    capabilities: Type.Array(DeploymentAuthorityCapabilitySchema),
    resources: Type.Array(DeploymentAuthorityResourceSchema),
    surfaces: Type.Array(DeploymentAuthoritySurfaceSchema),
  }),
  version: Type.String({ minLength: 1 }),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});
export type DeploymentAuthority = StaticDecode<
  typeof DeploymentAuthoritySchema
>;

export const DeploymentAuthorityProposalSchema = Type.Object({
  proposalId: Type.Optional(Type.String({ minLength: 1 })),
  deploymentId: Type.String({ minLength: 1 }),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  contract: Type.Optional(OpenObjectSchema),
  requestedNeeds: DeploymentAuthorityNeedsSchema,
  providedSurfaces: Type.Array(DeploymentAuthoritySurfaceSchema),
  summary: Type.Optional(OpenObjectSchema),
});
export type DeploymentAuthorityProposal = StaticDecode<
  typeof DeploymentAuthorityProposalSchema
>;

export const DeploymentResourceBindingSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  kind: DeploymentAuthorityResourceKindSchema,
  alias: Type.String({ minLength: 1 }),
  binding: Type.Record(Type.String(), Type.Unknown()),
  limits: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});
export type DeploymentResourceBinding = StaticDecode<
  typeof DeploymentResourceBindingSchema
>;

export const MaterializedAuthoritySurfaceGrantSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  surfaceKind: DeploymentAuthoritySurfaceKindSchema,
  name: Type.String({ minLength: 1 }),
  action: Type.Optional(DeploymentAuthoritySurfaceActionSchema),
});
export type MaterializedAuthoritySurfaceGrant = StaticDecode<
  typeof MaterializedAuthoritySurfaceGrantSchema
>;

export const MaterializedAuthorityCapabilityGrantSchema = Type.Object({
  capability: DeploymentAuthorityCapabilitySchema,
});
export type MaterializedAuthorityCapabilityGrant = StaticDecode<
  typeof MaterializedAuthorityCapabilityGrantSchema
>;

export const MaterializedAuthorityNatsGrantSourceSchema = Type.Union([
  Type.Literal("owned-surface"),
  Type.Literal("used-surface"),
  Type.Literal("resource-binding"),
  Type.Literal("platform-service"),
  Type.Literal("transfer"),
]);
export type MaterializedAuthorityNatsGrantSource = StaticDecode<
  typeof MaterializedAuthorityNatsGrantSourceSchema
>;

export const MaterializedAuthorityNatsGrantSchema = Type.Object({
  direction: Type.Union([Type.Literal("publish"), Type.Literal("subscribe")]),
  subject: Type.String({ minLength: 1 }),
  surface: Type.Optional(Type.Object({
    contractId: Type.String({ minLength: 1 }),
    kind: DeploymentAuthoritySurfaceKindSchema,
    name: Type.String({ minLength: 1 }),
    action: Type.Optional(DeploymentAuthoritySurfaceActionSchema),
  })),
  requiredCapabilities: Type.Array(Type.String({ minLength: 1 })),
  grantSource: MaterializedAuthorityNatsGrantSourceSchema,
});
export type MaterializedAuthorityNatsGrant = StaticDecode<
  typeof MaterializedAuthorityNatsGrantSchema
>;

export const MaterializedAuthorityGrantsSchema = Type.Object({
  capabilities: Type.Array(MaterializedAuthorityCapabilityGrantSchema),
  surfaces: Type.Array(MaterializedAuthoritySurfaceGrantSchema),
  nats: Type.Array(MaterializedAuthorityNatsGrantSchema),
});
export type MaterializedAuthorityGrants = StaticDecode<
  typeof MaterializedAuthorityGrantsSchema
>;

export type MaterializedAuthorityGrant =
  | MaterializedAuthorityCapabilityGrant
  | MaterializedAuthoritySurfaceGrant
  | MaterializedAuthorityNatsGrant;

export const DeploymentAuthorityMaterializationSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  desiredVersion: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal("current"),
    Type.Literal("pending"),
    Type.Literal("failed"),
  ]),
  resourceBindings: Type.Array(DeploymentResourceBindingSchema),
  grants: MaterializedAuthorityGrantsSchema,
  reconciledAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  error: Type.Optional(Type.String({ minLength: 1 })),
});
export type DeploymentAuthorityMaterialization = StaticDecode<
  typeof DeploymentAuthorityMaterializationSchema
>;

export const DeploymentAuthorityReconciliationStatusSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  desiredVersion: Type.String({ minLength: 1 }),
  state: Type.Union([
    Type.Literal("idle"),
    Type.Literal("running"),
    Type.Literal("succeeded"),
    Type.Literal("failed"),
  ]),
  startedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  finishedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  message: Type.Optional(Type.String({ minLength: 1 })),
});
export type DeploymentAuthorityReconciliationStatus = StaticDecode<
  typeof DeploymentAuthorityReconciliationStatusSchema
>;

const DeploymentAuthorityPlanBaseSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  proposal: DeploymentAuthorityProposalSchema,
  desiredChange: OpenObjectSchema,
  materializationPreview: OpenObjectSchema,
  warnings: Type.Array(Type.String({ minLength: 1 })),
  createdAt: IsoDateStringSchema,
  expiresAt: Type.Optional(IsoDateStringSchema),
  state: Type.Optional(
    Type.Union([
      Type.Literal("pending"),
      Type.Literal("accepted"),
      Type.Literal("rejected"),
      Type.Literal("expired"),
    ]),
  ),
  decisionAt: Type.Optional(Type.Union([IsoDateStringSchema, Type.Null()])),
  decisionBy: Type.Optional(
    Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  ),
  decisionReason: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
});

export const DeploymentAuthorityUpdateSchema = Type.Object({
  ...DeploymentAuthorityPlanBaseSchema.properties,
  classification: Type.Literal("update"),
});
export type DeploymentAuthorityUpdate = StaticDecode<
  typeof DeploymentAuthorityUpdateSchema
>;

export const DeploymentAuthorityMigrationSchema = Type.Object({
  ...DeploymentAuthorityPlanBaseSchema.properties,
  classification: Type.Literal("migration"),
  acknowledgementRequired: Type.Boolean(),
});
export type DeploymentAuthorityMigration = StaticDecode<
  typeof DeploymentAuthorityMigrationSchema
>;

export const DeploymentAuthorityPlanSchema = Type.Union([
  DeploymentAuthorityUpdateSchema,
  DeploymentAuthorityMigrationSchema,
]);
export type DeploymentAuthorityPlan = StaticDecode<
  typeof DeploymentAuthorityPlanSchema
>;

export const ImplementationOfferSchema = Type.Object({
  offerId: Type.String({ minLength: 1 }),
  deploymentKind: Type.Union([Type.Literal("service"), Type.Literal("device")]),
  deploymentId: Type.String({ minLength: 1 }),
  instanceId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  lineageKey: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal("offered"),
    Type.Literal("accepted"),
    Type.Literal("stale"),
    Type.Literal("expired"),
    Type.Literal("withdrawn"),
  ]),
  liveness: Type.Union([
    Type.Literal("unknown"),
    Type.Literal("healthy"),
    Type.Literal("unhealthy"),
    Type.Literal("disconnected"),
  ]),
  firstOfferedAt: IsoDateStringSchema,
  acceptedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  lastRefreshedAt: IsoDateStringSchema,
  staleAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  expiresAt: Type.Union([IsoDateStringSchema, Type.Null()]),
});
export type ImplementationOffer = StaticDecode<
  typeof ImplementationOfferSchema
>;

export const DeploymentPortalRouteSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  portalId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  entryUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  disabled: Type.Boolean(),
  updatedAt: IsoDateStringSchema,
});
export type DeploymentPortalRoute = StaticDecode<
  typeof DeploymentPortalRouteSchema
>;

export const DeploymentAuthorityGrantOverrideSchema = Type.Union([
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
export type DeploymentAuthorityGrantOverride = StaticDecode<
  typeof DeploymentAuthorityGrantOverrideSchema
>;

export const AuthDeploymentAuthorityListSchema = Type.Object({
  kind: Type.Optional(DeploymentAuthorityKindSchema),
  disabled: Type.Optional(Type.Boolean()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export type AuthDeploymentAuthorityListInput = StaticDecode<
  typeof AuthDeploymentAuthorityListSchema
>;

export const AuthDeploymentAuthorityListResponseSchema = Type.Object({
  ...PageResponseSchema(DeploymentAuthoritySchema).properties,
});
export type AuthDeploymentAuthorityListResponse = StaticDecode<
  typeof AuthDeploymentAuthorityListResponseSchema
>;

export const AuthDeploymentAuthorityGetSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
});
export type AuthDeploymentAuthorityGetInput = StaticDecode<
  typeof AuthDeploymentAuthorityGetSchema
>;

export const AuthDeploymentAuthorityGetResponseSchema = Type.Object({
  authority: DeploymentAuthoritySchema,
  materializedAuthority: Type.Union([
    DeploymentAuthorityMaterializationSchema,
    Type.Null(),
  ]),
  portalRoute: Type.Union([DeploymentPortalRouteSchema, Type.Null()]),
  grantOverrides: Type.Array(DeploymentAuthorityGrantOverrideSchema),
});
export type AuthDeploymentAuthorityGetResponse = StaticDecode<
  typeof AuthDeploymentAuthorityGetResponseSchema
>;

export const AuthDeploymentAuthorityPlansListSchema = Type.Object({
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(
    Type.Union([
      Type.Literal("pending"),
      Type.Literal("accepted"),
      Type.Literal("rejected"),
      Type.Literal("expired"),
    ]),
  ),
  classification: Type.Optional(
    Type.Union([Type.Literal("update"), Type.Literal("migration")]),
  ),
  kind: Type.Optional(DeploymentAuthorityKindSchema),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export type AuthDeploymentAuthorityPlansListInput = StaticDecode<
  typeof AuthDeploymentAuthorityPlansListSchema
>;

export const AuthDeploymentAuthorityPlansListResponseSchema = Type.Object({
  ...PageResponseSchema(DeploymentAuthorityPlanSchema).properties,
});
export type AuthDeploymentAuthorityPlansListResponse = StaticDecode<
  typeof AuthDeploymentAuthorityPlansListResponseSchema
>;

export const AuthDeploymentAuthorityPlansGetSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
});
export type AuthDeploymentAuthorityPlansGetInput = StaticDecode<
  typeof AuthDeploymentAuthorityPlansGetSchema
>;

export const AuthDeploymentAuthorityPlansGetResponseSchema = Type.Object({
  plan: DeploymentAuthorityPlanSchema,
});
export type AuthDeploymentAuthorityPlansGetResponse = StaticDecode<
  typeof AuthDeploymentAuthorityPlansGetResponseSchema
>;

export const AuthDeploymentAuthorityPlanSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  contract: OpenObjectSchema,
  expectedDigest: DigestSchema,
});
export type AuthDeploymentAuthorityPlanInput = StaticDecode<
  typeof AuthDeploymentAuthorityPlanSchema
>;

export const AuthDeploymentAuthorityPlanResponseSchema = Type.Object({
  plan: DeploymentAuthorityPlanSchema,
});
export type AuthDeploymentAuthorityPlanResponse = StaticDecode<
  typeof AuthDeploymentAuthorityPlanResponseSchema
>;

export const AuthDeploymentAuthorityAcceptUpdateSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  expectedDesiredVersion: Type.Optional(Type.String({ minLength: 1 })),
});
export type AuthDeploymentAuthorityAcceptUpdateInput = StaticDecode<
  typeof AuthDeploymentAuthorityAcceptUpdateSchema
>;

export const AuthDeploymentAuthorityAcceptMigrationSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  expectedDesiredVersion: Type.Optional(Type.String({ minLength: 1 })),
  acknowledgement: Type.String({ minLength: 1 }),
});
export type AuthDeploymentAuthorityAcceptMigrationInput = StaticDecode<
  typeof AuthDeploymentAuthorityAcceptMigrationSchema
>;

export const AuthDeploymentAuthorityAcceptResponseSchema = Type.Object({
  authority: DeploymentAuthoritySchema,
});
export type AuthDeploymentAuthorityAcceptResponse = StaticDecode<
  typeof AuthDeploymentAuthorityAcceptResponseSchema
>;

export const AuthDeploymentAuthorityRejectSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  reason: Type.Optional(Type.String({ minLength: 1 })),
});
export type AuthDeploymentAuthorityRejectInput = StaticDecode<
  typeof AuthDeploymentAuthorityRejectSchema
>;

export const AuthDeploymentAuthorityRejectResponseSchema = Type.Object({
  success: Type.Boolean(),
});
export type AuthDeploymentAuthorityRejectResponse = StaticDecode<
  typeof AuthDeploymentAuthorityRejectResponseSchema
>;

export const AuthDeploymentAuthorityReconcileSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  desiredVersion: Type.Optional(Type.String({ minLength: 1 })),
});
export type AuthDeploymentAuthorityReconcileInput = StaticDecode<
  typeof AuthDeploymentAuthorityReconcileSchema
>;

export const AuthDeploymentAuthorityReconcileResponseSchema = Type.Object({
  authority: DeploymentAuthoritySchema,
  materializedAuthority: DeploymentAuthorityMaterializationSchema,
  reconciliation: Type.Optional(DeploymentAuthorityReconciliationStatusSchema),
});
export type AuthDeploymentAuthorityReconcileResponse = StaticDecode<
  typeof AuthDeploymentAuthorityReconcileResponseSchema
>;

export const AuthDeploymentAuthorityGrantOverridesPutSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  overrides: Type.Array(DeploymentAuthorityGrantOverrideSchema),
});
export type AuthDeploymentAuthorityGrantOverridesPutInput = StaticDecode<
  typeof AuthDeploymentAuthorityGrantOverridesPutSchema
>;

export const AuthDeploymentAuthorityGrantOverridesListSchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export type AuthDeploymentAuthorityGrantOverridesListInput = StaticDecode<
  typeof AuthDeploymentAuthorityGrantOverridesListSchema
>;

export const AuthDeploymentAuthorityGrantOverridesListResponseSchema = Type
  .Object({
    ...PageResponseSchema(DeploymentAuthorityGrantOverrideSchema).properties,
  });
export type AuthDeploymentAuthorityGrantOverridesListResponse = StaticDecode<
  typeof AuthDeploymentAuthorityGrantOverridesListResponseSchema
>;

export const AuthDeploymentAuthorityGrantOverridesResponseSchema = Type.Object({
  grantOverrides: Type.Array(DeploymentAuthorityGrantOverrideSchema),
});
export type AuthDeploymentAuthorityGrantOverridesResponse = StaticDecode<
  typeof AuthDeploymentAuthorityGrantOverridesResponseSchema
>;

export const AuthDeploymentAuthorityGrantOverridesRemoveSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  overrides: Type.Array(DeploymentAuthorityGrantOverrideSchema),
});
export type AuthDeploymentAuthorityGrantOverridesRemoveInput = StaticDecode<
  typeof AuthDeploymentAuthorityGrantOverridesRemoveSchema
>;

export const AuthServiceInstancesProvisionSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  instanceKey: Type.String({ minLength: 1 }),
});
export const AuthServiceInstancesProvisionResponseSchema = Type.Object({
  instance: ServiceInstanceSchema,
});

export const AuthServiceInstancesListSchema = Type.Object({
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  disabled: Type.Optional(Type.Boolean()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthServiceInstancesListResponseSchema = Type.Object({
  ...PageResponseSchema(ServiceInstanceSchema).properties,
});

export const AuthServiceInstancesDisableSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthServiceInstancesDisableResponseSchema = Type.Object({
  instance: ServiceInstanceSchema,
});

export const AuthServiceInstancesEnableSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthServiceInstancesEnableResponseSchema = Type.Object({
  instance: ServiceInstanceSchema,
});

export const AuthServiceInstancesRemoveSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthServiceInstancesRemoveResponseSchema = Type.Object({
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
  observeCapabilities: Type.Array(Type.String()),
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

export const AuthenticatedUserSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  active: Type.Boolean(),
  name: Type.String(),
  email: Type.String(),
  image: Type.Optional(Type.String()),
  capabilities: Type.Array(Type.String()),
  identity: Type.Object({
    identityId: Type.String({ minLength: 1 }),
    provider: Type.String({ minLength: 1 }),
    subject: Type.String({ minLength: 1 }),
  }),
  lastLogin: Type.Optional(IsoDateStringSchema),
});
export type AuthenticatedUser = StaticDecode<typeof AuthenticatedUserSchema>;

export const AuthSessionsMeSchema = Type.Object({});

export const AuthRequestsValidateSchema = Type.Object({
  sessionKey: Type.String({ minLength: 1 }),
  proof: Type.String({ minLength: 1 }),
  subject: Type.String({ minLength: 1 }),
  payloadHash: Type.String({ minLength: 1 }),
  iat: Type.Integer(),
  requestId: Type.String({ minLength: 1 }),
  capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
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

export const AuthSessionsMeResponseSchema = Type.Object({
  participantKind: ParticipantKindSchema,
  user: NullableAuthenticatedUserSchema,
  device: NullableAuthenticatedDeviceSchema,
  service: NullableAuthenticatedServiceSchema,
});
export type AuthSessionsMeResponse = StaticDecode<
  typeof AuthSessionsMeResponseSchema
>;

export const CallerViewSchema = Type.Union([
  Type.Object({
    type: Type.Literal("user"),
    participantKind: UserParticipantKindSchema,
    userId: Type.String({ minLength: 1 }),
    identity: Type.Object({
      identityId: Type.String({ minLength: 1 }),
      provider: Type.String({ minLength: 1 }),
      subject: Type.String({ minLength: 1 }),
    }),
    active: Type.Boolean(),
    name: Type.String(),
    email: Type.String(),
    image: Type.Optional(Type.String()),
    capabilities: Type.Array(Type.String()),
    lastAuth: IsoDateStringSchema,
  }),
  AuthenticatedServiceSchema,
  AuthenticatedDeviceSchema,
]);

export const AuthRequestsValidateResponseSchema = Type.Object({
  allowed: Type.Boolean(),
  inboxPrefix: Type.String(),
  caller: CallerViewSchema,
});

export const AuthIdentitiesListSchema = Type.Object({
  user: Type.Optional(Type.String({ minLength: 1 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthIdentitiesListResponseSchema = Type.Object({
  ...PageResponseSchema(ApprovalRecordViewSchema).properties,
});

export const AuthIdentityGrantsRevokeSchema = Type.Object({
  identityGrantId: Type.String({ minLength: 1 }),
  user: Type.Optional(Type.String({ minLength: 1 })),
});
export const AuthIdentityGrantsRevokeResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const IdentityGrantViewSchema = Type.Object({
  identityGrantId: Type.String({ minLength: 1 }),
  identityAnchor: IdentityAnchorViewSchema,
  contractEvidence: ContractEvidenceViewSchema,
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  participantKind: UserParticipantKindSchema,
  capabilities: Type.Array(Type.String()),
  grantedAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});
export type IdentityGrantView = StaticDecode<typeof IdentityGrantViewSchema>;

export const AuthIdentityGrantsListSchema = Type.Object({
  user: Type.Optional(Type.String({ minLength: 1 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthIdentityGrantsListResponseSchema = Type.Object({
  ...PageResponseSchema(IdentityGrantViewSchema).properties,
});

export const LoginPortalRecordSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  entryUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  builtIn: Type.Boolean(),
  disabled: Type.Boolean(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});
export type LoginPortalRecord = StaticDecode<typeof LoginPortalRecordSchema>;

export const LoginPortalSettingsSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  localRegistrationEnabled: Type.Boolean(),
  federatedRegistrationEnabled: Type.Boolean(),
  allowedFederatedProviders: Type.Union([
    Type.Array(Type.String({ minLength: 1 })),
    Type.Null(),
  ]),
  selfRegisteredAccountActive: Type.Boolean(),
  updatedAt: IsoDateStringSchema,
});
export type LoginPortalSettings = StaticDecode<
  typeof LoginPortalSettingsSchema
>;

export const LoginPortalFederatedProviderSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  type: Type.String({ minLength: 1 }),
});

export const LoginPortalRouteSchema = Type.Object({
  routeKey: Type.String({ minLength: 1 }),
  portalId: Type.String({ minLength: 1 }),
  contractId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  origin: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  disabled: Type.Boolean(),
  updatedAt: IsoDateStringSchema,
});
export type LoginPortalRoute = StaticDecode<typeof LoginPortalRouteSchema>;

export const LoginPortalSummarySchema = Type.Object({
  ...LoginPortalRecordSchema.properties,
  routeCount: Type.Integer({ minimum: 0 }),
  activeRouteCount: Type.Integer({ minimum: 0 }),
});
export type LoginPortalSummary = StaticDecode<
  typeof LoginPortalSummarySchema
>;

export const AuthPortalsListSchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthPortalsListResponseSchema = Type.Object({
  ...PageResponseSchema(LoginPortalSummarySchema).properties,
});
export const AuthPortalsGetSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
});
export const AuthPortalsGetResponseSchema = Type.Object({
  portal: LoginPortalRecordSchema,
  settings: LoginPortalSettingsSchema,
  routes: Type.Array(LoginPortalRouteSchema),
  defaultCapabilities: Type.Array(Type.String({ minLength: 1 })),
  defaultCapabilityGroups: Type.Array(Type.String({ minLength: 1 })),
  federatedProviders: Type.Array(LoginPortalFederatedProviderSchema),
});
export const AuthPortalsPutSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  entryUrl: Type.String({ minLength: 1 }),
  disabled: Type.Optional(Type.Boolean()),
});
export const AuthPortalsPutResponseSchema = Type.Object({
  portal: LoginPortalRecordSchema,
});
export const AuthPortalsRemoveSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
});
export const AuthPortalsRemoveResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthPortalsLoginSettingsGetSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
});
export const AuthPortalsLoginSettingsResponseSchema = Type.Object({
  portal: LoginPortalRecordSchema,
  settings: LoginPortalSettingsSchema,
  defaultCapabilities: Type.Array(Type.String({ minLength: 1 })),
  defaultCapabilityGroups: Type.Array(Type.String({ minLength: 1 })),
  federatedProviders: Type.Array(LoginPortalFederatedProviderSchema),
});
export const AuthPortalsLoginSettingsUpdateSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  localRegistrationEnabled: Type.Boolean(),
  federatedRegistrationEnabled: Type.Boolean(),
  allowedFederatedProviders: Type.Union([
    Type.Array(Type.String({ minLength: 1 })),
    Type.Null(),
  ]),
  selfRegisteredAccountActive: Type.Boolean(),
  defaultCapabilities: Type.Array(Type.String({ minLength: 1 })),
  defaultCapabilityGroups: Type.Array(Type.String({ minLength: 1 })),
});

export const AuthPortalsRoutesPutSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  contractId: Type.Optional(Type.Union([
    Type.String({ minLength: 1 }),
    Type.Null(),
  ])),
  origin: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
  disabled: Type.Optional(Type.Boolean()),
});
export const AuthPortalsRoutesPutResponseSchema = Type.Object({
  route: LoginPortalRouteSchema,
});
export const AuthPortalsRoutesRemoveSchema = Type.Object({
  portalId: Type.String({ minLength: 1 }),
  contractId: Type.Optional(Type.Union([
    Type.String({ minLength: 1 }),
    Type.Null(),
  ])),
  origin: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
});
export const AuthPortalsRoutesRemoveResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const FlowRegistrationAvailabilitySchema = Type.Object({
  localIdentity: Type.Object({
    available: Type.Boolean(),
  }),
  federatedIdentity: Type.Object({
    available: Type.Boolean(),
    providers: Type.Array(Type.Object({
      id: Type.String({ minLength: 1 }),
      displayName: Type.String({ minLength: 1 }),
    })),
  }),
});
export type FlowRegistrationAvailability = StaticDecode<
  typeof FlowRegistrationAvailabilitySchema
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
    portal: Type.Optional(LoginPortalRecordSchema),
    registration: Type.Optional(FlowRegistrationAvailabilitySchema),
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
    approval: ApprovalEvidenceViewSchema,
  }),
  Type.Object({
    status: Type.Literal("approval_denied"),
    flowId: Type.String({ minLength: 1 }),
    approval: ApprovalEvidenceViewSchema,
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
    approval: ApprovalEvidenceViewSchema,
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
    returnLocation: Type.Optional(Type.String({ minLength: 1 })),
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

export const DeviceDeploymentSchema = Type.Unsafe<{
  deploymentId: string;
  reviewMode?: "none" | "required";
  disabled: boolean;
}>(Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  reviewMode: Type.Optional(
    Type.Union([Type.Literal("none"), Type.Literal("required")]),
  ),
  disabled: Type.Boolean(),
}));

export const AuthDeploymentKindSchema = Type.Union([
  Type.Literal("service"),
  Type.Literal("device"),
]);
export type AuthDeploymentKind = StaticDecode<typeof AuthDeploymentKindSchema>;

export const AuthDeploymentSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("service"),
    deploymentId: Type.String({ minLength: 1 }),
    namespaces: Type.Array(Type.String({ minLength: 1 })),
    contractCompatibilityMode: Type.Optional(
      Type.Union([Type.Literal("strict"), Type.Literal("mutable-dev")]),
    ),
    disabled: Type.Boolean(),
  }),
  Type.Object({
    kind: Type.Literal("device"),
    deploymentId: Type.String({ minLength: 1 }),
    reviewMode: Type.Optional(
      Type.Union([Type.Literal("none"), Type.Literal("required")]),
    ),
    disabled: Type.Boolean(),
  }),
]);
export type AuthDeployment = StaticDecode<typeof AuthDeploymentSchema>;

export const AuthDeploymentsCreateSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("service"),
    deploymentId: Type.String({ minLength: 1 }),
    namespaces: Type.Array(Type.String({ minLength: 1 })),
    contractCompatibilityMode: Type.Optional(
      Type.Union([Type.Literal("strict"), Type.Literal("mutable-dev")]),
    ),
  }),
  Type.Object({
    kind: Type.Literal("device"),
    deploymentId: Type.String({ minLength: 1 }),
    reviewMode: Type.Optional(
      Type.Union([Type.Literal("none"), Type.Literal("required")]),
    ),
  }),
]);
export const AuthDeploymentsCreateResponseSchema = Type.Object({
  deployment: AuthDeploymentSchema,
});

export const AuthDeploymentsListSchema = Type.Object({
  kind: Type.Optional(AuthDeploymentKindSchema),
  disabled: Type.Optional(Type.Boolean()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthDeploymentsListResponseSchema = Type.Object({
  ...PageResponseSchema(AuthDeploymentSchema).properties,
});

export const AuthDeploymentsDisableSchema = Type.Object({
  kind: AuthDeploymentKindSchema,
  deploymentId: Type.String({ minLength: 1 }),
});
export const AuthDeploymentsDisableResponseSchema = Type.Object({
  deployment: AuthDeploymentSchema,
});

export const AuthCatalogIssuesResolveSchema = Type.Object({
  issueId: Type.String({ minLength: 1 }),
  action: Type.Union([
    Type.Literal("keep-current"),
    Type.Literal("force-replace"),
  ]),
});
export const AuthCatalogIssuesResolveResponseSchema = Type.Object({
  success: Type.Literal(true),
  issueId: Type.String({ minLength: 1 }),
  action: Type.Union([
    Type.Literal("keep-current"),
    Type.Literal("force-replace"),
  ]),
});

export const AuthDeploymentsEnableSchema = Type.Object({
  kind: AuthDeploymentKindSchema,
  deploymentId: Type.String({ minLength: 1 }),
});
export const AuthDeploymentsEnableResponseSchema = Type.Object({
  deployment: AuthDeploymentSchema,
});

export const AuthDeploymentsRemoveSchema = Type.Object({
  kind: AuthDeploymentKindSchema,
  deploymentId: Type.String({ minLength: 1 }),
  cascade: Type.Optional(Type.Boolean()),
  purgeUnusedContracts: Type.Optional(Type.Boolean()),
});
export const AuthDeploymentsRemoveResponseSchema = Type.Object({
  success: Type.Boolean(),
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
  createdAt: IsoDateStringSchema,
  activatedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
  revokedAt: Type.Union([IsoDateStringSchema, Type.Null()]),
});

export const DeviceActivationActorSchema = Type.Object({
  participantKind: UserParticipantKindSchema,
  userId: Type.String({ minLength: 1 }),
  identity: Type.Object({
    identityId: Type.String({ minLength: 1 }),
    provider: Type.String({ minLength: 1 }),
    subject: Type.String({ minLength: 1 }),
  }),
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

export const AuthDeviceUserAuthoritiesReviewRequestedEventSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  flowId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  requestedAt: IsoDateStringSchema,
  requestedBy: DeviceActivationActorSchema,
});

export const AuthDeviceUserAuthoritiesRequestedEventSchema = Type.Object({
  flowId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  requestedAt: IsoDateStringSchema,
  requestedBy: DeviceActivationActorSchema,
});

export const AuthDeviceUserAuthoritiesApprovedEventSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  flowId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  requestedAt: IsoDateStringSchema,
  approvedAt: IsoDateStringSchema,
  requestedBy: DeviceActivationActorSchema,
  approvedBy: DeviceActivationActorSchema,
});

export const AuthDeviceUserAuthoritiesResolvedEventSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  resolvedAt: IsoDateStringSchema,
  resolvedBy: DeviceActivationActorSchema,
  flowId: Type.Optional(Type.String({ minLength: 1 })),
  reviewId: Type.Optional(Type.String({ minLength: 1 })),
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
    authority: Type.Union([
      Type.Literal("admin_reviewed"),
      Type.Literal("user_delegated"),
    ]),
    iatSkewSeconds: Type.Number(),
  }),
});

export const AuthDevicesProvisionSchema = Type.Object({
  deploymentId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  activationKey: Type.String({ minLength: 1 }),
  metadata: Type.Optional(DeviceMetadataSchema),
});
export const AuthDevicesProvisionResponseSchema = Type.Object({
  instance: DeviceSchema,
});
export const AuthDevicesListSchema = Type.Object({
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(Type.Union([
    Type.Literal("registered"),
    Type.Literal("activated"),
    Type.Literal("revoked"),
    Type.Literal("disabled"),
  ])),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthDevicesListResponseSchema = Type.Object({
  ...PageResponseSchema(DeviceSchema).properties,
});
export const AuthDevicesDisableSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthDevicesDisableResponseSchema = Type.Object({
  instance: DeviceSchema,
});
export const AuthDevicesEnableSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthDevicesEnableResponseSchema = Type.Object({
  instance: DeviceSchema,
});
export const AuthDevicesRemoveSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthDevicesRemoveResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthResolveDeviceUserAuthoritiesSchema = Type.Object({
  flowId: Type.String({ minLength: 1 }),
});
export const AuthResolveDeviceUserAuthoritiesProgressSchema = Type.Object({
  status: Type.Literal("pending_review"),
  reviewId: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  requestedAt: IsoDateStringSchema,
});
export const AuthResolveDeviceUserAuthoritiesResponseSchema = Type.Union([
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

export const WaitForDeviceActivationRequestSchema = Type.Object({
  flowId: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  iat: Type.Number(),
  sig: Type.String({ minLength: 1 }),
});

export const AuthDevicesConnectInfoGetSchema = Type.Object({
  publicIdentityKey: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  iat: Type.Number(),
  sig: Type.String({ minLength: 1 }),
});
export const AuthDevicesConnectInfoGetResponseSchema = Type.Object({
  status: Type.Literal("ready"),
  connectInfo: DeviceConnectInfoSchema,
});

export const AuthDeviceUserAuthoritiesListSchema = Type.Object({
  instanceId: Type.Optional(Type.String({ minLength: 1 })),
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(
    Type.Union([Type.Literal("activated"), Type.Literal("revoked")]),
  ),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthDeviceUserAuthoritiesListResponseSchema = Type.Object({
  ...PageResponseSchema(DeviceActivationRecordSchema).properties,
});
export const AuthDeviceUserAuthoritiesRevokeSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
});
export const AuthDeviceUserAuthoritiesRevokeResponseSchema = Type.Object({
  success: Type.Boolean(),
});
export const AuthDeviceUserAuthoritiesReviewsListSchema = Type.Object({
  instanceId: Type.Optional(Type.String({ minLength: 1 })),
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(Type.Union([
    Type.Literal("pending"),
    Type.Literal("approved"),
    Type.Literal("rejected"),
  ])),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthDeviceUserAuthoritiesReviewsListResponseSchema = Type.Object({
  ...PageResponseSchema(DeviceActivationReviewSchema).properties,
});
export const AuthDeviceUserAuthoritiesReviewsDecideSchema = Type.Object({
  reviewId: Type.String({ minLength: 1 }),
  decision: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
  reason: Type.Optional(Type.String({ minLength: 1 })),
});
export const AuthDeviceUserAuthoritiesReviewsDecideResponseSchema = Type.Object(
  {
    review: DeviceActivationReviewSchema,
    activation: Type.Optional(DeviceActivationRecordSchema),
    confirmationCode: Type.Optional(Type.String({ minLength: 1 })),
  },
);

export const UserIdentityViewSchema = Type.Object({
  identityId: Type.String({ minLength: 1 }),
  provider: Type.String({ minLength: 1 }),
  subject: Type.String({ minLength: 1 }),
  displayName: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  email: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  emailVerified: Type.Boolean(),
  linkedAt: IsoDateStringSchema,
  lastLoginAt: Type.Union([IsoDateStringSchema, Type.Null()]),
});

export const UserViewSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
  capabilityGroups: Type.Array(Type.String()),
  identities: Type.Array(UserIdentityViewSchema),
});

export const AuthUsersListSchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthUsersListResponseSchema = Type.Object({
  ...PageResponseSchema(UserViewSchema).properties,
});

export const AuthUsersGetSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
});
export const AuthUsersGetResponseSchema = Type.Object({
  user: UserViewSchema,
});

export const AuthUsersCreateSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  email: Type.Optional(Type.String({ minLength: 1 })),
  username: Type.Optional(Type.String({ minLength: 1 })),
  active: Type.Optional(Type.Boolean()),
  capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  capabilityGroups: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export const AuthUsersCreateResponseSchema = Type.Object({
  user: UserViewSchema,
});

export const AuthUsersIdentityLinkCreateSchema = Type.Object({
  returnTo: Type.Optional(Type.String({ minLength: 1 })),
});

export const AuthUsersPasswordChangeSchema = Type.Object({
  currentPassword: Type.String({ minLength: 1 }),
  newPassword: Type.String({ minLength: 1 }),
});

export const AuthUsersPasswordChangeResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthUsersPasswordResetCreateSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  expiresInSeconds: Type.Optional(
    Type.Integer({ minimum: 60, maximum: 2592000 }),
  ),
});

export const AuthUsersAccountFlowCreateResponseSchema = Type.Object({
  flowId: Type.String({ minLength: 1 }),
  url: Type.String({ minLength: 1 }),
  expiresAt: IsoDateStringSchema,
});

export const CapabilityDefinitionSchema = Type.Object({
  deploymentId: Type.Optional(Type.String({ minLength: 1 })),
  key: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  consequence: Type.Optional(Type.String({ minLength: 1 })),
  source: Type.Union([Type.Literal("contract"), Type.Literal("platform")]),
  contractId: Type.Optional(Type.String({ minLength: 1 })),
  contractDigest: Type.Optional(DigestSchema),
  contractDisplayName: Type.Optional(Type.String({ minLength: 1 })),
  direction: Type.Optional(DeploymentAuthorityCapabilityDirectionSchema),
});

export const AuthCapabilitiesListSchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthCapabilitiesListResponseSchema = Type.Object({
  ...PageResponseSchema(CapabilityDefinitionSchema).properties,
});

export const CapabilityGroupSchema = Type.Object({
  groupKey: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  capabilities: Type.Array(Type.String({ minLength: 1 })),
  includedGroups: Type.Array(Type.String({ minLength: 1 })),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
});

export const AuthCapabilityGroupsListSchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthCapabilityGroupsListResponseSchema = Type.Object({
  ...PageResponseSchema(CapabilityGroupSchema).properties,
});

export const AuthCapabilityGroupsGetSchema = Type.Object({
  groupKey: Type.String({ minLength: 1 }),
});
export const AuthCapabilityGroupsGetResponseSchema = Type.Object({
  group: CapabilityGroupSchema,
});

export const AuthCapabilityGroupsPutSchema = Type.Object({
  groupKey: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  includedGroups: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export const AuthCapabilityGroupsPutResponseSchema = Type.Object({
  group: CapabilityGroupSchema,
});

export const AuthCapabilityGroupsDeleteSchema = Type.Object({
  groupKey: Type.String({ minLength: 1 }),
});
export const AuthCapabilityGroupsDeleteResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthUsersUpdateSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  active: Type.Optional(Type.Boolean()),
  capabilities: Type.Optional(Type.Array(Type.String())),
  capabilityGroups: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
});
export const AuthUsersUpdateResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export const AuthUserIdentitiesListSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0, maximum: 500 }),
});
export const AuthUserIdentitiesListResponseSchema = Type.Object({
  ...PageResponseSchema(UserIdentityViewSchema).properties,
});

export const AuthUserIdentitiesUnlinkSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  identityId: Type.String({ minLength: 1 }),
});
export const AuthUserIdentitiesUnlinkResponseSchema = Type.Object({
  success: Type.Boolean(),
});
