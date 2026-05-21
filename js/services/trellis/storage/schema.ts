import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { ulid } from "ulid";

export const contracts = sqliteTable(
  "contracts",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    digest: text("digest").notNull().unique(),
    contractId: text("contract_id").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    installedAt: text("installed_at").notNull(),
    contract: text("contract").notNull(),
    resources: text("resources"),
    analysisSummary: text("analysis_summary"),
    analysis: text("analysis"),
  },
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    userId: text("user_id").notNull().unique(),
    name: text("name"),
    email: text("email"),
    active: integer("active", { mode: "boolean" }).notNull(),
    capabilities: text("capabilities").notNull(),
    capabilityGroups: text("capability_groups").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("users_active_idx").on(table.active)],
);

export const capabilityGroups = sqliteTable(
  "capability_groups",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    groupKey: text("group_key").notNull().unique(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    capabilities: text("capabilities").notNull(),
    includedGroups: text("included_groups").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("capability_groups_group_key_idx").on(table.groupKey)],
);

export const userIdentities = sqliteTable(
  "user_identities",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    identityId: text("identity_id").notNull().unique(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    displayName: text("display_name"),
    email: text("email"),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
    linkedAt: text("linked_at").notNull(),
    lastLoginAt: text("last_login_at"),
  },
  (table) => [
    unique("user_identities_provider_subject_unique").on(
      table.provider,
      table.subject,
    ),
    index("user_identities_user_id_idx").on(table.userId),
  ],
);

export const localCredentials = sqliteTable(
  "local_credentials",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    identityId: text("identity_id").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    passwordAlgorithm: text("password_algorithm").notNull(),
    passwordParams: text("password_params").notNull(),
    passwordSetAt: text("password_set_at").notNull(),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull(),
    failedLoginCount: integer("failed_login_count").notNull(),
    lockedUntil: text("locked_until"),
    updatedAt: text("updated_at").notNull(),
  },
);

