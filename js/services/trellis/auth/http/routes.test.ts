import { Hono } from "@hono/hono";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { AsyncResult } from "@qlever-llc/result";
import {
  base64urlEncode,
  createAuth,
  deriveDeviceIdentity,
  sha256,
  signDeviceWaitRequest,
  utf8,
} from "@qlever-llc/trellis/auth";

import type { Config } from "../../config.ts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import { authHttpRateLimitKey } from "./routes.ts";
import type { BrowserFlowRecord } from "./route_context.ts";
import { buildAuthStartSignaturePayload } from "./start_request.ts";
import { hashKey } from "../crypto.ts";
import { identityIdForProviderSubject } from "../identity.ts";
import { createLocalCredentialPassword } from "../local_credentials/passwords.ts";
import { registerDeviceActivationHttpRoutes } from "../device_activation/http.ts";
import type {
  AccountFlow,
  LocalCredential,
  LoginPortalRecord,
  LoginPortalSettings,
  OAuthState,
  PendingAuth,
  Session,
  UserAccount,
  UserIdentity,
} from "../schemas.ts";
import type { Provider } from "../providers/index.ts";

const config: Config = {
  logLevel: "info",
  port: 3000,
  instanceName: "Trellis",
  web: { origins: ["*"], allowInsecureOrigins: [] },
  httpRateLimit: { windowMs: 60_000, max: 0 },
  storage: { dbPath: ":memory:" },
  auth: { localIdentity: { enabled: true, passwordPolicy: { minLength: 8 } } },
  ttlMs: {
    sessions: 1,
    oauth: 1,
    deviceFlow: 1,
    pendingAuth: 1,
    connections: 1,
    natsJwt: 1,
  },
  nats: {
    servers: "nats://127.0.0.1:4222",
    jetstream: { replicas: 1 },
    trellis: { credsPath: "" },
    auth: { credsPath: "" },
    system: { credsPath: "" },
    sentinelCredsPath: "",
    authCallout: {
      issuer: { nkey: "issuer", signing: "issuer-seed" },
      target: { nkey: "target", signing: "target-seed" },
      sxSeed: "sx-seed",
    },
  },
  sessionKeySeed: "session-seed",
  client: { natsServers: ["ws://127.0.0.1:9222"] },
  oauth: {
    redirectBase: "http://localhost:3000",
    alwaysShowProviderChooser: false,
    providers: {},
  },
};

const portalRecord: LoginPortalRecord = {
  portalId: "trellis.builtin.login",
  displayName: "Trellis Login",
  entryUrl: null,
  builtIn: true,
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const portalSettings: LoginPortalSettings = {
  portalId: portalRecord.portalId,
  localRegistrationEnabled: true,
  federatedRegistrationEnabled: true,
  allowedFederatedProviders: null,
  selfRegisteredAccountActive: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const externalPortalRecord: LoginPortalRecord = {
  portalId: "external.portal",
  displayName: "External Portal",
  entryUrl: "https://portal.example/login",
  builtIn: false,
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const externalPortalSettings: LoginPortalSettings = {
  portalId: externalPortalRecord.portalId,
  localRegistrationEnabled: true,
  federatedRegistrationEnabled: true,
  allowedFederatedProviders: null,
  selfRegisteredAccountActive: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function externalPortalSelection() {
  return {
    portal: externalPortalRecord,
    settings: externalPortalSettings,
    defaultCapabilities: [],
    defaultCapabilityGroups: [],
  };
}

function externalLoginPortalStorage() {
  return {
    getSelectedByPortalId: (portalId: string) =>
      Promise.resolve(
        portalId === externalPortalRecord.portalId
          ? externalPortalSelection()
          : undefined,
      ),
    resolveForApp: () => Promise.resolve(externalPortalSelection()),
  };
}

function testProvider(name: string, displayName: string): Provider {
  return {
    name,
    displayName,
    issuer: `https://${name}.example`,
    authorizationEndpoint: `https://${name}.example/authorize`,
    tokenEndpoint: `https://${name}.example/token`,
    scope: "openid profile email",
    supportsDiscovery: true,
    supportsPKCE: true,
    clientId: `${name}-client`,
    clientSecret: `${name}-secret`,
    redirectBase: "http://localhost:3000/auth/oauth/callback",
    getRedirectUri() {
      return `${this.redirectBase}/${this.name}`;
    },
    getUserInfo() {
      return Promise.resolve({
        provider: name,
        id: "user",
        name: "Test User",
        email: "user@example.com",
        emailVerified: true,
      });
    },
  };
}

function accountFlow(overrides: Partial<AccountFlow>): AccountFlow {
  return {
    flowIdHash: "flow_hash",
    kind: "identity_link",
    targetUserId: "usr_target",
    targetIdentityId: null,
    targetLocalUsername: null,
    createdByUserId: "usr_admin",
    allowedProviders: null,
    capabilities: null,
    profileHint: null,
    createdAt: "2026-05-09T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    consumedAt: null,
    ...overrides,
  };
}

Deno.test("auth HTTP rate-limit key ignores spoofable forwarding headers", () => {
  assertEquals(
    authHttpRateLimitKey({
      env: { remoteAddr: { hostname: "203.0.113.10", port: 12345 } },
      req: { header: () => "198.51.100.20" },
    }),
    "203.0.113.10",
  );
  assertEquals(
    authHttpRateLimitKey({
      env: {},
      req: { header: () => "198.51.100.20" },
    }),
    "trellis-auth-http",
  );
});

Deno.test({
  name: "auth HTTP routes enforce configured rate limit",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({}, {}, {}, {
      config: { ...config, httpRateLimit: { windowMs: 60_000, max: 1 } },
    });
    const env = { remoteAddr: { hostname: "203.0.113.30", port: 12345 } };

    const first = await app.request("http://trellis/auth/requests", {
      method: "POST",
      body: "not-json",
    }, env);
    const second = await app.request("http://trellis/auth/requests", {
      method: "POST",
      body: "not-json",
    }, env);

    assertEquals(first.status, 400);
    assertEquals(second.status, 429);
    assertStringIncludes(await second.text(), "Too many requests");
  },
});

Deno.test({
  name: "auth HTTP routes skip rate limit when disabled",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({}, {}, {}, {
      config: { ...config, httpRateLimit: { windowMs: 60_000, max: 0 } },
    });
    const env = { remoteAddr: { hostname: "203.0.113.31", port: 12345 } };

    const first = await app.request("http://trellis/auth/requests", {
      method: "POST",
      body: "not-json",
    }, env);
    const second = await app.request("http://trellis/auth/requests", {
      method: "POST",
      body: "not-json",
    }, env);

    assertEquals(first.status, 400);
    assertEquals(second.status, 400);
  },
});

async function registerTestRoutes(
  flowOverride: Partial<BrowserFlowRecord> = {},
  storageOverride: Record<string, unknown> = {},
  providersOverride: Record<string, Provider> = {},
  routeOverride: Record<string, unknown> = {},
  runtimeDepsOverride: Record<string, unknown> = {},
): Promise<Hono> {
  const { registerHttpRoutes } = await import("./routes.ts");
  const app = new Hono();
  const kv = {
    get: () => AsyncResult.ok({ value: {} }),
    put: () => AsyncResult.ok(undefined),
    create: () => AsyncResult.ok(undefined),
    delete: () => AsyncResult.ok(undefined),
    keys: () => AsyncResult.ok((async function* () {})()),
  };
  const logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const storage = {
    get: () => Promise.resolve(undefined),
    getByProviderSubject: () => Promise.resolve(undefined),
    getLogin: () => Promise.resolve(undefined),
    getDevice: () => Promise.resolve(undefined),
    getByInstanceKey: () => Promise.resolve(undefined),
    has: () => Promise.resolve(false),
    put: () => Promise.resolve(undefined),
    consume: () => Promise.resolve(false),
    delete: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    listPage: () => Promise.resolve([]),
    listByUser: () => Promise.resolve([]),
    listByDeployment: () => Promise.resolve([]),
    listEnabledByContractId: () => Promise.resolve([]),
    getFirstEnabledForDeployments: () => Promise.resolve(undefined),
    ...storageOverride,
  };

  registerHttpRoutes(app, {
    contractStorage: storage,
    accountFlowStorage: storage,
    accountStorage: storage,
    userIdentityStorage: storage,
    localCredentialStorage: storage,
    userStorage: storage,
    contractApprovalStorage: storage,
    deploymentPortalRouteStorage: storage,
    serviceDeploymentStorage: storage,
    serviceInstanceStorage: storage,
    deviceDeploymentStorage: storage,
    deviceInstanceStorage: storage,
    deviceActivationStorage: storage,
    deviceActivationReviewStorage: storage,
    deviceProvisioningSecretStorage: storage,
    deploymentEnvelopeStorage: storage,
    deploymentGrantOverrideStorage: storage,
    deploymentResourceBindingStorage: storage,
    envelopeExpansionRequestStorage: storage,
    config,
    kick: async () => {},
    loadEffectiveGrantPolicies: () => Promise.resolve([]),
    contracts: createTestContracts(),
    providers: providersOverride,
    ...routeOverride,
    runtimeDeps: {
      browserFlowsKV: {
        ...kv,
        get: () =>
          AsyncResult.ok({
            value: {
              flowId: "missing",
              kind: "login",
              sessionKey: "session-local",
              authToken: "token",
              createdAt: new Date(),
              expiresAt: new Date("2099-01-01T00:00:00.000Z"),
              ...flowOverride,
            },
          }),
      },
      connectionsKV: kv,
      logger,
      natsTrellis: {},
      oauthStateKV: kv,
      pendingAuthKV: kv,
      sentinelCreds: { jwt: "jwt", seed: "seed" },
      sessionStorage: storage,
      trellis: { publish: () => AsyncResult.ok(undefined) },
      ...runtimeDepsOverride,
    },
  } as never);
  return app;
}

async function registerLocalLoginTestRoutes(options: {
  credential: LocalCredential;
  accountActive?: boolean;
}): Promise<{
  app: Hono;
  getCredential: () => LocalCredential;
  getPendingAuth: () => PendingAuth | undefined;
}> {
  const { registerHttpRoutes } = await import("./routes.ts");
  const app = new Hono();
  const flow: BrowserFlowRecord = {
    flowId: "flow-local",
    kind: "login",
    sessionKey: "session-local",
    redirectTo: "http://localhost:5173/app",
    contract: { id: "client.example@v1" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2099-01-01T00:05:00.000Z"),
  };
  let credential = options.credential;
  let pendingAuth: PendingAuth | undefined;
  const identity = {
    identityId: credential.identityId,
    userId: "usr_local",
    provider: "local",
    subject: "alex",
    displayName: "Alex Local",
    email: "alex@example.com",
    emailVerified: true,
    linkedAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: null,
  };
  const kv = {
    get: () => AsyncResult.ok({ value: {} }),
    put: () => AsyncResult.ok(undefined),
    create: () => AsyncResult.ok(undefined),
    delete: () => AsyncResult.ok(undefined),
    keys: () => AsyncResult.ok((async function* () {})()),
  };
  const logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const emptyStorage = {
    get: () => Promise.resolve(undefined),
    getLogin: () => Promise.resolve(undefined),
    getDevice: () => Promise.resolve(undefined),
    getByInstanceKey: () => Promise.resolve(undefined),
    has: () => Promise.resolve(false),
    put: () => Promise.resolve(undefined),
    consume: () => Promise.resolve(false),
    delete: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    listPage: () => Promise.resolve([]),
    listByUser: () => Promise.resolve([]),
    listEnabled: () => Promise.resolve([]),
    listByDeployment: () => Promise.resolve([]),
    listEnabledByContractId: () => Promise.resolve([]),
    getFirstEnabledForDeployments: () => Promise.resolve(undefined),
  };

  registerHttpRoutes(app, {
    contractStorage: emptyStorage,
    accountFlowStorage: emptyStorage,
    accountStorage: {
      ...emptyStorage,
      get: () =>
        Promise.resolve({
          userId: "usr_local",
          name: "Alex Account",
          email: "account@example.com",
          active: options.accountActive ?? true,
          capabilities: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
    },
    userIdentityStorage: {
      ...emptyStorage,
      getByProviderSubject: (provider: string, subject: string) =>
        Promise.resolve(
          provider === "local" && subject === "alex" ? identity : undefined,
        ),
    },
    localCredentialStorage: {
      ...emptyStorage,
      get: () => Promise.resolve(credential),
      put: (record: LocalCredential) => {
        credential = record;
        return Promise.resolve(undefined);
      },
    },
    userStorage: emptyStorage,
    contractApprovalStorage: emptyStorage,
    deploymentPortalRouteStorage: emptyStorage,
    serviceDeploymentStorage: emptyStorage,
    serviceInstanceStorage: emptyStorage,
    deviceDeploymentStorage: emptyStorage,
    deviceInstanceStorage: emptyStorage,
    deviceActivationStorage: emptyStorage,
    deviceActivationReviewStorage: emptyStorage,
    deviceProvisioningSecretStorage: emptyStorage,
    deploymentEnvelopeStorage: emptyStorage,
    deploymentGrantOverrideStorage: emptyStorage,
    deploymentResourceBindingStorage: emptyStorage,
    envelopeExpansionRequestStorage: emptyStorage,
    config,
    kick: async () => {},
    contracts: createTestContracts(),
    providers: {},
    runtimeDeps: {
      browserFlowsKV: {
        ...kv,
        get: () => AsyncResult.ok({ value: flow }),
      },
      connectionsKV: kv,
      logger,
      natsTrellis: {},
      oauthStateKV: kv,
      pendingAuthKV: {
        ...kv,
        create: (_key: string, value: PendingAuth) => {
          pendingAuth = value;
          return AsyncResult.ok(undefined);
        },
      },
      sentinelCreds: { jwt: "jwt", seed: "seed" },
      sessionStorage: emptyStorage,
    },
  } as never);

  return {
    app,
    getCredential: () => credential,
    getPendingAuth: () => pendingAuth,
  };
}

function localLoginRequest(password: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      flowId: "flow-local",
      username: "alex",
      password,
    }),
  };
}

Deno.test({
  name: "auth HTTP routes register current auth request endpoint",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();

    const response = await app.request("http://trellis/auth/requests", {
      method: "POST",
      body: "not-json",
    });

    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "Invalid JSON body" });
  },
});

