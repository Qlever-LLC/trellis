import { assertEquals, assertThrows } from "@std/assert";

import { ContractUseDependencyError } from "../../catalog/uses.ts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import type { IdentityEnvelopeRecord, PendingAuth } from "../schemas.ts";
import { getApprovalResolutionErrorMessage } from "./approval_errors.ts";
import {
  applyApprovalDecision,
  buildRedirectLocation,
  decodeContractQuery,
  decodeOpenObjectQuery,
  encodeBase64Url,
  getApprovalResolution,
  getApprovalResolutionBlocker,
  getCookie,
  resolveLinkedActiveUserIdentity,
  shouldUseSecureOauthCookie,
} from "./support.ts";

const linkedUserId = "usr_linked_123";
const linkedIdentity = {
  identityId: "idn_github_123",
  provider: "github",
  subject: "123",
};

const { buildPortalFlowState } = await import("./portal_flow.ts");

function encodeJsonQueryPayload(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function approvalCapabilities(keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, {
    displayName: key,
    description: key,
  }]));
}

function storedAppApproval(args: {
  userTrellisId: string;
  answer: "approved" | "denied";
  capabilities: string[];
  answeredAt?: Date;
}): IdentityEnvelopeRecord {
  const answeredAt = args.answeredAt ?? new Date();
  return {
    identityEnvelopeId: "env-console",
    userTrellisId: args.userTrellisId,
    origin: "github",
    id: "123",
    identityAnchor: {
      kind: "web",
      contractId: "trellis.console@v1",
      origin: "https://console.example",
    },
    answer: args.answer,
    answeredAt,
    updatedAt: answeredAt,
    approvalEvidence: {
      contractId: "trellis.console@v1",
      contractDigest: "digest",
      displayName: "Console",
      description: "Admin",
      participantKind: "app",
      capabilities: approvalCapabilities(args.capabilities),
    },
    publishSubjects: [],
    subscribeSubjects: [],
  };
}

Deno.test("buildRedirectLocation appends flowId in the query string", () => {
  const location = buildRedirectLocation(
    "http://localhost:5173/callback?redirectTo=%2Fdeployment",
    {
      flowId: "flow-123",
    },
  );

  const parsed = new URL(location);
  assertEquals(parsed.pathname, "/callback");
  assertEquals(parsed.searchParams.get("redirectTo"), "/deployment");
  assertEquals(parsed.searchParams.get("flowId"), "flow-123");
  assertEquals(parsed.hash, "");
});

Deno.test("buildRedirectLocation preserves relative redirects", () => {
  const location = buildRedirectLocation("/callback?redirectTo=%2Fdeployment", {
    flowId: "flow-123",
  });

  assertEquals(location, "/callback?redirectTo=%2Fdeployment&flowId=flow-123");
});

Deno.test("getCookie ignores malformed percent-encoding", () => {
  const value = getCookie({
    req: {
      header: (name) => name === "Cookie" ? "session=%E0%A4%A" : undefined,
    },
    header: () => {},
    json: () => new Response(),
    redirect: () => new Response(),
  }, "session");

  assertEquals(value, null);
});

Deno.test("decodeContractQuery requires an object payload", () => {
  assertThrows(
    () => decodeContractQuery(encodeJsonQueryPayload(["not-object"])),
    Error,
    "Invalid contract payload",
  );
});

Deno.test("decodeOpenObjectQuery requires an object payload", () => {
  assertThrows(
    () => decodeOpenObjectQuery(encodeJsonQueryPayload(["not-object"])),
    Error,
    "Invalid JSON payload",
  );
});

Deno.test("getApprovalResolutionErrorMessage explains inactive contract dependencies", () => {
  const message = getApprovalResolutionErrorMessage(
    new Error(
      "Dependency 'jobs' references inactive contract 'trellis.jobs@v1'",
    ),
  );

  assertEquals(
    message,
    "Requested app depends on inactive contract 'trellis.jobs@v1'. Install or upgrade that service before logging in.",
  );
});

Deno.test("getApprovalResolutionErrorMessage explains missing dependency surfaces", () => {
  const message = getApprovalResolutionErrorMessage(
    new ContractUseDependencyError({
      alias: "fieldOps",
      contractId: "trellis.demo-service@v1",
      surface: "rpc",
      reason: "missing",
      key: "Evidence.Delete",
    }),
  );

  assertEquals(
    message,
    "Requested app depends on missing RPC 'Evidence.Delete' from contract 'trellis.demo-service@v1'. Update the app contract or install a compatible version of that service before logging in.",
  );
});