export const accountFlows = sqliteTable(
  "account_flows",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    flowIdHash: text("flow_id_hash").notNull().unique(),
    kind: text("kind").notNull(),
    targetUserId: text("target_user_id"),
    targetIdentityId: text("target_identity_id"),
    targetLocalUsername: text("target_local_username"),
    createdByUserId: text("created_by_user_id"),
    allowedProviders: text("allowed_providers"),
    capabilities: text("capabilities"),
    profileHint: text("profile_hint"),
    returnTo: text("return_to"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => [
    index("account_flows_kind_idx").on(table.kind),
    index("account_flows_target_user_id_idx").on(table.targetUserId),
    index("account_flows_expires_at_idx").on(table.expiresAt),
    index("account_flows_consumed_expires_idx").on(
      table.consumedAt,
      table.expiresAt,
    ),
  ],
);

export const identityEnvelopes = sqliteTable(
  "identity_envelopes",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    identityEnvelopeId: text("identity_envelope_id").notNull().unique(),
    userTrellisId: text("user_trellis_id").notNull(),
    origin: text("origin").notNull(),
    externalId: text("external_id").notNull(),
    identityAnchorKind: text("identity_anchor_kind").notNull(),
    identityAnchor: text("identity_anchor").notNull(),
    evidenceContractDigest: text("evidence_contract_digest").notNull(),
    contractId: text("contract_id").notNull(),
    participantKind: text("participant_kind").notNull(),
    answer: text("answer").notNull(),
    answeredAt: text("answered_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    approvalEvidence: text("approval_evidence").notNull(),
    publishSubjects: text("publish_subjects").notNull(),
    subscribeSubjects: text("subscribe_subjects").notNull(),
  },
  (table) => [
    unique("identity_envelopes_user_anchor_unique").on(
      table.userTrellisId,
      table.identityAnchorKind,
      table.identityAnchor,
    ),
    index("identity_envelopes_answer_idx").on(table.answer),
    index("identity_envelopes_answer_evidence_digest_idx").on(
      table.answer,
      table.evidenceContractDigest,
    ),
  ],
);

export const serviceDeployments = sqliteTable(
  "service_deployments",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    deploymentId: text("deployment_id").notNull().unique(),
    namespaces: text("namespaces").notNull(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
  },
  (table) => [index("service_deployments_disabled_idx").on(table.disabled)],
);

export const serviceInstances = sqliteTable(
  "service_instances",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    instanceId: text("instance_id").notNull().unique(),
    deploymentId: text("deployment_id").notNull(),
    instanceKey: text("instance_key").notNull().unique(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    currentContractId: text("current_contract_id"),
    currentContractDigest: text("current_contract_digest"),
    capabilities: text("capabilities").notNull(),
    resourceBindings: text("resource_bindings"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("service_instances_deployment_id_idx").on(table.deploymentId),
    index("service_instances_disabled_idx").on(table.disabled),
    index("service_instances_current_contract_digest_idx").on(
      table.currentContractDigest,
    ),
    index("service_instances_deployment_disabled_idx").on(
      table.deploymentId,
      table.disabled,
    ),
    index("service_instances_deployment_digest_idx").on(
      table.deploymentId,
      table.currentContractDigest,
    ),
    index("service_instances_deployment_digest_disabled_idx").on(
      table.deploymentId,
      table.currentContractDigest,
      table.disabled,
    ),
  ],
);

export const deviceDeployments = sqliteTable(
  "device_deployments",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    deploymentId: text("deployment_id").notNull().unique(),
    reviewMode: text("review_mode"),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
  },
  (table) => [index("device_deployments_disabled_idx").on(table.disabled)],
);

export const deviceInstances = sqliteTable(
  "device_instances",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    instanceId: text("instance_id").notNull().unique(),
    publicIdentityKey: text("public_identity_key").notNull().unique(),
    deploymentId: text("deployment_id").notNull(),
    metadata: text("metadata"),
    state: text("state").notNull(),
    createdAt: text("created_at").notNull(),
    activatedAt: text("activated_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("device_instances_deployment_id_idx").on(table.deploymentId),
    index("device_instances_state_idx").on(table.state),
    index("device_instances_deployment_state_idx").on(
      table.deploymentId,
      table.state,
    ),
  ],
);

export const deviceProvisioningSecrets = sqliteTable(
  "device_provisioning_secrets",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    instanceId: text("instance_id").notNull().unique(),
    activationKey: text("activation_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
);

export const deviceActivations = sqliteTable(
  "device_activations",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    instanceId: text("instance_id").notNull().unique(),
    publicIdentityKey: text("public_identity_key").notNull().unique(),
    deploymentId: text("deployment_id").notNull(),
    activatedBy: text("activated_by"),
    state: text("state").notNull(),
    activatedAt: text("activated_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("device_activations_deployment_state_idx").on(
      table.deploymentId,
      table.state,
    ),
    index("device_activations_state_idx").on(table.state),
  ],
);

export const deviceActivationReviews = sqliteTable(
  "device_activation_reviews",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    reviewId: text("review_id").notNull().unique(),
    operationId: text("operation_id").notNull().unique(),
    flowId: text("flow_id").notNull().unique(),
    instanceId: text("instance_id").notNull(),
    publicIdentityKey: text("public_identity_key").notNull(),
    deploymentId: text("deployment_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    state: text("state").notNull(),
    requestedAt: text("requested_at").notNull(),
    decidedAt: text("decided_at"),
    reason: text("reason"),
  },
  (table) => [
    index("device_activation_reviews_instance_state_idx").on(
      table.instanceId,
      table.state,
    ),
    index("device_activation_reviews_deployment_state_idx").on(
      table.deploymentId,
      table.state,
    ),
  ],
);

export const deploymentEnvelopes = sqliteTable(
  "deployment_envelopes",
  {
    deploymentId: text("deployment_id").primaryKey(),
    kind: text("kind").notNull(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("deployment_envelopes_disabled_idx").on(table.disabled),
    index("deployment_envelopes_kind_disabled_idx").on(
      table.kind,
      table.disabled,
    ),
  ],
);

export const deploymentEnvelopeContracts = sqliteTable(
  "deployment_envelope_contracts",
  {
    deploymentId: text("deployment_id").notNull(),
    contractId: text("contract_id").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.contractId] }),
    index("deployment_envelope_contracts_contract_deployment_idx").on(
      table.contractId,
      table.deploymentId,
    ),
  ],
);

