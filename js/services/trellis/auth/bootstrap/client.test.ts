import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { AsyncResult, isErr, UnexpectedError } from "@qlever-llc/result";
import {
  base64urlEncode,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth";

import { ContractStore } from "../../catalog/store.ts";
import type { SentinelCreds, Session } from "../schemas.ts";
import type { UserProjectionEntry } from "../schemas.ts";
import { createClientBootstrapHandler } from "./client.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TEST_IAT = 1_700_000_000;

class InMemoryKV<V> {
  readonly #values = new Map<string, V>();

  seed(key: string, value: V): void {
    this.#values.set(key, value);
  }

  getValue(key: string): V | undefined {
    return this.#values.get(key);
  }

  get(key: string): AsyncResult<{ value: V }, UnexpectedError> {
    const value = this.#values.get(key);
    if (value === undefined) {
      return AsyncResult.err(new UnexpectedError({ context: { key } }));
    }
    return AsyncResult.ok({ value });
  }

  keys(filter: string): AsyncResult<AsyncIterable<string>, UnexpectedError> {
    const prefix = filter.endsWith(">") ? filter.slice(0, -1) : filter;
    const entries = [...this.#values.keys()].filter((key) =>
      key.startsWith(prefix)
    );
    return AsyncResult.ok({
      async *[Symbol.asyncIterator]() {
        for (const key of entries) {
          yield key;
        }
      },
    });
  }

  put(key: string, value: V): AsyncResult<void, UnexpectedError> {
    this.#values.set(key, value);
    return AsyncResult.ok(undefined);
  }
}

function sessionStorageFromKV(sessionKV: InMemoryKV<Session>) {
  return {
    async getOneBySessionKey(sessionKey: string): Promise<Session | undefined> {
      const entry = await sessionKV.get(sessionKey).take();
      return isErr(entry) ? undefined : entry.value;
    },
  };
}

async function createTestContractStore() {
  const store = new ContractStore();
  const validated = await store.validate(testClientContract());
  store.activate(validated.digest, validated.contract);
  return { store, validated };
}

function testClientContract(
  description = "Example browser client contract",
  kind: "app" | "agent" | "service" | "device" = "app",
) {
  return {
    format: "trellis.contract.v1",
    id: "client.example@v1",
    displayName: "Example Client",
    description,
    kind,
    schemas: {
      JobPayload: { type: "object" },
      DeploymentState: { type: "object" },
    },
    jobs: {
      process: {
        payload: { schema: "JobPayload" },
      },
    },
    resources: {
      kv: {
        deployment: {
          purpose: "Store deployment state",
          schema: { schema: "DeploymentState" },
        },
      },
    },
  };
}

async function signClientBootstrapProof(
  sessionSeed: string,
  iat: number,
): Promise<string> {
  const auth = await createAuth({ sessionKeySeed: sessionSeed });
  const digest = await sha256(utf8(`bootstrap-client:${String(iat)}`));
  const sigBytes = await auth.sign(digest);
  return base64urlEncode(sigBytes);
}

async function createVerifiedApp(args?: {
  activateContract?: boolean;
  contract?: ReturnType<typeof testClientContract>;
  nowSeconds?: number;
  userProjection?: UserProjectionEntry;
}) {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const store = new ContractStore();
  const validated = await store.validate(
    args?.contract ?? testClientContract(),
  );
  const contractStore = new ContractStore();
  if (args?.activateContract !== false) {
    contractStore.activate(validated.digest, validated.contract);
  } else {
    contractStore.add(validated.digest, validated.contract);
  }

  const sessionKV = new InMemoryKV<Session>();
  const usersKV = new InMemoryKV<UserProjectionEntry>();
  const sentinel: SentinelCreds = { jwt: "jwt", seed: "seed" };

  sessionKV.seed(auth.sessionKey, {
    type: "user",
    participantKind: "app",
    trellisId: "user-1",
    origin: "github",
    id: "123",
    email: "user@example.com",
    name: "Example User",
    contractDigest: validated.digest,
    contractId: validated.contract.id,
    contractDisplayName: validated.contract.displayName,
    contractDescription: validated.contract.description,
    delegatedCapabilities: ["read:deployment"],
    delegatedPublishSubjects: ["events.deployment.updated"],
    delegatedSubscribeSubjects: ["events.deployment.*"],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastAuth: new Date("2026-01-01T00:01:00.000Z"),
  });
  usersKV.seed(
    "user-1",
    args?.userProjection ?? {
      origin: "github",
      id: "123",
      name: "Example User",
      email: "user@example.com",
      active: true,
      capabilities: ["read:deployment"],
    },
  );

  const app = new Hono();
  app.post(
    "/bootstrap/client",
    createClientBootstrapHandler({
      contractStore,
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      sentinel,
      sessionStorage: sessionStorageFromKV(sessionKV),
      loadUserProjection: async (trellisId) =>
        usersKV.getValue(trellisId) ?? null,
      loadStoredApproval: async () => ({
        userTrellisId: "user-1",
        origin: "github",
        id: "123",
        answer: "approved",
        answeredAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        approval: {
          contractDigest: validated.digest,
          contractId: validated.contract.id,
          displayName: validated.contract.displayName,
          description: validated.contract.description,
          participantKind: "app",
          capabilities: ["read:deployment"],
        },
        publishSubjects: ["events.deployment.updated"],
        subscribeSubjects: ["events.deployment.*"],
      }),
      loadInstanceGrantPolicies: async () => [],
      verifyIdentityProof: async ({ sessionKey, iat, sig }) =>
        sessionKey === auth.sessionKey &&
        sig === await signClientBootstrapProof(TEST_SEED, iat),
      nowSeconds: () => args?.nowSeconds ?? TEST_IAT,
    }),
  );

  return { app, auth, contract: validated };
}

Deno.test("POST /bootstrap/client returns runtime bootstrap info for bound browser sessions", async () => {
  const { app, auth, contract } = await createVerifiedApp();
  const response = await app.request("http://trellis/bootstrap/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      iat: TEST_IAT,
      sig: await signClientBootstrapProof(TEST_SEED, TEST_IAT),
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ready",
    serverNow: TEST_IAT,
    connectInfo: {
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      transport: {
        inboxPrefix: `_INBOX.${auth.sessionKey.slice(0, 16)}`,
        sentinel: { jwt: "jwt", seed: "seed" },
      },
    },
    contract: {
      id: contract.contract.id,
      digest: contract.digest,
      displayName: contract.contract.displayName,
      description: contract.contract.description,
      jobs: contract.contract.jobs,
      resources: contract.contract.resources,
    },
    user: {
      trellisId: "user-1",
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "Example User",
    },
    binding: {
      contractId: contract.contract.id,
      digest: contract.digest,
      capabilities: ["read:deployment"],
      publishSubjects: ["events.deployment.updated"],
      subscribeSubjects: ["events.deployment.*"],
    },
  });
});

