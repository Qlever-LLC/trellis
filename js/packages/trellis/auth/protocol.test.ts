import { assert, assertEquals, assertFalse } from "@std/assert";
import Value from "typebox/value";

import * as AuthProtocol from "./mod.ts";

import {
  AuthIdentitiesGrantsListResponseSchema
    as GeneratedAuthIdentitiesGrantsListResponseSchema,
  AuthIdentitiesGrantsListSchema as GeneratedAuthIdentitiesGrantsListSchema,
} from "../models/auth/rpc/ListUserGrants.ts";
import {
  AuthIdentityEnvelopesRevokeResponseSchema
    as GeneratedAuthIdentityEnvelopesRevokeResponseSchema,
  AuthIdentityEnvelopesRevokeSchema
    as GeneratedAuthIdentityEnvelopesRevokeSchema,
} from "../models/auth/rpc/RevokeUserGrant.ts";
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
  AuthEnvelopeExpansionsListResponseSchema,
  AuthEnvelopeExpansionsListSchema,
  AuthIdentitiesGrantsListResponseSchema,
  AuthIdentitiesGrantsListSchema,
  AuthIdentityEnvelopesRevokeResponseSchema,
  AuthIdentityEnvelopesRevokeSchema,
  AuthRequestsValidateResponseSchema,
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
} from "./mod.ts";

const now = new Date().toISOString();
const adminApprovalCapabilities = {
  admin: {
    displayName: "Admin",
    description: "Requires admin.",
  },
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
      trellisId: "tid_123",
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["admin"],
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
    Value.Check(AuthDeploymentsListResponseSchema, { deployments: [] }),
  );
  assert(Value.Check(AuthEnvelopeExpansionsListSchema, { limit: 10 }));
  assert(Value.Check(AuthEnvelopeExpansionsListSchema, {
    deploymentId: "billing.default",
    limit: 10,
    state: "pending",
  }));
  assert(Value.Check(AuthEnvelopeExpansionsListResponseSchema, {
    requests: [],
  }));
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
  assert(Value.Check(AuthDevicesListResponseSchema, { instances: [] }));
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
      id: "123",
      origin: "github",
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
      id: "123",
      origin: "github",
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