Deno.test("buildPortalFlowState maps browser flow records to typed states", async () => {
  const now = new Date();
  const app = {
    contractId: "trellis.console@v1",
    contractDigest: "digest",
    displayName: "Console",
    description: "Admin",
    context: { subtitle: "Welcome back" },
  };

  const choose = await buildPortalFlowState(
    {
      flowId: "flow-1",
      flow: {
        flowId: "flow-1",
        kind: "login" as const,
        sessionKey: "A".repeat(43),
        contract: {
          id: "trellis.console@v1",
          displayName: "Console",
          description: "Admin",
          format: "trellis.contract.v1",
          kind: "app",
        },
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1_000),
      },
      app,
      providers: [{ id: "github", displayName: "GitHub" }],
    } satisfies Parameters<typeof buildPortalFlowState>[0],
  );
  assertEquals(choose.status, "choose_provider");
  if (choose.status === "choose_provider") {
    assertEquals((choose.app as { context?: unknown }).context, {
      subtitle: "Welcome back",
    });
  }

  const approval = await buildPortalFlowState(
    {
      flowId: "flow-2",
      flow: {
        flowId: "flow-2",
        kind: "login" as const,
        sessionKey: "A".repeat(43),
        authToken: "token",
        contract: {
          id: "trellis.console@v1",
          displayName: "Console",
          description: "Admin",
          format: "trellis.contract.v1",
          kind: "app",
        },
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1_000),
      },
      app,
      providers: [{ id: "github", displayName: "GitHub" }],
      resolution: {
        plan: {
          digest: "digest",
          contract: {
            id: "trellis.console@v1",
            displayName: "Console",
            description: "Admin",
            format: "trellis.contract.v1",
            kind: "app",
          },
          approval: {
            contractId: "trellis.console@v1",
            contractDigest: "digest",
            displayName: "Console",
            description: "Admin",
            participantKind: "app",
            capabilities: approvalCapabilities(["admin"]),
          },
          publishSubjects: [],
          subscribeSubjects: [],
        },
        userId: "trellis-123",
        identityId: "idn_123",
        identityProvider: "github",
        identitySubject: "123",
        userEmail: "user@example.com",
        userName: "User",
        sessionPublicKey: "A".repeat(43),
        existingProjection: null,
        existingCapabilities: ["admin"],
        effectiveCapabilities: ["admin"],
        missingCapabilities: [],
        matchedPolicies: [],
        effectiveApproval: { kind: "none", answer: "none" },
        storedApproval: null,
      },
    } satisfies Parameters<typeof buildPortalFlowState>[0],
  );
  assertEquals(approval.status, "approval_required");

  const denied = await buildPortalFlowState(
    {
      flowId: "flow-3",
      flow: {
        flowId: "flow-3",
        kind: "login" as const,
        sessionKey: "A".repeat(43),
        authToken: "token",
        contract: {
          id: "trellis.console@v1",
          displayName: "Console",
          description: "Admin",
          format: "trellis.contract.v1",
          kind: "app",
        },
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1_000),
      },
      app,
      providers: [{ id: "github", displayName: "GitHub" }],
      returnLocation: "http://localhost:5173/callback?flowId=flow-3",
      resolution: {
        plan: {
          digest: "digest",
          contract: {
            id: "trellis.console@v1",
            displayName: "Console",
            description: "Admin",
            format: "trellis.contract.v1",
            kind: "app",
          },
          approval: {
            contractId: "trellis.console@v1",
            contractDigest: "digest",
            displayName: "Console",
            description: "Admin",
            participantKind: "app",
            capabilities: approvalCapabilities(["admin"]),
          },
          publishSubjects: [],
          subscribeSubjects: [],
        },
        userId: "trellis-123",
        identityId: "idn_123",
        identityProvider: "github",
        identitySubject: "123",
        userEmail: "user@example.com",
        userName: "User",
        sessionPublicKey: "A".repeat(43),
        existingProjection: null,
        existingCapabilities: [],
        effectiveCapabilities: [],
        missingCapabilities: [],
        matchedPolicies: [],
        effectiveApproval: { kind: "stored_approval", answer: "denied" },
        storedApproval: storedAppApproval({
          userTrellisId: "trellis-123",
          answer: "denied",
          capabilities: ["admin"],
          answeredAt: now,
        }),
      },
    } satisfies Parameters<typeof buildPortalFlowState>[0],
  );
  assertEquals(denied.status, "approval_required");

  const insufficient = await buildPortalFlowState(
    {
      flowId: "flow-4",
      flow: {
        flowId: "flow-4",
        kind: "login" as const,
        sessionKey: "A".repeat(43),
        authToken: "token",
        contract: {
          id: "trellis.console@v1",
          displayName: "Console",
          description: "Admin",
          format: "trellis.contract.v1",
          kind: "app",
        },
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1_000),
      },
      app,
      providers: [{ id: "github", displayName: "GitHub" }],
      returnLocation: "http://localhost:5173/callback?flowId=flow-4",
      resolution: {
        plan: {
          digest: "digest",
          contract: {
            id: "trellis.console@v1",
            displayName: "Console",
            description: "Admin",
            format: "trellis.contract.v1",
            kind: "app",
          },
          approval: {
            contractId: "trellis.console@v1",
            contractDigest: "digest",
            displayName: "Console",
            description: "Admin",
            participantKind: "app",
            capabilities: approvalCapabilities(["admin", "audit"]),
          },
          publishSubjects: [],
          subscribeSubjects: [],
        },
        userId: "trellis-123",
        identityId: "idn_123",
        identityProvider: "github",
        identitySubject: "123",
        userEmail: "user@example.com",
        userName: "User",
        sessionPublicKey: "A".repeat(43),
        existingProjection: null,
        existingCapabilities: ["admin"],
        effectiveCapabilities: ["admin"],
        missingCapabilities: ["audit"],
        matchedPolicies: [],
        effectiveApproval: { kind: "none", answer: "none" },
        storedApproval: null,
      },
    } satisfies Parameters<typeof buildPortalFlowState>[0],
  );
  assertEquals(insufficient.status, "insufficient_capabilities");
  if (insufficient.status === "insufficient_capabilities") {
    assertEquals(
      insufficient.returnLocation,
      "http://localhost:5173/callback?flowId=flow-4",
    );
  }

  const redirect = await buildPortalFlowState(
    {
      flowId: "flow-5",
      flow: {
        flowId: "flow-5",
        kind: "login" as const,
        sessionKey: "A".repeat(43),
        authToken: "token",
        contract: {
          id: "trellis.console@v1",
          displayName: "Console",
          description: "Admin",
          format: "trellis.contract.v1",
          kind: "app",
        },
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1_000),
      },
      app,
      providers: [{ id: "github", displayName: "GitHub" }],
      resolution: {
        plan: {
          digest: "digest",
          contract: {
            id: "trellis.console@v1",
            displayName: "Console",
            description: "Admin",
            format: "trellis.contract.v1",
            kind: "app",
          },
          approval: {
            contractId: "trellis.console@v1",
            contractDigest: "digest",
            displayName: "Console",
            description: "Admin",
            participantKind: "app",
            capabilities: approvalCapabilities(["admin"]),
          },
          publishSubjects: [],
          subscribeSubjects: [],
        },
        userId: "trellis-123",
        identityId: "idn_123",
        identityProvider: "github",
        identitySubject: "123",
        userEmail: "user@example.com",
        userName: "User",
        sessionPublicKey: "A".repeat(43),
        existingProjection: null,
        existingCapabilities: ["admin"],
        effectiveCapabilities: ["admin"],
        missingCapabilities: [],
        matchedPolicies: [],
        effectiveApproval: { kind: "stored_approval", answer: "approved" },
        storedApproval: storedAppApproval({
          userTrellisId: "trellis-123",
          answer: "approved",
          capabilities: ["admin"],
          answeredAt: now,
        }),
      },
      redirectLocation: "http://localhost:5173/callback?flowId=flow-5",
    } satisfies Parameters<typeof buildPortalFlowState>[0],
  );
  assertEquals(redirect.status, "redirect");

  const expired = await buildPortalFlowState(
    {
      flowId: "flow-6",
      flow: {
        flowId: "flow-6",
        kind: "login" as const,
        sessionKey: "A".repeat(43),
        contract: {
          id: "trellis.console@v1",
          displayName: "Console",
          description: "Admin",
          format: "trellis.contract.v1",
          kind: "app",
        },
        createdAt: new Date(now.getTime() - 2_000),
        expiresAt: new Date(now.getTime() - 1_000),
      },
      app,
      providers: [{ id: "github", displayName: "GitHub" }],
      now,
    } satisfies Parameters<typeof buildPortalFlowState>[0],
  );
  assertEquals(expired.status, "expired");
});