Deno.test("POST /bootstrap/client accepts the exact session digest when multiple digests share a contract id", async () => {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const contractStore = new ContractStore();
  const first = await contractStore.validate(
    testClientContract("First revision"),
  );
  const second = await contractStore.validate(
    testClientContract("Second revision"),
  );
  const [otherContract, sessionContract] = [first, second].sort((left, right) =>
    left.digest.localeCompare(right.digest)
  );
  contractStore.activate(otherContract.digest, otherContract.contract);
  contractStore.activate(sessionContract.digest, sessionContract.contract);

  const sessionKV = new InMemoryKV<Session>();
  const usersKV = new InMemoryKV<UserProjectionEntry>();
  sessionKV.seed(auth.sessionKey, {
    type: "user",
    participantKind: "app",
    trellisId: "user-1",
    origin: "github",
    id: "123",
    email: "user@example.com",
    name: "Example User",
    contractDigest: sessionContract.digest,
    contractId: sessionContract.contract.id,
    contractDisplayName: sessionContract.contract.displayName,
    contractDescription: sessionContract.contract.description,
    delegatedCapabilities: ["read:deployment"],
    delegatedPublishSubjects: ["events.deployment.updated"],
    delegatedSubscribeSubjects: ["events.deployment.*"],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastAuth: new Date("2026-01-01T00:01:00.000Z"),
  });
  usersKV.seed("user-1", {
    origin: "github",
    id: "123",
    name: "Example User",
    email: "user@example.com",
    active: true,
    capabilities: ["read:deployment"],
  });

  const app = new Hono();
  app.post(
    "/bootstrap/client",
    createClientBootstrapHandler({
      contractStore,
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      sentinel: { jwt: "jwt", seed: "seed" },
      sessionStorage: sessionStorageFromKV(sessionKV),
      loadUserProjection: async (trellisId) =>
        usersKV.getValue(trellisId) ?? null,
      loadStoredApproval: async () => ({
        userTrellisId: "user-1",
        origin: "github",
        id: "123",
        answer: "approved",
        answeredAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        approval: {
          contractDigest: sessionContract.digest,
          contractId: sessionContract.contract.id,
          displayName: sessionContract.contract.displayName,
          description: sessionContract.contract.description,
          participantKind: "app",
          capabilities: ["read:deployment"],
        },
        publishSubjects: ["events.deployment.updated"],
        subscribeSubjects: ["events.deployment.*"],
      }),
      loadInstanceGrantPolicies: async () => [],
      verifyIdentityProof: async ({ sessionKey, iat, sig }) =>
        sessionKey === auth.sessionKey &&
        sig === await signClientBootstrapProof(TEST_SEED, iat),
      nowSeconds: () => TEST_IAT,
    }),
  );

  const response = await app.request("http://trellis/bootstrap/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      iat: TEST_IAT,
      sig: await signClientBootstrapProof(TEST_SEED, TEST_IAT),
    }),
  });

  const payload = await response.json();
  assertEquals(response.status, 200);
  assertEquals(payload.status, "ready");
  assertEquals(payload.connectInfo.contractDigest, sessionContract.digest);
});