Deno.test({
  name: "auth HTTP routes set browser security headers",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();

    const response = await app.request("http://trellis/auth/requests", {
      method: "POST",
      body: "not-json",
    });

    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    assertEquals(response.headers.get("referrer-policy"), "no-referrer");
    assertEquals(response.headers.get("x-frame-options"), "DENY");
    assertStringIncludes(
      response.headers.get("content-security-policy") ?? "",
      "frame-ancestors 'none'",
    );
    assertEquals(response.headers.get("strict-transport-security"), null);
  },
});

Deno.test({
  name: "auth HTTP routes register account-flow local-password endpoint",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();
    const response = await app.request(
      "http://trellis/auth/account-flow/missing/local-password",
      {
        method: "POST",
        body: JSON.stringify({ username: "ada", password: "password" }),
        headers: { "content-type": "application/json" },
      },
    );

    assertEquals(response.status, 404);
    assertEquals(await response.json(), { error: "flow_not_found" });
  },
});

Deno.test({
  name: "auth HTTP account-flow state returns expired for missing flow",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();

    const response = await app.request(
      "http://trellis/auth/account-flow/missing",
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { status: "expired" });
  },
});

Deno.test({
  name: "auth HTTP account-flow state returns consumed flow summary",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "consumed-flow";
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "identity_link",
      targetUserId: "usr_target",
      targetIdentityId: null,
      targetLocalUsername: null,
      createdByUserId: "usr_admin",
      allowedProviders: null,
      capabilities: ["admin"],
      profileHint: { name: "Ada" },
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: "2026-05-09T00:01:00.000Z",
    };
    const app = await registerTestRoutes({}, {
      get: (id: string) =>
        Promise.resolve(id === flow.flowIdHash ? flow : undefined),
    });

    const response = await app.request(
      `http://trellis/auth/account-flow/${flowId}`,
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "consumed",
      kind: "identity_link",
      targetUserId: "usr_target",
    });
  },
});

Deno.test({
  name: "auth HTTP account-flow state returns expired flow summary",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "expired-flow";
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "local_password_reset",
      targetUserId: "usr_target",
      targetIdentityId: null,
      targetLocalUsername: null,
      createdByUserId: "usr_admin",
      allowedProviders: ["local"],
      capabilities: null,
      profileHint: null,
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2000-01-01T00:00:00.000Z",
      consumedAt: null,
    };
    const app = await registerTestRoutes({}, {
      get: (id: string) =>
        Promise.resolve(id === flow.flowIdHash ? flow : undefined),
    });

    const response = await app.request(
      `http://trellis/auth/account-flow/${flowId}`,
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "expired",
      kind: "local_password_reset",
      targetUserId: "usr_target",
    });
  },
});

