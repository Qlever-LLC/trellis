import { assert, assertEquals } from "@std/assert";
import { AsyncResult, isErr, UnexpectedError } from "@qlever-llc/result";
import {
  base64urlEncode,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth";
import {
  createAuthConnectionsListHandler,
  createAuthHealthHandler,
  createAuthRequestsValidateHandler,
  createAuthSessionsListHandler,
  createAuthSessionsLogoutHandler,
  createAuthSessionsMeHandler,
} from "./rpc.ts";
import { connectionKey } from "./connections.ts";
import { createAuthSessionsRevokeHandler } from "./revoke.ts";
import type { IdentityGrantRecord, Session, UserSession } from "../schemas.ts";
import type { UserProjectionEntry } from "../schemas.ts";
import type { Config } from "../../config.ts";
import { Provider } from "../providers/index.ts";
import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../../storage/db.ts";
import type { TrellisStorage } from "../../storage/db.ts";
import {
  SqlIdentityGrantRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";

const TEST_IAT = 1_700_000_000;

function matchFilter(filter: string, key: string): boolean {
  const filterParts = filter.split(".");
  const keyParts = key.split(".");

  if (filterParts.length === 1 && filterParts[0] === ">") return true;

  for (let i = 0; i < filterParts.length; i += 1) {
    const part = filterParts[i];
    if (part === ">") return true;
    if (keyParts[i] === undefined) return false;
    if (part !== "*" && part !== keyParts[i]) return false;
  }

  return keyParts.length === filterParts.length;
}

class InMemoryKV<V> {
  #store = new Map<string, V>();

  seed(key: string, value: V): void {
    this.#store.set(key, value);
  }

  keys(filter: string): AsyncResult<AsyncIterable<string>, UnexpectedError> {
    async function* iter(store: Map<string, V>) {
      for (const key of store.keys()) {
        if (matchFilter(filter, key)) yield key;
      }
    }

    return AsyncResult.ok(iter(this.#store));
  }

  get(key: string): AsyncResult<{ value: V }, UnexpectedError> {
    const value = this.#store.get(key);
    if (value === undefined) {
      return AsyncResult.err(new UnexpectedError({ context: { key } }));
    }
    return AsyncResult.ok({ value });
  }

  put(key: string, value: V): AsyncResult<void, UnexpectedError> {
    this.#store.set(key, value);
    return AsyncResult.ok(undefined);
  }

  delete(key: string): AsyncResult<void, UnexpectedError> {
    this.#store.delete(key);
    return AsyncResult.ok(undefined);
  }
}

type CapturedLog = {
  level: "trace" | "warn";
  fields: Record<string, unknown>;
  message: string;
};

function createTestLogger(logs: CapturedLog[] = []) {
  return {
    trace: (fields: Record<string, unknown>, message: string) => {
      logs.push({ level: "trace", fields, message });
    },
    warn: (fields: Record<string, unknown>, message: string) => {
      logs.push({ level: "warn", fields, message });
    },
  };
}

Deno.test("Auth.Health returns the auth control-plane health response", async () => {
  const handler = createAuthHealthHandler({
    logger: createTestLogger(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  const value = (await handler({ context: { sessionKey: "sk_health" } }))
    .take();

  assertEquals(value, {
    status: "healthy",
    service: "trellis",
    timestamp: "2026-01-01T00:00:00.000Z",
    checks: [
      {
        name: "auth-rpc",
        status: "ok",
        summary: "Auth RPC handlers are mounted.",
        latencyMs: 0,
      },
    ],
  });
});

function sessionStorageFromKV(kv: InMemoryKV<Session>) {
  async function entries(filter: string) {
    const iter = await kv.keys(filter).take();
    const result = [] as Array<{
      sessionKey: string;
      principalId: string;
      session: Session;
    }>;
    if (isErr(iter)) return result;
    for await (const key of iter) {
      const entry = await kv.get(key).take();
      if (isErr(entry)) continue;
      const sessionKey = key;
      const session = entry.value;
      const principalId = session.type === "device"
        ? session.instanceId
        : session.type === "user"
        ? session.userId
        : session.trellisId;
      result.push({ sessionKey, principalId, session: entry.value });
    }
    return result;
  }
  return {
    getOneBySessionKey: async (sessionKey: string) => {
      const entry = await kv.get(sessionKey).take();
      return isErr(entry) ? undefined : entry.value;
    },
    listEntries: () => entries(">"),
    listEntriesByUser: async (userId: string) =>
      (await entries(">")).filter((entry) => entry.principalId === userId),
    deleteBySessionKey: async (sessionKey: string) => {
      await kv.delete(sessionKey).take();
    },
  };
}

function deviceActivationStorageFromKV<V extends { instanceId: string }>(
  kv: InMemoryKV<V>,
) {
  return {
    get: async (instanceId: string): Promise<V | undefined> => {
      const entry = await kv.get(instanceId).take();
      return isErr(entry) ? undefined : entry.value;
    },
    put: async (value: V): Promise<void> => {
      await kv.put(value.instanceId, value).take();
    },
  };
}

function getStorageFromKV<V>(kv: InMemoryKV<V>) {
  return {
    get: async (key: string): Promise<V | undefined> => {
      const entry = await kv.get(key).take();
      return isErr(entry) ? undefined : entry.value;
    },
  };
}

class InMemoryUserStorage {
  #store = new Map<string, UserProjectionEntry>();

  seed(key: string, value: UserProjectionEntry): void {
    this.#store.set(key, value);
  }

  async get(key: string): Promise<UserProjectionEntry | undefined> {
    return this.#store.get(key);
  }
}

class InMemoryApprovalStorage {
  #store = new Map<string, IdentityGrantRecord>();

  seed(record: IdentityGrantRecord): void {
    this.#store.set(record.identityGrantId, record);
  }

  async get(
    identityGrantId: string,
  ): Promise<IdentityGrantRecord | undefined> {
    return this.#store.get(identityGrantId);
  }

  async delete(identityGrantId: string): Promise<void> {
    this.#store.delete(identityGrantId);
  }
}

const emptyApprovalStorage = {
  get: (_identityGrantId: string) => Promise.resolve(undefined),
  delete: (_identityGrantId: string) => Promise.resolve(),
};

async function withSqlAuthRepositories(
  test: (repos: {
    users: SqlUserProjectionRepository;
    approvals: SqlIdentityGrantRepository;
  }, storage: TrellisStorage) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-session-rpc-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await initializeTrellisStorageSchema(storage);
    await test({
      users: new SqlUserProjectionRepository(storage.db),
      approvals: new SqlIdentityGrantRepository(storage.db),
    }, storage);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function baseSessionFields() {
  return {
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    lastAuth: new Date("2026-04-10T00:00:00.000Z"),
  };
}

const TEST_USER_ID = "usr_github_123";
const TEST_IDENTITY = {
  identityId: "idn_github_123",
  provider: "github",
  subject: "123",
};
const TEST_WEB_CONFIG: Pick<Config, "web"> = {
  web: {
    origins: ["https://app.example.com"],
    allowInsecureOrigins: [],
  },
};
type TestDeviceActivationActor = {
  participantKind: "app" | "agent";
  userId: string;
  identity: typeof TEST_IDENTITY;
};
const TEST_ACTIVATION_ACTOR: TestDeviceActivationActor = {
  participantKind: "app",
  userId: TEST_USER_ID,
  identity: TEST_IDENTITY,
};

function testUserProjection(
  overrides: Partial<UserProjectionEntry> = {},
): UserProjectionEntry {
  return {
    origin: "account",
    id: TEST_USER_ID,
    name: "Ada",
    email: "ada@example.com",
    active: true,
    capabilities: ["users.read"],
    capabilityGroups: [],
    ...overrides,
  };
}

function testUserSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    type: "user",
    userId: TEST_USER_ID,
    identity: TEST_IDENTITY,
    email: "ada@example.com",
    name: "Ada",
    participantKind: "app",
    contractDigest: "digest-a",
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    contractDescription: "Admin app",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    ...baseSessionFields(),
    ...overrides,
  };
}

class TestLogoutProvider extends Provider {
  override name = "auth0";
  override displayName = "Auth0";
  override issuer = "https://tenant.example.auth0.com";
  override authorizationEndpoint = "https://tenant.example.auth0.com/authorize";
  override tokenEndpoint = "https://tenant.example.auth0.com/oauth/token";
  override scope = "openid profile email";
  override supportsDiscovery = true;
  override supportsPKCE = true;
  calls: Array<{ returnTo?: string; federated?: boolean }> = [];

  constructor(private readonly logoutUrl: string | undefined) {
    super(
      "client-id",
      "client-secret",
      "https://trellis.example/auth/callback",
    );
  }

  buildLogoutUrl(args: {
    returnTo?: string;
    federated?: boolean;
  } = {}): Promise<string | undefined> {
    this.calls.push(args);
    return Promise.resolve(this.logoutUrl);
  }
}

function testUserContext(sessionKey: string, identity = TEST_IDENTITY) {
  return {
    sessionKey,
    caller: {
      type: "user",
      participantKind: "app" as const,
      userId: TEST_USER_ID,
      identity,
      email: "ada@example.com",
      name: "Ada",
      active: true,
      capabilities: ["admin"],
    },
  };
}

function createTestNatsSystem(
  requests: Array<{ subject: string; payload?: string }>,
) {
  return {
    request: (subject: string, payload?: string): Promise<unknown> => {
      requests.push({ subject, payload });
      return Promise.resolve(undefined);
    },
  };
}

Deno.test("Auth.Sessions.Logout with empty input deletes session and connections without provider URL", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<{
    serverId: string;
    clientId: number;
    connectedAt: Date;
  }>();
  const natsRequests: Array<{ subject: string; payload?: string }> = [];
  const sessionKey = "sk_logout";
  sessionKV.seed(sessionKey, testUserSession());
  connectionsKV.seed(connectionKey(sessionKey, TEST_USER_ID, "user_nkey"), {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-10T00:00:00.000Z"),
  });

  const sessionStorage = sessionStorageFromKV(sessionKV);
  const handler = createAuthSessionsLogoutHandler({
    logger: createTestLogger(),
    sessionStorage,
    connectionsKV,
    natsSystem: createTestNatsSystem(natsRequests),
    config: TEST_WEB_CONFIG,
    providers: {},
  });

  const value = (await handler({
    input: {},
    context: testUserContext(sessionKey),
  })).take();
  if (isErr(value)) throw value.error;

  assertEquals(value, { success: true });
  assertEquals(await sessionStorage.getOneBySessionKey(sessionKey), undefined);
  assert(isErr(
    await connectionsKV.get(
      connectionKey(sessionKey, TEST_USER_ID, "user_nkey"),
    ).take(),
  ));
  assertEquals(natsRequests, [{
    subject: "$SYS.REQ.SERVER.n1.KICK",
    payload: JSON.stringify({ cid: 7 }),
  }]);
});

Deno.test("Auth.Sessions.Logout returns provider logout URL for matching browser provider", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<{
    serverId: string;
    clientId: number;
    connectedAt: Date;
  }>();
  const natsRequests: Array<{ subject: string; payload?: string }> = [];
  const sessionKey = "sk_auth0_logout";
  const auth0Identity = {
    identityId: "idn_auth0_123",
    provider: "auth0",
    subject: "auth0|123",
  };
  sessionKV.seed(
    sessionKey,
    testUserSession({
      identity: auth0Identity,
      app: {
        contractId: "trellis.console@v1",
        origin: "https://app.example.com",
      },
    }),
  );
  const provider = new TestLogoutProvider(
    "https://tenant.example.auth0.com/v2/logout?client_id=client-id",
  );

  const sessionStorage = sessionStorageFromKV(sessionKV);
  const handler = createAuthSessionsLogoutHandler({
    logger: createTestLogger(),
    sessionStorage,
    connectionsKV,
    natsSystem: createTestNatsSystem(natsRequests),
    config: TEST_WEB_CONFIG,
    providers: { auth0: provider },
  });

  const value = (await handler({
    input: {
      browser: {
        includeProviderLogout: true,
        returnTo: "https://app.example.com/signed-out",
        federatedProviderLogout: true,
      },
    },
    context: testUserContext(sessionKey, auth0Identity),
  })).take();
  if (isErr(value)) throw value.error;

  assertEquals(value, {
    success: true,
    providerLogoutUrl:
      "https://tenant.example.auth0.com/v2/logout?client_id=client-id",
  });
  assertEquals(provider.calls, [{
    returnTo: "https://app.example.com/signed-out",
    federated: true,
  }]);
  assertEquals(await sessionStorage.getOneBySessionKey(sessionKey), undefined);
});

Deno.test("Auth.Sessions.Logout rejects invalid returnTo without deleting Trellis session", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<{
    serverId: string;
    clientId: number;
    connectedAt: Date;
  }>();
  const natsRequests: Array<{ subject: string; payload?: string }> = [];
  const sessionKey = "sk_invalid_return_to";
  const auth0Identity = {
    identityId: "idn_auth0_123",
    provider: "auth0",
    subject: "auth0|123",
  };
  const session = testUserSession({
    identity: auth0Identity,
    app: {
      contractId: "trellis.console@v1",
      origin: "https://app.example.com",
    },
  });
  sessionKV.seed(sessionKey, session);
  const provider = new TestLogoutProvider(
    "https://tenant.example.auth0.com/v2/logout",
  );

  const sessionStorage = sessionStorageFromKV(sessionKV);
  const result = await createAuthSessionsLogoutHandler({
    logger: createTestLogger(),
    sessionStorage,
    connectionsKV,
    natsSystem: createTestNatsSystem(natsRequests),
    config: TEST_WEB_CONFIG,
    providers: { auth0: provider },
  })({
    input: {
      browser: {
        includeProviderLogout: true,
        returnTo: "https://evil.example.com/signed-out",
      },
    },
    context: testUserContext(sessionKey, auth0Identity),
  });
  const value = result.take();

  assert(isErr(value));
  assertEquals(value.error.reason, "invalid_request");
  assertEquals(value.error.toSerializable().context, {
    reason: "invalid_return_to",
  });
  assertEquals(await sessionStorage.getOneBySessionKey(sessionKey), session);
  assertEquals(provider.calls, []);
  assertEquals(natsRequests, []);
});

Deno.test("Auth.Sessions.Logout ignores mismatched provider logout while deleting Trellis session", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<{
    serverId: string;
    clientId: number;
    connectedAt: Date;
  }>();
  const natsRequests: Array<{ subject: string; payload?: string }> = [];
  const sessionKey = "sk_mismatched_provider";
  const auth0Identity = {
    identityId: "idn_auth0_123",
    provider: "auth0",
    subject: "auth0|123",
  };
  sessionKV.seed(sessionKey, testUserSession({ identity: auth0Identity }));
  const provider = new TestLogoutProvider("https://logout.example.com");
  provider.name = "other";

  const sessionStorage = sessionStorageFromKV(sessionKV);
  const handler = createAuthSessionsLogoutHandler({
    logger: createTestLogger(),
    sessionStorage,
    connectionsKV,
    natsSystem: createTestNatsSystem(natsRequests),
    config: TEST_WEB_CONFIG,
    providers: { auth0: provider },
  });

  const value = (await handler({
    input: { browser: { includeProviderLogout: true } },
    context: testUserContext(sessionKey, auth0Identity),
  })).take();
  if (isErr(value)) throw value.error;

  assertEquals(value, { success: true });
  assertEquals(provider.calls, []);
  assertEquals(await sessionStorage.getOneBySessionKey(sessionKey), undefined);
});

Deno.test("Auth.Sessions.Me returns user, device, and service envelopes", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const userStorage = new InMemoryUserStorage();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    activatedBy?: TestDeviceActivationActor;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const deviceDeploymentsKV = new InMemoryKV<{
    deploymentId: string;
    disabled: boolean;
  }>();
  const deviceInstancesKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "registered" | "activated" | "revoked" | "disabled";
  }>();

  const handler = createAuthSessionsMeHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    userStorage,
    deviceActivationStorage: deviceActivationStorageFromKV(deviceActivationsKV),
    deviceInstanceStorage: getStorageFromKV(deviceInstancesKV),
    deviceDeploymentStorage: getStorageFromKV(deviceDeploymentsKV),
    loadServiceInstance: async (sessionKey: string) =>
      sessionKey === "sk_service"
        ? {
          deploymentId: "billing.default",
          disabled: false,
          capabilities: ["service"],
        }
        : null,
    loadServiceDeployment: async (deploymentId: string) =>
      deploymentId === "billing.default" ? { disabled: false } : undefined,
  });

  const userTrellisId = TEST_USER_ID;
  userStorage.seed(userTrellisId, testUserProjection());

  const userSessionKey = "sk_user";
  sessionKV.seed(userSessionKey, {
    type: "user",
    userId: userTrellisId,
    identity: TEST_IDENTITY,
    email: "ada@example.com",
    name: "Ada",
    participantKind: "app",
    contractDigest: "digest-a",
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    contractDescription: "Admin app",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    ...baseSessionFields(),
  });

  const userResult = await handler({
    context: { sessionKey: userSessionKey, caller: { type: "unknown" } },
  });
  const userValue = userResult.take();
  if (isErr(userValue)) throw userValue.error;
  assertEquals(userValue, {
    participantKind: "app",
    user: {
      userId: TEST_USER_ID,
      active: true,
      name: "Ada",
      email: "ada@example.com",
      identity: TEST_IDENTITY,
      capabilities: ["users.read"],
      lastLogin: "2026-04-10T00:00:00.000Z",
    },
    device: null,
    service: null,
  });

  const deviceSessionKey = "sk_device";
  sessionKV.seed(deviceSessionKey, {
    type: "device",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    contractId: "trellis.reader@v1",
    contractDigest: "digest-w",
    delegatedCapabilities: ["device.sync"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
    activatedAt: null,
    revokedAt: null,
  });
  deviceActivationsKV.seed("dev_1", {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    activatedBy: TEST_ACTIVATION_ACTOR,
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  deviceInstancesKV.seed("dev_1", {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    state: "activated",
  });
  deviceDeploymentsKV.seed("reader.default", {
    deploymentId: "reader.default",
    disabled: false,
  });

  const deviceResult = await handler({
    context: { sessionKey: deviceSessionKey, caller: { type: "unknown" } },
  });
  const deviceValue = deviceResult.take();
  if (isErr(deviceValue)) throw deviceValue.error;
  assertEquals(deviceValue, {
    participantKind: "device",
    user: {
      userId: TEST_USER_ID,
      active: true,
      name: "Ada",
      email: "ada@example.com",
      identity: TEST_IDENTITY,
      capabilities: ["users.read"],
    },
    device: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "reader",
      runtimePublicKey: "A".repeat(43),
      deploymentId: "reader.default",
      active: true,
      capabilities: ["device.sync"],
    },
    service: null,
  });

  const serviceSessionKey = "sk_service";
  sessionKV.seed(serviceSessionKey, {
    type: "service",
    trellisId: "svc_1",
    origin: "service",
    id: "billing",
    email: "billing@trellis.internal",
    name: "Billing",
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: serviceSessionKey,
    contractId: null,
    contractDigest: null,
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
  });
  const serviceResult = await handler({
    context: { sessionKey: serviceSessionKey, caller: { type: "unknown" } },
  });
  const serviceValue = serviceResult.take();
  if (isErr(serviceValue)) throw serviceValue.error;
  assertEquals(serviceValue, {
    participantKind: "service",
    user: null,
    device: null,
    service: {
      type: "service",
      id: "billing",
      name: "Billing",
      active: true,
      capabilities: ["service"],
    },
  });
});

