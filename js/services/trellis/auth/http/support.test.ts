import { assertEquals, assertThrows } from "@std/assert";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";

import { ContractUseDependencyError } from "../../catalog/uses.ts";
import { ContractStore } from "../../catalog/store.ts";
import type { ContractApprovalRecord, PendingAuth } from "../schemas.ts";
import { getApprovalResolutionErrorMessage } from "./approval_errors.ts";
import {
  applyApprovalDecision,
  buildRedirectLocation,
  contractApprovalKey,
  decodeContractQuery,
  decodeOpenObjectQuery,
  encodeBase64Url,
  getApprovalResolution,
  getApprovalResolutionBlocker,
  getCookie,
  resolveDevicePortal,
  resolveLoginPortal,
  shouldUseSecureOauthCookie,
} from "./support.ts";

const { buildPortalFlowState } = await import("./portal_flow.ts");

function encodeJsonQueryPayload(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function storedAppApproval(args: {
  userTrellisId: string;
  answer: "approved" | "denied";
  capabilities: string[];
  answeredAt?: Date;
}): ContractApprovalRecord {
  const answeredAt = args.answeredAt ?? new Date();
  return {
    userTrellisId: args.userTrellisId,
    origin: "github",
    id: "123",
    answer: args.answer,
    answeredAt,
    updatedAt: answeredAt,
    approval: {
      contractId: "trellis.console@v1",
      contractDigest: "digest",
      displayName: "Console",
      description: "Admin",
      participantKind: "app",
      capabilities: args.capabilities,
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
            capabilities: ["admin"],
          },
          publishSubjects: [],
          subscribeSubjects: [],
        },
        trellisId: "trellis-123",
        userOrigin: "github",
        userId: "123",
        userEmail: "user@example.com",
        userName: "User",
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
            capabilities: ["admin"],
          },
          publishSubjects: [],
          subscribeSubjects: [],
        },
        trellisId: "trellis-123",
        userOrigin: "github",
        userId: "123",
        userEmail: "user@example.com",
        userName: "User",
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
  assertEquals(denied.status, "approval_denied");
  if (denied.status === "approval_denied") {
    assertEquals(
      denied.returnLocation,
      "http://localhost:5173/callback?flowId=flow-3",
    );
  }

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
            capabilities: ["admin", "audit"],
          },
          publishSubjects: [],
          subscribeSubjects: [],
        },
        trellisId: "trellis-123",
        userOrigin: "github",
        userId: "123",
        userEmail: "user@example.com",
        userName: "User",
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
            capabilities: ["admin"],
          },
          publishSubjects: [],
          subscribeSubjects: [],
        },
        trellisId: "trellis-123",
        userOrigin: "github",
        userId: "123",
        userEmail: "user@example.com",
        userName: "User",
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

Deno.test("applyApprovalDecision returns a denied portal state immediately", async () => {
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
          capabilities: ["admin"],
        },
        publishSubjects: [],
        subscribeSubjects: [],
      },
      trellisId: "trellis-123",
      userOrigin: "github",
      userId: "123",
      userEmail: "user@example.com",
      userName: "User",
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

  assertEquals(state.status, "approval_denied");
});

Deno.test("getApprovalResolution uses injected loaders", async () => {
  const contractStore = new ContractStore();
  const pending: PendingAuth = {
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
  const expectedTrellisId = await trellisIdFromOriginId("github", "123");
  let requestedApprovalKey: string | null = null;

  const resolution = await getApprovalResolution(contractStore, pending, {
    loadStoredApproval: async (key) => {
      requestedApprovalKey = key;
      return storedAppApproval({
        userTrellisId: expectedTrellisId,
        answer: "approved",
        capabilities: ["audit"],
      });
    },
    loadUserProjection: async (trellisId) => {
      assertEquals(trellisId, expectedTrellisId);
      return {
        origin: "github",
        id: "123",
        name: "User",
        email: "user@example.com",
        active: true,
        capabilities: [],
      };
    },
  });

  assertEquals(resolution.trellisId, expectedTrellisId);
  assertEquals(
    requestedApprovalKey,
    contractApprovalKey(expectedTrellisId, resolution.plan.digest),
  );
  assertEquals(resolution.missingCapabilities, ["audit"]);
  assertEquals(resolution.existingProjection, {
    origin: "github",
    id: "123",
    name: "User",
    email: "user@example.com",
    active: true,
    capabilities: [],
  });
  assertEquals(resolution.storedApproval?.answer, "approved");
  assertEquals(resolution.app, {
    contractId: "trellis.console@v1",
    origin: "http://localhost:5173",
  });
});

Deno.test("getApprovalResolution prefers matching instance grant policy over stored denial", async () => {
  const contractStore = new ContractStore();
  const pending: PendingAuth = {
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

  const resolution = await getApprovalResolution(contractStore, pending, {
    loadStoredApproval: async () =>
      storedAppApproval({
        userTrellisId: "trellis-123",
        answer: "denied",
        capabilities: ["audit"],
      }),
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
    }),
    loadInstanceGrantPolicies: async () => [{
      contractId: "trellis.console@v1",
      impliedCapabilities: ["audit"],
      allowedOrigins: ["https://app.example.com"],
      disabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: {
        kind: "admin_policy",
      },
    }],
  });

  assertEquals(resolution.app, {
    contractId: "trellis.console@v1",
    origin: "https://app.example.com",
  });
  assertEquals(resolution.existingCapabilities, []);
  assertEquals(resolution.effectiveCapabilities, ["audit"]);
  assertEquals(resolution.missingCapabilities, []);
  assertEquals(resolution.matchedPolicies.map((policy) => policy.contractId), [
    "trellis.console@v1",
  ]);
  assertEquals(resolution.effectiveApproval, {
    answer: "approved",
    kind: "admin_policy",
  });
  assertEquals(resolution.storedApproval?.answer, "denied");
});

