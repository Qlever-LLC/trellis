import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { AsyncResult } from "@qlever-llc/result";
import {
  base64urlEncode,
  buildLogoutSignaturePayload,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth";

import type { Config } from "../../config.ts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import { Provider } from "../providers/index.ts";
import { connectionKey } from "../session/connections.ts";
import type { Session, UserSession } from "../schemas.ts";
import { registerHttpRoutes } from "./routes.ts";

const config: Config = {
  logLevel: "info",
  port: 3000,
  instanceName: "Trellis",
  web: {
    origins: ["http://localhost:5173"],
    allowInsecureOrigins: ["http://localhost:5173"],
  },
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

type LogoutRequest = {
  sessionKey: string;
  iat: number;
  sig: string;
  providerLogout?: boolean;
  federatedProviderLogout?: boolean;
  returnTo?: string;
  responseMode?: "json" | "redirect";
  [key: string]: unknown;
};

type TestRoutes = {
  app: Hono;
  sessions: Map<string, Session>;
  deletedConnections: string[];
  kicked: Array<{ serverId: string; clientId: number }>;
};

class LogoutProvider extends Provider {
  override name = "github";
  override displayName = "GitHub";
  override issuer = "https://github.example";
  override authorizationEndpoint = "https://github.example/authorize";
  override tokenEndpoint = "https://github.example/token";
  override scope = "openid profile email";
  override supportsDiscovery = true;
  override supportsPKCE = true;

  constructor() {
    super("github-client", "github-secret", "http://localhost:3000/callback");
  }

  buildLogoutUrl(args: { returnTo?: string; federated?: boolean } = {}) {
    const url = new URL("https://github.example/logout");
    if (args.returnTo) url.searchParams.set("returnTo", args.returnTo);
    if (args.federated) url.searchParams.set("federated", "true");
    return Promise.resolve(url.toString());
  }
}

function testUserSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    type: "user",
    userId: "usr_oauth",
    identity: {
      identityId: "idn_github_user",
      provider: "github",
      subject: "user",
    },
    email: "user@example.com",
    name: "OAuth User",
    participantKind: "app",
    contractDigest: "digest",
    contractId: "client.example@v1",
    contractDisplayName: "Example Client",
    contractDescription: "Example browser client",
    app: { contractId: "client.example@v1", origin: "http://localhost:5173" },
    delegatedCapabilities: [],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    createdAt: new Date("2026-05-09T00:00:00.000Z"),
    lastAuth: new Date("2026-05-09T00:00:00.000Z"),
    ...overrides,
  };
}

async function signedLogoutRequest(
  auth: Awaited<ReturnType<typeof createAuth>>,
  fields: Partial<LogoutRequest> = {},
): Promise<LogoutRequest> {
  const request: LogoutRequest = {
    sessionKey: auth.sessionKey,
    iat: Math.floor(Date.now() / 1_000),
    sig: "",
    ...fields,
  };
  const digest = await sha256(
    utf8(`logout-session:${
      buildLogoutSignaturePayload({
        iat: request.iat,
        ...(request.providerLogout !== undefined
          ? { providerLogout: request.providerLogout }
          : {}),
        ...(request.federatedProviderLogout !== undefined
          ? { federatedProviderLogout: request.federatedProviderLogout }
          : {}),
        ...(request.returnTo !== undefined
          ? { returnTo: request.returnTo }
          : {}),
        ...(request.responseMode !== undefined
          ? { responseMode: request.responseMode }
          : {}),
      })
    }`),
  );
  request.sig = base64urlEncode(await auth.sign(digest));
  return request;
}

function createTestAuth(seedByte: number) {
  return createAuth({
    sessionKeySeed: base64urlEncode(new Uint8Array(32).fill(seedByte)),
  });
}

