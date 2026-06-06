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

export const trellisUpgrades = sqliteTable("trellis_upgrades", {
  upgradeId: text("upgrade_id").primaryKey(),
  appliedAt: text("applied_at").notNull(),
  summary: text("summary"),
});

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

export const identityAuthorities = sqliteTable(
  "identity_authorities",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    identityAuthorityId: text("identity_authority_id").notNull().unique(),
    userTrellisId: text("user_trellis_id").notNull(),
    origin: text("origin").notNull(),
    externalId: text("external_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("identity_authorities_user_origin_external_unique").on(
      table.userTrellisId,
      table.origin,
      table.externalId,
    ),
  ],
);

export const identityGrants = sqliteTable(
  "identity_grants",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    identityGrantId: text("identity_grant_id").notNull().unique(),
    identityAuthorityId: text("identity_authority_id").notNull(),
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
    unique("identity_grants_user_anchor_unique").on(
      table.userTrellisId,
      table.identityAnchorKind,
      table.identityAnchor,
    ),
    index("identity_grants_answer_idx").on(table.answer),
    index("identity_grants_answer_evidence_digest_idx").on(
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
    contractCompatibilityMode: text("contract_compatibility_mode").notNull()
      .default("strict"),
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
    capabilities: text("capabilities").notNull(),
    resourceBindings: text("resource_bindings"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("service_instances_deployment_id_idx").on(table.deploymentId),
    index("service_instances_disabled_idx").on(table.disabled),
    index("service_instances_deployment_disabled_idx").on(
      table.deploymentId,
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

export const deploymentAuthorities = sqliteTable(
  "deployment_authorities",
  {
    deploymentId: text("deployment_id").primaryKey(),
    kind: text("kind").notNull(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    version: text("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("deployment_authorities_disabled_idx").on(table.disabled),
    index("deployment_authorities_kind_disabled_idx").on(
      table.kind,
      table.disabled,
    ),
  ],
);

export const deploymentAuthorityContracts = sqliteTable(
  "deployment_authority_contracts",
  {
    deploymentId: text("deployment_id").notNull(),
    contractId: text("contract_id").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.contractId] }),
    index("deployment_authority_contracts_contract_deployment_idx").on(
      table.contractId,
      table.deploymentId,
    ),
  ],
);

export const deploymentAuthoritySurfaces = sqliteTable(
  "deployment_authority_surfaces",
  {
    deploymentId: text("deployment_id").notNull(),
    contractId: text("contract_id").notNull(),
    surfaceKind: text("surface_kind").notNull(),
    surfaceName: text("surface_name").notNull(),
    action: text("action").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
    source: text("source", { enum: ["need", "surface"] }).notNull(),
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
    index("deployment_authority_surfaces_lookup_idx").on(
      table.contractId,
      table.surfaceKind,
      table.surfaceName,
      table.action,
      table.deploymentId,
    ),
  ],
);

export const deploymentAuthorityResources = sqliteTable(
  "deployment_authority_resources",
  {
    deploymentId: text("deployment_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceAlias: text("resource_alias").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
    definitionJson: text("definition_json"),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.resourceKind, table.resourceAlias],
    }),
  ],
);

export const deploymentAuthorityCapabilities = sqliteTable(
  "deployment_authority_capabilities",
  {
    deploymentId: text("deployment_id").notNull(),
    capability: text("capability").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.capability] }),
  ],
);

export const deploymentAuthorityCapabilityDefinitions = sqliteTable(
  "deployment_authority_capability_definitions",
  {
    deploymentId: text("deployment_id").notNull(),
    capability: text("capability").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    consequence: text("consequence"),
    source: text("source").notNull(),
    contractId: text("contract_id").notNull(),
    contractDigest: text("contract_digest").notNull(),
    contractDisplayName: text("contract_display_name"),
    direction: text("direction").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.deploymentId,
        table.capability,
        table.direction,
        table.contractId,
        table.contractDigest,
      ],
    }),
    index("deployment_authority_capability_definitions_lookup_idx").on(
      table.capability,
      table.deploymentId,
      table.contractId,
      table.contractDigest,
    ),
  ],
);