Deno.test("buildPortalFlowState asks again after a stored denial", async () => {
  const now = new Date();
  const resolution = applyApprovalDecision({
    resolution: {
      plan: {
        digest: "digest",
        contract: {
          id: "trellis.console@v1",
          displayName: "Console",
          description: "Admin",
          format: "trellis.contract.v1",
          kind: "app",
        },
        approval: {
          contractId: "trellis.console@v1",
          contractDigest: "digest",
          displayName: "Console",
          description: "Admin",
          participantKind: "app",
          capabilities: approvalCapabilities(["admin"]),
        },
        publishSubjects: [],
        subscribeSubjects: [],
      },
      userId: "trellis-123",
      identityId: "idn_123",
      identityProvider: "github",
      identitySubject: "123",
      userEmail: "user@example.com",
      userName: "User",
      sessionPublicKey: "A".repeat(43),
      existingProjection: null,
      existingCapabilities: ["admin"],
      effectiveCapabilities: ["admin"],
      missingCapabilities: [],
      matchedPolicies: [],
      effectiveApproval: { kind: "none", answer: "none" },
      storedApproval: null,
    },
    approved: false,
    answeredAt: now,
  });

  const state = await buildPortalFlowState({
    flowId: "flow-denied",
    flow: {
      flowId: "flow-denied",
      kind: "login",
      sessionKey: "A".repeat(43),
      authToken: "token",
      contract: {
        id: "trellis.console@v1",
        displayName: "Console",
        description: "Admin",
        format: "trellis.contract.v1",
        kind: "app",
      },
      createdAt: now,
      expiresAt: new Date(now.getTime() + 1_000),
    },
    app: {
      contractId: "trellis.console@v1",
      contractDigest: "digest",
      displayName: "Console",
      description: "Admin",
    },
    providers: [{ id: "github", displayName: "GitHub" }],
    resolution,
  });

  assertEquals(state.status, "approval_required");
});

