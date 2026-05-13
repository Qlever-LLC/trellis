import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import Value from "typebox/value";
import { resolveCapabilities } from "./capability_groups.ts";

import {
  AppIdentitySchema,
  AuthBrowserFlowSchema,
  AuthRequestsValidateRequestSchema,
  BindResponseSchema,
  DeploymentContractEvidenceSchema,
  DeploymentEnvelopeSchema,
  DeploymentGrantOverrideSchema,
  DeploymentPortalRouteSchema,
  DeploymentResourceBindingSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewRecordSchema,
  DeviceDeploymentSchema,
  DeviceSchema,
  EnvelopeBoundarySchema,
  EnvelopeExpansionRequestSchema,
  IdentityEnvelopeRecordSchema,
  LocalCredentialSchema,
  OAuthStateSchema,
  PendingAuthSchema,
  SessionKeySchema,
  SessionSchema,
  SignatureSchema,
} from "./schemas.ts";

const sessionKey = "A".repeat(43);
const sig = "B".repeat(86);

Deno.test("capability resolver expands admin without service", async () => {
  const resolved = await resolveCapabilities({
    capabilities: ["admin"],
    capabilityGroups: [],
  });
  assert(resolved.includes("admin"));
  assert(resolved.includes("trellis.auth::device.review"));
  assert(resolved.includes("trellis.auth::events.auth"));
  assert(resolved.includes("trellis.jobs::jobs.admin.read"));
  assert(resolved.includes("trellis.jobs::jobs.admin.mutate"));
  assert(resolved.includes("trellis.jobs::jobs.admin.stream"));
  assert(resolved.includes("trellis.core::trellis.catalog.read"));
  assert(resolved.includes("trellis.core::trellis.contract.read"));
  assertFalse(resolved.includes("service"));
});

