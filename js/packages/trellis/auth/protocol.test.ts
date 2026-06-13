import { assert, assertEquals, assertFalse } from "@std/assert";
import Value from "typebox/value";

import * as AuthProtocol from "./mod.ts";
import * as GeneratedAuth from "../../../../generated/packages/jsr/auth/mod.ts";
import {
  AuthDeploymentsCreateResponseSchema,
  AuthDeploymentsCreateSchema,
  AuthDeploymentsDisableResponseSchema,
  AuthDeploymentsDisableSchema,
  AuthDeploymentsListResponseSchema,
  AuthDeploymentsListSchema,
  AuthDevicesConnectInfoGetResponseSchema,
  AuthDevicesConnectInfoGetSchema,
  AuthDevicesDisableResponseSchema,
  AuthDevicesDisableSchema,
  AuthDevicesListResponseSchema,
  AuthDevicesListSchema,
  AuthDevicesProvisionResponseSchema,
  AuthDevicesProvisionSchema,
  AuthDeviceUserAuthoritiesApprovedEventSchema,
  AuthDeviceUserAuthoritiesListResponseSchema,
  AuthDeviceUserAuthoritiesListSchema,
  AuthDeviceUserAuthoritiesRequestedEventSchema,
  AuthDeviceUserAuthoritiesResolvedEventSchema,
  AuthDeviceUserAuthoritiesReviewRequestedEventSchema,
  AuthDeviceUserAuthoritiesReviewsDecideResponseSchema,
  AuthDeviceUserAuthoritiesReviewsDecideSchema,
  AuthDeviceUserAuthoritiesReviewsListResponseSchema,
  AuthDeviceUserAuthoritiesReviewsListSchema,
  AuthDeviceUserAuthoritiesRevokeResponseSchema,
  AuthDeviceUserAuthoritiesRevokeSchema,
  AuthPortalsGetResponseSchema,
  AuthPortalsListResponseSchema,
  AuthPortalsLoginSettingsResponseSchema,
  AuthPortalsLoginSettingsUpdateSchema,
  AuthPortalsRoutesPutResponseSchema,
  AuthPortalsRoutesRemoveSchema,
  AuthRequestsValidateResponseSchema,
  AuthRequestsValidateSchema,
  AuthResolveDeviceUserAuthoritiesProgressSchema,
  AuthResolveDeviceUserAuthoritiesResponseSchema,
  AuthResolveDeviceUserAuthoritiesSchema,
  AuthSessionsMeResponseSchema,
  ContractApprovalSchema,
  DeviceConnectInfoSchema,
  DeviceDeploymentSchema,
  DeviceSchema,
  NatsAuthTokenV1Schema,
  PortalFlowStateSchema,
  ServiceDeploymentSchema,
  WaitForDeviceActivationRequestSchema,
} from "./mod.ts";

const now = new Date().toISOString();
const page = <T>(entries: T[], limit = 10) => ({
  entries,
  count: entries.length,
  offset: 0,
  limit,
});
const deviceActivationActor = {
  participantKind: "app" as const,
  userId: "usr_123",
  identity: {
    identityId: "idn_github_123",
    provider: "github",
    subject: "123",
  },
};
const adminDeviceActivationActor = {
  participantKind: "app" as const,
  userId: "usr_admin",
  identity: {
    identityId: "idn_github_admin",
    provider: "github",
    subject: "admin",
  },
};
const adminApprovalCapabilities = {
  admin: {
    displayName: "Admin",
    description: "Requires admin.",
  },
};
const deploymentAuthoritySurface = {
  contractId: "trellis.graph@v1",
  kind: "rpc" as const,
  name: "Graph.Query",
  action: "call" as const,
};
const deploymentAuthorityResource = {
  kind: "kv" as const,
  alias: "cache",
  required: true,
  definition: { history: 1, ttlMs: 60_000 },
};
const deploymentAuthorityNeeds = {
  contracts: [{
    contractId: "trellis.graph@v1",
    required: true,
  }],
  surfaces: [{
    ...deploymentAuthoritySurface,
    required: true,
  }],
  capabilities: [{
    capability: "graph.query",
    required: true,
  }],
  resources: [{
    ...deploymentAuthorityResource,
    required: false,
  }],
};
const legacyFlatDeploymentAuthorityNeeds = [
  { kind: "contract", contractId: "trellis.graph@v1", required: true },
  { kind: "surface", surface: deploymentAuthoritySurface, required: true },
  { kind: "capability", capability: "graph.query", required: true },
  { kind: "resource", resource: deploymentAuthorityResource, required: false },
];
const deploymentAuthority = {
  deploymentId: "graph.default",
  kind: "service" as const,
  disabled: false,
  desiredState: {
    needs: deploymentAuthorityNeeds,
    capabilities: ["graph.query"],
    resources: [deploymentAuthorityResource],
    surfaces: [deploymentAuthoritySurface],
  },
  version: "dav_1",
  createdAt: now,
  updatedAt: now,
};
const deploymentAuthorityProposal = {
  proposalId: "dap_1",
  deploymentId: deploymentAuthority.deploymentId,
  contractId: "trellis.graph@v1",
  contractDigest: "digest_123",
  contract: { id: "trellis.graph@v1" },
  requestedNeeds: deploymentAuthorityNeeds,
  providedSurfaces: [deploymentAuthoritySurface],
  summary: { breaking: false },
};
const deploymentAuthorityUpdate = {
  classification: "update" as const,
  planId: "plan_1",
  deploymentId: deploymentAuthority.deploymentId,
  proposal: deploymentAuthorityProposal,
  desiredChange: { addCapabilities: ["graph.query"] },
  materializationPreview: { grants: 1 },
  warnings: ["resource binding will be reconciled"],
  createdAt: now,
  expiresAt: now,
};
const deploymentAuthorityMigration = {
  ...deploymentAuthorityUpdate,
  classification: "migration" as const,
  planId: "plan_2",
  acknowledgementRequired: true,
};
const deploymentResourceBinding = {
  deploymentId: deploymentAuthority.deploymentId,
  kind: "kv" as const,
  alias: "cache",
  binding: { bucket: "graph-cache" },
  limits: null,
  createdAt: now,
  updatedAt: now,
};
const deploymentAuthorityMaterialization = {
  deploymentId: deploymentAuthority.deploymentId,
  desiredVersion: deploymentAuthority.version,
  status: "current" as const,
  resourceBindings: [deploymentResourceBinding],
  grants: {
    capabilities: [{ capability: "graph.query" }],
    surfaces: [],
    nats: [],
  },
  reconciledAt: now,
};
const deploymentAuthorityReconciliation = {
  deploymentId: deploymentAuthority.deploymentId,
  desiredVersion: deploymentAuthority.version,
  state: "succeeded" as const,
  startedAt: now,
  finishedAt: now,
  message: "reconciled",
};
const grantOverride = {
  deploymentId: deploymentAuthority.deploymentId,
  identityKind: "web" as const,
  grantKind: "capability" as const,
  contractId: "trellis.console@v1",
  origin: "https://console.example.com",
  sessionPublicKey: null,
  capability: "graph.query",
  capabilityGroupKey: null,
};