Deno.test("session RPC handlers log through the injected logger", async () => {
  const logs: CapturedLog[] = [];
  const handler = createAuthSessionsListHandler({
    logger: createTestLogger(logs),
    sessionStorage: sessionStorageFromKV(new InMemoryKV<Session>()),
  });

  const result = await handler({ input: { user: TEST_USER_ID } });
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(logs, [{
    level: "trace",
    fields: { rpc: "Auth.Sessions.List", user: TEST_USER_ID },
    message: "RPC request",
  }]);
});

Deno.test("Auth.Sessions.Me validates services with the durable instance deployment", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const handler = createAuthSessionsMeHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    userStorage: new InMemoryUserStorage(),
    deviceActivationStorage: deviceActivationStorageFromKV(
      new InMemoryKV<{
        instanceId: string;
        publicIdentityKey: string;
        deploymentId: string;
        activatedBy?: TestDeviceActivationActor;
        state: "activated" | "revoked";
        activatedAt: string;
        revokedAt: string | null;
      }>(),
    ),
    deviceDeploymentStorage: getStorageFromKV(
      new InMemoryKV<{
        deploymentId: string;
        disabled: boolean;
      }>(),
    ),
    loadServiceInstance: async (sessionKey: string) =>
      sessionKey === "sk_service"
        ? {
          deploymentId: "billing.current",
          disabled: false,
          capabilities: ["service"],
        }
        : null,
    loadServiceDeployment: async (deploymentId: string) =>
      deploymentId === "billing.current" ? { disabled: false } : undefined,
  });

  sessionKV.seed("sk_service", {
    type: "service",
    trellisId: "svc_1",
    origin: "service",
    id: "billing",
    email: "billing@trellis.internal",
    name: "Billing",
    instanceId: "svc_1",
    deploymentId: "billing.stale",
    instanceKey: "sk_service",
    contractId: null,
    contractDigest: null,
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
  });

  const result = await handler({
    context: { sessionKey: "sk_service", caller: { type: "unknown" } },
  });
  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(value.service?.active, true);
});