export const deploymentEnvelopeSurfaces = sqliteTable(
  "deployment_envelope_surfaces",
  {
    deploymentId: text("deployment_id").notNull(),
    contractId: text("contract_id").notNull(),
    surfaceKind: text("surface_kind").notNull(),
    surfaceName: text("surface_name").notNull(),
    action: text("action").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.deploymentId,
        table.contractId,
        table.surfaceKind,
        table.surfaceName,
        table.action,
      ],
    }),
    index("deployment_envelope_surfaces_lookup_idx").on(
      table.contractId,
      table.surfaceKind,
      table.surfaceName,
      table.action,
      table.deploymentId,
    ),
  ],
);

export const deploymentEnvelopeResources = sqliteTable(
  "deployment_envelope_resources",
  {
    deploymentId: text("deployment_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceAlias: text("resource_alias").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.resourceKind, table.resourceAlias],
    }),
  ],
);

export const deploymentEnvelopeCapabilities = sqliteTable(
  "deployment_envelope_capabilities",
  {
    deploymentId: text("deployment_id").notNull(),
    capability: text("capability").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.capability] }),
  ],
);

export const deploymentPortalRoutes = sqliteTable(
  "deployment_portal_routes",
  {
    deploymentId: text("deployment_id").primaryKey(),
    portalId: text("portal_id"),
    entryUrl: text("entry_url"),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const authPortals = sqliteTable(
  "auth_portals",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    portalId: text("portal_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    entryUrl: text("entry_url"),
    builtIn: integer("built_in", { mode: "boolean" }).notNull(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const authLoginPortalSettings = sqliteTable(
  "auth_login_portal_settings",
  {
    portalId: text("portal_id").primaryKey(),
    localRegistrationEnabled: integer("local_registration_enabled", {
      mode: "boolean",
    }).notNull(),
    federatedRegistrationEnabled: integer("federated_registration_enabled", {
      mode: "boolean",
    }).notNull(),
    allowedFederatedProviders: text("allowed_federated_providers"),
    selfRegisteredAccountActive: integer("self_registered_account_active", {
      mode: "boolean",
    }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const authLoginPortalDefaultCapabilities = sqliteTable(
  "auth_login_portal_default_capabilities",
  {
    portalId: text("portal_id").notNull(),
    capability: text("capability").notNull(),
  },
  (table) => [primaryKey({ columns: [table.portalId, table.capability] })],
);

export const authLoginPortalDefaultCapabilityGroups = sqliteTable(
  "auth_login_portal_default_capability_groups",
  {
    portalId: text("portal_id").notNull(),
    groupKey: text("group_key").notNull(),
  },
  (table) => [primaryKey({ columns: [table.portalId, table.groupKey] })],
);

export const authLoginPortalRoutes = sqliteTable(
  "auth_login_portal_routes",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    routeId: text("route_id").notNull().unique(),
    portalId: text("portal_id").notNull(),
    contractId: text("contract_id"),
    origin: text("origin"),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("auth_login_portal_routes_lookup_idx").on(
      table.contractId,
      table.origin,
      table.disabled,
    ),
  ],
);

export const deploymentGrantOverrides = sqliteTable(
  "deployment_grant_overrides",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    deploymentId: text("deployment_id").notNull(),
    grantKey: text("grant_key").notNull().unique(),
    identityKind: text("identity_kind").notNull(),
    grantKind: text("grant_kind").notNull(),
    contractId: text("contract_id"),
    origin: text("origin"),
    sessionPublicKey: text("session_public_key"),
    capability: text("capability"),
    capabilityGroupKey: text("capability_group_key"),
  },
);

export const deploymentResourceBindings = sqliteTable(
  "deployment_resource_bindings",
  {
    deploymentId: text("deployment_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceAlias: text("resource_alias").notNull(),
    bindingJson: text("binding_json").notNull(),
    limitsJson: text("limits_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.resourceKind, table.resourceAlias],
    }),
  ],
);

export const deploymentContractEvidence = sqliteTable(
  "deployment_contract_evidence",
  {
    deploymentId: text("deployment_id").notNull(),
    contractId: text("contract_id").notNull(),
    contractDigest: text("contract_digest").notNull(),
    contractJson: text("contract_json").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    ignoredAt: text("ignored_at"),
    ignoredByJson: text("ignored_by_json"),
    ignoreReason: text("ignore_reason"),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.contractDigest] }),
    index("deployment_contract_evidence_digest_idx").on(
      table.contractDigest,
    ),
    index("deployment_contract_evidence_contract_deployment_idx").on(
      table.contractId,
      table.deploymentId,
    ),
  ],
);

export const envelopeExpansionRequests = sqliteTable(
  "envelope_expansion_requests",
  {
    requestId: text("request_id").primaryKey(),
    pendingKey: text("pending_key").unique(),
    deploymentId: text("deployment_id").notNull(),
    requestedByKind: text("requested_by_kind").notNull(),
    requestedByJson: text("requested_by_json").notNull(),
    contractId: text("contract_id").notNull(),
    contractDigest: text("contract_digest").notNull(),
    contractJson: text("contract_json").notNull(),
    state: text("state").notNull(),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
    decidedByJson: text("decided_by_json"),
    decisionReason: text("decision_reason"),
  },
  (table) => [
    index("envelope_expansion_requests_deployment_state_idx").on(
      table.deploymentId,
      table.state,
    ),
    index("envelope_expansion_requests_state_idx").on(table.state),
  ],
);

export const envelopeExpansionRequestContracts = sqliteTable(
  "envelope_expansion_request_contracts",
  {
    requestId: text("request_id").notNull(),
    contractId: text("contract_id").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.requestId, table.contractId] })],
);

