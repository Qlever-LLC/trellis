import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { AsyncResult } from "@qlever-llc/result";
import {
  base64urlEncode,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth";

import { __testing__, type Config } from "../../config.ts";
import { ContractStore } from "../../catalog/store.ts";
import { buildAuthStartSignaturePayload } from "./start_request.ts";
import type { Session } from "../schemas.ts";

const config: Config = {
  logLevel: "info",
  port: 3000,
  instanceName: "Trellis",
  web: { origins: [], allowInsecureOrigins: [] },
  httpRateLimit: { windowMs: 60_000, max: 0 },
  storage: { dbPath: ":memory:" },
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
    trellis: { credsPath: "" },
    auth: { credsPath: "" },
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

async function registerTestRoutes(): Promise<Hono> {
  __testing__.setConfig(config);
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
    getLogin: () => Promise.resolve(undefined),
    getDevice: () => Promise.resolve(undefined),
    getByInstanceKey: () => Promise.resolve(undefined),
    put: () => Promise.resolve(undefined),
    delete: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    listByDeployment: () => Promise.resolve([]),
  };

  registerHttpRoutes(app, {
    contractStorage: storage,
    userStorage: storage,
    contractApprovalStorage: storage,
    portalStorage: storage,
    portalDefaultStorage: storage,
    loginPortalSelectionStorage: storage,
    devicePortalSelectionStorage: storage,
    serviceDeploymentStorage: storage,
    serviceInstanceStorage: storage,
    deviceDeploymentStorage: storage,
    deviceInstanceStorage: storage,
    deviceActivationStorage: storage,
    deviceActivationReviewStorage: storage,
    deviceProvisioningSecretStorage: storage,
    config,
    kick: async () => {},
    loadEffectiveGrantPolicies: () => Promise.resolve([]),
    contractStore: { getContract: () => undefined },
    providers: {},
    runtimeDeps: {
      browserFlowsKV: {
        ...kv,
        get: () =>
          AsyncResult.ok({
            value: {
              flowId: "missing",
              kind: "login",
              authToken: "token",
              createdAt: new Date(),
              expiresAt: new Date(),
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
    },
  } as never);
  return app;
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
  name:
    "auth HTTP bind caches app contracts without activating them in catalog",
  sanitizeResources: false,
  fn: async () => {
    __testing__.setConfig(config);
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

    const contractStore = new ContractStore();
    const sessions = new Map<string, Session>();
    sessions.set(auth.sessionKey, {
      type: "user",
      participantKind: "app",
      trellisId: "tid_123",
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
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
      put: () => Promise.resolve(undefined),
      delete: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      listByDeployment: () => Promise.resolve([]),
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
      portalStorage: emptyStorage,
      portalDefaultStorage: emptyStorage,
      loginPortalSelectionStorage: emptyStorage,
      devicePortalSelectionStorage: emptyStorage,
      serviceDeploymentStorage: emptyStorage,
      serviceInstanceStorage: emptyStorage,
      deviceDeploymentStorage: emptyStorage,
      deviceInstanceStorage: emptyStorage,
      deviceActivationStorage: emptyStorage,
      deviceActivationReviewStorage: emptyStorage,
      deviceProvisioningSecretStorage: emptyStorage,
      config,
      kick: async () => {},
      loadEffectiveGrantPolicies: () => Promise.resolve([]),
      contractStore,
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
      },
    } as never);

    const response = await app.request("http://trellis/auth/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    assertEquals(response.status, 200);
    assertEquals((await response.json()).status, "bound");
    assertEquals(contractStore.getActiveCatalog().contracts, []);
    assertEquals(
      contractStore.getKnownContractsById("client.example@v1").length,
      1,
    );
  },
});