Deno.test("getApprovalResolution uses injected loaders", async () => {
  const contracts = createTestContracts();
  const pending: PendingAuth = {
    userId: linkedUserId,
    identity: linkedIdentity,
    user: {
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
    },
    sessionKey: "A".repeat(43),
    redirectTo: "http://localhost:5173/callback",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.console@v1",
      displayName: "Console",
      description: "Admin",
      kind: "app",
      schemas: { AuditEvent: { type: "object" } },
      events: {
        "Audit.Recorded": {
          version: "v1",
          subject: "trellis.console.audit",
          event: { schema: "AuditEvent" },
          capabilities: {
            publish: ["audit"],
          },
        },
      },
    },
    createdAt: new Date(),
  };
  const expectedUserId = linkedUserId;
  const resolution = await getApprovalResolution(contracts, pending, {
    loadUserProjection: async (userId) => {
      assertEquals(userId, expectedUserId);
      return {
        origin: "account",
        id: linkedUserId,
        name: "User",
        email: "user@example.com",
        active: true,
        capabilities: [],
        capabilityGroups: [],
      };
    },
  });

  assertEquals(resolution.userId, expectedUserId);
  assertEquals(resolution.identityId, linkedIdentity.identityId);
  assertEquals(resolution.missingCapabilities, ["audit"]);
  assertEquals(resolution.existingProjection, {
    origin: "account",
    id: linkedUserId,
    name: "User",
    email: "user@example.com",
    active: true,
    capabilities: [],
    capabilityGroups: [],
  });
  assertEquals(resolution.storedApproval, null);
  assertEquals(resolution.app, {
    contractId: "trellis.console@v1",
    origin: "http://localhost:5173",
  });
});

Deno.test("resolveLinkedActiveUserIdentity returns a linked active account", async () => {
  const now = new Date().toISOString();
  const resolution = await resolveLinkedActiveUserIdentity({
    provider: "github",
    subject: "123",
  }, {
    loadIdentityByProviderSubject: async () => ({
      ...linkedIdentity,
      userId: linkedUserId,
      displayName: "User",
      email: "user@example.com",
      emailVerified: true,
      linkedAt: now,
      lastLoginAt: null,
    }),
    loadAccount: async () => ({
      userId: linkedUserId,
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: ["admin"],
      capabilityGroups: [],
      createdAt: now,
      updatedAt: now,
    }),
  });

  assertEquals(resolution.ok, true);
  if (resolution.ok) {
    assertEquals(resolution.account.userId, linkedUserId);
    assertEquals(resolution.identity.identityId, linkedIdentity.identityId);
  }
});

Deno.test("resolveLinkedActiveUserIdentity rejects unlinked identities", async () => {
  const resolution = await resolveLinkedActiveUserIdentity({
    provider: "github",
    subject: "missing",
  }, {
    loadIdentityByProviderSubject: async () => undefined,
    loadAccount: async () => {
      throw new Error("account lookup should not run for unlinked identity");
    },
  });

  assertEquals(resolution, { ok: false, error: "identity_not_linked" });
});

Deno.test("resolveLinkedActiveUserIdentity rejects inactive accounts", async () => {
  const now = new Date().toISOString();
  const resolution = await resolveLinkedActiveUserIdentity({
    provider: "github",
    subject: "123",
  }, {
    loadIdentityByProviderSubject: async () => ({
      ...linkedIdentity,
      userId: linkedUserId,
      displayName: "User",
      email: "user@example.com",
      emailVerified: true,
      linkedAt: now,
      lastLoginAt: null,
    }),
    loadAccount: async () => ({
      userId: linkedUserId,
      name: "User",
      email: "user@example.com",
      active: false,
      capabilities: ["admin"],
      capabilityGroups: [],
      createdAt: now,
      updatedAt: now,
    }),
  });

  assertEquals(resolution, { ok: false, error: "user_inactive" });
});