Deno.test("user grant schemas validate self-service grant rows", () => {
  assert(Value.Check(AuthIdentitiesGrantsListSchema, { limit: 10 }));
  assert(Value.Check(GeneratedAuthIdentitiesGrantsListSchema, { limit: 10 }));
  assertFalse(Value.Check(AuthIdentitiesGrantsListSchema, {}));
  assertFalse(Value.Check(GeneratedAuthIdentitiesGrantsListSchema, {}));
  assert(Value.Check(AuthIdentitiesGrantsListResponseSchema, {
    grants: [
      {
        identityEnvelopeId: "env_123",
        identityAnchor: {
          kind: "cli",
          contractId: "trellis.agent@v1",
          sessionPublicKey: "session-agent",
        },
        contractEvidence: {
          contractDigest: "digest_123",
          contractId: "trellis.agent@v1",
        },
        displayName: "Trellis Agent",
        description: "Local delegated tooling",
        participantKind: "agent",
        capabilities: ["jobs.read"],
        grantedAt: now,
        updatedAt: now,
      },
    ],
  }));
  assert(Value.Check(GeneratedAuthIdentitiesGrantsListResponseSchema, {
    grants: [
      {
        identityEnvelopeId: "env_123",
        identityAnchor: {
          kind: "cli",
          contractId: "trellis.agent@v1",
          sessionPublicKey: "session-agent",
        },
        contractEvidence: {
          contractDigest: "digest_123",
          contractId: "trellis.agent@v1",
        },
        displayName: "Trellis Agent",
        description: "Local delegated tooling",
        participantKind: "agent",
        capabilities: ["jobs.read"],
        grantedAt: now,
        updatedAt: now,
      },
    ],
  }));
  assert(Value.Check(AuthIdentityEnvelopesRevokeSchema, {
    identityEnvelopeId: "env_123",
  }));
  assert(Value.Check(GeneratedAuthIdentityEnvelopesRevokeSchema, {
    identityEnvelopeId: "env_123",
  }));
  assertFalse(Value.Check(AuthIdentityEnvelopesRevokeSchema, {
    contractDigest: "digest_123",
  }));
  assert(Value.Check(AuthIdentityEnvelopesRevokeResponseSchema, {
    success: true,
  }));
  assert(Value.Check(GeneratedAuthIdentityEnvelopesRevokeResponseSchema, {
    success: true,
  }));

  assertFalse(Value.Check(GeneratedAuthIdentitiesGrantsListResponseSchema, {
    grants: [{
      identityEnvelopeId: "env_123",
      identityAnchor: {
        kind: "cli",
        contractId: "trellis.agent@v1",
        sessionPublicKey: "session-agent",
      },
      contractEvidence: {
        contractDigest: "digest with spaces",
        contractId: "trellis.agent@v1",
      },
      displayName: "Trellis Agent",
      description: "Local delegated tooling",
      participantKind: "agent",
      capabilities: ["jobs.read"],
      grantedAt: now,
      updatedAt: now,
    }],
  }));
  assertFalse(Value.Check(GeneratedAuthIdentitiesGrantsListResponseSchema, {
    grants: [{
      identityEnvelopeId: "env_123",
      identityAnchor: {
        kind: "cli",
        contractId: "trellis.agent@v1",
        sessionPublicKey: "session-agent",
      },
      contractEvidence: {
        contractDigest: "digest_123",
        contractId: "",
      },
      displayName: "Trellis Agent",
      description: "Local delegated tooling",
      participantKind: "agent",
      capabilities: ["jobs.read"],
      grantedAt: now,
      updatedAt: now,
    }],
  }));
  assertFalse(Value.Check(GeneratedAuthIdentitiesGrantsListResponseSchema, {
    grants: [{
      contractDigest: "digest_123",
      contractId: "trellis.agent@v1",
      displayName: "Trellis Agent",
      description: "Local delegated tooling",
      participantKind: "agent",
      capabilities: ["jobs.read"],
      grantedAt: "not-a-date",
      updatedAt: now,
    }],
  }));
  assertFalse(Value.Check(GeneratedAuthIdentityEnvelopesRevokeSchema, {
    contractDigest: "digest with spaces",
  }));
});

Deno.test("identity envelope revoke schema rejects contractDigest authority", () => {
  assertFalse(Value.Check(AuthIdentityEnvelopesRevokeSchema, {
    contractDigest: "digest_123",
  }));
  assertFalse(Value.Check(GeneratedAuthIdentityEnvelopesRevokeSchema, {
    contractDigest: "digest_123",
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
    requestedBy: {
      origin: "github",
      id: "123",
    },
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesRequestedEventSchema, {
    flowId: "flow_1",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "sherpa",
    requestedAt: now,
    requestedBy: {
      origin: "github",
      id: "123",
    },
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesApprovedEventSchema, {
    reviewId: "dar_1",
    flowId: "flow_1",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "sherpa",
    requestedAt: now,
    approvedAt: now,
    requestedBy: {
      origin: "github",
      id: "123",
    },
    approvedBy: {
      id: "admin",
    },
  }));
  assert(Value.Check(AuthDeviceUserAuthoritiesResolvedEventSchema, {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "sherpa",
    resolvedAt: now,
    resolvedBy: {
      origin: "github",
      id: "123",
    },
    flowId: "flow_1",
    reviewId: "dar_1",
  }));
  assert(Value.Check(AuthDevicesConnectInfoGetSchema, {
    publicIdentityKey: "A".repeat(43),
    contractDigest: "digest-a",
    iat: 123,
    sig: "proof",
  }));
  assertFalse(Value.Check(AuthDevicesConnectInfoGetSchema, {
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
      activations: [],
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
    reviews: [],
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
