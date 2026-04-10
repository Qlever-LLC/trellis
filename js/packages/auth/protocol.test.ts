import { assert, assertFalse } from "@std/assert";
import Value from "typebox/value";

import {
  AuthActivateWorkloadResponseSchema,
  AuthActivateWorkloadSchema,
  AuthClearLoginPortalSelectionResponseSchema,
  AuthClearLoginPortalSelectionSchema,
  AuthClearWorkloadPortalSelectionResponseSchema,
  AuthClearWorkloadPortalSelectionSchema,
  AuthCreatePortalResponseSchema,
  AuthCreatePortalSchema,
  AuthCreateWorkloadProfileResponseSchema,
  AuthCreateWorkloadProfileSchema,
  AuthMeResponseSchema,
  AuthDisablePortalResponseSchema,
  AuthDisablePortalSchema,
  AuthDisableWorkloadInstanceResponseSchema,
  AuthDisableWorkloadInstanceSchema,
  AuthDisableWorkloadProfileResponseSchema,
  AuthDisableWorkloadProfileSchema,
   AuthGetLoginPortalDefaultResponseSchema,
   AuthGetLoginPortalDefaultSchema,
   AuthGetWorkloadActivationStatusResponseSchema,
   AuthGetWorkloadActivationStatusSchema,
   AuthGetWorkloadConnectInfoResponseSchema,
   AuthGetWorkloadConnectInfoSchema,
   AuthGetWorkloadPortalDefaultResponseSchema,
   AuthGetWorkloadPortalDefaultSchema,
   AuthListLoginPortalSelectionsResponseSchema,
   AuthListLoginPortalSelectionsSchema,
   AuthListPortalsResponseSchema,
   AuthListPortalsSchema,
   AuthListWorkloadActivationReviewsResponseSchema,
   AuthListWorkloadActivationReviewsSchema,
   AuthListWorkloadPortalSelectionsResponseSchema,
   AuthListWorkloadPortalSelectionsSchema,
   AuthListWorkloadActivationsResponseSchema,
   AuthListWorkloadActivationsSchema,
   AuthListWorkloadInstancesResponseSchema,
   AuthListWorkloadInstancesSchema,
   AuthListWorkloadProfilesResponseSchema,
   AuthListWorkloadProfilesSchema,
   AuthProvisionWorkloadInstanceResponseSchema,
   AuthProvisionWorkloadInstanceSchema,
   AuthDecideWorkloadActivationReviewResponseSchema,
   AuthDecideWorkloadActivationReviewSchema,
   AuthRevokeWorkloadActivationResponseSchema,
   AuthRevokeWorkloadActivationSchema,
  AuthSetLoginPortalDefaultResponseSchema,
  AuthSetLoginPortalDefaultSchema,
  AuthSetLoginPortalSelectionResponseSchema,
  AuthSetLoginPortalSelectionSchema,
  AuthSetWorkloadPortalDefaultResponseSchema,
  AuthSetWorkloadPortalDefaultSchema,
  AuthSetWorkloadPortalSelectionResponseSchema,
  AuthSetWorkloadPortalSelectionSchema,
  AuthValidateRequestResponseSchema,
  PortalFlowStateSchema,
  WorkloadConnectInfoSchema,
  WorkloadSchema,
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

Deno.test("AuthValidateRequestResponseSchema validates workload caller variants", () => {
  assert(Value.Check(AuthValidateRequestResponseSchema, {
    allowed: true,
    inboxPrefix: "_INBOX.session",
    caller: {
      type: "user",
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
      type: "workload",
      instanceId: "wrk_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["workload.sync"],
    },
  }));
  assertFalse(Value.Check(AuthValidateRequestResponseSchema, {
    allowed: true,
    inboxPrefix: "_INBOX.session",
    caller: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "drive",
      runtimePublicKey: "A".repeat(43),
      profileId: "drive.default",
      active: true,
      capabilities: ["device:sync"],
    },
  }));
});