Deno.test({
  name: "auth HTTP account-flow state returns active portal-safe state",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "invite-flow";
    const identityId = identityIdForProviderSubject("local", "ada");
    const target: UserAccount = {
      userId: "usr_target",
      name: "Ada Account",
      email: "ada@example.com",
      active: true,
      capabilities: ["admin"],
      capabilityGroups: [],
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "identity_link",
      targetUserId: target.userId,
      targetIdentityId: null,
      targetLocalUsername: null,
      createdByUserId: "usr_admin",
      allowedProviders: ["local", "github"],
      capabilities: ["admin"],
      profileHint: { name: "Ada" },
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
    };
    const app = await registerTestRoutes({}, {
      get: (id: string) =>
        Promise.resolve(
          id === flow.flowIdHash
            ? flow
            : id === target.userId
            ? target
            : undefined,
        ),
    }, {
      github: testProvider("github", "GitHub"),
      google: testProvider("google", "Google"),
    });

    const response = await app.request(
      `http://trellis/auth/account-flow/${flowId}`,
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "active",
      flowId,
      kind: "identity_link",
      targetUserId: target.userId,
      allowedProviders: ["local", "github"],
      profileHint: { name: "Ada" },
      expiresAt: "2099-01-01T00:00:00.000Z",
      passwordPolicy: { minLength: 8 },
      providers: [
        { id: "local", displayName: "Username and password" },
        { id: "github", displayName: "GitHub" },
      ],
      target: {
        userId: target.userId,
        name: "Ada Account",
        email: "ada@example.com",
        active: true,
      },
    });
  },
});

Deno.test({
  name:
    "auth HTTP identity-link state hides local provider when target already has local identity",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "identity-link-flow";
    const target: UserAccount = {
      userId: "usr_target",
      name: "Ada Account",
      email: "ada@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };
    const localIdentity: UserIdentity = {
      identityId: identityIdForProviderSubject("local", "ada"),
      userId: target.userId,
      provider: "local",
      subject: "ada",
      displayName: "Ada",
      email: "ada@example.com",
      emailVerified: false,
      linkedAt: "2026-05-09T00:00:00.000Z",
      lastLoginAt: null,
    };
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "identity_link",
      targetUserId: target.userId,
      targetIdentityId: null,
      targetLocalUsername: null,
      createdByUserId: target.userId,
      allowedProviders: null,
      capabilities: null,
      profileHint: null,
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
    };
    const app = await registerTestRoutes({}, {
      get: (id: string) =>
        Promise.resolve(
          id === flow.flowIdHash
            ? flow
            : id === target.userId
            ? target
            : undefined,
        ),
      listByUser: (userId: string) =>
        Promise.resolve(userId === target.userId ? [localIdentity] : []),
    }, {
      github: testProvider("github", "GitHub"),
    });

    const response = await app.request(
      `http://trellis/auth/account-flow/${flowId}`,
    );

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.providers, [{ id: "github", displayName: "GitHub" }]);
  },
});

Deno.test({
  name: "auth HTTP admin-bootstrap account-flow state allows all providers",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "bootstrap-flow";
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "admin_bootstrap",
      targetUserId: null,
      targetIdentityId: null,
      targetLocalUsername: null,
      createdByUserId: null,
      allowedProviders: null,
      capabilities: ["admin"],
      profileHint: null,
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
    };
    const app = await registerTestRoutes({}, {
      get: (id: string) =>
        Promise.resolve(id === flow.flowIdHash ? flow : undefined),
    }, {
      github: testProvider("github", "GitHub"),
    });

    const response = await app.request(
      `http://trellis/auth/account-flow/${flowId}`,
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "active",
      flowId,
      kind: "admin_bootstrap",
      allowedProviders: null,
      profileHint: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
      passwordPolicy: { minLength: 8 },
      providers: [
        { id: "local", displayName: "Username and password" },
        { id: "github", displayName: "GitHub" },
      ],
    });
  },
});

Deno.test({
  name: "auth HTTP account-flow OAuth start stores typed account-flow state",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "invite-oauth-flow";
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "identity_link",
      targetUserId: "usr_target",
      targetIdentityId: null,
      targetLocalUsername: null,
      createdByUserId: "usr_admin",
      allowedProviders: ["github"],
      capabilities: null,
      profileHint: null,
      returnTo: "/profile?tab=logins",
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
    };
    let savedState: OAuthState | undefined;
    const app = await registerTestRoutes({}, {
      get: (id: string) =>
        Promise.resolve(id === flow.flowIdHash ? flow : undefined),
    }, {
      github: testProvider("github", "GitHub"),
    }, {
      oauthCodeRequest: () =>
        Promise.resolve([
          "https://github.example/authorize?state=state-123",
          { state: "state-123", codeVerifier: "verifier-123" },
        ]),
    }, {
      oauthStateKV: {
        create: (_key: string, value: OAuthState) => {
          savedState = value;
          return AsyncResult.ok(undefined);
        },
      },
    });

    const response = await app.request(
      `http://trellis/auth/account-flow/${flowId}/login/github`,
    );

    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "https://github.example/authorize?state=state-123",
    );
    assertStringIncludes(
      response.headers.get("set-cookie") ?? "",
      "trellis_oauth=state-123",
    );
    assertEquals(savedState?.kind, "account_flow");
    if (savedState?.kind !== "account_flow") {
      throw new Error("expected account-flow OAuth state");
    }
    assertEquals(savedState?.provider, "github");
    assertEquals(savedState?.flowId, flowId);
    assertEquals(savedState?.returnTo, "/profile?tab=logins");
    assertEquals(savedState?.codeVerifier, "verifier-123");
    assertEquals(savedState?.createdAt instanceof Date, true);
  },
});

Deno.test({
  name: "auth HTTP OAuth login start validates browser flow state",
  sanitizeResources: false,
  fn: async () => {
    const provider = { github: testProvider("github", "GitHub") };

    const wrongKindApp = await registerTestRoutes(
      { kind: "device_activation" as const },
      {},
      provider,
    );
    const wrongKindResponse = await wrongKindApp.request(
      "http://trellis/auth/login/github?flowId=flow-oauth",
    );

    assertEquals(wrongKindResponse.status, 404);
    assertStringIncludes(
      await wrongKindResponse.text(),
      "Expired browser flow",
    );

    const app = await registerTestRoutes(
      { sessionKey: undefined },
      {},
      provider,
    );
    const response = await app.request(
      "http://trellis/auth/login/github?flowId=flow-oauth",
    );

    assertEquals(response.status, 400);
    assertStringIncludes(await response.text(), "Invalid browser flow state");
  },
});

Deno.test({
  name: "auth HTTP OAuth login start redirects expired login flows to app",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes(
      {
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        redirectTo: "http://localhost:5173/callback?redirectTo=%2Fprofile",
      },
      {},
      { github: testProvider("github", "GitHub") },
    );

    const response = await app.request(
      "http://trellis/auth/login/github?flowId=flow-oauth",
    );

    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "http://localhost:5173/callback?redirectTo=%2Fprofile&authError=flow_expired",
    );
  },
});

Deno.test({
  name:
    "auth HTTP account-flow OAuth callback links provider to target account",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "link-oauth-flow";
    const target: UserAccount = {
      userId: "usr_target",
      name: "Target User",
      email: "target@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "identity_link",
      targetUserId: target.userId,
      targetIdentityId: null,
      targetLocalUsername: null,
      createdByUserId: "usr_admin",
      allowedProviders: ["github"],
      capabilities: null,
      profileHint: null,
      returnTo: "/profile",
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
    };
    let linkedIdentity: UserIdentity | undefined;
    const oauthState: OAuthState = {
      kind: "account_flow",
      provider: "github",
      flowId,
      codeVerifier: "verifier-123",
      createdAt: new Date("2026-05-09T00:00:00.000Z"),
    };
    const app = await registerTestRoutes({}, {
      get: (id: string) =>
        Promise.resolve(
          id === flow.flowIdHash
            ? flow
            : id === target.userId
            ? target
            : undefined,
        ),
      consume: (flowIdHash: string, consumedAt: string) => {
        if (flowIdHash !== flow.flowIdHash || flow.consumedAt !== null) {
          return Promise.resolve(false);
        }
        flow.consumedAt = consumedAt;
        return Promise.resolve(true);
      },
      getByProviderSubject: () => Promise.resolve(undefined),
      put: (record: UserIdentity) => {
        linkedIdentity = record;
        return Promise.resolve(undefined);
      },
    }, {
      github: testProvider("github", "GitHub"),
    }, {
      oauthCodeResponse: () => Promise.resolve({ accessToken: "access-token" }),
    }, {
      oauthStateKV: {
        get: () =>
          AsyncResult.ok({
            value: oauthState,
            delete: () => AsyncResult.ok(undefined),
          }),
      },
    });

    const response = await app.request(
      "http://trellis/auth/callback/github?state=state-123&code=code-123",
      { headers: { cookie: "trellis_oauth=state-123" } },
    );

    assertEquals(response.status, 302);
    assertStringIncludes(
      response.headers.get("location") ?? "",
      "/_trellis/portal/account/link?flowId=link-oauth-flow&status=completed&userId=usr_target",
    );
    assertStringIncludes(
      response.headers.get("location") ?? "",
      "returnTo=%2Fprofile",
    );
    assertEquals(flow.consumedAt !== null, true);
    assertEquals(linkedIdentity?.userId, target.userId);
    assertEquals(linkedIdentity?.provider, "github");
    assertEquals(linkedIdentity?.subject, "user");
    assertEquals(linkedIdentity?.lastLoginAt, flow.consumedAt);
  },
});