function registerLogoutTestRoutes(options: {
  auth: Awaited<ReturnType<typeof createAuth>>;
  session?: Session;
  provider?: Provider;
}): TestRoutes {
  const app = new Hono();
  const sessions = new Map<string, Session>();
  if (options.session) sessions.set(options.auth.sessionKey, options.session);

  const connectedKey = connectionKey(
    options.auth.sessionKey,
    "usr_oauth",
    "UAPP",
  );
  const otherScopeConnectedKey = connectionKey(
    options.auth.sessionKey,
    "device_abc",
    "DAPP",
  );
  const connections = new Map<string, { serverId: string; clientId: number }>([[
    connectedKey,
    { serverId: "srv-a", clientId: 7 },
  ], [
    otherScopeConnectedKey,
    { serverId: "srv-b", clientId: 8 },
  ]]);
  const deletedConnections: string[] = [];
  const kicked: Array<{ serverId: string; clientId: number }> = [];

  const kv = {
    get: (key: string) => AsyncResult.ok({ value: connections.get(key) }),
    put: () => AsyncResult.ok(undefined),
    create: () => AsyncResult.ok(undefined),
    delete: (key: string) => {
      deletedConnections.push(key);
      connections.delete(key);
      return AsyncResult.ok(undefined);
    },
    keys: (filter: string) => {
      const prefix = filter.endsWith(">") ? filter.slice(0, -1) : filter;
      return AsyncResult.ok((async function* () {
        for (const key of connections.keys()) {
          if (key.startsWith(prefix)) yield key;
        }
      })());
    },
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
    getOneBySessionKey: (sessionKey: string) =>
      Promise.resolve(sessions.get(sessionKey)),
    has: () => Promise.resolve(false),
    put: () => Promise.resolve(undefined),
    consume: () => Promise.resolve(false),
    delete: () => Promise.resolve(undefined),
    deleteBySessionKey: (sessionKey: string) => {
      sessions.delete(sessionKey);
      return Promise.resolve(undefined);
    },
    list: () => Promise.resolve([]),
    listPage: () => Promise.resolve([]),
    listByUser: () => Promise.resolve([]),
    listByDeployment: () => Promise.resolve([]),
    listEnabled: () => Promise.resolve([]),
    listEnabledByContractId: () => Promise.resolve([]),
    getFirstEnabledForDeployments: () => Promise.resolve(undefined),
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
    deploymentAuthorityStorage: storage,
    deploymentAuthorityGrantOverrideStorage: storage,
    deploymentResourceBindingStorage: storage,
    config,
    kick: (serverId: string, clientId: number) => {
      kicked.push({ serverId, clientId });
      return Promise.resolve();
    },
    loadEffectiveGrantPolicies: () => Promise.resolve([]),
    contracts: createTestContracts(),
    providers: options.provider
      ? { [options.provider.name]: options.provider }
      : {},
    runtimeDeps: {
      browserFlowsKV: kv,
      connectionsKV: kv,
      logger,
      natsTrellis: {},
      oauthStateKV: kv,
      pendingAuthKV: kv,
      sentinelCreds: { jwt: "jwt", seed: "seed" },
      sessionStorage: storage,
      trellis: { publish: () => AsyncResult.ok(undefined) },
    },
  } as never);

  return { app, sessions, deletedConnections, kicked };
}

function postLogout(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

Deno.test("HTTP session logout deletes and kicks all session connections", async () => {
  const auth = await createTestAuth(1);
  const routes = registerLogoutTestRoutes({
    auth,
    session: testUserSession(),
    provider: new LogoutProvider(),
  });
  const returnTo = "http://localhost:5173/signed-out";
  const request = await signedLogoutRequest(auth, {
    providerLogout: true,
    federatedProviderLogout: true,
    returnTo,
  });

  const response = await routes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout(request),
  );

  const providerUrl =
    "https://github.example/logout?returnTo=http%3A%2F%2Flocalhost%3A5173%2Fsigned-out&federated=true";
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    redirectTo: providerUrl,
  });
  assertEquals(routes.sessions.has(auth.sessionKey), false);
  assertEquals(routes.kicked, [
    { serverId: "srv-a", clientId: 7 },
    { serverId: "srv-b", clientId: 8 },
  ]);
  assertEquals(routes.deletedConnections, [
    connectionKey(auth.sessionKey, "usr_oauth", "UAPP"),
    connectionKey(auth.sessionKey, "device_abc", "DAPP"),
  ]);
});