Deno.test("PortalFlowStateSchema tolerates additive portal app fields", () => {
  assert(Value.Check(PortalFlowStateSchema, {
    status: "choose_provider",
    flowId: "flow_1",
    providers: [{ id: "google", displayName: "Google" }],
    app: {
      contractId: "trellis.console@v1",
      contractDigest: "digest",
      displayName: "Trellis Console",
      description: "Admin app",
    },
  }));
  assert(Value.Check(PortalFlowStateSchema, {
    status: "choose_provider",
    flowId: "flow_1",
    providers: [{ id: "google", displayName: "Google" }],
    app: {
      contractId: "trellis.console@v1",
      contractDigest: "digest",
      displayName: "Trellis Console",
      description: "Admin app",
      kind: "app",
    },
  }));
});

Deno.test("PortalFlowStateSchema validates portal registration availability", () => {
  assert(Value.Check(PortalFlowStateSchema, {
    status: "choose_provider",
    flowId: "flow_1",
    providers: [{ id: "local", displayName: "Username and password" }],
    app: {
      contractId: "trellis.console@v1",
      contractDigest: "digest",
      displayName: "Trellis Console",
      description: "Admin app",
    },
    portal: {
      portalId: "trellis.builtin.login",
      displayName: "Trellis Login",
      entryUrl: null,
      builtIn: true,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    },
    registration: {
      localIdentity: { available: true },
      federatedIdentity: {
        available: false,
        providers: [],
      },
    },
  }));
});

Deno.test("admin portal RPC schemas expose projected portal fields", () => {
  const portal = {
    portalId: "trellis.builtin.login",
    displayName: "Trellis Login",
    entryUrl: null,
    builtIn: true,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  };
  const settings = {
    portalId: "trellis.builtin.login",
    localRegistrationEnabled: true,
    federatedRegistrationEnabled: false,
    allowedFederatedProviders: null,
    selfRegisteredAccountActive: true,
    updatedAt: now,
  };
  const route = {
    routeKey: "any-contract:any-origin",
    portalId: "trellis.builtin.login",
    contractId: null,
    origin: null,
    disabled: false,
    updatedAt: now,
  };

  assert(Value.Check(
    AuthPortalsListResponseSchema,
    page([{
      ...portal,
      routeCount: 1,
      activeRouteCount: 1,
    }]),
  ));
  assert(Value.Check(AuthPortalsGetResponseSchema, {
    portal,
    settings,
    routes: [route],
    defaultCapabilities: ["admin"],
    defaultCapabilityGroups: ["operators"],
    federatedProviders: [{
      id: "github",
      displayName: "GitHub",
      type: "oauth",
    }],
  }));
  assert(Value.Check(AuthPortalsLoginSettingsResponseSchema, {
    portal,
    settings,
    defaultCapabilities: ["admin"],
    defaultCapabilityGroups: ["operators"],
    federatedProviders: [{
      id: "github",
      displayName: "GitHub",
      type: "oauth",
    }],
  }));
  assert(Value.Check(AuthPortalsLoginSettingsUpdateSchema, {
    portalId: portal.portalId,
    localRegistrationEnabled: true,
    federatedRegistrationEnabled: true,
    allowedFederatedProviders: ["github"],
    selfRegisteredAccountActive: true,
    defaultCapabilities: [],
    defaultCapabilityGroups: [],
  }));
  assert(Value.Check(AuthPortalsLoginSettingsUpdateSchema, {
    portalId: portal.portalId,
    localRegistrationEnabled: true,
    federatedRegistrationEnabled: true,
    allowedFederatedProviders: [],
    selfRegisteredAccountActive: true,
    defaultCapabilities: [],
    defaultCapabilityGroups: [],
  }));
  assert(Value.Check(AuthPortalsRoutesPutResponseSchema, { route }));
  assert(Value.Check(AuthPortalsRoutesRemoveSchema, {
    portalId: portal.portalId,
    contractId: null,
    origin: null,
  }));
  assert(Value.Check(AuthPortalsLoginSettingsResponseSchema, {
    portal,
    settings: { ...settings, jsonSettings: {} },
    defaultCapabilities: [],
    defaultCapabilityGroups: [],
    federatedProviders: [],
  }));
});

Deno.test("auth schemas keep contractDigest consistently typed", () => {
  assert(Value.Check(ContractApprovalSchema, {
    contractDigest: "digest_123",
    contractId: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    participantKind: "app",
    capabilities: adminApprovalCapabilities,
  }));
  assert(Value.Check(NatsAuthTokenV1Schema, {
    v: 1,
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    iat: 1,
    contractDigest: "digest_123",
  }));
  assertFalse(Value.Check(NatsAuthTokenV1Schema, {
    v: 1,
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    iat: 1,
    contractDigest: "digest with spaces",
  }));
});