Deno.test("POST /bootstrap/client returns auth_required when no bound user session exists", async () => {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const { validated } = await createTestContractStore();
  const contractStore = new ContractStore();
  contractStore.activate(validated.digest, validated.contract);

  const app = new Hono();
  app.post(
    "/bootstrap/client",
    createClientBootstrapHandler({
      contractStore,
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      sentinel: { jwt: "jwt", seed: "seed" },
      sessionStorage: sessionStorageFromKV(new InMemoryKV<Session>()),
      loadUserProjection: async () => null,
      loadStoredApproval: async () => null,
      loadInstanceGrantPolicies: async () => [],
      verifyIdentityProof: async ({ sessionKey, iat, sig }) =>
        sessionKey === auth.sessionKey &&
        sig === await signClientBootstrapProof(TEST_SEED, iat),
      nowSeconds: () => TEST_IAT,
    }),
  );

  const response = await app.request("http://trellis/bootstrap/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      iat: TEST_IAT,
      sig: await signClientBootstrapProof(TEST_SEED, TEST_IAT),
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "auth_required",
    serverNow: TEST_IAT,
  });
});

Deno.test("POST /bootstrap/client returns not_ready when the bound user is inactive", async () => {
  const { app, auth } = await createVerifiedApp({
    userProjection: {
      origin: "github",
      id: "123",
      name: "Example User",
      email: "user@example.com",
      active: false,
      capabilities: ["read:deployment"],
    },
  });

  const response = await app.request("http://trellis/bootstrap/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      iat: TEST_IAT,
      sig: await signClientBootstrapProof(TEST_SEED, TEST_IAT),
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "not_ready",
    reason: "user_inactive",
    serverNow: TEST_IAT,
  });
});

Deno.test("POST /bootstrap/client returns not_ready for known non-client contracts", async () => {
  const { app, auth } = await createVerifiedApp({
    contract: testClientContract("Example service contract", "service"),
  });

  const response = await app.request("http://trellis/bootstrap/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      iat: TEST_IAT,
      sig: await signClientBootstrapProof(TEST_SEED, TEST_IAT),
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "not_ready",
    reason: "contract_not_active",
    serverNow: TEST_IAT,
  });
});

Deno.test("POST /bootstrap/client returns serverNow when bootstrap proof iat is out of range", async () => {
  const { app, auth } = await createVerifiedApp({ nowSeconds: TEST_IAT + 31 });
  const response = await app.request("http://trellis/bootstrap/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      iat: TEST_IAT,
      sig: await signClientBootstrapProof(TEST_SEED, TEST_IAT),
    }),
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    reason: "iat_out_of_range",
    serverNow: TEST_IAT + 31,
  });
});

Deno.test("POST /bootstrap/client rejects invalid bootstrap signatures", async () => {
  const { app, auth } = await createVerifiedApp();
  const validSig = await signClientBootstrapProof(TEST_SEED, TEST_IAT);
  const invalidSig = `${validSig.slice(0, -1)}${
    validSig.endsWith("A") ? "B" : "A"
  }`;
  const response = await app.request("http://trellis/bootstrap/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      iat: TEST_IAT,
      sig: invalidSig,
    }),
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { reason: "invalid_signature" });
});

Deno.test("POST /bootstrap/client accepts a known app contract digest that is not active", async () => {
  const { app, auth, contract } = await createVerifiedApp({
    activateContract: false,
  });
  const response = await app.request("http://trellis/bootstrap/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      iat: TEST_IAT,
      sig: await signClientBootstrapProof(TEST_SEED, TEST_IAT),
    }),
  });

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.status, "ready");
  assertEquals(payload.connectInfo.contractDigest, contract.digest);
  assertEquals(payload.contract.id, contract.contract.id);
});