Deno.test({
  name:
    "auth HTTP account-flow local-password endpoint completes target account flow",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "invite-flow";
    const identityId = identityIdForProviderSubject("local", "ada");
    const target: UserAccount = {
      userId: "usr_target",
      name: null,
      email: null,
      active: true,
      capabilities: ["admin"],
      capabilityGroups: [],
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "local_password_reset",
      targetUserId: target.userId,
      targetIdentityId: identityId,
      targetLocalUsername: "ada",
      createdByUserId: "usr_admin",
      allowedProviders: ["local"],
      capabilities: null,
      profileHint: null,
      returnTo: "/profile",
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
    };
    const existingIdentity: UserIdentity = {
      identityId,
      userId: target.userId,
      provider: "local",
      subject: "ada",
      displayName: null,
      email: null,
      emailVerified: false,
      linkedAt: "2026-05-01T00:00:00.000Z",
      lastLoginAt: null,
    };
    const identities: UserIdentity[] = [existingIdentity];
    const credentials: LocalCredential[] = [];
    const app = await registerTestRoutes({}, {
      get: (id: string) =>
        Promise.resolve(id === flow.flowIdHash ? flow : target),
      consume: (flowIdHash: string, consumedAt: string) => {
        if (flowIdHash !== flow.flowIdHash || flow.consumedAt !== null) {
          return Promise.resolve(false);
        }
        flow.consumedAt = consumedAt;
        return Promise.resolve(true);
      },
      getByProviderSubject: (provider: string, subject: string) =>
        Promise.resolve(
          identities.find((identity) =>
            identity.provider === provider && identity.subject === subject
          ),
        ),
      listByUser: (userId: string) =>
        Promise.resolve(
          identities.filter((identity) => identity.userId === userId),
        ),
      put: (record: UserIdentity | LocalCredential) => {
        if ("provider" in record) identities.push(record);
        else credentials.push(record);
        return Promise.resolve(undefined);
      },
    });

    const response = await app.request(
      `http://trellis/auth/account-flow/${flowId}/local-password`,
      {
        method: "POST",
        body: JSON.stringify({
          username: "ada",
          password: "password",
          name: "Ada Local",
          email: "ada@example.com",
        }),
        headers: { "content-type": "application/json" },
      },
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "created",
      userId: target.userId,
      returnTo: "/profile",
    });
    assertEquals(flow.consumedAt !== null, true);
    if (flow.consumedAt === null) throw new Error("expected consumed flow");
    assertEquals(identities, [existingIdentity]);
    assertEquals(credentials.length, 1);
    assertEquals(credentials[0]?.identityId, identityId);
  },
});

Deno.test({
  name:
    "auth HTTP account-flow local-password endpoint maps inactive target errors",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "setup-flow";
    const target: UserAccount = {
      userId: "usr_target",
      name: null,
      email: null,
      active: false,
      capabilities: [],
      capabilityGroups: [],
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "local_password_reset",
      targetUserId: target.userId,
      targetIdentityId: null,
      targetLocalUsername: null,
      createdByUserId: "usr_admin",
      allowedProviders: ["local"],
      capabilities: null,
      profileHint: null,
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
    };
    const app = await registerTestRoutes({}, {
      get: (id: string) =>
        Promise.resolve(id === flow.flowIdHash ? flow : target),
    });

    const response = await app.request(
      `http://trellis/auth/account-flow/${flowId}/local-password`,
      {
        method: "POST",
        body: JSON.stringify({ username: "ada", password: "password" }),
        headers: { "content-type": "application/json" },
      },
    );

    assertEquals(response.status, 403);
    assertEquals(await response.json(), { error: "target_user_inactive" });
  },
});

Deno.test({
  name:
    "auth HTTP account-flow local-password endpoint maps password policy errors",
  sanitizeResources: false,
  fn: async () => {
    const flowId = "reset-short-password-flow";
    const identityId = identityIdForProviderSubject("local", "ada");
    const target: UserAccount = {
      userId: "usr_target",
      name: null,
      email: null,
      active: true,
      capabilities: [],
      capabilityGroups: [],
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };
    const identity: UserIdentity = {
      identityId,
      userId: target.userId,
      provider: "local",
      subject: "ada",
      displayName: null,
      email: null,
      emailVerified: false,
      linkedAt: "2026-05-01T00:00:00.000Z",
      lastLoginAt: null,
    };
    const flow: AccountFlow = {
      flowIdHash: await hashKey(flowId),
      kind: "local_password_reset",
      targetUserId: target.userId,
      targetIdentityId: identityId,
      targetLocalUsername: "ada",
      createdByUserId: "usr_admin",
      allowedProviders: ["local"],
      capabilities: null,
      profileHint: null,
      createdAt: "2026-05-09T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
    };
    const app = await registerTestRoutes(
      {},
      {
        get: (id: string) =>
          Promise.resolve(
            id === flow.flowIdHash
              ? flow
              : id === target.userId
              ? target
              : undefined,
          ),
        getByProviderSubject: (provider: string, subject: string) =>
          Promise.resolve(
            provider === "local" && subject === "ada" ? identity : undefined,
          ),
        listByUser: (userId: string) =>
          Promise.resolve(userId === target.userId ? [identity] : []),
      },
      {},
      {
        config: {
          ...config,
          auth: {
            localIdentity: { enabled: true, passwordPolicy: { minLength: 12 } },
          },
        },
      },
    );

    const response = await app.request(
      `http://trellis/auth/account-flow/${flowId}/local-password`,
      {
        method: "POST",
        body: JSON.stringify({ password: "short" }),
        headers: { "content-type": "application/json" },
      },
    );

    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error: "local_password_too_short",
      minLength: 12,
    });
  },
});

Deno.test({
  name: "auth HTTP flow state offers local login without OAuth providers",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({ authToken: undefined });

    const response = await app.request("http://trellis/auth/flow/missing");

    assertEquals(response.status, 200);
    assertEquals((await response.json()).providers, [
      { id: "local", displayName: "Username and password" },
    ]);
  },
});

Deno.test({
  name: "auth HTTP flow state reports selected portal registration policy",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({ authToken: undefined }, {}, {
      github: testProvider("github", "GitHub"),
    }, {
      loginPortalStorage: {
        resolveForApp: () =>
          Promise.resolve({
            portal: portalRecord,
            settings: portalSettings,
            defaultCapabilities: [],
            defaultCapabilityGroups: [],
          }),
      },
    });

    const response = await app.request("http://trellis/auth/flow/flow-local");

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "choose_provider",
      flowId: "flow-local",
      providers: [
        { id: "local", displayName: "Username and password" },
        { id: "github", displayName: "GitHub" },
      ],
      app: {
        contractId: "unknown",
        contractDigest: "unknown",
        displayName: "Trellis",
        description: "Trellis",
      },
      portal: portalRecord,
      registration: {
        localIdentity: { available: true },
        federatedIdentity: {
          available: true,
          providers: [{ id: "github", displayName: "GitHub" }],
        },
      },
    });
  },
});