Deno.test("deployment authority grant override schema accepts only web and session identities", () => {
  assert(Value.Check(AuthProtocol.DeploymentAuthorityGrantOverrideSchema, {
    deploymentId: "svc.graph.default",
    identityKind: "web",
    grantKind: "capability",
    contractId: "app.graph@v1",
    origin: "https://app.example.com",
    sessionPublicKey: null,
    capability: "graph.query",
    capabilityGroupKey: null,
  }));
  assert(Value.Check(AuthProtocol.DeploymentAuthorityGrantOverrideSchema, {
    deploymentId: "svc.graph.default",
    identityKind: "session",
    grantKind: "capability-group",
    contractId: "app.graph@v1",
    origin: null,
    sessionPublicKey: "session-key",
    capability: null,
    capabilityGroupKey: "graph-users",
  }));
  for (const removed of ["any", "native", "device-user"]) {
    assertFalse(
      Value.Check(AuthProtocol.DeploymentAuthorityGrantOverrideSchema, {
        deploymentId: "svc.graph.default",
        identityKind: removed,
        grantKind: "capability",
        contractId: "app.graph@v1",
        origin: null,
        sessionPublicKey: null,
        capability: "graph.query",
        capabilityGroupKey: null,
      }),
    );
  }
  assert(Value.Check(AuthProtocol.DeploymentAuthorityGrantOverrideSchema, {
    deploymentId: "svc.graph.default",
    identityKind: "web",
    contractId: "app.graph@v1",
    origin: "https://app.example.com",
    sessionPublicKey: null,
    futureField: "preserved-by-schema-evolution",
    grantKind: "capability",
    capability: "graph.query",
    capabilityGroupKey: null,
  }));
});

Deno.test("device activation wait request requires flowId", () => {
  assert(Value.Check(WaitForDeviceActivationRequestSchema, {
    flowId: "flow_123",
    publicIdentityKey: "pub_123",
    nonce: "nonce_123",
    contractDigest: "digest_123",
    iat: 1,
    sig: "sig_123",
  }));
  assertFalse(Value.Check(WaitForDeviceActivationRequestSchema, {
    publicIdentityKey: "pub_123",
    nonce: "nonce_123",
    contractDigest: "digest_123",
    iat: 1,
    sig: "sig_123",
  }));
});

Deno.test("deployment schemas validate clean deployment shapes", () => {
  const serviceDeployment = {
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
  };
  const deviceDeployment = {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  };

  assert(Value.Check(ServiceDeploymentSchema, serviceDeployment));
  assert(Value.Check(DeviceDeploymentSchema, deviceDeployment));
});

Deno.test("auth protocol no longer exposes legacy deployment policy schemas", () => {
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthApplyServiceDeploymentContractSchema",
  ));
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthApplyServiceDeploymentContractResponseSchema",
  ));
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthUnapplyServiceDeploymentContractSchema",
  ));
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthUnapplyServiceDeploymentContractResponseSchema",
  ));
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthApplyDeviceDeploymentContractSchema",
  ));
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthApplyDeviceDeploymentContractResponseSchema",
  ));
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthUnapplyDeviceDeploymentContractSchema",
  ));
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthUnapplyDeviceDeploymentContractResponseSchema",
  ));
  assertFalse(Object.hasOwn(AuthProtocol, "AuthListInstalledContractsSchema"));
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthListInstalledContractsResponseSchema",
  ));
  assertFalse(Object.hasOwn(AuthProtocol, "AuthGetInstalledContractSchema"));
  assertFalse(Object.hasOwn(
    AuthProtocol,
    "AuthGetInstalledContractResponseSchema",
  ));
  assertFalse(Object.hasOwn(AuthProtocol, "InstalledContractSchema"));
  assertFalse(Object.hasOwn(AuthProtocol, "InstalledContractDetailSchema"));
});

Deno.test("deployment schemas no longer expose legacy policy fields", () => {
  const serviceDeploymentSchema = JSON.stringify(ServiceDeploymentSchema);
  const deviceDeploymentSchema = JSON.stringify(DeviceDeploymentSchema);

  assertFalse(serviceDeploymentSchema.includes('"firstConnectPolicy"'));
  assertFalse(serviceDeploymentSchema.includes('"compatibilityPolicy"'));
  assertFalse(serviceDeploymentSchema.includes('"appliedContracts"'));
  assertFalse(serviceDeploymentSchema.includes('"allowedDigests"'));
  assertFalse(deviceDeploymentSchema.includes('"firstConnectPolicy"'));
  assertFalse(deviceDeploymentSchema.includes('"preActivationPolicy"'));
  assertFalse(deviceDeploymentSchema.includes('"compatibilityPolicy"'));
  assertFalse(deviceDeploymentSchema.includes('"appliedContracts"'));
  assertFalse(deviceDeploymentSchema.includes('"allowedDigests"'));
});