Deno.test("getApprovalResolution keeps user approval explicit despite stored denial", async () => {
  const contracts = createTestContracts();
  const pending: PendingAuth = {
    userId: linkedUserId,
    identity: linkedIdentity,
    user: {
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
    },
    sessionKey: "A".repeat(43),
    redirectTo: "https://app.example.com/callback",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.console@v1",
      displayName: "Console",
      description: "Admin",
      kind: "app",
      schemas: { AuditEvent: { type: "object" } },
      events: {
        "Audit.Recorded": {
          version: "v1",
          subject: "trellis.console.audit",
          event: { schema: "AuditEvent" },
          capabilities: {
            publish: ["audit"],
          },
        },
      },
    },
    createdAt: new Date(),
  };

  const resolution = await getApprovalResolution(contracts, pending, {
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
    }),
  });

  assertEquals(resolution.app, {
    contractId: "trellis.console@v1",
    origin: "https://app.example.com",
  });
  assertEquals(resolution.existingCapabilities, []);
  assertEquals(resolution.effectiveCapabilities, []);
  assertEquals(resolution.missingCapabilities, ["audit"]);
  assertEquals(resolution.matchedPolicies, []);
  assertEquals(resolution.effectiveApproval, { answer: "none", kind: "none" });
  assertEquals(resolution.storedApproval, null);
});

Deno.test("getApprovalResolution prefers persisted app identity over redirect-derived origin", async () => {
  const contracts = createTestContracts();
  const pending: PendingAuth = {
    userId: linkedUserId,
    identity: linkedIdentity,
    user: {
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
    },
    sessionKey: "A".repeat(43),
    redirectTo: "https://redirect.example.com/callback",
    app: {
      contractId: "trellis.console@v1",
      origin: "https://app.example.com",
    },
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.console@v1",
      displayName: "Console",
      description: "Admin",
      kind: "app",
    },
    createdAt: new Date(),
  };

  const resolution = await getApprovalResolution(contracts, pending, {
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
    }),
  });

  assertEquals(resolution.app, pending.app);
  assertEquals(resolution.matchedPolicies, []);
});

Deno.test("getApprovalResolution resolves system availability from enabled deployment envelopes", async () => {
  const contracts = createTestContracts();
  const now = new Date().toISOString();
  const pending: PendingAuth = {
    userId: linkedUserId,
    identity: linkedIdentity,
    user: {
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
    },
    sessionKey: "A".repeat(43),
    redirectTo: "https://app.example.com/callback",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.console@v1",
      displayName: "Console",
      description: "Admin",
      kind: "app",
    },
    createdAt: new Date(),
  };

  const resolution = await getApprovalResolution(contracts, pending, {
    loadUserProjection: async () => null,
    loadDeploymentEnvelopes: async () => [{
      deploymentId: "billing.enabled",
      kind: "service",
      disabled: false,
      createdAt: now,
      updatedAt: now,
      boundary: {
        contracts: [{ contractId: "billing@v1", required: true }],
        surfaces: [],
        capabilities: [],
        resources: [],
      },
    }, {
      deploymentId: "billing.disabled",
      kind: "service",
      disabled: true,
      createdAt: now,
      updatedAt: now,
      boundary: {
        contracts: [{ contractId: "disabled@v1", required: true }],
        surfaces: [],
        capabilities: [],
        resources: [],
      },
    }],
  });

  assertEquals(resolution.systemAvailabilityEnvelope, {
    contracts: [{ contractId: "billing@v1", required: true }],
    surfaces: [],
    capabilities: [],
    resources: [],
  });
});

Deno.test("getApprovalResolution applies matching deployment grant overrides as capability overlays", async () => {
  const contracts = createTestContracts();
  const now = new Date().toISOString();
  const pending: PendingAuth = {
    userId: linkedUserId,
    identity: linkedIdentity,
    user: {
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
    },
    sessionKey: "A".repeat(43),
    redirectTo: "https://app.example.com/callback",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.console@v1",
      displayName: "Console",
      description: "Admin",
      kind: "app",
      capabilities: approvalCapabilities(["audit"]),
      schemas: { AuditEvent: { type: "object" } },
      events: {
        "Audit.Recorded": {
          version: "v1",
          subject: "trellis.console.audit",
          event: { schema: "AuditEvent" },
          capabilities: { publish: ["audit"] },
        },
      },
    },
    createdAt: new Date(),
  };

  const resolution = await getApprovalResolution(contracts, pending, {
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
    }),
    loadDeploymentEnvelopes: async () => [{
      deploymentId: "app.enabled",
      kind: "app",
      disabled: false,
      createdAt: now,
      updatedAt: now,
      boundary: {
        contracts: [],
        surfaces: [],
        capabilities: [],
        resources: [],
      },
    }],
    loadDeploymentGrantOverrides: async (deploymentId) => [{
      deploymentId,
      identityKind: "web",
      contractId: "trellis.console@v1",
      origin: "https://app.example.com",
      sessionPublicKey: null,
      devicePublicKey: null,
      capability: "audit",
    }],
  });

  assertEquals(resolution.effectiveCapabilities, ["audit"]);
  assertEquals(resolution.missingCapabilities, []);
  assertEquals(resolution.systemAvailabilityEnvelope, {
    contracts: [],
    surfaces: [],
    capabilities: [],
    resources: [],
  });
});

