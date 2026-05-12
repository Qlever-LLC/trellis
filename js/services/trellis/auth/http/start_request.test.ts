import { assertEquals, assertRejects } from "@std/assert";

import {
  buildAuthStartSignaturePayload,
  createAuthStartRequestHandler,
  resolveCurrentSessionApproval,
} from "./start_request.ts";
import type { ApprovalResolution } from "./support.ts";
import type { EnvelopeBoundary } from "../schemas.ts";

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function boundary(overrides: Partial<EnvelopeBoundary>): EnvelopeBoundary {
  return { ...EMPTY_BOUNDARY, ...overrides };
}

function resolutionFixture(): ApprovalResolution {
  return {
    plan: {
      digest: "digest-new",
      contract: {
        id: "trellis.console@v1",
        displayName: "Console",
        description: "Admin app",
        format: "trellis.contract.v1",
        kind: "app",
      },
      approval: {
        contractDigest: "digest-new",
        contractId: "trellis.console@v1",
        displayName: "Console",
        description: "Admin app",
        participantKind: "app",
        capabilities: {
          admin: {
            displayName: "Admin",
            description: "Administer Trellis.",
          },
        },
      },
      publishSubjects: ["rpc.v1.Auth.Sessions.Me"],
      subscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
    },
    app: {
      contractId: "trellis.console@v1",
      origin: "https://console.example.com",
    },
    userId: "tid_123",
    identityId: "idn_github_123",
    identityProvider: "github",
    identitySubject: "123",
    userEmail: "ada@example.com",
    userName: "Ada",
    sessionPublicKey: "session-key",
    existingProjection: {
      origin: "github",
      id: "123",
      name: "Ada",
      email: "ada@example.com",
      active: true,
      capabilities: ["admin"],
      capabilityGroups: [],
    },
    existingCapabilities: ["admin"],
    effectiveCapabilities: ["admin"],
    missingCapabilities: [],
    matchedPolicies: [],
    effectiveApproval: { kind: "none", answer: "none" },
    storedApproval: null,
  };
}

function currentSessionFixture() {
  return {
    userId: "tid_123",
    identity: {
      identityId: "idn_github_123",
      provider: "github",
      subject: "123",
    },
    origin: "github",
    id: "123",
    email: "ada@example.com",
    name: "Ada",
    contractId: "trellis.console@v1",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: ["rpc.v1.Auth.Sessions.Me"],
    delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
  };
}

Deno.test("approval resolver requires a persisted identity envelope", () => {
  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      approvalSource: "stored_approval",
      delegatedCapabilities: ["admin", "audit"],
      delegatedPublishSubjects: [
        "rpc.v1.Auth.Sessions.Me",
        "rpc.v1.Auth.Identities.List",
      ],
      delegatedSubscribeSubjects: [
        "events.v1.Auth.Connections.Opened.>",
        "events.v1.Auth.Connections.Closed.>",
      ],
      resolution: resolutionFixture(),
    }),
    {
      status: "approval_required",
      delta: boundary({ capabilities: ["admin"] }),
    },
  );
});

Deno.test("approval resolver requires concrete subject and capability subsets", () => {
  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
      identityEnvelope: boundary({ capabilities: ["admin"] }),
      resolution: resolutionFixture(),
    }),
    {
      status: "approval_required",
      delta: boundary({}),
    },
  );
});

Deno.test("approval resolver binds same web identity with new digest when existing identity envelope fits", () => {
  const identityEnvelope = boundary({
    contracts: [{ contractId: "billing@v1", required: true }],
    surfaces: [{
      contractId: "billing@v1",
      kind: "rpc",
      name: "Invoices.List",
      action: "call",
      required: true,
    }],
    capabilities: ["admin"],
  });
  const resolution = resolutionFixture();
  resolution.requestedBoundary = identityEnvelope;

  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: ["rpc.v1.Auth.Sessions.Me"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
      identityEnvelope,
      resolution,
    }),
    { status: "approved", source: "existing_envelope" },
  );
});

