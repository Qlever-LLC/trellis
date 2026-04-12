import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import Value from "typebox/value";

import {
  AuthBrowserFlowSchema,
  AuthRenewBindingTokenRequestSchema,
  AuthRenewBindingTokenResponseSchema,
  AuthValidateRequestRequestSchema,
  BindingTokenRecordSchema,
  BindRequestSchema,
  BindResponseSchema,
  ContractApprovalRecordSchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  LoginQuerySchema,
  OAuthStateSchema,
  PortalSchema,
  ServiceRegistrySchema,
  SessionKeySchema,
  SessionSchema,
  SignatureSchema,
  DevicePortalDefaultSchema,
  DevicePortalSelectionSchema,
  DeviceActivationHandoffSchema,
  DeviceActivationRecordSchema,
  DeviceProfileSchema,
  DeviceSchema,
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
      contractDigest: "digest",
      contractId: "trellis.console@v1",
      contractDisplayName: "Trellis Console",
      contractDescription: "Admin app",
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
  assert(Value.Check(AuthBrowserFlowSchema, {
    flowId: "flow_123",
    kind: "login",
    sessionKey,
    redirectTo: "https://app.example.com/dashboard",
    contract: { id: "trellis.console@v1" },
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  }));
});

Deno.test("portal and device state schemas validate", () => {
  assert(Value.Check(PortalSchema, {
    portalId: "main",
    appContractId: "trellis.portal@v1",
    entryUrl: "https://portal.example.com/auth",
    disabled: false,
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
    contractId: "acme.reader@v1",
    allowedDigests: ["digest-a"],
    reviewMode: "none",
    disabled: false,
  }));
  assert(Value.Check(DeviceSchema, {
    instanceId: "dev_123",
    publicIdentityKey: sessionKey,
    profileId: "reader.default",
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
  assert(Value.Check(DeviceActivationHandoffSchema, {
    handoffId: "dah_123",
    instanceId: "dev_123",
    publicIdentityKey: sessionKey,
    nonce: "nonce",
    qrMac: "mac",
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
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
});

Deno.test("OAuthStateSchema validates browser flow linkage", () => {
  assert(Value.Check(OAuthStateSchema, {
    provider: "github",
    redirectTo: "https://app.example.com/dashboard",
    codeVerifier: "code-verifier",
    sessionKey,
    contract: { id: "trellis.console@v1" },
    context: { subtitle: "Welcome" },
    flowId: "flow_123",
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
        kind: "app",
        capabilities: ["admin"],
      },
      missingCapabilities: ["admin"],
      userCapabilities: ["users.read"],
    }),
  );
});

Deno.test("BindResponseSchema validates bound responses with nats servers", () => {
  assert(
    Value.Check(BindResponseSchema, {
      status: "bound",
      bindingToken: "token",
      inboxPrefix: "_INBOX.abc",
      expires: new Date().toISOString(),
      sentinel: {
        jwt: "jwt",
        seed: "seed",
      },
      natsServers: ["ws://localhost:8080"],
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

Deno.test("AuthRenewBindingToken schemas validate", () => {
  assert(Value.Check(AuthRenewBindingTokenRequestSchema, {}));
  assert(
    Value.Check(AuthRenewBindingTokenResponseSchema, {
      status: "bound",
      bindingToken: "token",
      inboxPrefix: "_INBOX.aaaaaaaaaaaaaaaa",
      expires: new Date().toISOString(),
      sentinel: { jwt: "jwt", seed: "seed" },
      natsServers: ["ws://localhost:8080"],
    }),
  );
});

Deno.test("BindingTokenRecordSchema validates stored binding token records", () => {
  assert(
    Value.Check(BindingTokenRecordSchema, {
      sessionKey,
      kind: "initial",
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    }),
  );
});

Deno.test("BindingTokenRecordSchema decodes canonical ISO dates to Date objects", () => {
  const record = Value.Decode(BindingTokenRecordSchema, {
    sessionKey,
    kind: "initial",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
  }) as {
    createdAt: Date;
    expiresAt: Date;
  };

  assertEquals(record.createdAt.toISOString(), "2026-01-01T00:00:00.000Z");
  assertEquals(record.expiresAt.toISOString(), "2026-01-02T00:00:00.000Z");
});

Deno.test("BindingTokenRecordSchema rejects non-canonical ISO dates during decode", () => {
  assertThrows(() =>
    Value.Decode(BindingTokenRecordSchema, {
      sessionKey,
      kind: "initial",
      createdAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
    })
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
        capabilities: ["admin"],
      },
      publishSubjects: ["rpc.v1.Auth.ListServices"],
      subscribeSubjects: ["_INBOX.example.>"],
    }),
  );
});