Deno.test("capability resolver handles nested custom groups and cycles", async () => {
  const groups = new Map([
    ["outer", {
      groupKey: "outer",
      displayName: "Outer",
      description: "Outer group.",
      capabilities: ["outer.read"],
      includedGroups: ["inner"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    ["inner", {
      groupKey: "inner",
      displayName: "Inner",
      description: "Inner group.",
      capabilities: ["inner.read"],
      includedGroups: ["outer"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
  ]);
  const resolved = await resolveCapabilities(
    { capabilities: ["direct.read"], capabilityGroups: ["outer"] },
    { get: (groupKey) => Promise.resolve(groups.get(groupKey)) },
  );
  assertEquals(resolved, ["direct.read", "inner.read", "outer.read"]);
});

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
      userId: "usr_12345",
      identity: {
        identityId: "idn_github_12345",
        provider: "github",
        subject: "12345",
      },
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
      approvalSource: "deployment_grant",
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: ["rpc.v1.Auth.ListServices"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened"],
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
      deploymentId: "graph.default",
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
      deploymentId: "drive.default",
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
    portalId: "trellis.builtin.login",
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  }));
  assert(Value.Check(AuthBrowserFlowSchema, {
    flowId: "flow_456",
    kind: "device_activation",
    deviceActivation: {
      instanceId: "dev_123",
      deploymentId: "reader.default",
      publicIdentityKey: sessionKey,
      nonce: "nonce",
      qrMac: "mac",
    },
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  }));
});

Deno.test("LocalCredentialSchema validates durable login attempt state", () => {
  assert(Value.Check(LocalCredentialSchema, {
    identityId: "idn_local_alice",
    passwordHash: "hash",
    passwordAlgorithm: "pbkdf2-sha256",
    passwordParams: { v: 1 },
    passwordSetAt: "2026-05-09T00:00:00.000Z",
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    updatedAt: "2026-05-09T00:00:00.000Z",
  }));
  assert(Value.Check(LocalCredentialSchema, {
    identityId: "idn_local_alice",
    passwordHash: "hash",
    passwordAlgorithm: "pbkdf2-sha256",
    passwordParams: { v: 1 },
    passwordSetAt: "2026-05-09T00:00:00.000Z",
    mustChangePassword: false,
    failedLoginCount: 5,
    lockedUntil: "2026-05-09T00:15:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  }));
  assertFalse(Value.Check(LocalCredentialSchema, {
    identityId: "idn_local_alice",
    passwordHash: "hash",
    passwordAlgorithm: "pbkdf2-sha256",
    passwordParams: { v: 1 },
    passwordSetAt: "2026-05-09T00:00:00.000Z",
    mustChangePassword: false,
    failedLoginCount: 1.5,
    lockedUntil: null,
    updatedAt: "2026-05-09T00:00:00.000Z",
  }));
});

Deno.test("device state schemas validate", () => {
  assert(Value.Check(DeviceDeploymentSchema, {
    deploymentId: "reader.default",
    reviewMode: "none",
    disabled: false,
  }));
  assert(Value.Check(DeviceSchema, {
    instanceId: "dev_123",
    publicIdentityKey: sessionKey,
    deploymentId: "reader.default",
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
    deploymentId: "reader.default",
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
    operationId: "op_activate_123",
    flowId: "flow_123",
    instanceId: "dev_123",
    publicIdentityKey: sessionKey,
    deploymentId: "reader.default",
    requestedBy: {
      origin: "github",
      id: "123",
    },
    state: "pending",
    requestedAt: new Date().toISOString(),
    decidedAt: null,
  }));
});

Deno.test("envelope authority storage schemas validate modeled rows", () => {
  const boundary = {
    contracts: [{ contractId: "svc.graph@v1", required: true }],
    surfaces: [{
      contractId: "svc.graph@v1",
      kind: "rpc",
      name: "Graph.Query",
      action: "call",
      required: true,
    }],
    capabilities: ["graph.query"],
    resources: [{ kind: "kv", alias: "cache", required: false }],
  };

  assert(Value.Check(EnvelopeBoundarySchema, boundary));
  assert(Value.Check(DeploymentEnvelopeSchema, {
    deploymentId: "svc.graph.default",
    kind: "service",
    disabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    boundary,
  }));
  assert(Value.Check(DeploymentPortalRouteSchema, {
    deploymentId: "svc.graph.default",
    portalId: null,
    entryUrl: "https://portal.example.com/start",
    disabled: false,
    updatedAt: new Date().toISOString(),
  }));
  assert(Value.Check(DeploymentGrantOverrideSchema, {
    deploymentId: "svc.graph.default",
    identityKind: "web",
    contractId: "app.graph@v1",
    origin: "https://app.example.com",
    sessionPublicKey: null,
    devicePublicKey: null,
    capability: "graph.query",
  }));
  assert(Value.Check(DeploymentResourceBindingSchema, {
    deploymentId: "svc.graph.default",
    kind: "kv",
    alias: "cache",
    binding: { bucket: "graph-cache" },
    limits: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  assert(Value.Check(DeploymentContractEvidenceSchema, {
    deploymentId: "svc.graph.default",
    contractId: "svc.graph@v1",
    contractDigest: "sha256-graph",
    contract: { id: "svc.graph@v1" },
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }));
  assert(Value.Check(EnvelopeExpansionRequestSchema, {
    requestId: "req_123",
    deploymentId: "svc.graph.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc_123" },
    contractId: "svc.graph@v1",
    contractDigest: "sha256-graph",
    contract: { id: "svc.graph@v1" },
    state: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: boundary,
  }));
  assertFalse(Value.Check(EnvelopeExpansionRequestSchema, {
    requestId: "req_123",
    deploymentId: "svc.graph.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc_123" },
    contractId: "svc.graph@v1",
    contractDigest: "sha256-graph",
    contract: { id: "svc.graph@v1" },
    state: "accepted",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: boundary,
  }));
});

Deno.test("OAuthStateSchema validates browser flow linkage", () => {
  assert(Value.Check(OAuthStateSchema, {
    kind: "browser_login",
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
  assert(Value.Check(OAuthStateSchema, {
    kind: "account_flow",
    provider: "github",
    flowId: "flow_456",
    codeVerifier: "code-verifier",
    createdAt: new Date().toISOString(),
  }));
  assertFalse(Value.Check(OAuthStateSchema, {
    provider: "github",
    flowId: "flow_456",
    codeVerifier: "code-verifier",
    createdAt: new Date().toISOString(),
  }));
});

Deno.test("PendingAuthSchema validates explicit app identity", () => {
  assert(Value.Check(PendingAuthSchema, {
    userId: "usr_123",
    identity: {
      identityId: "idn_github_123",
      provider: "github",
      subject: "123",
    },
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
        capabilities: {
          admin: {
            displayName: "Admin",
            description: "Use administrator actions.",
          },
        },
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

Deno.test("AuthRequestsValidateRequestSchema validates ADR auth request", () => {
  assert(
    Value.Check(AuthRequestsValidateRequestSchema, {
      sessionKey,
      proof: sig,
      subject: "rpc.v1.Auth.Sessions.Me",
      payloadHash: "a".repeat(43),
      capabilities: ["users:read"],
    }),
  );
});

Deno.test("IdentityEnvelopeRecordSchema validates stored app envelopes", () => {
  assert(
    Value.Check(IdentityEnvelopeRecordSchema, {
      identityEnvelopeId: "env-console",
      userTrellisId: "abc",
      origin: "github",
      id: "12345",
      identityAnchor: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example",
      },
      answer: "approved",
      answeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalEvidence: {
        contractDigest: "digest",
        contractId: "trellis.console@v1",
        displayName: "Trellis Console",
        description: "Admin app",
        participantKind: "app",
        capabilities: {
          admin: {
            displayName: "Admin",
            description: "Use administrator actions.",
          },
        },
      },
      publishSubjects: ["rpc.v1.Auth.ListServices"],
      subscribeSubjects: ["_INBOX.example.>"],
    }),
  );
});