Deno.test("deployment authority model schemas validate current authority protocol", () => {
  assert(Value.Check(
    AuthProtocol.DeploymentAuthoritySurfaceSchema,
    deploymentAuthoritySurface,
  ));
  assert(Value.Check(
    AuthProtocol.DeploymentAuthorityCapabilitySchema,
    "graph.query",
  ));
  assertFalse(
    Value.Check(AuthProtocol.DeploymentAuthorityCapabilitySchema, ""),
  );
  assert(Value.Check(
    AuthProtocol.DeploymentAuthorityResourceSchema,
    deploymentAuthorityResource,
  ));
  assert(Value.Check(
    AuthProtocol.DeploymentAuthorityNeedsSchema,
    deploymentAuthorityNeeds,
  ));
  assertFalse(Value.Check(
    AuthProtocol.DeploymentAuthorityNeedsSchema,
    legacyFlatDeploymentAuthorityNeeds,
  ));
  assert(
    Value.Check(AuthProtocol.DeploymentAuthoritySchema, deploymentAuthority),
  );
  assert(Value.Check(
    AuthProtocol.DeploymentAuthorityProposalSchema,
    deploymentAuthorityProposal,
  ));
  assert(Value.Check(
    AuthProtocol.DeploymentAuthorityUpdateSchema,
    deploymentAuthorityUpdate,
  ));
  assertFalse(Value.Check(AuthProtocol.DeploymentAuthorityUpdateSchema, {
    ...deploymentAuthorityUpdate,
    classification: "migration",
  }));
  assert(Value.Check(
    AuthProtocol.DeploymentAuthorityMigrationSchema,
    deploymentAuthorityMigration,
  ));
  assertFalse(Value.Check(AuthProtocol.DeploymentAuthorityMigrationSchema, {
    ...deploymentAuthorityMigration,
    acknowledgementRequired: undefined,
  }));
  assert(Value.Check(
    AuthProtocol.DeploymentAuthorityMaterializationSchema,
    deploymentAuthorityMaterialization,
  ));
  assert(Value.Check(
    AuthProtocol.DeploymentAuthorityReconciliationStatusSchema,
    deploymentAuthorityReconciliation,
  ));
});

Deno.test("deployment authority RPC schemas validate source and generated shapes", () => {
  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityListSchema, {
    kind: "service",
    disabled: false,
    limit: 10,
  }));
  assert(Value.Check(GeneratedAuth.AuthDeploymentAuthorityListRequestSchema, {
    kind: "service",
    disabled: false,
    limit: 10,
  }));
  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityListResponseSchema, {
    ...page([deploymentAuthority]),
  }));
  assert(Value.Check(GeneratedAuth.AuthDeploymentAuthorityListResponseSchema, {
    ...page([deploymentAuthority]),
  }));

  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityGetSchema, {
    deploymentId: deploymentAuthority.deploymentId,
  }));
  assert(Value.Check(GeneratedAuth.AuthDeploymentAuthorityGetRequestSchema, {
    deploymentId: deploymentAuthority.deploymentId,
  }));
  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityGetResponseSchema, {
    authority: deploymentAuthority,
    materializedAuthority: deploymentAuthorityMaterialization,
    portalRoute: {
      deploymentId: deploymentAuthority.deploymentId,
      portalId: "trellis.builtin.login",
      entryUrl: null,
      disabled: false,
      updatedAt: now,
    },
    grantOverrides: [grantOverride],
  }));
  assert(Value.Check(GeneratedAuth.AuthDeploymentAuthorityGetResponseSchema, {
    authority: deploymentAuthority,
    materializedAuthority: deploymentAuthorityMaterialization,
    portalRoute: {
      deploymentId: deploymentAuthority.deploymentId,
      portalId: "trellis.builtin.login",
      entryUrl: null,
      disabled: false,
      updatedAt: now,
    },
    grantOverrides: [grantOverride],
  }));

  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityPlanSchema, {
    deploymentId: deploymentAuthority.deploymentId,
    contract: { id: "trellis.graph@v1" },
    expectedDigest: "digest_123",
  }));
  assert(Value.Check(GeneratedAuth.AuthDeploymentAuthorityPlanRequestSchema, {
    deploymentId: deploymentAuthority.deploymentId,
    contract: { id: "trellis.graph@v1" },
    expectedDigest: "digest_123",
  }));
  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityPlanResponseSchema, {
    plan: deploymentAuthorityUpdate,
  }));
  assert(Value.Check(GeneratedAuth.AuthDeploymentAuthorityPlanResponseSchema, {
    plan: deploymentAuthorityMigration,
  }));

  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityPlansListSchema, {
    deploymentId: deploymentAuthority.deploymentId,
    state: "pending",
    classification: "update",
    kind: "service",
    limit: 10,
  }));
  assert(
    Value.Check(GeneratedAuth.AuthDeploymentAuthorityPlansListRequestSchema, {
      deploymentId: deploymentAuthority.deploymentId,
      state: "pending",
      classification: "update",
      kind: "service",
      limit: 10,
    }),
  );
  assert(
    Value.Check(AuthProtocol.AuthDeploymentAuthorityPlansListResponseSchema, {
      ...page([deploymentAuthorityUpdate]),
    }),
  );
  assert(
    Value.Check(GeneratedAuth.AuthDeploymentAuthorityPlansListResponseSchema, {
      ...page([deploymentAuthorityUpdate]),
    }),
  );

  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityPlansGetSchema, {
    planId: deploymentAuthorityUpdate.planId,
  }));
  assert(
    Value.Check(GeneratedAuth.AuthDeploymentAuthorityPlansGetRequestSchema, {
      planId: deploymentAuthorityUpdate.planId,
    }),
  );
  assert(
    Value.Check(AuthProtocol.AuthDeploymentAuthorityPlansGetResponseSchema, {
      plan: deploymentAuthorityMigration,
    }),
  );
  assert(
    Value.Check(GeneratedAuth.AuthDeploymentAuthorityPlansGetResponseSchema, {
      plan: deploymentAuthorityMigration,
    }),
  );

  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityAcceptUpdateSchema, {
    planId: deploymentAuthorityUpdate.planId,
    expectedDesiredVersion: deploymentAuthority.version,
  }));
  assert(Value.Check(
    GeneratedAuth.AuthDeploymentAuthorityAcceptUpdateRequestSchema,
    {
      planId: deploymentAuthorityUpdate.planId,
      expectedDesiredVersion: deploymentAuthority.version,
    },
  ));
  assert(
    Value.Check(AuthProtocol.AuthDeploymentAuthorityAcceptMigrationSchema, {
      planId: deploymentAuthorityMigration.planId,
      acknowledgement: "I understand this migration changes authority.",
    }),
  );
  assert(Value.Check(
    GeneratedAuth.AuthDeploymentAuthorityAcceptMigrationRequestSchema,
    {
      planId: deploymentAuthorityMigration.planId,
      acknowledgement: "I understand this migration changes authority.",
    },
  ));
  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityAcceptResponseSchema, {
    authority: deploymentAuthority,
  }));
  assert(
    Value.Check(GeneratedAuth.AuthDeploymentAuthorityAcceptResponseSchema, {
      authority: deploymentAuthority,
    }),
  );

  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityRejectSchema, {
    planId: deploymentAuthorityUpdate.planId,
    reason: "not ready",
  }));
  assert(Value.Check(GeneratedAuth.AuthDeploymentAuthorityRejectRequestSchema, {
    planId: deploymentAuthorityUpdate.planId,
    reason: "not ready",
  }));
  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityRejectResponseSchema, {
    success: true,
  }));
  assert(
    Value.Check(GeneratedAuth.AuthDeploymentAuthorityRejectResponseSchema, {
      success: true,
    }),
  );

  assert(Value.Check(AuthProtocol.AuthDeploymentAuthorityReconcileSchema, {
    deploymentId: deploymentAuthority.deploymentId,
    desiredVersion: deploymentAuthority.version,
  }));
  assert(
    Value.Check(GeneratedAuth.AuthDeploymentAuthorityReconcileRequestSchema, {
      deploymentId: deploymentAuthority.deploymentId,
      desiredVersion: deploymentAuthority.version,
    }),
  );
  assert(
    Value.Check(AuthProtocol.AuthDeploymentAuthorityReconcileResponseSchema, {
      authority: deploymentAuthority,
      materializedAuthority: deploymentAuthorityMaterialization,
      reconciliation: deploymentAuthorityReconciliation,
    }),
  );
  assert(Value.Check(
    GeneratedAuth.AuthDeploymentAuthorityReconcileResponseSchema,
    {
      authority: deploymentAuthority,
      materializedAuthority: deploymentAuthorityMaterialization,
      reconciliation: deploymentAuthorityReconciliation,
    },
  ));
});