Deno.test("HTTP session logout accepts unknown additive fields", async () => {
  const auth = await createTestAuth(2);
  const routes = registerLogoutTestRoutes({
    auth,
    session: testUserSession(),
  });
  const request = await signedLogoutRequest(auth, {
    returnTo: "http://localhost:5173/signed-out",
    futureField: "preserved-by-schema-evolution",
  });

  const response = await routes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout(request),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    redirectTo: "http://localhost:5173/signed-out",
  });
});

Deno.test("HTTP session logout rejects bad signatures", async () => {
  const auth = await createTestAuth(3);
  const routes = registerLogoutTestRoutes({
    auth,
    session: testUserSession(),
  });
  const request = await signedLogoutRequest(auth);
  request.sig = "A".repeat(86);

  const response = await routes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout(request),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "invalid_logout_signature" });
  assertEquals(routes.sessions.has(auth.sessionKey), true);
});

Deno.test("HTTP session logout rejects stale and future iat values", async () => {
  const staleAuth = await createTestAuth(4);
  const staleRoutes = registerLogoutTestRoutes({
    auth: staleAuth,
    session: testUserSession(),
  });
  const staleRequest = await signedLogoutRequest(staleAuth, {
    iat: Math.floor(Date.now() / 1_000) - 60,
  });
  const staleResponse = await staleRoutes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout(staleRequest),
  );

  const futureAuth = await createTestAuth(5);
  const futureRoutes = registerLogoutTestRoutes({
    auth: futureAuth,
    session: testUserSession(),
  });
  const futureRequest = await signedLogoutRequest(futureAuth, {
    iat: Math.floor(Date.now() / 1_000) + 60,
  });
  const futureResponse = await futureRoutes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout(futureRequest),
  );

  assertEquals(staleResponse.status, 400);
  assertEquals(await staleResponse.json(), { error: "invalid_logout_request" });
  assertEquals(futureResponse.status, 400);
  assertEquals(await futureResponse.json(), {
    error: "invalid_logout_request",
  });
});

Deno.test("HTTP session logout rejects missing sessions", async () => {
  const auth = await createTestAuth(6);
  const routes = registerLogoutTestRoutes({ auth });
  const request = await signedLogoutRequest(auth);

  const response = await routes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout(request),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "logout_session_not_found" });
});

Deno.test("HTTP session logout accepts safe same-origin returnTo", async () => {
  const auth = await createTestAuth(7);
  const routes = registerLogoutTestRoutes({
    auth,
    session: testUserSession(),
  });
  const returnTo = "http://localhost:5173/signed-out?next=%2F";
  const request = await signedLogoutRequest(auth, { returnTo });

  const response = await routes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout(request),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { success: true, redirectTo: returnTo });
});

Deno.test("HTTP session logout rejects cross-origin returnTo", async () => {
  const auth = await createTestAuth(8);
  const routes = registerLogoutTestRoutes({
    auth,
    session: testUserSession(),
  });
  const request = await signedLogoutRequest(auth, {
    returnTo: "https://evil.example/signed-out",
  });

  const response = await routes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout(request),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "invalid_return_to" });
  assertEquals(routes.sessions.has(auth.sessionKey), true);
});

Deno.test("HTTP session logout redirect mode returns 303", async () => {
  const auth = await createTestAuth(9);
  const routes = registerLogoutTestRoutes({
    auth,
    session: testUserSession(),
  });
  const returnTo = "http://localhost:5173/signed-out";
  const request = await signedLogoutRequest(auth, {
    returnTo,
    responseMode: "redirect",
  });

  const response = await routes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout(request),
  );

  assertEquals(response.status, 303);
  assertEquals(response.headers.get("location"), returnTo);
});

Deno.test("HTTP session logout returns modeled malformed input errors", async () => {
  const auth = await createTestAuth(10);
  const routes = registerLogoutTestRoutes({
    auth,
    session: testUserSession(),
  });

  const invalidJson = await routes.app.request(
    "http://trellis/auth/sessions/logout",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    },
  );
  const invalidRequest = await routes.app.request(
    "http://trellis/auth/sessions/logout",
    postLogout({ sessionKey: auth.sessionKey }),
  );

  assertEquals(invalidJson.status, 400);
  assertEquals(await invalidJson.json(), { error: "invalid_logout_request" });
  assertEquals(invalidRequest.status, 400);
  assertEquals(await invalidRequest.json(), {
    error: "invalid_logout_request",
  });
});
