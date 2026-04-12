import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { Result, UnexpectedError } from "@qlever-llc/result";
import {
  base64urlEncode,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth";

import { ContractStore } from "../../catalog/store.ts";
import type {
  BindingTokenRecord,
  SentinelCreds,
  Session,
  UserProjectionEntry,
} from "../../state/schemas.ts";
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

  async get(key: string): Promise<Result<{ value: V }, UnexpectedError>> {
    const value = this.#values.get(key);
    if (value === undefined) {
      return Result.err(new UnexpectedError({ context: { key } }));
    }
    return Result.ok({ value });
  }

  async keys(filter: string): Promise<Result<AsyncIterable<string>, UnexpectedError>> {
    const prefix = filter.endsWith(">") ? filter.slice(0, -1) : filter;
    const entries = [...this.#values.keys()].filter((key) => key.startsWith(prefix));
    return Result.ok({
      async *[Symbol.asyncIterator]() {
        for (const key of entries) {
          yield key;
        }
      },
    });
  }

  async put(key: string, value: V): Promise<Result<void, UnexpectedError>> {
    this.#values.set(key, value);
    return Result.ok(undefined);
  }
}

async function createTestContractStore() {
  const store = new ContractStore();
  const validated = await store.validate({
    format: "trellis.contract.v1",
    id: "client.example@v1",
    displayName: "Example Client",
    description: "Example browser client contract",
    kind: "app",
    resources: {
      kv: {
        profile: {
          purpose: "Store profile state",
        },
      },
    },
  });
  store.activate(validated.digest, validated.contract);
  return { store, validated };
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
  nowSeconds?: number;
  userProjection?: UserProjectionEntry;
}) {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const { validated } = await createTestContractStore();
  const contractStore = new ContractStore();
  if (args?.activateContract !== false) {
    contractStore.activate(validated.digest, validated.contract);
  }

  const sessionKV = new InMemoryKV<Session>();
  const usersKV = new InMemoryKV<UserProjectionEntry>();
  const servicesKV = new InMemoryKV<{ active: boolean; capabilities: string[]; displayName: string; description: string; createdAt: Date }>();
  const bindingTokenKV = new InMemoryKV<BindingTokenRecord>();
  const sentinel: SentinelCreds = { jwt: "jwt", seed: "seed" };

  sessionKV.seed(`${auth.sessionKey}.user-1`, {
    type: "user",
    trellisId: "user-1",
    origin: "github",
    id: "123",
    email: "user@example.com",
    name: "Example User",
    contractDigest: validated.digest,
    contractId: validated.contract.id,
    contractDisplayName: validated.contract.displayName,
    contractDescription: validated.contract.description,
    delegatedCapabilities: ["read:profile"],
    delegatedPublishSubjects: ["events.profile.updated"],
    delegatedSubscribeSubjects: ["events.profile.*"],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastAuth: new Date("2026-01-01T00:01:00.000Z"),
  });
  usersKV.seed("user-1", args?.userProjection ?? {
    origin: "github",
    id: "123",
    name: "Example User",
    email: "user@example.com",
    active: true,
    capabilities: ["read:profile"],
  });

  const app = new Hono();
  app.post("/bootstrap/client", createClientBootstrapHandler({
    contractStore,
    natsServers: ["nats://127.0.0.1:4222"],
    sentinel,
    sessionKV,
    usersKV,
    servicesKV,
    bindingTokenKV,
    hashKey: async (value) => `hash:${value}`,
    randomToken: () => "binding-token-1",
    verifyIdentityProof: async ({ sessionKey, iat, sig }) =>
      sessionKey === auth.sessionKey &&
      sig === await signClientBootstrapProof(TEST_SEED, iat),
    bindingTokenTtlMs: () => 60_000,
    now: () => new Date("2026-01-01T00:02:00.000Z"),
    nowSeconds: () => args?.nowSeconds ?? TEST_IAT,
  }));

  return { app, auth, contract: validated, bindingTokenKV };
}

