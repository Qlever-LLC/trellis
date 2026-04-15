import { assert, assertFalse } from "@std/assert";
import Value from "typebox/value";

import {
  AuthDeviceActivationReviewRequestedEventSchema,
  AuthActivateDeviceResponseSchema,
  AuthActivateDeviceSchema,
  AuthClearDevicePortalSelectionResponseSchema,
  AuthClearDevicePortalSelectionSchema,
  AuthClearLoginPortalSelectionResponseSchema,
  AuthClearLoginPortalSelectionSchema,
  AuthCreateDeviceProfileResponseSchema,
  AuthCreateDeviceProfileSchema,
  AuthCreatePortalResponseSchema,
  AuthCreatePortalSchema,
  AuthDecideDeviceActivationReviewResponseSchema,
  AuthDecideDeviceActivationReviewSchema,
  AuthDisableDeviceInstanceResponseSchema,
  AuthDisableDeviceInstanceSchema,
  AuthDisableDeviceProfileResponseSchema,
  AuthDisableDeviceProfileSchema,
  AuthDisablePortalResponseSchema,
  AuthDisablePortalSchema,
  AuthGetDeviceActivationStatusResponseSchema,
  AuthGetDeviceActivationStatusSchema,
  AuthGetDeviceConnectInfoResponseSchema,
  AuthGetDeviceConnectInfoSchema,
  AuthGetDevicePortalDefaultResponseSchema,
  AuthGetDevicePortalDefaultSchema,
  AuthGetLoginPortalDefaultResponseSchema,
  AuthGetLoginPortalDefaultSchema,
  AuthDisableInstanceGrantPolicyResponseSchema,
  AuthDisableInstanceGrantPolicySchema,
  AuthListInstanceGrantPoliciesResponseSchema,
  AuthListInstanceGrantPoliciesSchema,
  AuthListDeviceActivationReviewsResponseSchema,
  AuthListDeviceActivationReviewsSchema,
  AuthListDeviceActivationsResponseSchema,
  AuthListDeviceActivationsSchema,
  AuthListDeviceInstancesResponseSchema,
  AuthListDeviceInstancesSchema,
  AuthListDevicePortalSelectionsResponseSchema,
  AuthListDevicePortalSelectionsSchema,
  AuthListDeviceProfilesResponseSchema,
  AuthListDeviceProfilesSchema,
  AuthListLoginPortalSelectionsResponseSchema,
  AuthListLoginPortalSelectionsSchema,
  AuthListPortalsResponseSchema,
  AuthListPortalsSchema,
  AuthMeResponseSchema,
  AuthProvisionDeviceInstanceResponseSchema,
  AuthProvisionDeviceInstanceSchema,
  AuthRevokeDeviceActivationResponseSchema,
  AuthRevokeDeviceActivationSchema,
  AuthSetDevicePortalDefaultResponseSchema,
  AuthSetDevicePortalDefaultSchema,
  AuthSetDevicePortalSelectionResponseSchema,
  AuthSetDevicePortalSelectionSchema,
  AuthUpsertInstanceGrantPolicyResponseSchema,
  AuthUpsertInstanceGrantPolicySchema,
  AuthSetLoginPortalDefaultResponseSchema,
  AuthSetLoginPortalDefaultSchema,
  AuthSetLoginPortalSelectionResponseSchema,
  AuthSetLoginPortalSelectionSchema,
  AuthValidateRequestResponseSchema,
  DeviceConnectInfoSchema,
  DeviceSchema,
  InstanceGrantPolicySchema,
  PortalFlowStateSchema,
} from "./mod.ts";

const now = new Date().toISOString();