Deno.test({
  name:
    "auth HTTP flow state filters federated providers by selected portal allowlist",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({ authToken: undefined }, {}, {
      github: testProvider("github", "GitHub"),
      google: testProvider("google", "Google"),
    }, {
      loginPortalStorage: {
        resolveForApp: () =>
          Promise.resolve({
            portal: portalRecord,
            settings: {
              ...portalSettings,
              allowedFederatedProviders: ["github"],
            },
            defaultCapabilities: [],
            defaultCapabilityGroups: [],
          }),
      },
    });

    const response = await app.request("http://trellis/auth/flow/flow-local");

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.providers, [
      { id: "local", displayName: "Username and password" },
      { id: "github", displayName: "GitHub" },
    ]);
    assertEquals(body.registration.federatedIdentity, {
      available: true,
      providers: [{ id: "github", displayName: "GitHub" }],
    });
  },
});

Deno.test({
  name:
    "auth HTTP flow state treats empty federated provider allowlist as none",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({ authToken: undefined }, {}, {
      github: testProvider("github", "GitHub"),
    }, {
      loginPortalStorage: {
        resolveForApp: () =>
          Promise.resolve({
            portal: portalRecord,
            settings: { ...portalSettings, allowedFederatedProviders: [] },
            defaultCapabilities: [],
            defaultCapabilityGroups: [],
          }),
      },
    });

    const response = await app.request("http://trellis/auth/flow/flow-local");

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.providers, [
      { id: "local", displayName: "Username and password" },
    ]);
    assertEquals(body.registration.federatedIdentity, {
      available: false,
      providers: [],
    });
  },
});

Deno.test({
  name:
    "auth HTTP login rejects federated provider outside selected portal allowlist",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({ authToken: undefined }, {}, {
      github: testProvider("github", "GitHub"),
      google: testProvider("google", "Google"),
    }, {
      loginPortalStorage: {
        resolveForApp: () =>
          Promise.resolve({
            portal: portalRecord,
            settings: {
              ...portalSettings,
              allowedFederatedProviders: ["github"],
            },
            defaultCapabilities: [],
            defaultCapabilityGroups: [],
          }),
      },
    });

    const response = await app.request(
      "http://trellis/auth/login/google?flowId=flow-local",
    );

    assertEquals(response.status, 403);
  },
});

Deno.test({
  name: "auth HTTP flow state accepts configured external portal origin",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({ authToken: undefined }, {}, {}, {
      loginPortalStorage: externalLoginPortalStorage(),
    });

    const response = await app.request("http://trellis/auth/flow/flow-local", {
      headers: { origin: "https://portal.example" },
    });

    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      "https://portal.example",
    );
    assertEquals((await response.json()).portal, externalPortalRecord);
  },
});

Deno.test({
  name:
    "auth HTTP flow state checks the portal selected when the flow was created",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes(
      {
        authToken: undefined,
        portalId: externalPortalRecord.portalId,
      },
      {},
      {},
      {
        loginPortalStorage: {
          getSelectedByPortalId: (portalId: string) =>
            Promise.resolve(
              portalId === externalPortalRecord.portalId
                ? externalPortalSelection()
                : undefined,
            ),
          resolveForApp: () => {
            throw new Error("flow portal should not be re-resolved");
          },
        },
      },
    );

    const response = await app.request("http://trellis/auth/flow/flow-local", {
      headers: { origin: "https://portal.example" },
    });

    assertEquals(response.status, 200);
    assertEquals((await response.json()).portal, externalPortalRecord);
  },
});

Deno.test({
  name: "auth HTTP flow state rejects mismatched external portal origin",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({ authToken: undefined }, {}, {}, {
      loginPortalStorage: externalLoginPortalStorage(),
    });

    const response = await app.request("http://trellis/auth/flow/flow-local", {
      headers: { origin: "https://attacker.example" },
    });

    assertEquals(response.status, 403);
    assertStringIncludes(await response.text(), "portal_origin_mismatch");
  },
});

Deno.test({
  name: "auth HTTP approval route rejects mismatched external portal origin",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({}, {}, {}, {
      loginPortalStorage: externalLoginPortalStorage(),
    });

    const response = await app.request(
      "http://trellis/auth/flow/missing/approval",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ decision: "approved" }),
      },
    );

    assertEquals(response.status, 403);
    assertStringIncludes(await response.text(), "portal_origin_mismatch");
  },
});

Deno.test({
  name: "auth HTTP bind route does not allow portal-origin CORS",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes(
      { portalId: externalPortalRecord.portalId },
      {},
      {},
      { loginPortalStorage: externalLoginPortalStorage() },
    );

    const response = await app.request(
      "http://trellis/auth/flow/flow-local/bind",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://portal.example",
          "access-control-request-method": "POST",
        },
      },
    );

    assertEquals(response.headers.get("access-control-allow-origin"), null);
  },
});

Deno.test({
  name: "auth HTTP bind preflight allows only the flow app origin",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({
      app: { contractId: "client.example@v1", origin: "https://app.example" },
    });

    const response = await app.request(
      "http://trellis/auth/flow/flow-local/bind",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example",
          "access-control-request-method": "POST",
        },
      },
    );

    assertEquals(response.status, 204);
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      "https://app.example",
    );
    assertEquals(
      response.headers.get("access-control-allow-credentials"),
      "true",
    );
  },
});

Deno.test({
  name: "auth HTTP public CORS allows arbitrary origins without credentials",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();

    const response = await app.request("http://trellis/bootstrap/client", {
      method: "OPTIONS",
      headers: {
        origin: "https://third-party.example",
        "access-control-request-method": "POST",
      },
    });

    assertEquals(response.status, 204);
    assertEquals(response.headers.get("access-control-allow-origin"), "*");
    assertEquals(
      response.headers.get("access-control-allow-credentials"),
      null,
    );
  },
});

Deno.test({
  name: "auth HTTP restricted CORS allows credentials for configured origins",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({}, {}, {}, {
      config: {
        ...config,
        web: {
          ...config.web,
          origins: ["https://app.example"],
        },
      },
    });

    const response = await app.request("http://trellis/bootstrap/client", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example",
        "access-control-request-method": "POST",
      },
    });

    assertEquals(response.status, 204);
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      "https://app.example",
    );
    assertEquals(
      response.headers.get("access-control-allow-credentials"),
      "true",
    );
  },
});

Deno.test({
  name:
    "auth HTTP local login preflight allows portal origin for route-level validation",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({}, {}, {}, {
      loginPortalStorage: externalLoginPortalStorage(),
    });

    const response = await app.request("http://trellis/auth/login/local", {
      method: "OPTIONS",
      headers: {
        origin: "https://portal.example",
        "access-control-request-method": "POST",
      },
    });

    assertEquals(response.status, 204);
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      "https://portal.example",
    );
  },
});

Deno.test({
  name: "auth HTTP local login rejects mismatched external portal origin",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({}, {}, {}, {
      loginPortalStorage: externalLoginPortalStorage(),
    });

    const response = await app.request("http://trellis/auth/login/local", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      body: JSON.stringify({
        flowId: "missing",
        username: "alex",
        password: "secret",
      }),
    });

    assertEquals(response.status, 403);
    assertStringIncludes(await response.text(), "portal_origin_mismatch");
  },
});

Deno.test({
  name:
    "auth HTTP local registration preflight accepts configured external portal origin",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({}, {}, {}, {
      loginPortalStorage: externalLoginPortalStorage(),
    });

    const response = await app.request(
      "http://trellis/auth/flow/flow-local/register/local",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://portal.example",
          "access-control-request-method": "POST",
        },
      },
    );

    assertEquals(response.status, 204);
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      "https://portal.example",
    );
  },
});