Deno.test("getApprovalResolution prefers persisted app identity over redirect-derived origin", async () => {
  const contractStore = new ContractStore();
  const pending: PendingAuth = {
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

  const resolution = await getApprovalResolution(contractStore, pending, {
    loadStoredApproval: async () => null,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
    }),
    loadInstanceGrantPolicies: async () => [{
      contractId: "trellis.console@v1",
      impliedCapabilities: ["audit"],
      allowedOrigins: ["https://app.example.com"],
      disabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: {
        kind: "admin_policy",
      },
    }],
  });

  assertEquals(resolution.app, pending.app);
  assertEquals(resolution.matchedPolicies.map((policy) => policy.contractId), [
    "trellis.console@v1",
  ]);
});

Deno.test("getApprovalResolutionBlocker rejects inactive users from completing bind", async () => {
  const contractStore = new ContractStore();
  const pending: PendingAuth = {
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

  const resolution = await getApprovalResolution(contractStore, pending, {
    loadStoredApproval: async () => null,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: false,
      capabilities: ["admin"],
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
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
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
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
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
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
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
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
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
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
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
        trellis: { credsPath: "/tmp/trellis.creds" },
        auth: { credsPath: "/tmp/auth.creds" },
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

Deno.test("resolveLoginPortal prefers contract selection over default and builtin", () => {
  const selectedPortal = resolveLoginPortal({
    contractId: "trellis.console@v1",
    portals: [
      { portalId: "default", entryUrl: "https://default.example.com" },
      { portalId: "contract", entryUrl: "https://contract.example.com" },
    ],
    defaultPortalId: "default",
    selections: [
      { contractId: "trellis.console@v1", portalId: "contract" },
    ],
  });
  assertEquals(selectedPortal, {
    kind: "custom",
    portal: { portalId: "contract", entryUrl: "https://contract.example.com" },
  });

  const forcedBuiltin = resolveLoginPortal({
    contractId: "trellis.console@v1",
    portals: [{ portalId: "default", entryUrl: "https://default.example.com" }],
    defaultPortalId: "default",
    selections: [{ contractId: "trellis.console@v1", portalId: null }],
  });
  assertEquals(forcedBuiltin, { kind: "builtin" });

  const defaultPortal = resolveLoginPortal({
    contractId: "trellis.console@v1",
    portals: [{ portalId: "default", entryUrl: "https://default.example.com" }],
    defaultPortalId: "default",
    selections: [],
  });
  assertEquals(defaultPortal, {
    kind: "custom",
    portal: { portalId: "default", entryUrl: "https://default.example.com" },
  });

  const builtinFallback = resolveLoginPortal({
    contractId: "trellis.console@v1",
    portals: [],
    defaultPortalId: undefined,
    selections: [],
  });
  assertEquals(builtinFallback, { kind: "builtin" });
});

Deno.test("resolveDevicePortal prefers deployment selection over default and builtin", () => {
  const selectedPortal = resolveDevicePortal({
    deploymentId: "reader.default",
    portals: [
      { portalId: "default", entryUrl: "https://default.example.com" },
      { portalId: "deployment", entryUrl: "https://deployment.example.com" },
    ],
    defaultPortalId: "default",
    selections: [{ deploymentId: "reader.default", portalId: "deployment" }],
  });
  assertEquals(selectedPortal, {
    kind: "custom",
    portal: {
      portalId: "deployment",
      entryUrl: "https://deployment.example.com",
    },
  });

  const forcedBuiltin = resolveDevicePortal({
    deploymentId: "reader.default",
    portals: [{ portalId: "default", entryUrl: "https://default.example.com" }],
    defaultPortalId: "default",
    selections: [{ deploymentId: "reader.default", portalId: null }],
  });
  assertEquals(forcedBuiltin, { kind: "builtin" });

  const defaultPortal = resolveDevicePortal({
    deploymentId: "reader.default",
    portals: [{ portalId: "default", entryUrl: "https://default.example.com" }],
    defaultPortalId: "default",
    selections: [],
  });
  assertEquals(defaultPortal, {
    kind: "custom",
    portal: { portalId: "default", entryUrl: "https://default.example.com" },
  });

  const builtinFallback = resolveDevicePortal({
    deploymentId: "reader.default",
    portals: [],
    defaultPortalId: undefined,
    selections: [],
  });
  assertEquals(builtinFallback, { kind: "builtin" });
});