Deno.test("deployment authority grant override RPC schemas validate", () => {
  assert(Value.Check(
    AuthProtocol.AuthDeploymentAuthorityGrantOverridesPutSchema,
    {
      deploymentId: deploymentAuthority.deploymentId,
      overrides: [grantOverride],
    },
  ));
  assert(Value.Check(
    GeneratedAuth.AuthDeploymentAuthorityGrantOverridesPutRequestSchema,
    {
      deploymentId: deploymentAuthority.deploymentId,
      overrides: [grantOverride],
    },
  ));
  assert(Value.Check(
    AuthProtocol.AuthDeploymentAuthorityGrantOverridesListSchema,
    { limit: 10 },
  ));
  assert(Value.Check(
    GeneratedAuth.AuthDeploymentAuthorityGrantOverridesListRequestSchema,
    { limit: 10 },
  ));
  assert(Value.Check(
    AuthProtocol.AuthDeploymentAuthorityGrantOverridesListResponseSchema,
    page([grantOverride]),
  ));
  assert(Value.Check(
    GeneratedAuth.AuthDeploymentAuthorityGrantOverridesListResponseSchema,
    page([grantOverride]),
  ));
  assert(Value.Check(
    AuthProtocol.AuthDeploymentAuthorityGrantOverridesRemoveSchema,
    {
      deploymentId: deploymentAuthority.deploymentId,
      overrides: [grantOverride],
    },
  ));
  assert(Value.Check(
    GeneratedAuth.AuthDeploymentAuthorityGrantOverridesRemoveRequestSchema,
    {
      deploymentId: deploymentAuthority.deploymentId,
      overrides: [grantOverride],
    },
  ));
  assert(Value.Check(
    AuthProtocol.AuthDeploymentAuthorityGrantOverridesResponseSchema,
    { grantOverrides: [grantOverride] },
  ));
  assert(Value.Check(
    GeneratedAuth.AuthDeploymentAuthorityGrantOverridesResponseSchema,
    { grantOverrides: [grantOverride] },
  ));
});

Deno.test("generated auth contract exposes deployment authority RPC keys only", () => {
  assertEquals(GeneratedAuth.CONTRACT_ID, "trellis.auth@v1");
  const rpcKeys = Object.keys(GeneratedAuth.OWNED_API.rpc);
  for (
    const key of [
      "Auth.DeploymentAuthority.List",
      "Auth.DeploymentAuthority.Get",
      "Auth.DeploymentAuthority.Plans.List",
      "Auth.DeploymentAuthority.Plans.Get",
      "Auth.DeploymentAuthority.Plan",
      "Auth.DeploymentAuthority.AcceptUpdate",
      "Auth.DeploymentAuthority.AcceptMigration",
      "Auth.DeploymentAuthority.Reject",
      "Auth.DeploymentAuthority.Reconcile",
      "Auth.DeploymentAuthority.GrantOverrides.Put",
      "Auth.DeploymentAuthority.GrantOverrides.List",
      "Auth.DeploymentAuthority.GrantOverrides.Remove",
      "Auth.IdentityGrants.List",
      "Auth.IdentityGrants.Revoke",
    ]
  ) {
    assert(rpcKeys.includes(key), key);
  }
  for (
    const key of [
      `Auth.${"Envelopes"}.List`,
      `Auth.${"Envelopes"}.Get`,
      `Auth.${"Envelope"}${"Expansions"}.List`,
      `Auth.${"Identity"}${"Envelopes"}.Revoke`,
      `Auth.${"Identities"}.${"Grants"}.List`,
    ]
  ) {
    assertFalse(rpcKeys.includes(key), key);
  }
});

