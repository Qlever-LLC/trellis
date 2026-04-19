import { assertEquals, assertRejects } from "@std/assert";

import {
  buildAuthStartSignaturePayload,
  canAutoApproveFromCurrentSession,
  createAuthStartRequestHandler,
} from "./start_request.ts";
import type { ApprovalResolution } from "./support.ts";

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
      capabilities: ["admin"],
    },
    publishSubjects: ["rpc.v1.Auth.Me"],
    subscribeSubjects: ["events.v1.Auth.Connect.>"],
  },
  app: {
    contractId: "trellis.console@v1",
    origin: "https://console.example.com",
  },
  trellisId: "tid_123",
  userOrigin: "github",
  userId: "123",
  userEmail: "ada@example.com",
  userName: "Ada",
  existingProjection: {
    origin: "github",
    id: "123",
    name: "Ada",
    email: "ada@example.com",
    active: true,
    capabilities: ["admin"],
  },
  existingCapabilities: ["admin"],
  effectiveCapabilities: ["admin"],
  missingCapabilities: [],
  matchedPolicies: [],
  effectiveApproval: { kind: "none", answer: "none" },
  storedApproval: null,
  };
}

Deno.test("canAutoApproveFromCurrentSession requires concrete subject and capability subsets", () => {
  assertEquals(canAutoApproveFromCurrentSession({
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
    delegatedPublishSubjects: ["rpc.v1.Auth.Me", "rpc.v1.Auth.ListApprovals"],
    delegatedSubscribeSubjects: ["events.v1.Auth.Connect.>", "events.v1.Auth.Disconnect.>"],
  }, resolutionFixture()), true);

  assertEquals(canAutoApproveFromCurrentSession({
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
    delegatedSubscribeSubjects: ["events.v1.Auth.Connect.>"],
  }, resolutionFixture()), false);
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

Deno.test("auth start auto-approves contract changes when current session envelope already covers them", async () => {
  let bindCalls = 0;
  const handler = createAuthStartRequestHandler({
    verifyInitRequest: async () => true,
    loadCurrentUserSession: async () => ({
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
      delegatedPublishSubjects: ["rpc.v1.Auth.Me", "rpc.v1.Auth.ListApprovals"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connect.>", "events.v1.Auth.Disconnect.>"],
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
      delegatedPublishSubjects: ["rpc.v1.Auth.Me", "rpc.v1.Auth.ListApprovals"],
      delegatedSubscribeSubjects: ["events.v1.Auth.Connect.>", "events.v1.Auth.Disconnect.>"],
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
    () => handler({
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