Deno.test("getApprovalResolution does not treat deployment envelope capabilities as user capabilities", async () => {
  const contracts = createTestContracts();
  const now = new Date().toISOString();
  const pending: PendingAuth = {
    userId: linkedUserId,
    identity: linkedIdentity,
    user: {
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
    },
    sessionKey: "A".repeat(43),
    redirectTo: "https://app.example.com/callback",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.console@v1",
      displayName: "Console",
      description: "Admin",
      kind: "app",
      capabilities: approvalCapabilities(["audit"]),
      schemas: { AuditEvent: { type: "object" } },
      events: {
        "Audit.Recorded": {
          version: "v1",
          subject: "trellis.console.audit",
          event: { schema: "AuditEvent" },
          capabilities: { publish: ["audit"] },
        },
      },
    },
    createdAt: new Date(),
  };

  const resolution = await getApprovalResolution(contracts, pending, {
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
    }),
    loadDeploymentEnvelopes: async () => [{
      deploymentId: "system.enabled",
      kind: "service",
      disabled: false,
      createdAt: now,
      updatedAt: now,
      boundary: {
        contracts: [],
        surfaces: [],
        capabilities: ["audit"],
        resources: [],
      },
    }],
  });

  assertEquals(resolution.effectiveCapabilities, []);
  assertEquals(resolution.missingCapabilities, ["audit"]);
  assertEquals(resolution.systemAvailabilityEnvelope?.capabilities, ["audit"]);
});

Deno.test("getApprovalResolution loads persisted identity envelope approvals", async () => {
  const contracts = createTestContracts();
  const userTrellisId = linkedUserId;
  const pending: PendingAuth = {
    userId: linkedUserId,
    identity: linkedIdentity,
    user: {
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
    },
    sessionKey: "A".repeat(43),
    redirectTo: "https://console.example/callback",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.console@v1",
      displayName: "Console",
      description: "Admin",
      kind: "app",
    },
    createdAt: new Date(),
  };
  const storedApproval = storedAppApproval({
    userTrellisId,
    answer: "approved",
    capabilities: [],
  });

  const resolution = await getApprovalResolution(contracts, pending, {
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
    }),
    loadIdentityEnvelopesByUser: async (trellisId) => {
      assertEquals(trellisId, userTrellisId);
      return [storedApproval];
    },
  });

  assertEquals(resolution.storedApproval, storedApproval);
  assertEquals(resolution.effectiveApproval, {
    kind: "stored_approval",
    answer: "approved",
  });
});

Deno.test("getApprovalResolution reuses approval for another linked identity", async () => {
  const contracts = createTestContracts();
  const userTrellisId = linkedUserId;
  const pending: PendingAuth = {
    userId: userTrellisId,
    identity: {
      identityId: "idn_local_ada",
      provider: "local",
      subject: "ada",
    },
    user: {
      origin: "local",
      id: "ada",
      email: "user@example.com",
      name: "User",
    },
    sessionKey: "A".repeat(43),
    redirectTo: "https://console.example/callback",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.console@v1",
      displayName: "Console",
      description: "Admin",
      kind: "app",
    },
    createdAt: new Date(),
  };
  const storedApproval = storedAppApproval({
    userTrellisId,
    answer: "approved",
    capabilities: [],
  });

  const resolution = await getApprovalResolution(contracts, pending, {
    loadUserProjection: async () => ({
      origin: "account",
      id: userTrellisId,
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
    }),
    loadIdentityEnvelopesByUser: async (trellisId) => {
      assertEquals(trellisId, userTrellisId);
      return [storedApproval];
    },
  });

  assertEquals(resolution.identityProvider, "local");
  assertEquals(resolution.identitySubject, "ada");
  assertEquals(resolution.storedApproval, storedApproval);
  assertEquals(resolution.effectiveApproval, {
    kind: "stored_approval",
    answer: "approved",
  });
});