Deno.test("Auth.Sessions.Me rejects deleted user sessions despite caller context", async () => {
  const handler = createAuthSessionsMeHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(new InMemoryKV<Session>()),
    userStorage: new InMemoryUserStorage(),
    deviceActivationStorage: deviceActivationStorageFromKV(
      new InMemoryKV<{
        instanceId: string;
        publicIdentityKey: string;
        deploymentId: string;
        activatedBy?: TestDeviceActivationActor;
        state: "activated" | "revoked";
        activatedAt: string;
        revokedAt: string | null;
      }>(),
    ),
    deviceDeploymentStorage: {
      get: async () => undefined,
    },
  });

  const result = await handler({
    context: {
      sessionKey: "missing",
      caller: {
        type: "user",
        userId: TEST_USER_ID,
        identity: TEST_IDENTITY,
        active: true,
        name: "Ada",
        email: "ada@example.com",
        capabilities: ["admin"],
      },
    },
  });
  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "session_not_found");
});

Deno.test("Auth.Sessions.Me reflects SQL user active and capability changes", async () => {
  await withSqlAuthRepositories(async ({ users }) => {
    const sessionKV = new InMemoryKV<Session>();
    const deviceActivationsKV = new InMemoryKV<{
      instanceId: string;
      publicIdentityKey: string;
      deploymentId: string;
      activatedBy?: TestDeviceActivationActor;
      state: "activated" | "revoked";
      activatedAt: string;
      revokedAt: string | null;
    }>();
    const deviceDeploymentsKV = new InMemoryKV<{
      deploymentId: string;
      disabled: boolean;
    }>();
    const handler = createAuthSessionsMeHandler({
      logger: createTestLogger(),
      sessionStorage: sessionStorageFromKV(sessionKV),
      userStorage: users,
      deviceActivationStorage: deviceActivationStorageFromKV(
        deviceActivationsKV,
      ),
      deviceDeploymentStorage: getStorageFromKV(deviceDeploymentsKV),
    });

    const userTrellisId = TEST_USER_ID;
    sessionKV.seed(
      "sk_user",
      testUserSession({
        delegatedCapabilities: ["fallback"],
      }),
    );

    await users.put(userTrellisId, testUserProjection());
    let result = await handler({
      context: { sessionKey: "sk_user", caller: { type: "unknown" } },
    });
    let value = result.take();
    if (isErr(value)) throw value.error;
    assertEquals(value.user?.active, true);
    assertEquals(value.user?.capabilities, ["users.read"]);

    await users.put(
      userTrellisId,
      testUserProjection({
        capabilities: [],
        capabilityGroups: ["admin"],
      }),
    );
    result = await handler({
      context: { sessionKey: "sk_user", caller: { type: "unknown" } },
    });
    value = result.take();
    if (isErr(value)) throw value.error;
    assertEquals(
      value.user?.capabilities.includes("trellis.auth::device.review"),
      true,
    );

    await users.put(
      userTrellisId,
      testUserProjection({
        active: false,
        capabilities: ["users.write"],
      }),
    );
    result = await handler({
      context: { sessionKey: "sk_user", caller: { type: "unknown" } },
    });
    value = result.take();
    if (isErr(value)) throw value.error;
    assertEquals(value.user?.active, false);
    assertEquals(value.user?.capabilities, ["users.write"]);
  });
});