Deno.test("portal, portal selection, and workload admin schemas validate", () => {
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
  assert(Value.Check(AuthSetLoginPortalDefaultSchema, { portalId: "portal-1" }));
  assert(Value.Check(AuthSetLoginPortalDefaultResponseSchema, {
    defaultPortal: { portalId: "portal-1" },
  }));
  assert(Value.Check(AuthListLoginPortalSelectionsSchema, {}));
  assert(Value.Check(AuthListLoginPortalSelectionsResponseSchema, { selections: [] }));
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
  assert(Value.Check(AuthClearLoginPortalSelectionSchema, { contractId: "trellis.console@v1" }));
  assert(Value.Check(AuthClearLoginPortalSelectionResponseSchema, { success: true }));

  assert(Value.Check(AuthGetWorkloadPortalDefaultSchema, {}));
  assert(Value.Check(AuthGetWorkloadPortalDefaultResponseSchema, {
    defaultPortal: { portalId: null },
  }));
  assert(Value.Check(AuthSetWorkloadPortalDefaultSchema, { portalId: "portal-1" }));
  assert(Value.Check(AuthSetWorkloadPortalDefaultResponseSchema, {
    defaultPortal: { portalId: "portal-1" },
  }));
  assert(Value.Check(AuthListWorkloadPortalSelectionsSchema, {}));
  assert(Value.Check(AuthListWorkloadPortalSelectionsResponseSchema, { selections: [] }));
  assert(Value.Check(AuthSetWorkloadPortalSelectionSchema, {
    profileId: "reader.default",
    portalId: null,
  }));
  assert(Value.Check(AuthSetWorkloadPortalSelectionResponseSchema, {
    selection: {
      profileId: "reader.default",
      portalId: null,
    },
  }));
  assert(Value.Check(AuthClearWorkloadPortalSelectionSchema, { profileId: "reader.default" }));
  assert(Value.Check(AuthClearWorkloadPortalSelectionResponseSchema, { success: true }));

  assert(Value.Check(AuthCreateWorkloadProfileSchema, {
    profileId: "reader.default",
    contractId: "acme.reader@v1",
    allowedDigests: ["digest-a", "digest-b"],
    reviewMode: "none",
    contract: { id: "acme.reader@v1" },
  }));
  assert(Value.Check(AuthCreateWorkloadProfileResponseSchema, {
    profile: {
      profileId: "reader.default",
      contractId: "acme.reader@v1",
      allowedDigests: ["digest-a", "digest-b"],
      reviewMode: "none",
      disabled: false,
    },
  }));
  assert(Value.Check(AuthListWorkloadProfilesSchema, {}));
  assert(Value.Check(AuthListWorkloadProfilesResponseSchema, { profiles: [] }));
  assert(Value.Check(AuthDisableWorkloadProfileSchema, { profileId: "reader.default" }));
  assert(Value.Check(AuthDisableWorkloadProfileResponseSchema, { success: true }));

  assert(Value.Check(AuthProvisionWorkloadInstanceSchema, {
    profileId: "reader.default",
    publicIdentityKey: "A".repeat(43),
    activationKey: "B".repeat(43),
  }));
  assert(Value.Check(AuthProvisionWorkloadInstanceResponseSchema, {
    instance: {
      instanceId: "wrk_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      state: "registered",
      createdAt: now,
      activatedAt: null,
      revokedAt: null,
    },
  }));
  assert(Value.Check(AuthListWorkloadInstancesSchema, {}));
  assert(Value.Check(AuthListWorkloadInstancesResponseSchema, { instances: [] }));
  assert(Value.Check(AuthDisableWorkloadInstanceSchema, { instanceId: "wrk_1" }));
  assert(Value.Check(AuthDisableWorkloadInstanceResponseSchema, { success: true }));
});

Deno.test("AuthMeResponseSchema validates user, workload, and service envelopes", () => {
  assert(Value.Check(AuthMeResponseSchema, {
    user: {
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["admin"],
    },
    workload: null,
    service: null,
  }));
  assert(Value.Check(AuthMeResponseSchema, {
    user: null,
    workload: {
      type: "workload",
      instanceId: "wrk_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["workload.sync"],
    },
    service: null,
  }));
  assert(Value.Check(AuthMeResponseSchema, {
    user: null,
    workload: null,
    service: {
      type: "service",
      id: "billing",
      name: "Billing",
      active: true,
      capabilities: ["service"],
    },
  }));
});

