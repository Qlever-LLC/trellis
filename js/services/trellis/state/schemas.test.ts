import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import Value from "typebox/value";

import {
  AppIdentitySchema,
  AuthBrowserFlowSchema,
  AuthValidateRequestRequestSchema,
  BindRequestSchema,
  BindResponseSchema,
  ContractApprovalRecordSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewRecordSchema,
  DevicePortalDefaultSchema,
  DevicePortalSelectionSchema,
  DeviceProfileSchema,
  DeviceSchema,
  InstanceGrantPolicySchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  LoginQuerySchema,
  OAuthStateSchema,
  PendingAuthSchema,
  PortalProfileSchema,
  PortalSchema,
  ServiceRegistrySchema,
  SessionKeySchema,
  SessionSchema,
  SignatureSchema,
} from "./schemas.ts";

const sessionKey = "A".repeat(43);
const sig = "B".repeat(86);

Deno.test("SessionKeySchema enforces base64url length for Ed25519 public keys", () => {
  assert(Value.Check(SessionKeySchema, sessionKey));
  assertFalse(Value.Check(SessionKeySchema, "A".repeat(42)));
  assertFalse(Value.Check(SessionKeySchema, "A".repeat(44)));
});

Deno.test("SignatureSchema enforces base64url length for Ed25519 signatures", () => {
  assert(Value.Check(SignatureSchema, sig));
  assertFalse(Value.Check(SignatureSchema, "B".repeat(85)));
  assertFalse(Value.Check(SignatureSchema, "B".repeat(87)));
});

Deno.test("SessionSchema validates session entries", () => {
  assert(
    Value.Check(SessionSchema, {
      type: "user",
      trellisId: "abc",
      origin: "github",
      id: "12345",
      email: "github:12345",
      name: "Test User",
      participantKind: "app",
      contractDigest: "digest",
      contractId: "trellis.console@v1",
      contractDisplayName: "Trellis Console",
      contractDescription: "Admin app",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://app.example.com",
      },
      approvalSource: "admin_policy",
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: ["rpc.v1.Auth.ListServices"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connect"],
      createdAt: new Date().toISOString(),
      lastAuth: new Date().toISOString(),
    }),
  );
  assert(
    Value.Check(SessionSchema, {
      type: "service",
      trellisId: "svc",
      origin: "service",
      id: "graph",
      email: "graph@trellis.internal",
      name: "graph",
      instanceId: "svc-1",
      profileId: "graph.default",
      instanceKey: "graph-instance-key",
      currentContractId: null,
      currentContractDigest: null,
      createdAt: new Date().toISOString(),
      lastAuth: new Date().toISOString(),
    }),
  );
  assert(
    Value.Check(SessionSchema, {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: sessionKey,
      profileId: "drive.default",
      contractId: "trellis.device@v1",
      contractDigest: "digest",
      delegatedCapabilities: ["device.sync"],
      delegatedPublishSubjects: ["subject.v1.device.sync"],
      delegatedSubscribeSubjects: ["events.v1.Device.Status.*"],
      createdAt: new Date().toISOString(),
      lastAuth: new Date().toISOString(),
      activatedAt: null,
      revokedAt: null,
    }),
  );
});

Deno.test("Portal and browser-flow schemas validate", () => {
  assert(Value.Check(AppIdentitySchema, {
    contractId: "trellis.console@v1",
    origin: "https://app.example.com",
  }));
  assert(Value.Check(AuthBrowserFlowSchema, {
    flowId: "flow_123",
    kind: "login",
    sessionKey,
    redirectTo: "https://app.example.com/dashboard",
    app: {
      contractId: "trellis.console@v1",
      origin: "https://app.example.com",
    },
    contract: { id: "trellis.console@v1" },
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  }));
  assert(Value.Check(AuthBrowserFlowSchema, {
    flowId: "flow_456",
    kind: "device_activation",
    deviceActivation: {
      instanceId: "dev_123",
      profileId: "reader.default",
      publicIdentityKey: sessionKey,
      nonce: "nonce",
      qrMac: "mac",
    },
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  }));
});