Deno.test("Auth.Sessions.Me rejects user sessions when the durable projection is missing", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const userTrellisId = TEST_USER_ID;
  sessionKV.seed(
    "sk_user",
    testUserSession({
      delegatedCapabilities: ["fallback"],
    }),
  );

  const handler = createAuthSessionsMeHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    userStorage: new InMemoryUserStorage(),
    deviceActivationStorage: deviceActivationStorageFromKV(
      new InMemoryKV<{
        instanceId: string;
        publicIdentityKey: string;
        deploymentId: string;
        activatedBy?: TestDeviceActivationActor;
        state: "activated" | "revoked";
        activatedAt: string;
        revokedAt: string | null;
      }>(),
    ),
    deviceDeploymentStorage: getStorageFromKV(
      new InMemoryKV<{
        deploymentId: string;
        disabled: boolean;
      }>(),
    ),
  });

  const result = await handler({
    context: {
      sessionKey: "sk_user",
      caller: {
        type: "user",
        userId: userTrellisId,
        identity: TEST_IDENTITY,
        active: true,
        name: "Ada",
        email: "ada@example.com",
        capabilities: ["admin"],
      },
    },
  });
  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "user_not_found");
});

Deno.test("Auth.Sessions.Me rejects missing device sessions despite caller context", async () => {
  const userStorage = new InMemoryUserStorage();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    activatedBy?: TestDeviceActivationActor;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const deviceDeploymentsKV = new InMemoryKV<{
    deploymentId: string;
    disabled: boolean;
  }>();

  const handler = createAuthSessionsMeHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(new InMemoryKV<Session>()),
    userStorage,
    deviceActivationStorage: deviceActivationStorageFromKV(deviceActivationsKV),
    deviceDeploymentStorage: getStorageFromKV(deviceDeploymentsKV),
  });

  const userTrellisId = TEST_USER_ID;
  userStorage.seed(userTrellisId, {
    origin: "github",
    id: "123",
    name: "Ada",
    email: "ada@example.com",
    active: true,
    capabilities: ["users.read"],
    capabilityGroups: [],
  });
  deviceActivationsKV.seed("dev_1", {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    activatedBy: TEST_ACTIVATION_ACTOR,
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  deviceDeploymentsKV.seed("reader.default", {
    deploymentId: "reader.default",
    disabled: false,
  });

  const result = await handler({
    context: {
      sessionKey: "missing",
      caller: {
        type: "device",
        deviceId: "dev_1",
        runtimePublicKey: "A".repeat(43),
        deploymentId: "reader.default",
        active: true,
        capabilities: ["device.sync"],
      },
    },
  });
  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "session_not_found");
});

Deno.test("Auth.Sessions.Me rejects stale device activation deployment", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const userStorage = new InMemoryUserStorage();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const deviceInstancesKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "registered" | "activated" | "revoked" | "disabled";
  }>();
  const deviceDeploymentsKV = new InMemoryKV<{
    deploymentId: string;
    disabled: boolean;
  }>();

  const handler = createAuthSessionsMeHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    userStorage,
    deviceActivationStorage: deviceActivationStorageFromKV(deviceActivationsKV),
    deviceInstanceStorage: getStorageFromKV(deviceInstancesKV),
    deviceDeploymentStorage: getStorageFromKV(deviceDeploymentsKV),
  });

  sessionKV.seed("sk_device", {
    type: "device",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    contractId: "trellis.reader@v1",
    contractDigest: "digest-a",
    delegatedCapabilities: ["device.sync"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
    activatedAt: null,
    revokedAt: null,
  });
  deviceActivationsKV.seed("dev_1", {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  deviceInstancesKV.seed("dev_1", {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.next",
    state: "activated",
  });
  deviceDeploymentsKV.seed("reader.default", {
    deploymentId: "reader.default",
    disabled: false,
  });

  const result = await handler({
    context: { sessionKey: "sk_device", caller: { type: "unknown" } },
  });
  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "device_activation_revoked");
});