Deno.test("PortalFlowStateSchema accepts returnLocation for restartable portal states", () => {
  assert(Value.Check(PortalFlowStateSchema, {
    status: "approval_denied",
    flowId: "flow_1",
    approval: {
      contractId: "trellis.console@v1",
      contractDigest: "digest",
      displayName: "Trellis Console",
      description: "Admin app",
      capabilities: adminApprovalCapabilities,
    },
    returnLocation: "https://app.example.com/callback?flowId=flow_1",
  }));
  assert(Value.Check(PortalFlowStateSchema, {
    status: "insufficient_capabilities",
    flowId: "flow_2",
    user: {
      origin: "github",
      id: "123",
      name: "Ada",
    },
    approval: {
      contractId: "trellis.console@v1",
      contractDigest: "digest",
      displayName: "Trellis Console",
      description: "Admin app",
      capabilities: adminApprovalCapabilities,
    },
    missingCapabilities: ["audit"],
    userCapabilities: ["admin"],
    returnLocation: "https://app.example.com/callback?flowId=flow_2",
  }));
});

Deno.test("AuthRequestsValidateResponseSchema validates device caller variants", () => {
  assert(Value.Check(AuthRequestsValidateResponseSchema, {
    allowed: true,
    inboxPrefix: "_INBOX.session",
    caller: {
      type: "user",
      participantKind: "app",
      userId: "usr_123",
      identity: {
        identityId: "idn_123",
        provider: "github",
        subject: "123",
      },
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["admin"],
      lastAuth: "2026-04-10T00:00:00.000Z",
    },
  }));
  assert(Value.Check(AuthRequestsValidateResponseSchema, {
    allowed: true,
    inboxPrefix: "_INBOX.session",
    caller: {
      type: "service",
      id: "billing",
      name: "Billing",
      active: true,
      capabilities: ["service"],
    },
  }));
  assert(Value.Check(AuthRequestsValidateResponseSchema, {
    allowed: true,
    inboxPrefix: "_INBOX.session",
    caller: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "reader",
      runtimePublicKey: "A".repeat(43),
      deploymentId: "reader.default",
      active: true,
      capabilities: ["device.sync"],
    },
  }));
  assertFalse(Value.Check(AuthRequestsValidateResponseSchema, {
    allowed: true,
    inboxPrefix: "_INBOX.session",
    caller: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "reader",
      runtimePublicKey: "A".repeat(43),
      deploymentId: "",
      active: true,
      capabilities: ["device.sync"],
    },
  }));
});

Deno.test("deployment and device admin schemas validate", () => {
  assert(Value.Check(AuthDeploymentsCreateSchema, {
    kind: "service",
    deploymentId: "billing.default",
    namespaces: ["billing"],
  }));
  assert(Value.Check(AuthDeploymentsCreateResponseSchema, {
    deployment: {
      kind: "service",
      deploymentId: "billing.default",
      namespaces: ["billing"],
      disabled: false,
    },
  }));
  assert(Value.Check(AuthDeploymentsCreateSchema, {
    kind: "device",
    deploymentId: "reader.default",
    reviewMode: "none",
  }));
  assert(Value.Check(AuthDeploymentsCreateResponseSchema, {
    deployment: {
      kind: "device",
      deploymentId: "reader.default",
      reviewMode: "none",
      disabled: false,
    },
  }));
  assert(Value.Check(AuthDeploymentsListSchema, { limit: 10 }));
  assert(
    Value.Check(AuthDeploymentsListSchema, { kind: "service", limit: 10 }),
  );
  assert(
    Value.Check(AuthDeploymentsListResponseSchema, page([])),
  );
  assert(
    Value.Check(AuthDeploymentsDisableSchema, {
      kind: "device",
      deploymentId: "reader.default",
    }),
  );
  assert(
    Value.Check(AuthDeploymentsDisableResponseSchema, {
      deployment: {
        kind: "device",
        deploymentId: "reader.default",
        reviewMode: "none",
        disabled: true,
      },
    }),
  );

  assert(Value.Check(AuthDevicesProvisionSchema, {
    deploymentId: "reader.default",
    publicIdentityKey: "A".repeat(43),
    activationKey: "B".repeat(43),
    metadata: {
      name: "Front Desk Reader",
      serialNumber: "SN-123",
      modelNumber: "MODEL-9",
      assetTag: "asset-42",
    },
  }));
  assert(Value.Check(AuthDevicesProvisionResponseSchema, {
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: "A".repeat(43),
      deploymentId: "reader.default",
      metadata: {
        name: "Front Desk Reader",
        serialNumber: "SN-123",
        modelNumber: "MODEL-9",
        assetTag: "asset-42",
      },
      state: "registered",
      createdAt: now,
      activatedAt: null,
      revokedAt: null,
    },
  }));
  assert(Value.Check(AuthDevicesListSchema, { limit: 10 }));
  assert(Value.Check(AuthDevicesListResponseSchema, page([])));
  assert(Value.Check(AuthDevicesDisableSchema, { instanceId: "dev_1" }));
  assert(
    Value.Check(AuthDevicesDisableResponseSchema, {
      instance: {
        instanceId: "dev_1",
        publicIdentityKey: "A".repeat(43),
        deploymentId: "reader.default",
        state: "disabled",
        createdAt: now,
        activatedAt: null,
        revokedAt: null,
      },
    }),
  );
});