Deno.test({
  name: "auth HTTP local self-registration creates pending auth",
  sanitizeResources: false,
  fn: async () => {
    let registered = false;
    let registeredPasswordMinLength: number | undefined;
    let pendingAuth: PendingAuth | undefined;
    const app = await registerTestRoutes(
      {
        flowId: "flow-register",
        authToken: undefined,
        sessionKey: "session-local",
        redirectTo: "http://localhost:5173/app",
        contract: { id: "client.example@v1" },
      },
      {},
      {},
      {
        loginPortalStorage: {
          resolveForApp: () =>
            Promise.resolve({
              portal: portalRecord,
              settings: portalSettings,
              defaultCapabilities: ["profile.basic"],
              defaultCapabilityGroups: ["users"],
            }),
          registerLocalIdentity: (request: {
            username: string;
            name: string;
            email: string;
            active: boolean;
            capabilities: string[];
            capabilityGroups: string[];
            userId: string;
            passwordMinLength?: number;
          }) => {
            registered = true;
            registeredPasswordMinLength = request.passwordMinLength;
            return Promise.resolve({
              ok: true as const,
              account: {
                userId: request.userId,
                name: request.name,
                email: request.email,
                active: request.active,
                capabilities: request.capabilities,
                capabilityGroups: request.capabilityGroups,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
              identity: {
                identityId: identityIdForProviderSubject(
                  "local",
                  request.username,
                ),
                userId: request.userId,
                provider: "local",
                subject: request.username,
                displayName: request.name,
                email: request.email,
                emailVerified: false,
                linkedAt: "2026-01-01T00:00:00.000Z",
                lastLoginAt: "2026-01-01T00:00:00.000Z",
              },
            });
          },
        },
      },
      {
        pendingAuthKV: {
          get: () => AsyncResult.ok({ value: {} }),
          put: () => AsyncResult.ok(undefined),
          create: (_key: string, value: PendingAuth) => {
            pendingAuth = value;
            return AsyncResult.ok(undefined);
          },
          delete: () => AsyncResult.ok(undefined),
          keys: () => AsyncResult.ok((async function* () {})()),
        },
      },
    );

    const response = await app.request(
      "http://trellis/auth/flow/flow-register/register/local",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alex",
          password: "correct horse battery staple",
          name: "Alex Local",
          email: "alex@example.com",
        }),
      },
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "authenticated",
      flowId: "flow-register",
    });
    assertEquals(registered, true);
    assertEquals(registeredPasswordMinLength, 8);
    assertEquals(pendingAuth?.identity.provider, "local");
    assertEquals(pendingAuth?.user.email, "alex@example.com");
  },
});

Deno.test({
  name: "auth HTTP local self-registration reports username conflicts",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes(
      {
        flowId: "flow-register-conflict",
        authToken: undefined,
        sessionKey: "session-local",
        redirectTo: "http://localhost:5173/app",
        contract: { id: "client.example@v1" },
      },
      {},
      {},
      {
        loginPortalStorage: {
          resolveForApp: () =>
            Promise.resolve({
              portal: portalRecord,
              settings: portalSettings,
              defaultCapabilities: [],
              defaultCapabilityGroups: [],
            }),
          registerLocalIdentity: () =>
            Promise.resolve({ ok: false as const, error: "identity_conflict" }),
        },
      },
    );

    const response = await app.request(
      "http://trellis/auth/flow/flow-register-conflict/register/local",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alex",
          password: "correct horse battery staple",
          name: "Alex Local",
          email: "alex@example.com",
        }),
      },
    );

    assertEquals(response.status, 409);
    assertEquals(await response.json(), { error: "username_taken" });
  },
});

Deno.test({
  name: "auth HTTP local self-registration returns password policy errors",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes(
      {
        flowId: "flow-register-short-password",
        authToken: undefined,
        sessionKey: "session-local",
        redirectTo: "http://localhost:5173/app",
        contract: { id: "client.example@v1" },
      },
      {},
      {},
      {
        loginPortalStorage: externalLoginPortalStorage(),
        config: {
          ...config,
          auth: {
            localIdentity: { enabled: true, passwordPolicy: { minLength: 12 } },
          },
        },
      },
    );

    const response = await app.request(
      "http://trellis/auth/flow/flow-register-short-password/register/local",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://portal.example",
        },
        body: JSON.stringify({
          username: "alex",
          password: "too-short",
          name: "Alex Local",
          email: "alex@example.com",
        }),
      },
    );

    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error: "Password must be at least 12 characters",
    });
  },
});

Deno.test({
  name:
    "auth HTTP start rejects malformed session keys and signatures during request validation",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();
    const auth = await createAuth({ sessionKeySeed: "A".repeat(43) });
    const cases = [
      {
        sessionKey: "not-a-session-key",
        sig: "A".repeat(86),
      },
      {
        sessionKey: auth.sessionKey,
        sig: "not-a-signature",
      },
    ];

    for (const body of cases) {
      const response = await app.request("http://trellis/auth/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirectTo: "http://localhost:5173/app",
          contract: {},
          ...body,
        }),
      });

      assertEquals(response.status, 400);
      assertStringIncludes(await response.text(), "Invalid request");
    }
  },
});

Deno.test({
  name:
    "auth HTTP bind rejects malformed session keys and signatures during request validation",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();
    const auth = await createAuth({ sessionKeySeed: "A".repeat(43) });
    const cases = [
      {
        sessionKey: "not-a-session-key",
        sig: "A".repeat(86),
      },
      {
        sessionKey: auth.sessionKey,
        sig: "not-a-signature",
      },
    ];

    for (const body of cases) {
      const response = await app.request(
        "http://trellis/auth/flow/missing/bind",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      assertEquals(response.status, 400);
      assertEquals(await response.json(), { error: "Invalid bind request" });
    }
  },
});

Deno.test({
  name: "auth HTTP routes do not register removed legacy login endpoint",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();

    const response = await app.request("http://trellis/auth/login", {
      method: "GET",
    });

    assertEquals(response.status, 404);
  },
});

Deno.test({
  name: "auth HTTP local login creates pending auth for linked active identity",
  sanitizeResources: false,
  fn: async () => {
    const { registerHttpRoutes } = await import("./routes.ts");
    const app = new Hono();
    const flow: BrowserFlowRecord = {
      flowId: "flow-local",
      kind: "login" as const,
      sessionKey: "session-local",
      redirectTo: "http://localhost:5173/app",
      app: { contractId: "client.example@v1", origin: "http://localhost:5173" },
      contract: {
        id: "client.example@v1",
        displayName: "Example Client",
        description: "Example browser client",
      },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:05:00.000Z"),
    };
    let savedFlow = flow;
    let pendingAuth: PendingAuth | undefined;
    const identity = {
      identityId: "idn_local",
      userId: "usr_local",
      provider: "local",
      subject: "alex",
      displayName: "Alex Local",
      email: "alex@example.com",
      emailVerified: true,
      linkedAt: "2026-01-01T00:00:00.000Z",
      lastLoginAt: null,
    };
    const credential = await createLocalCredentialPassword({
      identityId: identity.identityId,
      password: "correct horse battery staple",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const kv = {
      get: () => AsyncResult.ok({ value: {} }),
      put: () => AsyncResult.ok(undefined),
      create: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok((async function* () {})()),
    };
    const logger = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const emptyStorage = {
      get: () => Promise.resolve(undefined),
      getLogin: () => Promise.resolve(undefined),
      getDevice: () => Promise.resolve(undefined),
      getByInstanceKey: () => Promise.resolve(undefined),
      has: () => Promise.resolve(false),
      put: () => Promise.resolve(undefined),
      consume: () => Promise.resolve(false),
      delete: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      listPage: () => Promise.resolve([]),
      listByUser: () => Promise.resolve([]),
      listEnabled: () => Promise.resolve([]),
      listByDeployment: () => Promise.resolve([]),
      listEnabledByContractId: () => Promise.resolve([]),
      getFirstEnabledForDeployments: () => Promise.resolve(undefined),
    };

    registerHttpRoutes(app, {
      contractStorage: emptyStorage,
      accountFlowStorage: emptyStorage,
      accountStorage: {
        ...emptyStorage,
        get: () =>
          Promise.resolve({
            userId: "usr_local",
            name: "Alex Account",
            email: "account@example.com",
            active: true,
            capabilities: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
      },
      userIdentityStorage: {
        ...emptyStorage,
        getByProviderSubject: (provider: string, subject: string) =>
          Promise.resolve(
            provider === "local" && subject === "alex" ? identity : undefined,
          ),
        put: (record: typeof identity) => {
          Object.assign(identity, record);
          return Promise.resolve(undefined);
        },
      },
      localCredentialStorage: {
        ...emptyStorage,
        get: () => Promise.resolve(credential),
      },
      userStorage: emptyStorage,
      contractApprovalStorage: emptyStorage,
      deploymentPortalRouteStorage: emptyStorage,
      serviceDeploymentStorage: emptyStorage,
      serviceInstanceStorage: emptyStorage,
      deviceDeploymentStorage: emptyStorage,
      deviceInstanceStorage: emptyStorage,
      deviceActivationStorage: emptyStorage,
      deviceActivationReviewStorage: emptyStorage,
      deviceProvisioningSecretStorage: emptyStorage,
      deploymentEnvelopeStorage: emptyStorage,
      deploymentGrantOverrideStorage: emptyStorage,
      deploymentResourceBindingStorage: emptyStorage,
      envelopeExpansionRequestStorage: emptyStorage,
      config,
      kick: async () => {},
      contracts: createTestContracts(),
      providers: {},
      runtimeDeps: {
        browserFlowsKV: {
          ...kv,
          get: () => AsyncResult.ok({ value: savedFlow }),
          put: (_flowId: string, value: typeof flow) => {
            savedFlow = value;
            return AsyncResult.ok(undefined);
          },
        },
        connectionsKV: kv,
        logger,
        natsTrellis: {},
        oauthStateKV: kv,
        pendingAuthKV: {
          ...kv,
          create: (_key: string, value: PendingAuth) => {
            pendingAuth = value;
            return AsyncResult.ok(undefined);
          },
        },
        sentinelCreds: { jwt: "jwt", seed: "seed" },
        sessionStorage: emptyStorage,
      },
    } as never);

    const wrongPasswordResponse = await app.request(
      "http://trellis/auth/login/local",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flowId: "flow-local",
          username: "alex",
          password: "wrong",
        }),
      },
    );

    assertEquals(wrongPasswordResponse.status, 403);
    assertEquals(await wrongPasswordResponse.json(), {
      error: "invalid_credentials",
    });
    assertEquals(pendingAuth, undefined);

    const response = await app.request("http://trellis/auth/login/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        flowId: "flow-local",
        username: "alex",
        password: "correct horse battery staple",
      }),
    });

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "authenticated",
      flowId: "flow-local",
    });
    assertEquals(savedFlow.provider, "local");
    assertEquals(typeof savedFlow.authToken, "string");
    assertEquals(pendingAuth?.userId, "usr_local");
    assertEquals(pendingAuth?.identity, {
      identityId: "idn_local",
      provider: "local",
      subject: "alex",
    });
    assertEquals(pendingAuth?.user.email, "account@example.com");
    assertEquals(identity.lastLoginAt === null, false);
  },
});