Deno.test("POST /bootstrap/client returns runtime bootstrap info for bound browser sessions", async () => {
  const { app, auth, contract, bindingTokenKV } = await createVerifiedApp();
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
    connectInfo: {
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      transport: {
        natsServers: ["nats://127.0.0.1:4222"],
        inboxPrefix: `_INBOX.${auth.sessionKey.slice(0, 16)}`,
        sentinel: { jwt: "jwt", seed: "seed" },
      },
      auth: {
        mode: "binding_token",
        bindingToken: "binding-token-1",
        expiresAt: "2026-01-01T00:03:00.000Z",
      },
    },
    contract: {
      id: contract.contract.id,
      digest: contract.digest,
      displayName: contract.contract.displayName,
      description: contract.contract.description,
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
      capabilities: ["read:profile"],
      publishSubjects: ["events.profile.updated"],
      subscribeSubjects: ["events.profile.*"],
    },
  });
  assertEquals(bindingTokenKV.getValue("hash:binding-token-1"), {
    sessionKey: auth.sessionKey,
    kind: "renew",
    createdAt: new Date("2026-01-01T00:02:00.000Z"),
    expiresAt: new Date("2026-01-01T00:03:00.000Z"),
  });
});

Deno.test("POST /bootstrap/client returns auth_required when no bound user session exists", async () => {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const { validated } = await createTestContractStore();
  const contractStore = new ContractStore();
  contractStore.activate(validated.digest, validated.contract);

  const app = new Hono();
  app.post("/bootstrap/client", createClientBootstrapHandler({
    contractStore,
    natsServers: ["nats://127.0.0.1:4222"],
    sentinel: { jwt: "jwt", seed: "seed" },
    sessionKV: new InMemoryKV<Session>(),
    usersKV: new InMemoryKV<UserProjectionEntry>(),
    servicesKV: new InMemoryKV<{ active: boolean; capabilities: string[]; displayName: string; description: string; createdAt: Date }>(),
    bindingTokenKV: new InMemoryKV<BindingTokenRecord>(),
    hashKey: async (value) => `hash:${value}`,
    randomToken: () => "binding-token-1",
    verifyIdentityProof: async ({ sessionKey, iat, sig }) =>
      sessionKey === auth.sessionKey &&
      sig === await signClientBootstrapProof(TEST_SEED, iat),
    bindingTokenTtlMs: () => 60_000,
    now: () => new Date("2026-01-01T00:02:00.000Z"),
    nowSeconds: () => TEST_IAT,
  }));

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
  assertEquals(await response.json(), { status: "auth_required" });
});

Deno.test("POST /bootstrap/client returns not_ready when the bound user is inactive", async () => {
  const { app, auth } = await createVerifiedApp({
    userProjection: {
      origin: "github",
      id: "123",
      name: "Example User",
      email: "user@example.com",
      active: false,
      capabilities: ["read:profile"],
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
  });
});

Deno.test("POST /bootstrap/client falls back to session contract metadata when the contract is no longer active", async () => {
  const { app, auth, contract } = await createVerifiedApp({ activateContract: false });
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
    connectInfo: {
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      transport: {
        natsServers: ["nats://127.0.0.1:4222"],
        inboxPrefix: `_INBOX.${auth.sessionKey.slice(0, 16)}`,
        sentinel: { jwt: "jwt", seed: "seed" },
      },
      auth: {
        mode: "binding_token",
        bindingToken: "binding-token-1",
        expiresAt: "2026-01-01T00:03:00.000Z",
      },
    },
    contract: {
      id: contract.contract.id,
      digest: contract.digest,
      displayName: contract.contract.displayName,
      description: contract.contract.description,
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
      capabilities: ["read:profile"],
      publishSubjects: ["events.profile.updated"],
      subscribeSubjects: ["events.profile.*"],
    },
  });
});