Deno.test("Auth.Sessions.Me rejects stale device activation identity key", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const userStorage = new InMemoryUserStorage();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const deviceInstancesKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "registered" | "activated" | "revoked" | "disabled";
  }>();
  const deviceDeploymentsKV = new InMemoryKV<{
    deploymentId: string;
    disabled: boolean;
  }>();

  const handler = createAuthSessionsMeHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    userStorage,
    deviceActivationStorage: deviceActivationStorageFromKV(deviceActivationsKV),
    deviceInstanceStorage: getStorageFromKV(deviceInstancesKV),
    deviceDeploymentStorage: getStorageFromKV(deviceDeploymentsKV),
  });

  sessionKV.seed("sk_device", {
    type: "device",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    contractId: "trellis.reader@v1",
    contractDigest: "digest-a",
    delegatedCapabilities: ["device.sync"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
    activatedAt: null,
    revokedAt: null,
  });
  deviceActivationsKV.seed("dev_1", {
    instanceId: "dev_1",
    publicIdentityKey: "B".repeat(43),
    deploymentId: "reader.default",
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  deviceInstancesKV.seed("dev_1", {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    state: "activated",
  });
  deviceDeploymentsKV.seed("reader.default", {
    deploymentId: "reader.default",
    disabled: false,
  });

  const result = await handler({
    context: { sessionKey: "sk_device", caller: { type: "unknown" } },
  });
  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "device_activation_revoked");
});

Deno.test("Auth.Requests.Validate returns invalid_signature for malformed payload hash", async () => {
  const handler = createAuthRequestsValidateHandler({
    logger: createTestLogger(),
    sessionStorage: { getOneBySessionKey: () => Promise.resolve(undefined) },
    userStorage: new InMemoryUserStorage(),
    deviceActivationStorage: { get: () => Promise.resolve(undefined) },
    deviceDeploymentStorage: { get: () => Promise.resolve(undefined) },
    deviceInstanceStorage: { get: () => Promise.resolve(undefined) },
    loadServiceInstance: () => Promise.resolve(null),
    loadServiceDeployment: () => Promise.resolve(null),
  });

  const result = await handler({
    input: {
      sessionKey: "A".repeat(43),
      proof: "not-a-proof",
      subject: "rpc.v1.Auth.Sessions.Me",
      payloadHash: "!!!!",
      iat: TEST_IAT,
      requestId: "req_malformed",
    },
  });

  assert(result.isErr());
  assertEquals(result.error.reason, "invalid_signature");
});

Deno.test("Auth.Requests.Validate uses current delegated publish subjects", async () => {
  const auth = await createAuth({
    sessionKeySeed: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  });
  const payloadHash = await sha256(utf8("{}"));
  const sessionKV = new InMemoryKV<Session>();
  const userStorage = new InMemoryUserStorage();
  userStorage.seed(TEST_USER_ID, testUserProjection());
  sessionKV.seed(
    auth.sessionKey,
    testUserSession({
      delegatedCapabilities: ["users.read"],
      delegatedPublishSubjects: ["rpc.v1.Allowed.*"],
    }),
  );
  const handler = createAuthRequestsValidateHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    userStorage,
    deviceActivationStorage: { get: () => Promise.resolve(undefined) },
    deviceDeploymentStorage: { get: () => Promise.resolve(undefined) },
    deviceInstanceStorage: { get: () => Promise.resolve(undefined) },
    loadServiceInstance: () => Promise.resolve(null),
    loadServiceDeployment: () => Promise.resolve(null),
    nowSeconds: () => TEST_IAT,
  });

  let requestSequence = 0;
  async function validate(subject: string) {
    const requestId = `req_${requestSequence++}`;
    return await handler({
      input: {
        sessionKey: auth.sessionKey,
        proof: await auth.createProof(
          subject,
          payloadHash,
          requestId,
          TEST_IAT,
        ),
        subject,
        payloadHash: base64urlEncode(payloadHash),
        iat: TEST_IAT,
        requestId,
      },
    });
  }

  const allowed = (await validate("rpc.v1.Allowed.Ping")).take();
  if (isErr(allowed)) throw allowed.error;
  assertEquals(allowed.allowed, true);
  assertEquals(allowed.caller, {
    type: "user",
    participantKind: "app",
    userId: TEST_USER_ID,
    identity: TEST_IDENTITY,
    active: true,
    name: "Ada",
    email: "ada@example.com",
    image: undefined,
    capabilities: ["users.read"],
    lastAuth: "2026-04-10T00:00:00.000Z",
  });

  const denied = (await validate("rpc.v1.Removed.Ping")).take();
  if (isErr(denied)) throw denied.error;
  assertEquals(denied.allowed, false);
});

Deno.test("Auth.Requests.Validate rejects stale request proofs", async () => {
  const auth = await createAuth({
    sessionKeySeed: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  });
  const subject = "rpc.v1.Allowed.Ping";
  const payloadHash = await sha256(utf8("{}"));
  const requestId = "req_stale";
  const handler = createAuthRequestsValidateHandler({
    logger: createTestLogger(),
    sessionStorage: { getOneBySessionKey: () => Promise.resolve(undefined) },
    userStorage: new InMemoryUserStorage(),
    deviceActivationStorage: { get: () => Promise.resolve(undefined) },
    deviceDeploymentStorage: { get: () => Promise.resolve(undefined) },
    deviceInstanceStorage: { get: () => Promise.resolve(undefined) },
    loadServiceInstance: () => Promise.resolve(null),
    loadServiceDeployment: () => Promise.resolve(null),
    nowSeconds: () => TEST_IAT + 31,
  });

  const result = await handler({
    input: {
      sessionKey: auth.sessionKey,
      proof: await auth.createProof(subject, payloadHash, requestId, TEST_IAT),
      subject,
      payloadHash: base64urlEncode(payloadHash),
      iat: TEST_IAT,
      requestId,
    },
  });

  assert(result.isErr());
  assertEquals(result.error.reason, "iat_out_of_range");
});

Deno.test("Auth.Requests.Validate rejects replayed request ids", async () => {
  const auth = await createAuth({
    sessionKeySeed: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  });
  const subject = "rpc.v1.Allowed.Ping";
  const payloadHash = await sha256(utf8("{}"));
  const requestId = "req_replay";
  const sessionKV = new InMemoryKV<Session>();
  sessionKV.seed(auth.sessionKey, {
    type: "service",
    trellisId: "service-trellis-id",
    origin: "service",
    id: auth.sessionKey,
    email: "worker@trellis.internal",
    name: "Worker",
    instanceId: "instance-1",
    deploymentId: "worker.default",
    instanceKey: auth.sessionKey,
    contractId: "worker.current@v1",
    contractDigest: "digest-current",
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
  });
  const handler = createAuthRequestsValidateHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    userStorage: new InMemoryUserStorage(),
    deviceActivationStorage: { get: () => Promise.resolve(undefined) },
    deviceDeploymentStorage: { get: () => Promise.resolve(undefined) },
    deviceInstanceStorage: { get: () => Promise.resolve(undefined) },
    loadServiceInstance: () =>
      Promise.resolve({
        instanceId: "instance-1",
        deploymentId: "worker.default",
        instanceKey: auth.sessionKey,
        disabled: false,
        capabilities: ["worker.run"],
      }),
    loadServiceDeployment: () =>
      Promise.resolve({ deploymentId: "worker.default", disabled: false }),
    nowSeconds: () => TEST_IAT,
  });
  const input = {
    sessionKey: auth.sessionKey,
    proof: await auth.createProof(subject, payloadHash, requestId, TEST_IAT),
    subject,
    payloadHash: base64urlEncode(payloadHash),
    iat: TEST_IAT,
    requestId,
  };

  const first = (await handler({ input })).take();
  if (isErr(first)) throw first.error;
  assertEquals(first.allowed, true);

  const second = await handler({ input });
  assert(second.isErr());
  assertEquals(second.error.reason, "invalid_signature");
});