Deno.test("AuthSessionsMeResponseSchema validates user, device, and service envelopes", () => {
  assert(Value.Check(AuthSessionsMeResponseSchema, {
    participantKind: "agent",
    user: {
      userId: "usr_123",
      identity: {
        identityId: "idn_123",
        provider: "github",
        subject: "123",
      },
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["admin"],
    },
    device: null,
    service: null,
  }));
  assert(Value.Check(AuthSessionsMeResponseSchema, {
    participantKind: "device",
    user: null,
    device: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "reader",
      runtimePublicKey: "A".repeat(43),
      deploymentId: "reader.default",
      active: true,
      capabilities: ["device.sync"],
    },
    service: null,
  }));
  assert(Value.Check(AuthSessionsMeResponseSchema, {
    participantKind: "service",
    user: null,
    device: null,
    service: {
      type: "service",
      id: "billing",
      name: "Billing",
      active: true,
      capabilities: ["service"],
    },
  }));
  assert(Value.Check(AuthSessionsMeResponseSchema, {
    participantKind: "app",
    user: {
      userId: "usr_123",
      identity: {
        identityId: "idn_123",
        provider: "github",
        subject: "123",
      },
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["admin"],
      locale: "en-US",
    },
    device: null,
    service: null,
    requestId: "req_123",
  }));
});

Deno.test("AuthRequestsValidateSchema requires current proof metadata and non-empty strings", () => {
  assert(Value.Check(AuthRequestsValidateSchema, {
    sessionKey: "sk_123",
    proof: "sig_123",
    subject: "rpc.v1.Example.Call",
    payloadHash: "hash_123",
    iat: 1_700_000_000,
    requestId: "req_123",
    capabilities: ["example.call"],
  }));

  assertFalse(Value.Check(AuthRequestsValidateSchema, {
    sessionKey: "sk_123",
    proof: "sig_123",
    subject: "rpc.v1.Example.Call",
    payloadHash: "hash_123",
    requestId: "req_123",
  }));

  assertFalse(Value.Check(AuthRequestsValidateSchema, {
    sessionKey: "",
    proof: "sig_123",
    subject: "rpc.v1.Example.Call",
    payloadHash: "hash_123",
    iat: 1_700_000_000,
    requestId: "req_123",
  }));

  assertFalse(Value.Check(AuthRequestsValidateSchema, {
    sessionKey: "sk_123",
    proof: "sig_123",
    subject: "rpc.v1.Example.Call",
    payloadHash: "hash_123",
    iat: 1_700_000_000,
    requestId: "req_123",
    capabilities: [""],
  }));
});

Deno.test("identity grant RPC schemas validate self-service grant rows", () => {
  const identityGrant = {
    identityGrantId: "grant_123",
    identityAnchor: {
      kind: "cli" as const,
      contractId: "trellis.agent@v1",
      sessionPublicKey: "session-agent",
    },
    contractEvidence: {
      contractDigest: "digest_123",
      contractId: "trellis.agent@v1",
    },
    displayName: "Trellis Agent",
    description: "Local delegated tooling",
    participantKind: "agent" as const,
    capabilities: ["jobs.read"],
    grantedAt: now,
    updatedAt: now,
  };

  assert(Value.Check(AuthProtocol.AuthIdentityGrantsListSchema, {
    user: "usr_123",
    limit: 10,
  }));
  assert(Value.Check(GeneratedAuth.AuthIdentityGrantsListRequestSchema, {
    user: "usr_123",
    limit: 10,
  }));
  assertFalse(Value.Check(AuthProtocol.AuthIdentityGrantsListSchema, {}));
  assertFalse(Value.Check(
    GeneratedAuth.AuthIdentityGrantsListRequestSchema,
    {},
  ));
  assert(Value.Check(AuthProtocol.AuthIdentityGrantsListResponseSchema, {
    ...page([identityGrant]),
  }));
  assert(Value.Check(GeneratedAuth.AuthIdentityGrantsListResponseSchema, {
    ...page([identityGrant]),
  }));
  assert(Value.Check(AuthProtocol.AuthIdentityGrantsRevokeSchema, {
    identityGrantId: "grant_123",
    user: "usr_123",
  }));
  assert(Value.Check(GeneratedAuth.AuthIdentityGrantsRevokeRequestSchema, {
    identityGrantId: "grant_123",
    user: "usr_123",
  }));
  assertFalse(Value.Check(AuthProtocol.AuthIdentityGrantsRevokeSchema, {
    contractDigest: "digest_123",
  }));
  assertFalse(Value.Check(GeneratedAuth.AuthIdentityGrantsRevokeRequestSchema, {
    contractDigest: "digest_123",
  }));
  assertFalse(Value.Check(AuthProtocol.AuthIdentityGrantsRevokeSchema, {
    [`identity${"Envelope"}Id`]: "grant_123",
  }));
  assertFalse(Value.Check(GeneratedAuth.AuthIdentityGrantsRevokeRequestSchema, {
    [`identity${"Envelope"}Id`]: "grant_123",
  }));
  assert(Value.Check(AuthProtocol.AuthIdentityGrantsRevokeResponseSchema, {
    success: true,
  }));
  assert(Value.Check(GeneratedAuth.AuthIdentityGrantsRevokeResponseSchema, {
    success: true,
  }));

  assertFalse(Value.Check(GeneratedAuth.AuthIdentityGrantsListResponseSchema, {
    ...page([{ ...identityGrant, identityGrantId: undefined }]),
  }));
  assertFalse(
    JSON.stringify(GeneratedAuth.AuthIdentityGrantsListResponseSchema).includes(
      `identity${"Envelope"}Id`,
    ),
  );
  assertFalse(Value.Check(GeneratedAuth.AuthIdentityGrantsListResponseSchema, {
    ...page([{
      ...identityGrant,
      contractEvidence: {
        contractDigest: "digest with spaces",
        contractId: "trellis.agent@v1",
      },
    }]),
  }));
  assertFalse(Value.Check(GeneratedAuth.AuthIdentityGrantsListResponseSchema, {
    ...page([{
      ...identityGrant,
      contractEvidence: {
        contractDigest: "digest_123",
        contractId: "",
      },
    }]),
  }));
  assertFalse(Value.Check(GeneratedAuth.AuthIdentityGrantsListResponseSchema, {
    ...page([{ ...identityGrant, grantedAt: "not-a-date" }]),
  }));
});

