import { assertEquals } from "@std/assert";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";

import { ContractStore } from "../../catalog/store.ts";
import type { PendingAuth } from "../../state/schemas.ts";
import { getApprovalResolutionErrorMessage } from "./approval_errors.ts";
import {
  applyApprovalDecision,
  buildRedirectLocation,
  contractApprovalKey,
  getApprovalResolutionBlocker,
  getApprovalResolution,
  resolveLoginPortal,
  resolveWorkloadPortal,
  shouldUseSecureOauthCookie,
} from "./support.ts";

const { buildPortalFlowState } = await import("./portal_flow.ts");

Deno.test("buildRedirectLocation appends flowId in the query string", () => {
  const location = buildRedirectLocation("http://localhost:5173/callback?redirectTo=%2Fprofile", {
    flowId: "flow-123",
  });

  const parsed = new URL(location);
  assertEquals(parsed.pathname, "/callback");
  assertEquals(parsed.searchParams.get("redirectTo"), "/profile");
  assertEquals(parsed.searchParams.get("flowId"), "flow-123");
  assertEquals(parsed.hash, "");
});

Deno.test("getApprovalResolutionErrorMessage explains inactive contract dependencies", () => {
  const message = getApprovalResolutionErrorMessage(
    new Error("Dependency 'jobs' references inactive contract 'trellis.jobs@v1'"),
  );

  assertEquals(
    message,
    "Requested app depends on inactive contract 'trellis.jobs@v1'. Install or upgrade that service before logging in.",
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

  const choose = await buildPortalFlowState({
    flowId: "flow-1",
    flow: {
      flowId: "flow-1",
      kind: "login" as const,
      sessionKey: "A".repeat(43),
      contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
      createdAt: now,
      expiresAt: new Date(now.getTime() + 1_000),
    },
    app,
    providers: [{ id: "github", displayName: "GitHub" }],
  } satisfies Parameters<typeof buildPortalFlowState>[0]);
  assertEquals(choose.status, "choose_provider");
  if (choose.status === "choose_provider") {
    assertEquals((choose.app as { context?: unknown }).context, { subtitle: "Welcome back" });
  }

  const approval = await buildPortalFlowState({
    flowId: "flow-2",
    flow: {
      flowId: "flow-2",
      kind: "login" as const,
      sessionKey: "A".repeat(43),
      authToken: "token",
      contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
      createdAt: now,
      expiresAt: new Date(now.getTime() + 1_000),
    },
    app,
    providers: [{ id: "github", displayName: "GitHub" }],
    resolution: {
      plan: {
        digest: "digest",
        contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
        approval: {
          contractId: "trellis.console@v1",
          contractDigest: "digest",
          displayName: "Console",
          description: "Admin",
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
      missingCapabilities: [],
      storedApproval: null,
    },
  } satisfies Parameters<typeof buildPortalFlowState>[0]);
  assertEquals(approval.status, "approval_required");

  const denied = await buildPortalFlowState({
    flowId: "flow-3",
    flow: {
      flowId: "flow-3",
      kind: "login" as const,
      sessionKey: "A".repeat(43),
      authToken: "token",
      contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
      createdAt: now,
      expiresAt: new Date(now.getTime() + 1_000),
    },
    app,
    providers: [{ id: "github", displayName: "GitHub" }],
    returnLocation: "http://localhost:5173/callback?flowId=flow-3",
    resolution: {
      plan: {
        digest: "digest",
        contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
        approval: {
          contractId: "trellis.console@v1",
          contractDigest: "digest",
          displayName: "Console",
          description: "Admin",
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
      missingCapabilities: [],
      storedApproval: {
        userTrellisId: "trellis-123",
        origin: "github",
        id: "123",
        answer: "denied",
        answeredAt: now,
        updatedAt: now,
        approval: {
          contractId: "trellis.console@v1",
          contractDigest: "digest",
          displayName: "Console",
          description: "Admin",
            capabilities: ["admin"],
        },
        publishSubjects: [],
        subscribeSubjects: [],
      },
    },
  } satisfies Parameters<typeof buildPortalFlowState>[0]);
  assertEquals(denied.status, "approval_denied");
  if (denied.status === "approval_denied") {
    assertEquals(denied.returnLocation, "http://localhost:5173/callback?flowId=flow-3");
  }

  const insufficient = await buildPortalFlowState({
    flowId: "flow-4",
    flow: {
      flowId: "flow-4",
      kind: "login" as const,
      sessionKey: "A".repeat(43),
      authToken: "token",
      contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
      createdAt: now,
      expiresAt: new Date(now.getTime() + 1_000),
    },
    app,
    providers: [{ id: "github", displayName: "GitHub" }],
    returnLocation: "http://localhost:5173/callback?flowId=flow-4",
    resolution: {
      plan: {
        digest: "digest",
        contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
        approval: {
          contractId: "trellis.console@v1",
          contractDigest: "digest",
          displayName: "Console",
          description: "Admin",
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
      missingCapabilities: ["audit"],
      storedApproval: null,
    },
  } satisfies Parameters<typeof buildPortalFlowState>[0]);
  assertEquals(insufficient.status, "insufficient_capabilities");
  if (insufficient.status === "insufficient_capabilities") {
    assertEquals(insufficient.returnLocation, "http://localhost:5173/callback?flowId=flow-4");
  }

  const redirect = await buildPortalFlowState({
    flowId: "flow-5",
    flow: {
      flowId: "flow-5",
      kind: "login" as const,
      sessionKey: "A".repeat(43),
      authToken: "token",
      contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
      createdAt: now,
      expiresAt: new Date(now.getTime() + 1_000),
    },
    app,
    providers: [{ id: "github", displayName: "GitHub" }],
    resolution: {
      plan: {
        digest: "digest",
        contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
        approval: {
          contractId: "trellis.console@v1",
          contractDigest: "digest",
          displayName: "Console",
          description: "Admin",
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
      missingCapabilities: [],
      storedApproval: {
        userTrellisId: "trellis-123",
        origin: "github",
        id: "123",
        answer: "approved",
        answeredAt: now,
        updatedAt: now,
        approval: {
          contractId: "trellis.console@v1",
          contractDigest: "digest",
          displayName: "Console",
          description: "Admin",
            capabilities: ["admin"],
        },
        publishSubjects: [],
        subscribeSubjects: [],
      },
    },
    redirectLocation: "http://localhost:5173/callback?flowId=flow-5",
  } satisfies Parameters<typeof buildPortalFlowState>[0]);
  assertEquals(redirect.status, "redirect");

  const expired = await buildPortalFlowState({
    flowId: "flow-6",
    flow: {
      flowId: "flow-6",
      kind: "login" as const,
      sessionKey: "A".repeat(43),
      contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
      createdAt: new Date(now.getTime() - 2_000),
      expiresAt: new Date(now.getTime() - 1_000),
    },
    app,
    providers: [{ id: "github", displayName: "GitHub" }],
    now,
  } satisfies Parameters<typeof buildPortalFlowState>[0]);
  assertEquals(expired.status, "expired");
});

Deno.test("applyApprovalDecision returns a denied portal state immediately", async () => {
  const now = new Date();
  const resolution = applyApprovalDecision({
    resolution: {
      plan: {
        digest: "digest",
        contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
        approval: {
          contractId: "trellis.console@v1",
          contractDigest: "digest",
          displayName: "Console",
          description: "Admin",
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
      missingCapabilities: [],
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
      contract: { id: "trellis.console@v1", displayName: "Console", description: "Admin", format: "trellis.contract.v1" },
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
        subjects: {
        audit: {
          subject: "trellis.console.audit",
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
      return {
        userTrellisId: expectedTrellisId,
        origin: "github",
        id: "123",
        answer: "approved",
        answeredAt: new Date(),
        updatedAt: new Date(),
        approval: {
          contractId: "trellis.console@v1",
          contractDigest: "digest",
          displayName: "Console",
          description: "Admin",
          kind: "app",
          capabilities: ["audit"],
        },
        publishSubjects: [],
        subscribeSubjects: [],
      };
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
  assertEquals(requestedApprovalKey, contractApprovalKey(expectedTrellisId, resolution.plan.digest));
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

  const secure = shouldUseSecureOauthCookie({
    logLevel: "info",
    port: 3000,
    instanceName: "Trellis Test",
    web: { origins: ["http://localhost:3000"], publicOrigin: "://bad-origin" },
    httpRateLimit: { windowMs: 60_000, max: 60 },
    ttlMs: {
      sessions: 1,
      oauth: 1,
      workloadHandoff: 1,
      pendingAuth: 1,
      bindingTokens: { bucket: 1, initial: 1, renew: 1, cliInitial: 1, cliRenew: 1 },
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
  } satisfies Parameters<typeof shouldUseSecureOauthCookie>[0], {
    logger: {
      warn: (context, message) => {
        warnings.push({ origin: String(context.origin), message });
      },
    },
  });

  assertEquals(secure, true);
  assertEquals(warnings, [{
    origin: "://bad-origin",
    message: "Failed to parse auth public origin for cookie policy",
  }]);
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

Deno.test("resolveWorkloadPortal prefers profile selection over default and builtin", () => {
  const selectedPortal = resolveWorkloadPortal({
    profileId: "reader.default",
    portals: [
      { portalId: "default", entryUrl: "https://default.example.com" },
      { portalId: "profile", entryUrl: "https://profile.example.com" },
    ],
    defaultPortalId: "default",
    selections: [{ profileId: "reader.default", portalId: "profile" }],
  });
  assertEquals(selectedPortal, {
    kind: "custom",
    portal: { portalId: "profile", entryUrl: "https://profile.example.com" },
  });

  const forcedBuiltin = resolveWorkloadPortal({
    profileId: "reader.default",
    portals: [{ portalId: "default", entryUrl: "https://default.example.com" }],
    defaultPortalId: "default",
    selections: [{ profileId: "reader.default", portalId: null }],
  });
  assertEquals(forcedBuiltin, { kind: "builtin" });

  const defaultPortal = resolveWorkloadPortal({
    profileId: "reader.default",
    portals: [{ portalId: "default", entryUrl: "https://default.example.com" }],
    defaultPortalId: "default",
    selections: [],
  });
  assertEquals(defaultPortal, {
    kind: "custom",
    portal: { portalId: "default", entryUrl: "https://default.example.com" },
  });

  const builtinFallback = resolveWorkloadPortal({
    profileId: "reader.default",
    portals: [],
    defaultPortalId: undefined,
    selections: [],
  });
  assertEquals(builtinFallback, { kind: "builtin" });
});