Deno.test("Auth.Requests.Validate uses current service instance permissions", async () => {
  const auth = await createAuth({
    sessionKeySeed: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  });
  const payloadHash = await sha256(utf8("{}"));
  const subject = "rpc.v1.Worker.Run";
  const sessionKV = new InMemoryKV<Session>();
  sessionKV.seed(auth.sessionKey, {
    type: "service",
    trellisId: "service-trellis-id",
    origin: "service",
    id: auth.sessionKey,
    email: "worker@trellis.internal",
    name: "Worker",
    instanceId: "instance-1",
    deploymentId: "worker.default",
    instanceKey: auth.sessionKey,
    contractId: "worker.old@v1",
    contractDigest: "digest-old",
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
  });
  const handler = createAuthRequestsValidateHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    userStorage: new InMemoryUserStorage(),
    deviceActivationStorage: { get: () => Promise.resolve(undefined) },
    deviceDeploymentStorage: { get: () => Promise.resolve(undefined) },
    deviceInstanceStorage: { get: () => Promise.resolve(undefined) },
    loadServiceInstance: () =>
      Promise.resolve({
        instanceId: "instance-1",
        deploymentId: "worker.default",
        instanceKey: auth.sessionKey,
        disabled: false,
        capabilities: ["service", "worker.run"],
      }),
    loadServiceDeployment: () =>
      Promise.resolve({ deploymentId: "worker.default", disabled: false }),
    nowSeconds: () => TEST_IAT,
  });
  const requestId = "req_service_permissions";

  const result = await handler({
    input: {
      sessionKey: auth.sessionKey,
      proof: await auth.createProof(subject, payloadHash, requestId, TEST_IAT),
      subject,
      payloadHash: base64urlEncode(payloadHash),
      iat: TEST_IAT,
      requestId,
      capabilities: ["worker.run"],
    },
  });

  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(value.allowed, true);
  assertEquals(value.caller, {
    type: "service",
    id: auth.sessionKey,
    name: "Worker",
    active: true,
    capabilities: ["service", "worker.run"],
  });
});