Deno.test("approval resolver requests delta for same identity when new digest exceeds envelope", () => {
  const resolution = resolutionFixture();
  resolution.requestedBoundary = boundary({
    capabilities: ["admin", "billing.export"],
  });

  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
      identityEnvelope: boundary({ capabilities: ["admin"] }),
      resolution,
    }),
    {
      status: "approval_required",
      delta: boundary({ capabilities: ["billing.export"] }),
    },
  );
});

Deno.test("approval resolver requires approval when identity anchor changes", () => {
  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://other.example.com",
      },
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: ["rpc.v1.Auth.Sessions.Me"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
      resolution: resolutionFixture(),
    }),
    { status: "approval_required", delta: boundary({}) },
  );
});

Deno.test("approval resolver requires exact cli/native identity anchor kind", () => {
  const resolution = resolutionFixture();
  resolution.app = undefined;

  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "native",
        contractId: "trellis.console@v1",
        sessionPublicKey: "session-key",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: ["rpc.v1.Auth.Sessions.Me"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
      identityEnvelope: boundary({ capabilities: ["admin"] }),
      identityAnchor: {
        kind: "cli",
        contractId: "trellis.console@v1",
        sessionPublicKey: "session-key",
      },
      resolution,
    }),
    { status: "approval_required", delta: boundary({}) },
  );
});

Deno.test("approval resolver reports insufficient user capabilities", () => {
  const resolution = resolutionFixture();
  resolution.missingCapabilities = ["billing.export"];

  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: ["rpc.v1.Auth.Sessions.Me"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
      resolution,
    }),
    {
      status: "insufficient_capabilities",
      missingCapabilities: ["billing.export"],
    },
  );
});

Deno.test("approval resolver reports unavailable system surface", () => {
  const requestedBoundary = boundary({
    surfaces: [{
      contractId: "billing@v1",
      kind: "operation",
      name: "Invoices.Export",
      action: "call",
      required: true,
    }],
  });
  const resolution = resolutionFixture();
  resolution.requestedBoundary = requestedBoundary;

  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: ["rpc.v1.Auth.Sessions.Me"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
      resolution,
      systemAvailabilityEnvelope: EMPTY_BOUNDARY,
    }),
    { status: "unavailable", missingAvailability: requestedBoundary },
  );
});

Deno.test("approval resolver uses resolution system availability when no override argument is passed", () => {
  const requestedBoundary = boundary({
    surfaces: [{
      contractId: "billing@v1",
      kind: "operation",
      name: "Invoices.Export",
      action: "call",
      required: true,
    }],
    capabilities: ["admin"],
  });
  const resolution = resolutionFixture();
  resolution.requestedBoundary = requestedBoundary;
  resolution.systemAvailabilityEnvelope = boundary({ capabilities: ["admin"] });

  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: ["rpc.v1.Auth.Sessions.Me"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
      identityEnvelope: requestedBoundary,
      resolution,
    }),
    {
      status: "unavailable",
      missingAvailability: boundary({
        surfaces: requestedBoundary.surfaces,
      }),
    },
  );
});