Deno.test("workload activation and connect-info schemas validate", () => {
  assert(Value.Check(WorkloadConnectInfoSchema, {
    instanceId: "wrk_1",
    profileId: "reader.default",
    contractId: "acme.reader@v1",
    contractDigest: "digest-a",
    transport: {
      natsServers: ["nats://127.0.0.1:4222"],
      sentinel: {
        jwt: "jwt",
        seed: "seed",
      },
    },
    auth: {
      mode: "workload_identity",
      iatSkewSeconds: 30,
    },
  }));

  assert(Value.Check(AuthActivateWorkloadSchema, { handoffId: "wah_1" }));
  assert(Value.Check(AuthActivateWorkloadResponseSchema, {
    status: "activated",
    instanceId: "wrk_1",
    profileId: "reader.default",
    activatedAt: now,
    confirmationCode: "ABCD1234",
  }));
  assert(Value.Check(AuthActivateWorkloadResponseSchema, {
    status: "pending_review",
    reviewId: "war_1",
    instanceId: "wrk_1",
    profileId: "reader.default",
    requestedAt: now,
  }));
  assert(Value.Check(AuthActivateWorkloadResponseSchema, {
    status: "rejected",
    reason: "policy_denied",
  }));
  assert(Value.Check(AuthGetWorkloadActivationStatusSchema, {
    handoffId: "wah_1",
  }));
  assert(Value.Check(AuthGetWorkloadActivationStatusResponseSchema, {
    status: "pending_review",
    reviewId: "war_1",
    instanceId: "wrk_1",
    profileId: "reader.default",
    requestedAt: now,
  }));
  assert(Value.Check(AuthGetWorkloadConnectInfoSchema, {
    publicIdentityKey: "A".repeat(43),
    contractDigest: "digest-a",
    iat: 123,
    sig: "proof",
  }));
  assert(Value.Check(AuthGetWorkloadConnectInfoResponseSchema, {
    status: "ready",
    connectInfo: {
      instanceId: "wrk_1",
      profileId: "reader.default",
      contractId: "acme.reader@v1",
      contractDigest: "digest-a",
      transport: {
        natsServers: ["nats://127.0.0.1:4222"],
        sentinel: { jwt: "jwt", seed: "seed" },
      },
      auth: {
        mode: "workload_identity",
        iatSkewSeconds: 30,
      },
    },
  }));
  assert(Value.Check(AuthListWorkloadActivationsSchema, {
    instanceId: "wrk_1",
    state: "activated",
  }));
  assert(Value.Check(AuthListWorkloadActivationsResponseSchema, { activations: [] }));
  assert(Value.Check(AuthRevokeWorkloadActivationSchema, { instanceId: "wrk_1" }));
  assert(Value.Check(AuthRevokeWorkloadActivationResponseSchema, { success: true }));
  assert(Value.Check(AuthListWorkloadActivationReviewsSchema, {
    profileId: "reader.default",
    state: "pending",
  }));
  assert(Value.Check(AuthListWorkloadActivationReviewsResponseSchema, {
    reviews: [],
  }));
  assert(Value.Check(AuthDecideWorkloadActivationReviewSchema, {
    reviewId: "war_1",
    decision: "approve",
    reason: "approved_by_policy",
  }));
  assert(Value.Check(AuthDecideWorkloadActivationReviewResponseSchema, {
    review: {
      reviewId: "war_1",
      instanceId: "wrk_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      state: "approved",
      requestedAt: now,
      decidedAt: now,
      reason: "approved_by_policy",
    },
    activation: {
      instanceId: "wrk_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      state: "activated",
      activatedAt: now,
      revokedAt: null,
    },
    confirmationCode: "ABCD1234",
  }));
});

Deno.test("WorkloadSchema validates profile-attached workloads", () => {
  assert(Value.Check(WorkloadSchema, {
    instanceId: "wrk_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "reader.default",
    state: "registered",
    createdAt: now,
    activatedAt: null,
    revokedAt: null,
  }));
});