Deno.test("getApprovalResolutionBlocker rejects inactive users from completing bind", async () => {
  const contracts = createTestContracts();
  const pending: PendingAuth = {
    userId: linkedUserId,
    identity: linkedIdentity,
    user: {
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
    },
    sessionKey: "A".repeat(43),
    redirectTo: "http://localhost:5173/callback",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.console@v1",
      displayName: "Console",
      description: "Admin",
      kind: "app",
    },
    createdAt: new Date(),
  };

  const resolution = await getApprovalResolution(contracts, pending, {
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: false,
      capabilities: ["admin"],
      capabilityGroups: [],
    }),
  });

  assertEquals(getApprovalResolutionBlocker(resolution), "user_inactive");
});

Deno.test("shouldUseSecureOauthCookie logs through injected logger", () => {
  const warnings: Array<{ origin: string; message: string }> = [];

  const secure = shouldUseSecureOauthCookie(
    {
      logLevel: "info",
      port: 3000,
      instanceName: "Trellis Test",
      web: {
        origins: ["http://localhost:3000"],
        publicOrigin: "://bad-origin",
        allowInsecureOrigins: [],
      },
      httpRateLimit: { windowMs: 60_000, max: 60 },
      ttlMs: {
        sessions: 1,
        oauth: 1,
        deviceFlow: 1,
        pendingAuth: 1,
        connections: 1,
        natsJwt: 1,
      },
      nats: {
        servers: "nats://localhost:4222",
        jetstream: { replicas: 1 },
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
        system: { credsPath: "/tmp/system.creds" },
        sentinelCredsPath: "/tmp/sentinel.creds",
        authCallout: {
          issuer: { nkey: "issuer", signing: "signing" },
          target: { nkey: "target", signing: "signing" },
          sxSeed: "seed",
        },
      },
      sessionKeySeed: "seed",
      client: { natsServers: ["nats://localhost:4222"] },
      oauth: {
        redirectBase: "http://localhost:3000",
        alwaysShowProviderChooser: false,
        providers: {},
      },
    } satisfies Parameters<typeof shouldUseSecureOauthCookie>[0],
    {
      logger: {
        warn: (context, message) => {
          warnings.push({ origin: String(context.origin), message });
        },
      },
    },
  );

  assertEquals(secure, true);
  assertEquals(warnings, [{
    origin: "://bad-origin",
    message: "Failed to parse auth public origin for cookie policy",
  }]);
});

Deno.test("shouldUseSecureOauthCookie allows insecure cookies on plain-http loopback origins", () => {
  const secure = shouldUseSecureOauthCookie(
    {
      logLevel: "info",
      port: 3000,
      instanceName: "Trellis Test",
      web: {
        origins: ["http://localhost:3000"],
        publicOrigin: "http://localhost:3000",
        allowInsecureOrigins: [],
      },
      httpRateLimit: { windowMs: 60_000, max: 60 },
      ttlMs: {
        sessions: 1,
        oauth: 1,
        deviceFlow: 1,
        pendingAuth: 1,
        connections: 1,
        natsJwt: 1,
      },
      nats: {
        servers: "nats://localhost:4222",
        jetstream: { replicas: 1 },
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
        system: { credsPath: "/tmp/system.creds" },
        sentinelCredsPath: "/tmp/sentinel.creds",
        authCallout: {
          issuer: { nkey: "issuer", signing: "signing" },
          target: { nkey: "target", signing: "signing" },
          sxSeed: "seed",
        },
      },
      sessionKeySeed: "seed",
      client: { natsServers: ["nats://localhost:4222"] },
      oauth: {
        redirectBase: "http://localhost:3000",
        alwaysShowProviderChooser: false,
        providers: {},
      },
    } satisfies Parameters<typeof shouldUseSecureOauthCookie>[0],
  );

  assertEquals(secure, false);
});

Deno.test("shouldUseSecureOauthCookie keeps plain-http non-loopback OAuth cookies secure by default", () => {
  const secure = shouldUseSecureOauthCookie(
    {
      logLevel: "info",
      port: 3000,
      instanceName: "Trellis Test",
      web: {
        origins: ["http://private.example:3000"],
        publicOrigin: "http://private.example:3000",
        allowInsecureOrigins: [],
      },
      httpRateLimit: { windowMs: 60_000, max: 60 },
      ttlMs: {
        sessions: 1,
        oauth: 1,
        deviceFlow: 1,
        pendingAuth: 1,
        connections: 1,
        natsJwt: 1,
      },
      nats: {
        servers: "nats://localhost:4222",
        jetstream: { replicas: 1 },
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
        system: { credsPath: "/tmp/system.creds" },
        sentinelCredsPath: "/tmp/sentinel.creds",
        authCallout: {
          issuer: { nkey: "issuer", signing: "signing" },
          target: { nkey: "target", signing: "signing" },
          sxSeed: "seed",
        },
      },
      sessionKeySeed: "seed",
      client: { natsServers: ["nats://localhost:4222"] },
      oauth: {
        redirectBase: "http://private.example:3000",
        alwaysShowProviderChooser: false,
        providers: {},
      },
    } satisfies Parameters<typeof shouldUseSecureOauthCookie>[0],
  );

  assertEquals(secure, true);
});

