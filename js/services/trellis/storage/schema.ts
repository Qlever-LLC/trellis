import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
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
    trellisId: text("trellis_id").notNull().unique(),
    origin: text("origin").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name"),
    email: text("email"),
    active: integer("active", { mode: "boolean" }).notNull(),
    capabilities: text("capabilities").notNull(),
  },
);

export const contractApprovals = sqliteTable(
  "contract_approvals",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    userTrellisId: text("user_trellis_id").notNull(),
    origin: text("origin").notNull(),
    externalId: text("external_id").notNull(),
    contractDigest: text("contract_digest").notNull(),
    contractId: text("contract_id").notNull(),
    participantKind: text("participant_kind").notNull(),
    answer: text("answer").notNull(),
    answeredAt: text("answered_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    approval: text("approval").notNull(),
    publishSubjects: text("publish_subjects").notNull(),
    subscribeSubjects: text("subscribe_subjects").notNull(),
  },
  (table) => [
    unique("contract_approvals_user_digest_unique").on(
      table.userTrellisId,
      table.contractDigest,
    ),
  ],
);

export const portals = sqliteTable(
  "portals",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    portalId: text("portal_id").notNull().unique(),
    entryUrl: text("entry_url").notNull(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
  },
);

export const portalProfiles = sqliteTable(
  "portal_profiles",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    portalId: text("portal_id").notNull().unique(),
    entryUrl: text("entry_url").notNull(),
    contractId: text("contract_id").notNull(),
    allowedOrigins: text("allowed_origins"),
    impliedCapabilities: text("implied_capabilities").notNull(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const portalDefaults = sqliteTable(
  "portal_defaults",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    defaultKey: text("default_key").notNull().unique(),
    portalId: text("portal_id"),
  },
);

export const loginPortalSelections = sqliteTable(
  "login_portal_selections",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    selectionKey: text("selection_key").notNull().unique(),
    contractId: text("contract_id").notNull().unique(),
    portalId: text("portal_id"),
  },
);

export const devicePortalSelections = sqliteTable(
  "device_portal_selections",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    selectionKey: text("selection_key").notNull().unique(),
    deploymentId: text("deployment_id").notNull().unique(),
    portalId: text("portal_id"),
  },
);

export const instanceGrantPolicies = sqliteTable(
  "instance_grant_policies",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    contractId: text("contract_id").notNull().unique(),
    allowedOrigins: text("allowed_origins"),
    impliedCapabilities: text("implied_capabilities").notNull(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    source: text("source").notNull(),
  },
);

export const serviceDeployments = sqliteTable(
  "service_deployments",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    deploymentId: text("deployment_id").notNull().unique(),
    namespaces: text("namespaces").notNull(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    appliedContracts: text("applied_contracts").notNull(),
  },
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
);

export const deviceDeployments = sqliteTable(
  "device_deployments",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    deploymentId: text("deployment_id").notNull().unique(),
    reviewMode: text("review_mode"),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
    appliedContracts: text("applied_contracts").notNull(),
  },
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
);

export const deviceActivationReviews = sqliteTable(
  "device_activation_reviews",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    reviewId: text("review_id").notNull().unique(),
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
  ],
);

export const schema = {
  contracts,
  users,
  contractApprovals,
  portals,
  portalProfiles,
  portalDefaults,
  loginPortalSelections,
  devicePortalSelections,
  instanceGrantPolicies,
  serviceDeployments,
  serviceInstances,
  deviceDeployments,
  deviceInstances,
  deviceProvisioningSecrets,
  deviceActivations,
  deviceActivationReviews,
  sessions,
};