Deno.test("approval resolver does not treat system capability gaps as availability gaps", () => {
  const resolution = resolutionFixture();
  resolution.requestedBoundary = boundary({ capabilities: ["admin"] });
  resolution.systemAvailabilityEnvelope = boundary({});

  assertEquals(
    resolveCurrentSessionApproval({
      requestedIdentity: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: ["rpc.v1.Auth.Sessions.Me"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connections.Opened.>"],
      identityEnvelope: boundary({ capabilities: ["admin"] }),
      resolution,
    }),
    { status: "approved", source: "existing_envelope" },
  );
});

Deno.test("buildAuthStartSignaturePayload includes provider and contract", () => {
  const base = buildAuthStartSignaturePayload({
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contract: { id: "trellis.console@v1" },
  });
  const changedContract = buildAuthStartSignaturePayload({
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contract: { id: "trellis.other@v1" },
  });
  const withProvider = buildAuthStartSignaturePayload({
    provider: "github",
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contract: { id: "trellis.console@v1" },
  });

  assertEquals(base === changedContract, false);
  assertEquals(base === withProvider, false);
});

Deno.test("buildAuthStartSignaturePayload supports digest-only presentation", () => {
  const digestOnly = buildAuthStartSignaturePayload({
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contractDigest: "digest-known",
  });
  const fullManifest = buildAuthStartSignaturePayload({
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contractDigest: "digest-known",
    contract: { id: "trellis.console@v1" },
  });

  assertEquals(digestOnly === fullManifest, false);
});

Deno.test("auth start resolves known digest without requiring a manifest", async () => {
  let plannedContract: Record<string, unknown> | undefined;
  const handler = createAuthStartRequestHandler({
    verifyInitRequest: async () => true,
    resolveContract: async () => ({ id: "trellis.console@v1" }),
    loadCurrentUserSession: async () => null,
    getApprovalResolution: async () => resolutionFixture(),
    planContract: async (contract) => {
      plannedContract = contract;
      return resolutionFixture().plan;
    },
    bindApprovedSession: async () => {
      throw new Error("should not bind");
    },
    createFlow: async () => ({
      status: "flow_started",
      flowId: "flow-1",
      loginUrl: "https://auth.example.com/login?flowId=flow-1",
    }),
  });

  const response = await handler({
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contractDigest: "digest-known",
  }, {
    authUrl: "https://auth.example.com",
  });

  assertEquals(response.status, "flow_started");
  assertEquals(plannedContract, { id: "trellis.console@v1" });
});

Deno.test("auth start requires a manifest when digest cannot be resolved", async () => {
  const handler = createAuthStartRequestHandler({
    verifyInitRequest: async () => true,
    loadCurrentUserSession: async () => null,
    getApprovalResolution: async () => resolutionFixture(),
    planContract: async () => resolutionFixture().plan,
    bindApprovedSession: async () => {
      throw new Error("should not bind");
    },
    createFlow: async () => ({
      status: "flow_started",
      flowId: "flow-1",
      loginUrl: "https://auth.example.com/login?flowId=flow-1",
    }),
  });

  await assertRejects(
    () =>
      handler({
        redirectTo: "https://console.example.com/callback",
        sessionKey: "A".repeat(43),
        sig: "B".repeat(86),
        contractDigest: "digest-unknown",
      }, {
        authUrl: "https://auth.example.com",
      }),
    Error,
    "manifest_required",
  );
});

Deno.test("auth start auto-approves contract changes when current session envelope already covers them", async () => {
  let bindCalls = 0;
  const handler = createAuthStartRequestHandler({
    verifyInitRequest: async () => true,
    loadCurrentUserSession: async () => ({
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      approvalSource: "stored_approval",
      delegatedCapabilities: ["admin", "audit"],
      delegatedPublishSubjects: [
        "rpc.v1.Auth.Sessions.Me",
        "rpc.v1.Auth.Identities.List",
      ],
      delegatedSubscribeSubjects: [
        "events.v1.Auth.Connections.Opened.>",
        "events.v1.Auth.Connections.Closed.>",
      ],
      identityEnvelope: boundary({ capabilities: ["admin"] }),
    }),
    getApprovalResolution: async () => resolutionFixture(),
    planContract: async () => resolutionFixture().plan,
    bindApprovedSession: async () => {
      bindCalls += 1;
      return {
        status: "bound",
        inboxPrefix: "_INBOX.abc",
        expires: "2026-01-01T00:00:00.000Z",
        sentinel: { jwt: "jwt", seed: "seed" },
        transports: {},
      };
    },
    createFlow: async () => ({
      status: "flow_started",
      flowId: "flow-1",
      loginUrl: "https://auth.example.com/login?flowId=flow-1",
    }),
  });

  const response = await handler({
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contract: { id: "trellis.console@v1" },
  }, {
    authUrl: "https://auth.example.com",
  });

  assertEquals(bindCalls, 1);
  assertEquals(response.status, "bound");
});

Deno.test("auth start falls back to normal auth flow when current session envelope is too small", async () => {
  const handler = createAuthStartRequestHandler({
    verifyInitRequest: async () => true,
    loadCurrentUserSession: async () => ({
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      approvalSource: "stored_approval",
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
    getApprovalResolution: async () => resolutionFixture(),
    planContract: async () => resolutionFixture().plan,
    bindApprovedSession: async () => {
      throw new Error("should not auto-bind");
    },
    createFlow: async () => ({
      status: "flow_started",
      flowId: "flow-1",
      loginUrl: "https://auth.example.com/login?flowId=flow-1",
    }),
  });

  const response = await handler({
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contract: { id: "trellis.console@v1" },
  }, {
    authUrl: "https://auth.example.com",
  });

  assertEquals(response, {
    status: "flow_started",
    flowId: "flow-1",
    loginUrl: "https://auth.example.com/login?flowId=flow-1",
  });
});

Deno.test("auth start falls back to normal auth flow when app identity changes", async () => {
  let bindCalls = 0;
  const handler = createAuthStartRequestHandler({
    verifyInitRequest: async () => true,
    loadCurrentUserSession: async () => ({
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://other.example.com",
      },
      approvalSource: "stored_approval",
      delegatedCapabilities: ["admin", "audit"],
      delegatedPublishSubjects: [
        "rpc.v1.Auth.Sessions.Me",
        "rpc.v1.Auth.Identities.List",
      ],
      delegatedSubscribeSubjects: [
        "events.v1.Auth.Connections.Opened.>",
        "events.v1.Auth.Connections.Closed.>",
      ],
    }),
    getApprovalResolution: async () => resolutionFixture(),
    planContract: async () => resolutionFixture().plan,
    bindApprovedSession: async () => {
      bindCalls += 1;
      throw new Error("should not auto-bind");
    },
    createFlow: async () => ({
      status: "flow_started",
      flowId: "flow-1",
      loginUrl: "https://auth.example.com/login?flowId=flow-1",
    }),
  });

  const response = await handler({
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contract: { id: "trellis.console@v1" },
  }, {
    authUrl: "https://auth.example.com",
  });

  assertEquals(bindCalls, 0);
  assertEquals(response.status, "flow_started");
});

Deno.test("auth start does not treat stored digest approval as identity-envelope authority", async () => {
  let bindCalls = 0;
  const approvedResolution = resolutionFixture();
  approvedResolution.effectiveApproval = {
    answer: "approved",
    kind: "stored_approval",
  };
  const handler = createAuthStartRequestHandler({
    verifyInitRequest: async () => true,
    loadCurrentUserSession: async () => ({
      ...currentSessionFixture(),
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      contractId: "trellis.console@v1",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://other.example.com",
      },
      approvalSource: "stored_approval",
      delegatedCapabilities: ["admin", "audit"],
      delegatedPublishSubjects: [
        "rpc.v1.Auth.Sessions.Me",
        "rpc.v1.Auth.Identities.List",
      ],
      delegatedSubscribeSubjects: [
        "events.v1.Auth.Connections.Opened.>",
        "events.v1.Auth.Connections.Closed.>",
      ],
    }),
    getApprovalResolution: async () => approvedResolution,
    planContract: async () => approvedResolution.plan,
    bindApprovedSession: async () => {
      bindCalls += 1;
      throw new Error("should not bind from digest approval");
    },
    createFlow: async () => ({
      status: "flow_started",
      flowId: "flow-1",
      loginUrl: "https://auth.example.com/login?flowId=flow-1",
    }),
  });

  const response = await handler({
    redirectTo: "https://console.example.com/callback",
    sessionKey: "A".repeat(43),
    sig: "B".repeat(86),
    contract: { id: "trellis.console@v1" },
  }, {
    authUrl: "https://auth.example.com",
  });

  assertEquals(bindCalls, 0);
  assertEquals(response.status, "flow_started");
});

Deno.test("auth start rejects invalid signatures", async () => {
  const handler = createAuthStartRequestHandler({
    verifyInitRequest: async () => false,
    loadCurrentUserSession: async () => null,
    getApprovalResolution: async () => resolutionFixture(),
    planContract: async () => resolutionFixture().plan,
    bindApprovedSession: async () => {
      throw new Error("should not bind");
    },
    createFlow: async () => ({
      status: "flow_started",
      flowId: "flow-1",
      loginUrl: "https://auth.example.com/login?flowId=flow-1",
    }),
  });

  await assertRejects(
    () =>
      handler({
        redirectTo: "https://console.example.com/callback",
        sessionKey: "A".repeat(43),
        sig: "B".repeat(86),
        contract: { id: "trellis.console@v1" },
      }, {
        authUrl: "https://auth.example.com",
      }),
    Error,
    "Invalid signature",
  );
});