Deno.test("shouldUseSecureOauthCookie honors exact insecure cookie origin allowlist", () => {
  const secure = shouldUseSecureOauthCookie(
    {
      logLevel: "info",
      port: 3000,
      instanceName: "Trellis Test",
      web: {
        origins: ["http://private.example:3000"],
        publicOrigin: "http://private.example:3000",
        allowInsecureOrigins: ["http://private.example:3000"],
      },
      httpRateLimit: { windowMs: 60_000, max: 60 },
      ttlMs: {
        sessions: 1,
        oauth: 1,
        deviceFlow: 1,
        pendingAuth: 1,
        connections: 1,
        natsJwt: 1,
      },
      nats: {
        servers: "nats://localhost:4222",
        jetstream: { replicas: 1 },
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
        system: { credsPath: "/tmp/system.creds" },
        sentinelCredsPath: "/tmp/sentinel.creds",
        authCallout: {
          issuer: { nkey: "issuer", signing: "signing" },
          target: { nkey: "target", signing: "signing" },
          sxSeed: "seed",
        },
      },
      sessionKeySeed: "seed",
      client: { natsServers: ["nats://localhost:4222"] },
      oauth: {
        redirectBase: "http://private.example:3000",
        alwaysShowProviderChooser: false,
        providers: {},
      },
    } satisfies Parameters<typeof shouldUseSecureOauthCookie>[0],
  );

  assertEquals(secure, false);
});

Deno.test("shouldUseSecureOauthCookie keeps non-loopback plain-http cookies secure when allowlist does not exactly match", () => {
  const secure = shouldUseSecureOauthCookie(
    {
      logLevel: "info",
      port: 3000,
      instanceName: "Trellis Test",
      web: {
        origins: ["http://private.example:3000"],
        publicOrigin: "http://private.example:3000",
        allowInsecureOrigins: ["http://private.example:4000"],
      },
      httpRateLimit: { windowMs: 60_000, max: 60 },
      ttlMs: {
        sessions: 1,
        oauth: 1,
        deviceFlow: 1,
        pendingAuth: 1,
        connections: 1,
        natsJwt: 1,
      },
      nats: {
        servers: "nats://localhost:4222",
        jetstream: { replicas: 1 },
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
        system: { credsPath: "/tmp/system.creds" },
        sentinelCredsPath: "/tmp/sentinel.creds",
        authCallout: {
          issuer: { nkey: "issuer", signing: "signing" },
          target: { nkey: "target", signing: "signing" },
          sxSeed: "seed",
        },
      },
      sessionKeySeed: "seed",
      client: { natsServers: ["nats://localhost:4222"] },
      oauth: {
        redirectBase: "http://private.example:3000",
        alwaysShowProviderChooser: false,
        providers: {},
      },
    } satisfies Parameters<typeof shouldUseSecureOauthCookie>[0],
  );

  assertEquals(secure, true);
});

Deno.test("shouldUseSecureOauthCookie keeps https OAuth cookies secure", () => {
  const secure = shouldUseSecureOauthCookie(
    {
      logLevel: "info",
      port: 3000,
      instanceName: "Trellis Test",
      web: {
        origins: ["https://phi.oats"],
        publicOrigin: "https://phi.oats",
        allowInsecureOrigins: [],
      },
      httpRateLimit: { windowMs: 60_000, max: 60 },
      ttlMs: {
        sessions: 1,
        oauth: 1,
        deviceFlow: 1,
        pendingAuth: 1,
        connections: 1,
        natsJwt: 1,
      },
      nats: {
        servers: "nats://localhost:4222",
        jetstream: { replicas: 1 },
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
        system: { credsPath: "/tmp/system.creds" },
        sentinelCredsPath: "/tmp/sentinel.creds",
        authCallout: {
          issuer: { nkey: "issuer", signing: "signing" },
          target: { nkey: "target", signing: "signing" },
          sxSeed: "seed",
        },
      },
      sessionKeySeed: "seed",
      client: { natsServers: ["nats://localhost:4222"] },
      oauth: {
        redirectBase: "https://phi.oats",
        alwaysShowProviderChooser: false,
        providers: {},
      },
    } satisfies Parameters<typeof shouldUseSecureOauthCookie>[0],
  );

  assertEquals(secure, true);
});