export const envelopeExpansionRequestSurfaces = sqliteTable(
  "envelope_expansion_request_surfaces",
  {
    requestId: text("request_id").notNull(),
    contractId: text("contract_id").notNull(),
    surfaceKind: text("surface_kind").notNull(),
    surfaceName: text("surface_name").notNull(),
    action: text("action").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.requestId,
        table.contractId,
        table.surfaceKind,
        table.surfaceName,
        table.action,
      ],
    }),
  ],
);

export const envelopeExpansionRequestCapabilities = sqliteTable(
  "envelope_expansion_request_capabilities",
  {
    requestId: text("request_id").notNull(),
    capability: text("capability").notNull(),
  },
  (table) => [primaryKey({ columns: [table.requestId, table.capability] })],
);

export const envelopeExpansionRequestResources = sqliteTable(
  "envelope_expansion_request_resources",
  {
    requestId: text("request_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceAlias: text("resource_alias").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.requestId, table.resourceKind, table.resourceAlias],
    }),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    sessionKey: text("session_key").notNull(),
    trellisId: text("trellis_id").notNull(),
    type: text("type").notNull(),
    origin: text("origin"),
    externalId: text("external_id"),
    identityEnvelopeId: text("identity_envelope_id"),
    contractDigest: text("contract_digest"),
    contractId: text("contract_id"),
    participantKind: text("participant_kind"),
    instanceId: text("instance_id"),
    deploymentId: text("deployment_id"),
    instanceKey: text("instance_key"),
    publicIdentityKey: text("public_identity_key"),
    createdAt: text("created_at").notNull(),
    lastAuth: text("last_auth").notNull(),
    revokedAt: text("revoked_at"),
    session: text("session").notNull(),
  },
  (table) => [
    unique("sessions_session_key_unique").on(table.sessionKey),
    index("sessions_trellis_id_idx").on(table.trellisId),
    index("sessions_deployment_id_idx").on(table.deploymentId),
    index("sessions_type_idx").on(table.type),
    index("sessions_contract_digest_idx").on(table.contractDigest),
  ],
);

export const schema = {
  contracts,
  users,
  userIdentities,
  localCredentials,
  accountFlows,
  identityEnvelopes,
  serviceDeployments,
  serviceInstances,
  deviceDeployments,
  deviceInstances,
  deviceProvisioningSecrets,
  deviceActivations,
  deviceActivationReviews,
  deploymentEnvelopes,
  deploymentEnvelopeContracts,
  deploymentEnvelopeSurfaces,
  deploymentEnvelopeResources,
  deploymentEnvelopeCapabilities,
  deploymentPortalRoutes,
  authPortals,
  authLoginPortalSettings,
  authLoginPortalDefaultCapabilities,
  authLoginPortalDefaultCapabilityGroups,
  authLoginPortalRoutes,
  deploymentGrantOverrides,
  deploymentResourceBindings,
  deploymentContractEvidence,
  envelopeExpansionRequests,
  envelopeExpansionRequestContracts,
  envelopeExpansionRequestSurfaces,
  envelopeExpansionRequestCapabilities,
  envelopeExpansionRequestResources,
  sessions,
};