Deno.test("device activation and connect-info schemas validate", () => {
  assert(Value.Check(DeviceConnectInfoSchema, {
    instanceId: "dev_1",
    deploymentId: "reader.default",
    contractId: "acme.reader@v1",
    contractDigest: "digest-a",
    transports: {
      native: { natsServers: ["nats://127.0.0.1:4222"] },
      websocket: { natsServers: ["ws://localhost:8080"] },
    },
    transport: {
      sentinel: {
        jwt: "jwt",
        seed: "seed",
      },
    },
    auth: {
      mode: "device_identity",
      authority: "user_delegated",
      iatSkewSeconds: 30,
    },
  }));
  assert(Value.Check(DeviceConnectInfoSchema, {
    instanceId: "dev_1",
    deploymentId: "reader.default",
    contractId: "acme.reader@v1",
    contractDigest: "digest-a",
    transports: {
      native: {
        natsServers: ["nats://127.0.0.1:4222"],
        tlsRequired: true,
      },
    },
    transport: {
      sentinel: {
        jwt: "jwt",
        seed: "seed",
        issuer: "trellis",
      },
    },
    auth: {
      mode: "device_identity",
      authority: "admin_reviewed",
      iatSkewSeconds: 30,
      tokenVersion: 2,
    },
    rollout: "canary",
  }));

  assert(Value.Check(AuthResolveDeviceUserAuthoritiesSchema, {
    flowId: "flow_1",
  }));
  assert(Value.Check(AuthResolveDeviceUserAuthoritiesProgressSchema, {
    status: "pending_review",
    reviewId: "dar_1",
    instanceId: "dev_1",
    deploymentId: "reader.default",
    requestedAt: now,
  }));
  assert(Value.Check(AuthResolveDeviceUserAuthoritiesResponseSchema, {
    status: "activated",
    instanceId: "dev_1",
    deploymentId: "reader.default",
    activatedAt: now,
    confirmationCode: "ABCD1234",
  }));
  assertFalse(Value.Check(AuthResolveDeviceUserAuthoritiesResponseSchema, {
    status: "pending_review",
    reviewId: "dar_1",
    instanceId: "dev_1",
    deploymentId: "reader.default",
    requestedAt: now,
  }));
  assert(Value.Check(AuthResolveDeviceUserAuthoritiesResponseSchema, {
    status: "rejected",
    reason: "policy_denied",
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesReviewRequestedEventSchema, {
    reviewId: "dar_1",
    flowId: "flow_1",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "sherpa",
    requestedAt: now,
    requestedBy: deviceActivationActor,
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesRequestedEventSchema, {
    flowId: "flow_1",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "sherpa",
    requestedAt: now,
    requestedBy: deviceActivationActor,
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesApprovedEventSchema, {
    reviewId: "dar_1",
    flowId: "flow_1",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "sherpa",
    requestedAt: now,
    approvedAt: now,
    requestedBy: deviceActivationActor,
    approvedBy: adminDeviceActivationActor,
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesResolvedEventSchema, {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "sherpa",
    resolvedAt: now,
    resolvedBy: deviceActivationActor,
    flowId: "flow_1",
    reviewId: "dar_1",
  }));
  assert(Value.Check(AuthDevicesConnectInfoGetSchema, {
    publicIdentityKey: "A".repeat(43),
    contractDigest: "digest-a",
    iat: 123,
    sig: "proof",
  }));
  assert(Value.Check(AuthDevicesConnectInfoGetSchema, {
    publicIdentityKey: "A".repeat(43),
    contractDigest: "digest-a",
    iat: 123,
    sig: "proof",
    rollout: "canary",
  }));
  assert(Value.Check(AuthDevicesConnectInfoGetResponseSchema, {
    status: "ready",
    connectInfo: {
      instanceId: "dev_1",
      deploymentId: "reader.default",
      contractId: "acme.reader@v1",
      contractDigest: "digest-a",
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      transport: {
        sentinel: { jwt: "jwt", seed: "seed", issuer: "trellis" },
      },
      auth: {
        mode: "device_identity",
        authority: "user_delegated",
        iatSkewSeconds: 30,
        tokenVersion: 2,
      },
      rollout: "canary",
    },
    requestId: "req_123",
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesListSchema, {
    instanceId: "dev_1",
    limit: 10,
    state: "activated",
  }));
  assert(
    Value.Check(AuthDeviceUserAuthoritiesListResponseSchema, {
      ...page([]),
    }),
  );
  assert(
    Value.Check(AuthDeviceUserAuthoritiesRevokeSchema, { instanceId: "dev_1" }),
  );
  assert(
    Value.Check(AuthDeviceUserAuthoritiesRevokeResponseSchema, {
      success: true,
    }),
  );
  assert(Value.Check(AuthDeviceUserAuthoritiesReviewsListSchema, {
    deploymentId: "reader.default",
    limit: 10,
    state: "pending",
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesReviewsListResponseSchema, {
    ...page([]),
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesReviewsDecideSchema, {
    reviewId: "dar_1",
    decision: "approve",
    reason: "approved_by_policy",
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesReviewsDecideResponseSchema, {
    review: {
      reviewId: "dar_1",
      instanceId: "dev_1",
      publicIdentityKey: "A".repeat(43),
      deploymentId: "reader.default",
      state: "approved",
      requestedAt: now,
      decidedAt: now,
      reason: "approved_by_policy",
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: "A".repeat(43),
      deploymentId: "reader.default",
      state: "activated",
      activatedAt: now,
      revokedAt: null,
    },
    confirmationCode: "ABCD1234",
  }));
});

Deno.test("DeviceSchema validates deployment-attached devices", () => {
  assert(Value.Check(DeviceSchema, {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    state: "registered",
    createdAt: now,
    activatedAt: null,
    revokedAt: null,
  }));
});