Deno.test("portal and device state schemas validate", () => {
  assert(Value.Check(PortalSchema, {
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    disabled: false,
  }));
  assert(Value.Check(PortalProfileSchema, {
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    contractId: "trellis.portal@v1",
    allowedOrigins: ["https://portal.example.com"],
    impliedCapabilities: ["auth.login"],
    disabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  assert(Value.Check(LoginPortalDefaultSchema, {
    portalId: null,
  }));
  assert(Value.Check(LoginPortalSelectionSchema, {
    contractId: "trellis.console@v1",
    portalId: "main",
  }));
  assert(Value.Check(DevicePortalDefaultSchema, {
    portalId: "main",
  }));
  assert(Value.Check(DevicePortalSelectionSchema, {
    profileId: "reader.default",
    portalId: null,
  }));
  assert(Value.Check(DeviceProfileSchema, {
    profileId: "reader.default",
    appliedContracts: [{
      contractId: "acme.reader@v1",
      allowedDigests: ["digest-a"],
    }],
    reviewMode: "none",
    disabled: false,
  }));
  assert(Value.Check(DeviceSchema, {
    instanceId: "dev_123",
    publicIdentityKey: sessionKey,
    profileId: "reader.default",
    metadata: {
      name: "Front Desk Reader",
      serialNumber: "SN-123",
      modelNumber: "MODEL-9",
      assetTag: "asset-42",
    },
    state: "registered",
    createdAt: new Date().toISOString(),
    activatedAt: null,
    revokedAt: null,
  }));
  assert(Value.Check(DeviceActivationRecordSchema, {
    instanceId: "dev_123",
    publicIdentityKey: sessionKey,
    profileId: "reader.default",
    activatedBy: {
      origin: "github",
      id: "123",
    },
    state: "activated",
    activatedAt: new Date().toISOString(),
    revokedAt: null,
  }));
  assert(Value.Check(DeviceActivationReviewRecordSchema, {
    reviewId: "dar_123",
    flowId: "flow_123",
    instanceId: "dev_123",
    publicIdentityKey: sessionKey,
    profileId: "reader.default",
    requestedBy: {
      origin: "github",
      id: "123",
    },
    state: "pending",
    requestedAt: new Date().toISOString(),
    decidedAt: null,
  }));
  assert(Value.Check(InstanceGrantPolicySchema, {
    contractId: "trellis.console@v1",
    allowedOrigins: ["https://app.example.com"],
    impliedCapabilities: ["admin"],
    disabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: { kind: "admin_policy" },
  }));
});

Deno.test("LoginQuerySchema validates login params", () => {
  assert(
    Value.Check(LoginQuerySchema, {
      provider: "github",
      redirectTo: "https://app.example.com/dashboard",
      sessionKey,
      sig,
      contract: "eyJpZCI6InRyZWxsaXMuY2xpQHYxIn0",
      context: "eyJzdWJ0aXRsZSI6IldlbGNvbWUifQ",
    }),
  );
  assertFalse(
    Value.Check(LoginQuerySchema, {
      provider: "github",
      redirectTo: "https://app.example.com/dashboard",
      sessionKey,
      sig,
      contract: "eyJpZCI6InRyZWxsaXMuY2xpQHYxIn0",
      rollout: "canary",
    }),
  );
});

Deno.test("OAuthStateSchema validates browser flow linkage", () => {
  assert(Value.Check(OAuthStateSchema, {
    provider: "github",
    redirectTo: "https://app.example.com/dashboard",
    codeVerifier: "code-verifier",
    sessionKey,
    app: {
      contractId: "trellis.console@v1",
      origin: "https://app.example.com",
    },
    contract: { id: "trellis.console@v1" },
    context: { subtitle: "Welcome" },
    flowId: "flow_123",
    createdAt: new Date().toISOString(),
  }));
});

Deno.test("PendingAuthSchema validates explicit app identity", () => {
  assert(Value.Check(PendingAuthSchema, {
    user: {
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
    },
    sessionKey,
    redirectTo: "https://app.example.com/dashboard",
    app: {
      contractId: "trellis.console@v1",
      origin: "https://app.example.com",
    },
    contract: { id: "trellis.console@v1" },
    createdAt: new Date().toISOString(),
  }));
});

Deno.test("LoginQuerySchema requires a contract payload", () => {
  assertFalse(
    Value.Check(LoginQuerySchema, {
      redirectTo: "https://app.example.com/dashboard",
      sessionKey,
      sig,
    }),
  );
});

Deno.test("BindRequestSchema validates bind params", () => {
  assert(
    Value.Check(BindRequestSchema, {
      authToken: "token",
      sessionKey,
      sig,
    }),
  );
  assertFalse(
    Value.Check(BindRequestSchema, {
      authToken: "token",
      sessionKey,
      sig,
      rollout: "canary",
    }),
  );
});

Deno.test("BindResponseSchema validates insufficient-capabilities responses", () => {
  assert(
    Value.Check(BindResponseSchema, {
      status: "insufficient_capabilities",
      approval: {
        contractDigest: "digest",
        contractId: "trellis.console@v1",
        displayName: "Trellis Console",
        description: "Admin app",
        participantKind: "app",
        capabilities: ["admin"],
      },
      missingCapabilities: ["admin"],
      userCapabilities: ["users.read"],
    }),
  );
});

Deno.test("BindResponseSchema validates bound responses with explicit transports", () => {
  assert(
    Value.Check(BindResponseSchema, {
      status: "bound",
      inboxPrefix: "_INBOX.abc",
      expires: new Date().toISOString(),
      sentinel: {
        jwt: "jwt",
        seed: "seed",
      },
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
    }),
  );
});

Deno.test("ServiceRegistrySchema validates createdAt field", () => {
  const service = {
    displayName: "test-service",
    active: true,
    capabilities: ["service"],
    description: "Test service",
    createdAt: new Date().toISOString(),
  };

  assert(Value.Check(ServiceRegistrySchema, service));
});

Deno.test("ServiceRegistrySchema requires createdAt", () => {
  const service = {
    displayName: "test-service",
    active: true,
    capabilities: ["service"],
    description: "Test service",
  };

  assertFalse(Value.Check(ServiceRegistrySchema, service));
});

Deno.test("AuthValidateRequestRequestSchema validates ADR auth request", () => {
  assert(
    Value.Check(AuthValidateRequestRequestSchema, {
      sessionKey,
      proof: sig,
      subject: "rpc.v1.Auth.Me",
      payloadHash: "a".repeat(43),
      capabilities: ["users:read"],
    }),
  );
});

Deno.test("ContractApprovalRecordSchema validates stored app approvals", () => {
  assert(
    Value.Check(ContractApprovalRecordSchema, {
      userTrellisId: "abc",
      origin: "github",
      id: "12345",
      answer: "approved",
      answeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approval: {
        contractDigest: "digest",
        contractId: "trellis.console@v1",
        displayName: "Trellis Console",
        description: "Admin app",
        participantKind: "app",
        capabilities: ["admin"],
      },
      publishSubjects: ["rpc.v1.Auth.ListServices"],
      subscribeSubjects: ["_INBOX.example.>"],
    }),
  );
});