export const deploymentAuthorityPlans = sqliteTable(
  "deployment_authority_plans",
  {
    planId: text("plan_id").primaryKey(),
    deploymentId: text("deployment_id").notNull(),
    classification: text("classification").notNull(),
    state: text("state").notNull(),
    proposalJson: text("proposal_json").notNull(),
    desiredChangeJson: text("desired_change_json").notNull(),
    materializationPreviewJson: text("materialization_preview_json").notNull(),
    warningsJson: text("warnings_json").notNull(),
    acknowledgementRequired: integer("acknowledgement_required", {
      mode: "boolean",
    }),
    decisionAt: text("decision_at"),
    decisionByJson: text("decision_by_json"),
    decisionReason: text("decision_reason"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
  },
  (table) => [
    index("deployment_authority_plans_deployment_state_idx").on(
      table.deploymentId,
      table.state,
    ),
    index("deployment_authority_plans_state_idx").on(table.state),
  ],
);

export const materializedAuthority = sqliteTable(
  "materialized_authority",
  {
    deploymentId: text("deployment_id").primaryKey(),
    desiredVersion: text("desired_version").notNull(),
    status: text("status").notNull(),
    grantsJson: text("grants_json").notNull(),
    reconciledAt: text("reconciled_at"),
    error: text("error"),
  },
);

export const materializedResourceBindings = sqliteTable(
  "materialized_resource_bindings",
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

export const authorityReconciliationStatus = sqliteTable(
  "authority_reconciliation_status",
  {
    deploymentId: text("deployment_id").primaryKey(),
    desiredVersion: text("desired_version").notNull(),
    state: text("state").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    message: text("message"),
  },
  (
    table,
  ) => [index("authority_reconciliation_status_state_idx").on(table.state)],
);

export const authorityReconciliationEvents = sqliteTable(
  "authority_reconciliation_events",
  {
    eventId: text("event_id").primaryKey(),
    deploymentId: text("deployment_id").notNull(),
    desiredVersion: text("desired_version").notNull(),
    state: text("state").notNull(),
    message: text("message"),
    detailsJson: text("details_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("authority_reconciliation_events_deployment_created_idx").on(
      table.deploymentId,
      table.createdAt,
      table.eventId,
    ),
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

export const deploymentAuthorityGrantOverrides = sqliteTable(
  "deployment_authority_grant_overrides",
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
  (table) => [
    index("deployment_authority_grant_overrides_deployment_id_idx").on(
      table.deploymentId,
    ),
  ],
);

export const implementationOffers = sqliteTable(
  "implementation_offers",
  {
    offerId: text("offer_id").primaryKey(),
    deploymentKind: text("deployment_kind").notNull(),
    deploymentId: text("deployment_id").notNull(),
    instanceId: text("instance_id"),
    contractId: text("contract_id").notNull(),
    contractDigest: text("contract_digest").notNull(),
    lineageKey: text("lineage_key").notNull(),
    status: text("status").notNull(),
    liveness: text("liveness").notNull(),
    firstOfferedAt: text("first_offered_at").notNull(),
    acceptedAt: text("accepted_at"),
    lastRefreshedAt: text("last_refreshed_at").notNull(),
    staleAt: text("stale_at"),
    expiresAt: text("expires_at"),
  },
  (table) => [
    index("implementation_offers_lineage_digest_idx").on(
      table.lineageKey,
      table.contractDigest,
    ),
    index("implementation_offers_contract_status_idx").on(
      table.contractId,
      table.status,
    ),
    index("implementation_offers_digest_status_idx").on(
      table.contractDigest,
      table.status,
    ),
    index("implementation_offers_deployment_idx").on(
      table.deploymentKind,
      table.deploymentId,
    ),
    index("implementation_offers_instance_idx").on(table.instanceId),
    index("implementation_offers_lineage_accepted_idx").on(
      table.lineageKey,
      table.acceptedAt,
    ),
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
    identityGrantId: text("identity_grant_id"),
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
  trellisUpgrades,
  users,
  userIdentities,
  localCredentials,
  accountFlows,
  identityAuthorities,
  identityGrants,
  serviceDeployments,
  serviceInstances,
  deviceDeployments,
  deviceInstances,
  deviceProvisioningSecrets,
  deviceActivations,
  deviceActivationReviews,
  deploymentAuthorities,
  deploymentAuthorityContracts,
  deploymentAuthoritySurfaces,
  deploymentAuthorityResources,
  deploymentAuthorityCapabilities,
  deploymentAuthorityCapabilityDefinitions,
  deploymentAuthorityPlans,
  materializedAuthority,
  materializedResourceBindings,
  authorityReconciliationStatus,
  authorityReconciliationEvents,
  deploymentPortalRoutes,
  authPortals,
  authLoginPortalSettings,
  authLoginPortalDefaultCapabilities,
  authLoginPortalDefaultCapabilityGroups,
  authLoginPortalRoutes,
  deploymentAuthorityGrantOverrides,
  implementationOffers,
  sessions,
};