Deno.test({
  name: "auth HTTP local login rejects missing identities uniformly",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();

    for (const username of ["missing", "alex"]) {
      const response = await app.request("http://trellis/auth/login/local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flowId: "flow-local",
          username,
          password: "wrong",
        }),
      });

      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: "invalid_credentials" });
    }
  },
});

Deno.test({
  name: "auth HTTP local login increments failures and locks at threshold",
  sanitizeResources: false,
  fn: async () => {
    const fixture = await registerLocalLoginTestRoutes({
      credential: await createLocalCredentialPassword({
        identityId: "idn_local",
        password: "correct horse battery staple",
        now: new Date("2026-01-01T00:00:00.000Z"),
      }),
    });

    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await fixture.app.request(
        "http://trellis/auth/login/local",
        localLoginRequest("wrong"),
      );

      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: "invalid_credentials" });
      assertEquals(fixture.getCredential().failedLoginCount, attempt);
    }

    const locked = fixture.getCredential();
    assertEquals(typeof locked.lockedUntil, "string");
    assertEquals(fixture.getPendingAuth(), undefined);
  },
});

Deno.test({
  name: "auth HTTP local login rejects locked credentials without mutation",
  sanitizeResources: false,
  fn: async () => {
    const credential = await createLocalCredentialPassword({
      identityId: "idn_local",
      password: "correct horse battery staple",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const lockedCredential: LocalCredential = {
      ...credential,
      passwordParams: {
        ...credential.passwordParams,
        iterations: 2_000_001,
      },
      failedLoginCount: 5,
      lockedUntil: "2099-01-01T00:15:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    };
    const fixture = await registerLocalLoginTestRoutes({
      credential: lockedCredential,
    });

    const response = await fixture.app.request(
      "http://trellis/auth/login/local",
      localLoginRequest("correct horse battery staple"),
    );

    assertEquals(response.status, 403);
    assertEquals(await response.json(), { error: "invalid_credentials" });
    assertEquals(fixture.getCredential(), lockedCredential);
    assertEquals(fixture.getPendingAuth(), undefined);
  },
});

Deno.test({
  name: "auth HTTP local login resets failure state after valid password",
  sanitizeResources: false,
  fn: async () => {
    const credential = await createLocalCredentialPassword({
      identityId: "idn_local",
      password: "correct horse battery staple",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const fixture = await registerLocalLoginTestRoutes({
      credential: {
        ...credential,
        failedLoginCount: 4,
        lockedUntil: "2026-01-01T00:15:00.000Z",
      },
    });

    const response = await fixture.app.request(
      "http://trellis/auth/login/local",
      localLoginRequest("correct horse battery staple"),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "authenticated",
      flowId: "flow-local",
    });
    assertEquals(fixture.getCredential().failedLoginCount, 0);
    assertEquals(fixture.getCredential().lockedUntil, null);
    assertEquals(fixture.getPendingAuth()?.userId, "usr_local");
  },
});

Deno.test({
  name: "auth HTTP local login rejects expired browser flows",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes({
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    const response = await app.request("http://trellis/auth/login/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        flowId: "flow-local",
        username: "alex",
        password: "wrong",
      }),
    });

    assertEquals(response.status, 404);
    assertStringIncludes(await response.text(), "Expired browser flow");
  },
});

Deno.test({
  name:
    "auth HTTP local login only reveals inactive accounts after valid password",
  sanitizeResources: false,
  fn: async () => {
    const { registerHttpRoutes } = await import("./routes.ts");
    const app = new Hono();
    const flow: BrowserFlowRecord = {
      flowId: "flow-local",
      kind: "login",
      sessionKey: "session-local",
      redirectTo: "http://localhost:5173/app",
      contract: { id: "client.example@v1" },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:05:00.000Z"),
    };
    const identity = {
      identityId: "idn_local",
      userId: "usr_local",
      provider: "local",
      subject: "alex",
      displayName: "Alex Local",
      email: "alex@example.com",
      emailVerified: true,
      linkedAt: "2026-01-01T00:00:00.000Z",
      lastLoginAt: null,
    };
    const credential = await createLocalCredentialPassword({
      identityId: identity.identityId,
      password: "correct horse battery staple",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const kv = {
      get: () => AsyncResult.ok({ value: {} }),
      put: () => AsyncResult.ok(undefined),
      create: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok((async function* () {})()),
    };
    const logger = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const emptyStorage = {
      get: () => Promise.resolve(undefined),
      getLogin: () => Promise.resolve(undefined),
      getDevice: () => Promise.resolve(undefined),
      getByInstanceKey: () => Promise.resolve(undefined),
      has: () => Promise.resolve(false),
      put: () => Promise.resolve(undefined),
      consume: () => Promise.resolve(false),
      delete: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      listPage: () => Promise.resolve([]),
      listByUser: () => Promise.resolve([]),
      listEnabled: () => Promise.resolve([]),
      listByDeployment: () => Promise.resolve([]),
      listEnabledByContractId: () => Promise.resolve([]),
      getFirstEnabledForDeployments: () => Promise.resolve(undefined),
    };

    registerHttpRoutes(app, {
      contractStorage: emptyStorage,
      accountFlowStorage: emptyStorage,
      accountStorage: {
        ...emptyStorage,
        get: () =>
          Promise.resolve({
            userId: "usr_local",
            name: "Alex Account",
            email: "account@example.com",
            active: false,
            capabilities: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
      },
      userIdentityStorage: {
        ...emptyStorage,
        getByProviderSubject: () => Promise.resolve(identity),
      },
      localCredentialStorage: {
        ...emptyStorage,
        get: () => Promise.resolve(credential),
      },
      userStorage: emptyStorage,
      contractApprovalStorage: emptyStorage,
      deploymentPortalRouteStorage: emptyStorage,
      serviceDeploymentStorage: emptyStorage,
      serviceInstanceStorage: emptyStorage,
      deviceDeploymentStorage: emptyStorage,
      deviceInstanceStorage: emptyStorage,
      deviceActivationStorage: emptyStorage,
      deviceActivationReviewStorage: emptyStorage,
      deviceProvisioningSecretStorage: emptyStorage,
      deploymentEnvelopeStorage: emptyStorage,
      deploymentGrantOverrideStorage: emptyStorage,
      deploymentResourceBindingStorage: emptyStorage,
      envelopeExpansionRequestStorage: emptyStorage,
      config,
      kick: async () => {},
      contracts: createTestContracts(),
      providers: {},
      runtimeDeps: {
        browserFlowsKV: {
          ...kv,
          get: () => AsyncResult.ok({ value: flow }),
        },
        connectionsKV: kv,
        logger,
        natsTrellis: {},
        oauthStateKV: kv,
        pendingAuthKV: kv,
        sentinelCreds: { jwt: "jwt", seed: "seed" },
        sessionStorage: emptyStorage,
      },
    } as never);

    const wrongPasswordResponse = await app.request(
      "http://trellis/auth/login/local",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flowId: "flow-local",
          username: "alex",
          password: "wrong",
        }),
      },
    );
    assertEquals(wrongPasswordResponse.status, 403);
    assertEquals(await wrongPasswordResponse.json(), {
      error: "invalid_credentials",
    });

    const validPasswordResponse = await app.request(
      "http://trellis/auth/login/local",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flowId: "flow-local",
          username: "alex",
          password: "correct horse battery staple",
        }),
      },
    );
    assertEquals(validPasswordResponse.status, 403);
    assertEquals(await validPasswordResponse.json(), {
      error: "user_inactive",
    });
  },
});