Deno.test("PortalFlowStateSchema validates portal states without contract kind", () => {
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
  assertFalse(Value.Check(PortalFlowStateSchema, {
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

Deno.test("PortalFlowStateSchema accepts returnLocation for restartable portal states", () => {
  assert(Value.Check(PortalFlowStateSchema, {
    status: "approval_denied",
    flowId: "flow_1",
    approval: {
      contractId: "trellis.console@v1",
      contractDigest: "digest",
      displayName: "Trellis Console",
      description: "Admin app",
      capabilities: ["admin"],
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
      capabilities: ["admin"],
    },
    missingCapabilities: ["audit"],
    userCapabilities: ["admin"],
    returnLocation: "https://app.example.com/callback?flowId=flow_2",
  }));
});

Deno.test("AuthValidateRequestResponseSchema validates device caller variants", () => {
  assert(Value.Check(AuthValidateRequestResponseSchema, {
    allowed: true,
    inboxPrefix: "_INBOX.session",
    caller: {
      type: "user",
      trellisId: "tid_123",
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["admin"],
    },
  }));
  assert(Value.Check(AuthValidateRequestResponseSchema, {
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
  assert(Value.Check(AuthValidateRequestResponseSchema, {
    allowed: true,
    inboxPrefix: "_INBOX.session",
    caller: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "reader",
      runtimePublicKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["device.sync"],
    },
  }));
  assertFalse(Value.Check(AuthValidateRequestResponseSchema, {
    allowed: true,
    inboxPrefix: "_INBOX.session",
    caller: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "reader",
      runtimePublicKey: "A".repeat(43),
      profileId: "",
      active: true,
      capabilities: ["device.sync"],
    },
  }));
});

Deno.test("portal, portal selection, and device admin schemas validate", () => {
  assert(Value.Check(AuthListPortalsSchema, {}));
  assert(Value.Check(AuthCreatePortalSchema, {
    portalId: "portal-1",
    appContractId: "trellis.portal@v1",
    entryUrl: "https://portal.example.com/auth",
  }));
  assert(Value.Check(AuthCreatePortalResponseSchema, {
    portal: {
      portalId: "portal-1",
      appContractId: "trellis.portal@v1",
      entryUrl: "https://portal.example.com/auth",
      disabled: false,
    },
  }));
  assert(Value.Check(AuthListPortalsResponseSchema, { portals: [] }));
  assert(Value.Check(AuthDisablePortalSchema, { portalId: "portal-1" }));
  assert(Value.Check(AuthDisablePortalResponseSchema, { success: true }));

  assert(Value.Check(AuthGetLoginPortalDefaultSchema, {}));
  assert(Value.Check(AuthGetLoginPortalDefaultResponseSchema, {
    defaultPortal: { portalId: null },
  }));
  assert(Value.Check(AuthListInstanceGrantPoliciesSchema, {}));
  assert(Value.Check(AuthListInstanceGrantPoliciesResponseSchema, {
    policies: [],
  }));
  assert(Value.Check(AuthUpsertInstanceGrantPolicySchema, {
    contractId: "trellis.console@v1",
    allowedOrigins: ["https://app.example.com"],
    impliedCapabilities: ["admin"],
  }));
  assert(Value.Check(InstanceGrantPolicySchema, {
    contractId: "trellis.console@v1",
    allowedOrigins: ["https://app.example.com"],
    impliedCapabilities: ["admin"],
    disabled: false,
    createdAt: now,
    updatedAt: now,
    source: { kind: "admin_policy" },
  }));
  assert(Value.Check(AuthUpsertInstanceGrantPolicyResponseSchema, {
    policy: {
      contractId: "trellis.console@v1",
      impliedCapabilities: [],
      disabled: false,
      createdAt: now,
      updatedAt: now,
      source: { kind: "admin_policy" },
    },
  }));
  assert(Value.Check(AuthDisableInstanceGrantPolicySchema, {
    contractId: "trellis.console@v1",
  }));
  assert(Value.Check(AuthDisableInstanceGrantPolicyResponseSchema, {
    policy: {
      contractId: "trellis.console@v1",
      impliedCapabilities: [],
      disabled: true,
      createdAt: now,
      updatedAt: now,
      source: { kind: "admin_policy" },
    },
  }));
  assert(
    Value.Check(AuthSetLoginPortalDefaultSchema, { portalId: "portal-1" }),
  );
  assert(Value.Check(AuthSetLoginPortalDefaultResponseSchema, {
    defaultPortal: { portalId: "portal-1" },
  }));
  assert(Value.Check(AuthListLoginPortalSelectionsSchema, {}));
  assert(
    Value.Check(AuthListLoginPortalSelectionsResponseSchema, {
      selections: [],
    }),
  );
  assert(Value.Check(AuthSetLoginPortalSelectionSchema, {
    contractId: "trellis.console@v1",
    portalId: "portal-1",
  }));
  assert(Value.Check(AuthSetLoginPortalSelectionResponseSchema, {
    selection: {
      contractId: "trellis.console@v1",
      portalId: "portal-1",
    },
  }));
  assert(
    Value.Check(AuthClearLoginPortalSelectionSchema, {
      contractId: "trellis.console@v1",
    }),
  );
  assert(
    Value.Check(AuthClearLoginPortalSelectionResponseSchema, { success: true }),
  );

  assert(Value.Check(AuthGetDevicePortalDefaultSchema, {}));
  assert(Value.Check(AuthGetDevicePortalDefaultResponseSchema, {
    defaultPortal: { portalId: null },
  }));
  assert(
    Value.Check(AuthSetDevicePortalDefaultSchema, { portalId: "portal-1" }),
  );
  assert(Value.Check(AuthSetDevicePortalDefaultResponseSchema, {
    defaultPortal: { portalId: "portal-1" },
  }));
  assert(Value.Check(AuthListDevicePortalSelectionsSchema, {}));
  assert(
    Value.Check(AuthListDevicePortalSelectionsResponseSchema, {
      selections: [],
    }),
  );
  assert(Value.Check(AuthSetDevicePortalSelectionSchema, {
    profileId: "reader.default",
    portalId: null,
  }));
  assert(Value.Check(AuthSetDevicePortalSelectionResponseSchema, {
    selection: {
      profileId: "reader.default",
      portalId: null,
    },
  }));
  assert(
    Value.Check(AuthClearDevicePortalSelectionSchema, {
      profileId: "reader.default",
    }),
  );
  assert(
    Value.Check(AuthClearDevicePortalSelectionResponseSchema, {
      success: true,
    }),
  );

  assert(Value.Check(AuthCreateDeviceProfileSchema, {
    profileId: "reader.default",
    contractId: "acme.reader@v1",
    allowedDigests: ["digest-a", "digest-b"],
    reviewMode: "none",
    contract: { id: "acme.reader@v1" },
  }));
  assert(Value.Check(AuthCreateDeviceProfileResponseSchema, {
    profile: {
      profileId: "reader.default",
      contractId: "acme.reader@v1",
      allowedDigests: ["digest-a", "digest-b"],
      reviewMode: "none",
      disabled: false,
    },
  }));
  assert(Value.Check(AuthListDeviceProfilesSchema, {}));
  assert(Value.Check(AuthListDeviceProfilesResponseSchema, { profiles: [] }));
  assert(
    Value.Check(AuthDisableDeviceProfileSchema, {
      profileId: "reader.default",
    }),
  );
  assert(
    Value.Check(AuthDisableDeviceProfileResponseSchema, { success: true }),
  );

  assert(Value.Check(AuthProvisionDeviceInstanceSchema, {
    profileId: "reader.default",
    publicIdentityKey: "A".repeat(43),
    activationKey: "B".repeat(43),
    metadata: {
      name: "Front Desk Reader",
      serialNumber: "SN-123",
      modelNumber: "MODEL-9",
      assetTag: "asset-42",
    },
  }));
  assert(Value.Check(AuthProvisionDeviceInstanceResponseSchema, {
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
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
  assert(Value.Check(AuthListDeviceInstancesSchema, {}));
  assert(Value.Check(AuthListDeviceInstancesResponseSchema, { instances: [] }));
  assert(Value.Check(AuthDisableDeviceInstanceSchema, { instanceId: "dev_1" }));
  assert(
    Value.Check(AuthDisableDeviceInstanceResponseSchema, { success: true }),
  );
});

Deno.test("AuthMeResponseSchema validates user, device, and service envelopes", () => {
  assert(Value.Check(AuthMeResponseSchema, {
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
  assert(Value.Check(AuthMeResponseSchema, {
    user: null,
    device: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "reader",
      runtimePublicKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["device.sync"],
    },
    service: null,
  }));
  assert(Value.Check(AuthMeResponseSchema, {
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
});

Deno.test("device activation and connect-info schemas validate", () => {
  assert(Value.Check(DeviceConnectInfoSchema, {
    instanceId: "dev_1",
    profileId: "reader.default",
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
      iatSkewSeconds: 30,
    },
  }));

  assert(Value.Check(AuthActivateDeviceSchema, { handoffId: "dah_1", linkRequestId: "link_1" }));
  assert(Value.Check(AuthActivateDeviceResponseSchema, {
    status: "activated",
    instanceId: "dev_1",
    profileId: "reader.default",
    activatedAt: now,
    confirmationCode: "ABCD1234",
  }));
  assert(Value.Check(AuthActivateDeviceResponseSchema, {
    status: "pending_review",
    reviewId: "dar_1",
    linkRequestId: "link_1",
    instanceId: "dev_1",
    profileId: "reader.default",
    requestedAt: now,
  }));
  assert(Value.Check(AuthActivateDeviceResponseSchema, {
    status: "rejected",
    reason: "policy_denied",
  }));
  assert(Value.Check(AuthGetDeviceActivationStatusSchema, {
    handoffId: "dah_1",
  }));
  assert(Value.Check(AuthGetDeviceActivationStatusResponseSchema, {
    status: "pending_review",
    reviewId: "dar_1",
    linkRequestId: "link_1",
    instanceId: "dev_1",
    profileId: "reader.default",
    requestedAt: now,
  }));
  assert(Value.Check(AuthDeviceActivationReviewRequestedEventSchema, {
    reviewId: "dar_1",
    linkRequestId: "link_1",
    handoffId: "dah_1",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "sherpa",
    requestedAt: now,
    requestedBy: {
      origin: "github",
      id: "123",
    },
  }));
  assert(Value.Check(AuthGetDeviceConnectInfoSchema, {
    publicIdentityKey: "A".repeat(43),
    contractDigest: "digest-a",
    iat: 123,
    sig: "proof",
  }));
  assert(Value.Check(AuthGetDeviceConnectInfoResponseSchema, {
    status: "ready",
    connectInfo: {
      instanceId: "dev_1",
      profileId: "reader.default",
      contractId: "acme.reader@v1",
      contractDigest: "digest-a",
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      transport: {
        sentinel: { jwt: "jwt", seed: "seed" },
      },
      auth: {
        mode: "device_identity",
        iatSkewSeconds: 30,
      },
    },
  }));
  assert(Value.Check(AuthListDeviceActivationsSchema, {
    instanceId: "dev_1",
    state: "activated",
  }));
  assert(
    Value.Check(AuthListDeviceActivationsResponseSchema, { activations: [] }),
  );
  assert(
    Value.Check(AuthRevokeDeviceActivationSchema, { instanceId: "dev_1" }),
  );
  assert(
    Value.Check(AuthRevokeDeviceActivationResponseSchema, { success: true }),
  );
  assert(Value.Check(AuthListDeviceActivationReviewsSchema, {
    profileId: "reader.default",
    state: "pending",
  }));
  assert(Value.Check(AuthListDeviceActivationReviewsResponseSchema, {
    reviews: [],
  }));
  assert(Value.Check(AuthDecideDeviceActivationReviewSchema, {
    reviewId: "dar_1",
    decision: "approve",
    reason: "approved_by_policy",
  }));
  assert(Value.Check(AuthDecideDeviceActivationReviewResponseSchema, {
    review: {
      reviewId: "dar_1",
      linkRequestId: "link_1",
      instanceId: "dev_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      state: "approved",
      requestedAt: now,
      decidedAt: now,
      reason: "approved_by_policy",
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      state: "activated",
      activatedAt: now,
      revokedAt: null,
    },
    confirmationCode: "ABCD1234",
  }));
});

Deno.test("DeviceSchema validates profile-attached devices", () => {
  assert(Value.Check(DeviceSchema, {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "reader.default",
    state: "registered",
    createdAt: now,
    activatedAt: null,
    revokedAt: null,
  }));
});