Deno.test("Auth.Sessions.List returns explicit participant metadata for app, agent, device, and service sessions", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const userTrellisId = TEST_USER_ID;

  sessionKV.seed(
    "sk_app",
    testUserSession({
      participantKind: "app",
      contractDigest: "digest-app",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      app: {
        contractId: "trellis.console@v1",
        origin: "https://console.example.com",
      },
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );
  sessionKV.seed(
    "sk_agent",
    testUserSession({
      participantKind: "agent",
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      contractDisplayName: "Trellis Agent",
      contractDescription: "Local delegated tooling",
      app: {
        contractId: "trellis.agent@v1",
        origin: "https://agent.example.com",
      },
      delegatedCapabilities: ["jobs.read"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );
  sessionKV.seed("sk_device", {
    type: "device",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    contractId: "trellis.reader@v1",
    contractDigest: "digest-device",
    delegatedCapabilities: ["device.sync"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
    activatedAt: null,
    revokedAt: null,
  });
  sessionKV.seed("sk_service", {
    type: "service",
    trellisId: "svc_1",
    origin: "service",
    id: "billing",
    email: "billing@trellis.internal",
    name: "Billing",
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "sk_service",
    contractId: null,
    contractDigest: null,
    ...baseSessionFields(),
  });

  const handler = createAuthSessionsListHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
  });
  const result = await handler({
    input: {},
  });
  const value = result.take();
  if (isErr(value)) throw value.error;

  const sessionsByKey = new Map<
    string,
    {
      key: string;
      participantKind: string;
    } & Record<string, unknown>
  >(
    value.entries.map((session: { key: string; participantKind: string }) => [
      session.key,
      session,
    ]),
  );
  assertEquals(value.count, 4);
  assertEquals(value.offset, 0);
  assertEquals(value.limit, 500);
  assertEquals(value.nextOffset, undefined);
  assertEquals(
    new Set(sessionsByKey.keys()),
    new Set([
      "usr_github_123.sk_app",
      "usr_github_123.sk_agent",
      `dev_1.${"A".repeat(43)}.sk_device`,
      "service.billing.sk_service",
    ]),
  );
  assertEquals(sessionsByKey.get("usr_github_123.sk_app"), {
    key: "usr_github_123.sk_app",
    sessionKey: "sk_app",
    participantKind: "app",
    principal: {
      type: "user",
      userId: userTrellisId,
      identity: TEST_IDENTITY,
      name: "Ada",
    },
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    createdAt: "2026-04-10T00:00:00.000Z",
    lastAuth: "2026-04-10T00:00:00.000Z",
  });
  assertEquals(
    sessionsByKey.get("usr_github_123.sk_agent")?.participantKind,
    "agent",
  );
  assertEquals(
    sessionsByKey.get(`dev_1.${"A".repeat(43)}.sk_device`)?.participantKind,
    "device",
  );
  assertEquals(
    sessionsByKey.get("service.billing.sk_service")?.participantKind,
    "service",
  );
});

Deno.test("Auth.Connections.List returns explicit participant metadata for user sessions", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<
    { serverId: string; clientId: number; connectedAt: Date }
  >();
  const userTrellisId = TEST_USER_ID;

  sessionKV.seed(
    "sk_agent",
    testUserSession({
      participantKind: "agent",
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      contractDisplayName: "Trellis Agent",
      contractDescription: "Local delegated tooling",
      app: {
        contractId: "trellis.agent@v1",
        origin: "https://agent.example.com",
      },
      delegatedCapabilities: ["jobs.read"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );
  connectionsKV.seed(connectionKey("sk_agent", userTrellisId, "user_nkey"), {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-10T00:00:00.000Z"),
  });

  const handler = createAuthConnectionsListHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
  });
  const result = await handler({
    input: {},
  });
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, {
    entries: [
      {
        key: "usr_github_123.sk_agent.user_nkey",
        userNkey: "user_nkey",
        sessionKey: "sk_agent",
        participantKind: "agent",
        principal: {
          type: "user",
          userId: userTrellisId,
          identity: TEST_IDENTITY,
          name: "Ada",
        },
        contractId: "trellis.agent@v1",
        contractDisplayName: "Trellis Agent",
        serverId: "n1",
        clientId: 7,
        connectedAt: "2026-04-10T00:00:00.000Z",
      },
    ],
    count: 1,
    offset: 0,
    limit: 500,
    nextOffset: undefined,
  });
});

Deno.test("Auth.Connections.List skips malformed connection entries", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<
    | { serverId: string; clientId: number; connectedAt: Date }
    | { serverId: string; connectedAt: Date }
  >();
  const userTrellisId = TEST_USER_ID;

  sessionKV.seed(
    "sk_app",
    testUserSession({
      participantKind: "app",
      contractDigest: "digest-app",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );
  connectionsKV.seed(connectionKey("sk_app", userTrellisId, "user_nkey_1"), {
    serverId: "n1",
    connectedAt: new Date("2026-04-10T00:00:00.000Z"),
  });
  connectionsKV.seed(connectionKey("sk_app", userTrellisId, "user_nkey_2"), {
    serverId: "n2",
    clientId: 8,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthConnectionsListHandler({
    logger: createTestLogger(),
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
  });
  const result = await handler({ input: { sessionKey: "sk_app" } });
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(
    value.entries.map((connection: { userNkey: string }) =>
      connection.userNkey
    ),
    [
      "user_nkey_2",
    ],
  );
  assertEquals(value.count, 1);
  assertEquals(value.offset, 0);
  assertEquals(value.limit, 500);
  assertEquals(value.nextOffset, undefined);
  assertEquals(value.entries[0]?.serverId, "n2");
  assertEquals(value.entries[0]?.clientId, 8);
});

Deno.test("Auth.Sessions.Revoke cascades agent revocation to the grant and sibling agent sessions", async () => {
  const userTrellisId = TEST_USER_ID;
  const contractApprovalStorage = new InMemoryApprovalStorage();
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<
    { serverId: string; clientId: number; connectedAt: Date }
  >();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const revoked: Array<
    { origin: string; id: string; sessionKey: string; revokedBy: string }
  > = [];

  contractApprovalStorage.seed({
    identityGrantId: "env-agent",
    identityAuthorityId: `${userTrellisId}:github:123`,
    userTrellisId,
    origin: "github",
    id: "123",
    identityAnchor: {
      kind: "cli",
      contractId: "trellis.agent@v1",
      sessionPublicKey: "session-agent",
    },
    answer: "approved",
    answeredAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-11T00:00:00.000Z"),
    approvalEvidence: {
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      displayName: "Trellis Agent",
      description: "Local delegated tooling",
      participantKind: "agent",
      capabilities: {
        "jobs.read": {
          displayName: "Read jobs",
          description: "Read job status.",
        },
      },
    },
    publishSubjects: [],
    subscribeSubjects: [],
  });

  sessionKV.seed(
    "sk_agent_1",
    testUserSession({
      participantKind: "agent",
      identityGrantId: "env-agent",
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      contractDisplayName: "Trellis Agent",
      contractDescription: "Local delegated tooling",
      delegatedCapabilities: ["jobs.read"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );
  sessionKV.seed(
    "sk_agent_2",
    testUserSession({
      participantKind: "agent",
      identityGrantId: "env-agent",
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      contractDisplayName: "Trellis Agent",
      contractDescription: "Local delegated tooling",
      delegatedCapabilities: ["jobs.read"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );
  sessionKV.seed(
    "sk_app",
    testUserSession({
      participantKind: "app",
      contractDigest: "digest-app",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );

  connectionsKV.seed(
    connectionKey("sk_agent_1", userTrellisId, "user_nkey_1"),
    {
      serverId: "n1",
      clientId: 7,
      connectedAt: new Date("2026-04-11T00:00:00.000Z"),
    },
  );
  connectionsKV.seed(
    connectionKey("sk_agent_2", userTrellisId, "user_nkey_2"),
    {
      serverId: "n2",
      clientId: 8,
      connectedAt: new Date("2026-04-11T00:00:00.000Z"),
    },
  );
  connectionsKV.seed(connectionKey("sk_app", userTrellisId, "user_nkey_3"), {
    serverId: "n3",
    clientId: 9,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthSessionsRevokeHandler({
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
    contractApprovalStorage,
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    publishSessionRevoked: async (event) => {
      revoked.push(event);
    },
  });

  const result = await handler(
    { sessionKey: "sk_agent_1" },
    {
      caller: {
        type: "user",
        userId: userTrellisId,
      },
    },
  );
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, { success: true });
  assertEquals(kicked, [
    { serverId: "n1", clientId: 7 },
    { serverId: "n2", clientId: 8 },
  ]);
  assertEquals(revoked, [
    {
      origin: "github",
      id: "123",
      sessionKey: "sk_agent_1",
      revokedBy: "usr_github_123",
    },
    {
      origin: "github",
      id: "123",
      sessionKey: "sk_agent_2",
      revokedBy: "usr_github_123",
    },
  ]);
  assertEquals(
    await contractApprovalStorage.get("env-agent"),
    undefined,
  );
  assertEquals(
    isErr(await sessionKV.get("sk_agent_1").take()),
    true,
  );
  assertEquals(
    isErr(await sessionKV.get("sk_agent_2").take()),
    true,
  );
  assertEquals(
    isErr(
      await connectionsKV.get(
        connectionKey("sk_agent_1", userTrellisId, "user_nkey_1"),
      ).take(),
    ),
    true,
  );
  assertEquals(
    isErr(
      await connectionsKV.get(
        connectionKey("sk_agent_2", userTrellisId, "user_nkey_2"),
      ).take(),
    ),
    true,
  );
  assertEquals(
    isErr(await sessionKV.get("sk_app").take()),
    false,
  );
  assertEquals(
    isErr(
      await connectionsKV.get(
        connectionKey("sk_app", userTrellisId, "user_nkey_3"),
      ).take(),
    ),
    false,
  );
});

Deno.test("Auth.Sessions.Revoke cascades app revocation to the grant and sibling user sessions", async () => {
  const userTrellisId = TEST_USER_ID;
  const contractApprovalStorage = new InMemoryApprovalStorage();
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<
    { serverId: string; clientId: number; connectedAt: Date }
  >();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const serviceInstancesKV = new InMemoryKV<{
    instanceId: string;
    deploymentId: string;
    instanceKey: string;
    disabled: boolean;
    capabilities: string[];
    createdAt: string;
  }>();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const revoked: Array<
    { origin: string; id: string; sessionKey: string; revokedBy: string }
  > = [];

  contractApprovalStorage.seed({
    identityGrantId: "env-app",
    identityAuthorityId: `${userTrellisId}:github:123`,
    userTrellisId,
    origin: "github",
    id: "123",
    identityAnchor: {
      kind: "web",
      contractId: "trellis.console@v1",
      origin: "https://console.example",
    },
    answer: "approved",
    answeredAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-11T00:00:00.000Z"),
    approvalEvidence: {
      contractDigest: "digest-app",
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
    publishSubjects: [],
    subscribeSubjects: [],
  });

  sessionKV.seed(
    "sk_app_1",
    testUserSession({
      participantKind: "app",
      identityGrantId: "env-app",
      contractDigest: "digest-app",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );
  sessionKV.seed(
    "sk_app_2",
    testUserSession({
      participantKind: "app",
      identityGrantId: "env-app",
      contractDigest: "digest-app",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );
  sessionKV.seed(
    "sk_agent",
    testUserSession({
      participantKind: "agent",
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      contractDisplayName: "Trellis Agent",
      contractDescription: "Local delegated tooling",
      delegatedCapabilities: ["jobs.read"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    }),
  );

  connectionsKV.seed(connectionKey("sk_app_1", userTrellisId, "user_nkey_1"), {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });
  connectionsKV.seed(connectionKey("sk_app_2", userTrellisId, "user_nkey_2"), {
    serverId: "n2",
    clientId: 8,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });
  connectionsKV.seed(connectionKey("sk_agent", userTrellisId, "user_nkey_3"), {
    serverId: "n3",
    clientId: 9,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthSessionsRevokeHandler({
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
    contractApprovalStorage,
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    publishSessionRevoked: async (event) => {
      revoked.push(event);
    },
  });

  const result = await handler(
    { sessionKey: "sk_app_1" },
    {
      caller: {
        type: "user",
        userId: userTrellisId,
      },
    },
  );
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, { success: true });
  assertEquals(kicked, [
    { serverId: "n1", clientId: 7 },
    { serverId: "n2", clientId: 8 },
  ]);
  assertEquals(revoked, [
    {
      origin: "github",
      id: "123",
      sessionKey: "sk_app_1",
      revokedBy: "usr_github_123",
    },
    {
      origin: "github",
      id: "123",
      sessionKey: "sk_app_2",
      revokedBy: "usr_github_123",
    },
  ]);
  assertEquals(
    await contractApprovalStorage.get("env-app"),
    undefined,
  );
  assertEquals(
    isErr(await sessionKV.get("sk_app_1").take()),
    true,
  );
  assertEquals(
    isErr(await sessionKV.get("sk_app_2").take()),
    true,
  );
  assertEquals(
    isErr(await sessionKV.get("sk_agent").take()),
    false,
  );
});

Deno.test("Auth.Sessions.Revoke deletes app approvals from SQL", async () => {
  await withSqlAuthRepositories(async ({ approvals }) => {
    const userTrellisId = TEST_USER_ID;
    await approvals.put({
      identityGrantId: "env-app",
      identityAuthorityId: `${userTrellisId}:github:123`,
      userTrellisId,
      origin: "github",
      id: "123",
      identityAnchor: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example",
      },
      answer: "approved",
      answeredAt: new Date("2026-04-10T00:00:00.000Z"),
      updatedAt: new Date("2026-04-11T00:00:00.000Z"),
      approvalEvidence: {
        contractDigest: "digest-app",
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
      publishSubjects: [],
      subscribeSubjects: [],
    });

    const sessionKV = new InMemoryKV<Session>();
    const connectionsKV = new InMemoryKV<
      { serverId: string; clientId: number; connectedAt: Date }
    >();
    sessionKV.seed(
      "sk_app",
      testUserSession({
        participantKind: "app",
        identityGrantId: "env-app",
        contractDigest: "digest-app",
        contractId: "trellis.console@v1",
        contractDisplayName: "Console",
        contractDescription: "Admin app",
        delegatedCapabilities: ["admin"],
        delegatedPublishSubjects: [],
        delegatedSubscribeSubjects: [],
      }),
    );

    const handler = createAuthSessionsRevokeHandler({
      sessionStorage: sessionStorageFromKV(sessionKV),
      connectionsKV,
      contractApprovalStorage: approvals,
      kick: async () => undefined,
      publishSessionRevoked: async () => undefined,
    });

    const result = await handler(
      { sessionKey: "sk_app" },
      {
        caller: {
          type: "user",
          userId: userTrellisId,
        },
      },
    );
    const value = result.take();
    if (isErr(value)) throw value.error;
    assertEquals(value, { success: true });
    assertEquals(await approvals.get("env-app"), undefined);
  });
});

Deno.test("Auth.Sessions.Revoke revokes device activation so the device cannot reconnect", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<
    { serverId: string; clientId: number; connectedAt: Date }
  >();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const serviceInstancesKV = new InMemoryKV<{
    instanceId: string;
    deploymentId: string;
    instanceKey: string;
    disabled: boolean;
    capabilities: string[];
    createdAt: string;
  }>();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const revoked: Array<
    { origin: string; id: string; sessionKey: string; revokedBy: string }
  > = [];

  sessionKV.seed("sk_device", {
    type: "device",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    contractId: "trellis.reader@v1",
    contractDigest: "digest-device",
    delegatedCapabilities: ["device.sync"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    lastAuth: new Date("2026-04-10T00:00:00.000Z"),
    activatedAt: new Date("2026-04-10T00:00:00.000Z"),
    revokedAt: null,
  });
  deviceActivationsKV.seed("dev_1", {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    deploymentId: "reader.default",
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  connectionsKV.seed(connectionKey("sk_device", "dev_1", "user_nkey"), {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthSessionsRevokeHandler({
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
    contractApprovalStorage: emptyApprovalStorage,
    deviceActivationStorage: deviceActivationStorageFromKV(
      deviceActivationsKV,
    ),
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    publishSessionRevoked: async (event) => {
      revoked.push(event);
    },
  });

  const result = await handler(
    { sessionKey: "sk_device" },
    {
      caller: {
        type: "user",
        userId: "usr_123",
      },
    },
  );
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, { success: true });
  assertEquals(kicked, [{ serverId: "n1", clientId: 7 }]);
  assertEquals(revoked, []);
  const activationEntry = await deviceActivationsKV.get("dev_1").take();
  if (isErr(activationEntry)) throw activationEntry.error;
  assertEquals(activationEntry.value.state, "revoked");
  assert(activationEntry.value.revokedAt !== null);
  assertEquals(isErr(await sessionKV.get("sk_device").take()), true);
});

Deno.test("Auth.Sessions.Revoke disables the service instance so it cannot reconnect", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<
    { serverId: string; clientId: number; connectedAt: Date }
  >();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const serviceInstancesKV = new InMemoryKV<{
    instanceId: string;
    deploymentId: string;
    instanceKey: string;
    disabled: boolean;
    capabilities: string[];
    createdAt: string;
  }>();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const revoked: Array<
    { origin: string; id: string; sessionKey: string; revokedBy: string }
  > = [];

  sessionKV.seed("sk_service", {
    type: "service",
    trellisId: "svc_1",
    origin: "service",
    id: "billing",
    email: "billing@trellis.internal",
    name: "Billing",
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "sk_service",
    contractId: null,
    contractDigest: null,
    ...baseSessionFields(),
  });
  serviceInstancesKV.seed("svc_1", {
    instanceId: "svc_1",
    deploymentId: "billing.default",
    instanceKey: "sk_service",
    disabled: false,
    capabilities: ["service"],
    createdAt: "2026-04-10T00:00:00.000Z",
  });
  connectionsKV.seed(connectionKey("sk_service", "svc_1", "user_nkey"), {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthSessionsRevokeHandler({
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
    contractApprovalStorage: emptyApprovalStorage,
    serviceInstanceStorage: {
      get: async (instanceId: string) => {
        const entry = await serviceInstancesKV.get(instanceId).take();
        return isErr(entry) ? undefined : entry.value;
      },
      put: async (instance) => {
        await serviceInstancesKV.put(instance.instanceId, instance).take();
      },
    },
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    publishSessionRevoked: async (event) => {
      revoked.push(event);
    },
  });

  const result = await handler(
    { sessionKey: "sk_service" },
    {
      caller: {
        type: "user",
        userId: "usr_123",
      },
    },
  );
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, { success: true });
  assertEquals(kicked, [{ serverId: "n1", clientId: 7 }]);
  assertEquals(revoked, [{
    origin: "service",
    id: "billing",
    sessionKey: "sk_service",
    revokedBy: "usr_123",
  }]);
  const serviceEntry = await serviceInstancesKV.get("svc_1").take();
  if (isErr(serviceEntry)) throw serviceEntry.error;
  assertEquals(serviceEntry.value.disabled, true);
  assertEquals(isErr(await sessionKV.get("sk_service").take()), true);
});