Deno.test({
  name: "auth HTTP approval route rejects non-boolean approval shape",
  sanitizeResources: false,
  fn: async () => {
    const app = await registerTestRoutes();

    const response = await app.request(
      "http://trellis/auth/flow/missing/approval",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      },
    );

    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "Invalid approval request" });
  },
});

Deno.test({
  name: "device activation wait loads signed flowId directly",
  sanitizeResources: false,
  fn: async () => {
    const app = new Hono();
    const identity = await deriveDeviceIdentity(new Uint8Array(32).fill(19));
    let loadedKey: string | undefined;
    let scanned = false;
    const flow = {
      flowId: "flow-direct",
      kind: "device_activation",
      deviceActivation: {
        instanceId: "dev_1",
        deploymentId: "reader.default",
        publicIdentityKey: identity.publicIdentityKey,
        nonce: "nonce_1",
        qrMac: "mac_1",
      },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:05:00.000Z"),
    };

    registerDeviceActivationHttpRoutes(app, {
      browserFlowsKV: {
        get: (key: string) => {
          loadedKey = key;
          return AsyncResult.ok({ value: key === flow.flowId ? flow : null });
        },
        put: () => AsyncResult.ok(undefined),
        keys: () => {
          scanned = true;
          return AsyncResult.ok((async function* () {})());
        },
      },
      contracts: createTestContracts(),
      deploymentEnvelopeStorage: { get: async () => undefined },
      deploymentPortalRouteStorage: { get: async () => undefined },
      deviceActivationReviewStorage: { getByFlowId: async () => undefined },
      deviceActivationStorage: { get: async () => undefined },
      deviceDeploymentStorage: { get: async () => undefined },
      deviceInstanceStorage: {
        get: async () => ({
          instanceId: "dev_1",
          publicIdentityKey: identity.publicIdentityKey,
          deploymentId: "reader.default",
          state: "registered",
          createdAt: "2026-01-01T00:00:00.000Z",
          activatedAt: null,
          revokedAt: null,
        }),
      },
      deviceProvisioningSecretStorage: { get: async () => undefined },
      logger: { error: () => {} },
      sentinelCreds: { jwt: "jwt", seed: "seed" },
      config,
    } as never);

    const waitRequest = await signDeviceWaitRequest({
      flowId: flow.flowId,
      publicIdentityKey: identity.publicIdentityKey,
      nonce: flow.deviceActivation.nonce,
      identitySeed: identity.identitySeed,
      contractDigest: "digest-a",
      iat: Math.floor(Date.now() / 1_000),
    });
    const response = await app.request(
      "http://trellis/auth/devices/activate/wait",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(waitRequest),
      },
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { status: "pending" });
    assertEquals(loadedKey, "flow-direct");
    assertEquals(scanned, false);
  },
});

Deno.test({
  name: "auth HTTP start does not activate app contracts in catalog",
  sanitizeResources: false,
  fn: async () => {
    const { registerHttpRoutes } = await import("./routes.ts");
    const auth = await createAuth({
      sessionKeySeed: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    const contract = {
      format: "trellis.contract.v1",
      id: "client.example@v1",
      displayName: "Example Client",
      description: "Example browser client",
      kind: "app",
    };
    const redirectTo = "http://localhost:5173/app";
    const request = {
      redirectTo,
      sessionKey: auth.sessionKey,
      sig: "",
      contract,
    };
    const digest = await sha256(
      utf8(`oauth-init:${buildAuthStartSignaturePayload(request)}`),
    );
    request.sig = base64urlEncode(await auth.sign(digest));

    const contracts = createTestContracts();
    const sessions = new Map<string, Session>();
    sessions.set(auth.sessionKey, {
      type: "user",
      participantKind: "app",
      userId: "usr_123",
      identity: {
        identityId: "idn_123",
        provider: "github",
        subject: "123",
      },
      email: "user@example.com",
      name: "User",
      identityEnvelopeId: "env-client",
      contractDigest: "old-digest",
      contractId: "client.example@v1",
      contractDisplayName: "Example Client",
      contractDescription: "Example browser client",
      app: { contractId: "client.example@v1", origin: "http://localhost:5173" },
      delegatedCapabilities: [],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastAuth: new Date("2026-01-01T00:00:00.000Z"),
    });
    const contractRecords = new Map<string, unknown>();
    const app = new Hono();
    const kv = {
      get: () => AsyncResult.ok({ value: {} }),
      put: () => AsyncResult.ok(undefined),
      create: () => AsyncResult.ok(undefined),
      delete: () => AsyncResult.ok(undefined),
      keys: () => AsyncResult.ok((async function* () {})()),
    };
    const logger = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const emptyStorage = {
      get: () => Promise.resolve(undefined),
      getLogin: () => Promise.resolve(undefined),
      getDevice: () => Promise.resolve(undefined),
      getByInstanceKey: () => Promise.resolve(undefined),
      has: () => Promise.resolve(false),
      put: () => Promise.resolve(undefined),
      consume: () => Promise.resolve(false),
      delete: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      listPage: () => Promise.resolve([]),
      listByUser: () => Promise.resolve([]),
      listEnabled: () => Promise.resolve([]),
      listByDeployment: () => Promise.resolve([]),
      listEnabledByContractId: () => Promise.resolve([]),
      getFirstEnabledForDeployments: () => Promise.resolve(undefined),
    };

    registerHttpRoutes(app, {
      contractStorage: {
        ...emptyStorage,
        get: (digestValue: string) =>
          Promise.resolve(contractRecords.get(digestValue)),
        put: (record: { digest: string }) => {
          contractRecords.set(record.digest, record);
          return Promise.resolve(undefined);
        },
      },
      accountFlowStorage: emptyStorage,
      accountStorage: emptyStorage,
      userIdentityStorage: emptyStorage,
      localCredentialStorage: emptyStorage,
      userStorage: {
        ...emptyStorage,
        get: () =>
          Promise.resolve({
            origin: "github",
            id: "123",
            name: "User",
            email: "user@example.com",
            active: true,
            capabilities: [],
          }),
      },
      contractApprovalStorage: emptyStorage,
      deploymentPortalRouteStorage: emptyStorage,
      serviceDeploymentStorage: emptyStorage,
      serviceInstanceStorage: emptyStorage,
      deviceDeploymentStorage: emptyStorage,
      deviceInstanceStorage: emptyStorage,
      deviceActivationStorage: emptyStorage,
      deviceActivationReviewStorage: emptyStorage,
      deviceProvisioningSecretStorage: emptyStorage,
      deploymentEnvelopeStorage: emptyStorage,
      deploymentGrantOverrideStorage: emptyStorage,
      deploymentResourceBindingStorage: emptyStorage,
      envelopeExpansionRequestStorage: emptyStorage,
      config,
      kick: async () => {},
      loadEffectiveGrantPolicies: () => Promise.resolve([]),
      contracts,
      providers: {},
      runtimeDeps: {
        browserFlowsKV: kv,
        connectionsKV: kv,
        logger,
        natsTrellis: {},
        oauthStateKV: kv,
        pendingAuthKV: kv,
        sentinelCreds: { jwt: "jwt", seed: "seed" },
        sessionStorage: {
          async getOneBySessionKey(sessionKey: string) {
            return sessions.get(sessionKey);
          },
          async put(sessionKey: string, session: Session) {
            sessions.set(sessionKey, session);
          },
          async deleteBySessionKey(sessionKey: string) {
            sessions.delete(sessionKey);
          },
        },
        trellis: { publish: () => AsyncResult.ok(undefined) },
      },
    } as never);

    const response = await app.request("http://trellis/auth/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    assertEquals(response.status, 200);
    assertEquals((await response.json()).status, "flow_started");
    assertEquals((await contracts.getActiveCatalog()).contracts, []);
    assertEquals(
      (await contracts.getKnownContractsById("client.example@v1")).length,
      0,
    );
  },
});
