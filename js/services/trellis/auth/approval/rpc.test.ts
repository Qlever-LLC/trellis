import { assertEquals } from "@std/assert";
import {
  AsyncResult,
  isErr,
  Result,
  UnexpectedError,
} from "@qlever-llc/result";

import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../../storage/db.ts";
import type { TrellisStorage } from "../../storage/db.ts";
import { SqlIdentityGrantRepository } from "../storage/sessions_users_approvals.ts";
import { createAuthIdentityGrantsRevokeHandler } from "./rpc.ts";
import {
  createAuthIdentitiesGrantsListHandler,
  createUserGrantRevokeHandler,
} from "./user_grants.ts";
import { connectionKey } from "../session/connections.ts";
import type { Connection, IdentityGrantRecord, Session } from "../schemas.ts";

class InMemoryKV<V> {
  #store = new Map<string, V>();

  #matches(filter: string, key: string): boolean {
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

  seed(key: string, value: V): void {
    this.#store.set(key, value);
  }

  keys(filter: string) {
    async function* iter(
      store: Map<string, V>,
      matches: (filter: string, key: string) => boolean,
      currentFilter: string,
    ) {
      for (const key of store.keys()) {
        if (matches(currentFilter, key)) yield key;
      }
    }

    return AsyncResult.lift(
      Result.ok(iter(this.#store, this.#matches.bind(this), filter)),
    );
  }

  get(key: string) {
    const value = this.#store.get(key);
    if (value === undefined) {
      return AsyncResult.lift(
        Result.err(new UnexpectedError({ context: { key } })),
      );
    }
    return AsyncResult.lift(Result.ok({ value }));
  }

  delete(key: string) {
    this.#store.delete(key);
    return AsyncResult.lift(Result.ok(undefined));
  }
}

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
      const session = entry.value;
      const principalId = session.type === "user" ? session.userId : "";
      if (!key || !principalId) continue;
      result.push({ sessionKey: key, principalId, session });
    }
    return result;
  }

  return {
    listEntriesByUser: async (userId: string) =>
      (await entries(">")).filter((entry) => entry.principalId === userId),
    deleteBySessionKey: async (sessionKey: string) => {
      await kv.delete(sessionKey).take();
    },
  };
}

async function withApprovalRepository(
  test: (
    approvals: SqlIdentityGrantRepository,
    storage: TrellisStorage,
  ) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-approval-rpc-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await initializeTrellisStorageSchema(storage);
    await test(new SqlIdentityGrantRepository(storage.db), storage);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function makeApproval(
  userTrellisId: string,
  overrides: Partial<IdentityGrantRecord> = {},
): IdentityGrantRecord {
  const identityGrantId = overrides.identityGrantId ?? "env-agent";
  return {
    identityGrantId,
    identityAuthorityId: overrides.identityAuthorityId ?? "ida-github-123",
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
          description: "View job status.",
        },
      },
    },
    publishSubjects: [],
    subscribeSubjects: [],
    ...overrides,
  };
}

Deno.test("Auth.IdentityGrants.List returns the caller's approved app and agent grants", async () => {
  await withApprovalRepository(async (contractApprovalStorage) => {
    const userTrellisId = "usr_123";
    await contractApprovalStorage.put(makeApproval(userTrellisId));
    await contractApprovalStorage.put(makeApproval(userTrellisId, {
      identityGrantId: "env-denied",
      identityAnchor: {
        kind: "web",
        contractId: "trellis.console@v1",
        origin: "https://console.example",
      },
      answer: "denied",
      approvalEvidence: {
        contractDigest: "digest-denied",
        contractId: "trellis.console@v1",
        displayName: "Console",
        description: "Admin app",
        participantKind: "app",
        capabilities: {
          admin: {
            displayName: "Admin",
            description: "Use administrator actions.",
          },
        },
      },
    }));

    const handler = createAuthIdentitiesGrantsListHandler({
      contractApprovalStorage,
    });
    const result = await handler({
      input: { limit: 10 },
      context: {
        caller: {
          type: "user",
          userId: userTrellisId,
        },
      },
    });
    const value = result.take();
    if (isErr(value)) throw value.error;

    assertEquals(value, {
      entries: [
        {
          identityGrantId: "env-agent",
          identityAnchor: {
            kind: "cli",
            contractId: "trellis.agent@v1",
            sessionPublicKey: "session-agent",
          },
          contractEvidence: {
            contractDigest: "digest-agent",
            contractId: "trellis.agent@v1",
          },
          displayName: "Trellis Agent",
          description: "Local delegated tooling",
          participantKind: "agent",
          capabilities: ["jobs.read"],
          grantedAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
      ],
      count: 1,
      offset: 0,
      limit: 10,
      nextOffset: undefined,
    });
  });
});

Deno.test("Auth.IdentityGrants.Revoke deletes the caller grant and matching user sessions", async () => {
  await withApprovalRepository(async (contractApprovalStorage) => {
    const userTrellisId = "usr_123";
    const sessionKV = new InMemoryKV<Session>();
    const connectionsKV = new InMemoryKV<Connection>();
    const kicked: Array<{ serverId: string; clientId: number }> = [];

    await contractApprovalStorage.put(makeApproval(userTrellisId));

    sessionKV.seed("sk_123", {
      type: "user",
      userId: userTrellisId,
      identity: {
        identityId: "idn_github_123",
        provider: "github",
        subject: "123",
      },
      email: "ada@example.com",
      name: "Ada",
      participantKind: "agent",
      identityGrantId: "env-agent",
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      contractDisplayName: "Trellis Agent",
      contractDescription: "Local delegated tooling",
      delegatedCapabilities: ["jobs.read"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
      createdAt: new Date("2026-04-10T00:00:00.000Z"),
      lastAuth: new Date("2026-04-11T00:00:00.000Z"),
    });
    connectionsKV.seed(connectionKey("sk_123", userTrellisId, "user_nkey"), {
      serverId: "n1",
      clientId: 7,
      connectedAt: new Date("2026-04-11T00:00:00.000Z"),
    });

    const handler = createUserGrantRevokeHandler({
      contractApprovalStorage,
      sessionStorage: sessionStorageFromKV(sessionKV),
      connectionsKV,
      kick: async (serverId, clientId) => {
        kicked.push({ serverId, clientId });
      },
      publishSessionRevoked: async () => {},
    });
    const result = await handler({
      input: { identityGrantId: "env-agent" },
      context: {
        caller: {
          type: "user",
          userId: userTrellisId,
        },
      },
    });
    const value = result.take();
    if (isErr(value)) throw value.error;

    assertEquals(value, { success: true });
    assertEquals(kicked.length, 1);
    assertEquals(kicked[0], { serverId: "n1", clientId: 7 });
    assertEquals(
      await contractApprovalStorage.get("env-agent"),
      undefined,
    );
    assertEquals(
      isErr(await sessionKV.get("sk_123").take()),
      true,
    );
  });
});

Deno.test("Auth.IdentityGrants.Revoke deletes a self grant and matching user sessions", async () => {
  await withApprovalRepository(async (contractApprovalStorage) => {
    const userTrellisId = "usr_123";
    const sessionKV = new InMemoryKV<Session>();
    const connectionsKV = new InMemoryKV<Connection>();
    const kicked: Array<{ serverId: string; clientId: number }> = [];
    const revoked: Array<{
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    }> = [];

    await contractApprovalStorage.put(makeApproval(userTrellisId));
    sessionKV.seed("sk_approval", {
      type: "user",
      userId: userTrellisId,
      identity: {
        identityId: "idn_github_123",
        provider: "github",
        subject: "123",
      },
      email: "ada@example.com",
      name: "Ada",
      participantKind: "agent",
      identityGrantId: "env-agent",
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      contractDisplayName: "Trellis Agent",
      contractDescription: "Local delegated tooling",
      delegatedCapabilities: ["jobs.read"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
      createdAt: new Date("2026-04-10T00:00:00.000Z"),
      lastAuth: new Date("2026-04-11T00:00:00.000Z"),
    });
    connectionsKV.seed(
      connectionKey("sk_approval", userTrellisId, "user_nkey"),
      {
        serverId: "n1",
        clientId: 9,
        connectedAt: new Date("2026-04-11T00:00:00.000Z"),
      },
    );

    const handler = createAuthIdentityGrantsRevokeHandler({
      contractApprovalStorage,
      sessionStorage: sessionStorageFromKV(sessionKV),
      connectionsKV,
      kick: async (serverId, clientId) => {
        kicked.push({ serverId, clientId });
      },
      publishSessionRevoked: async (event) => {
        revoked.push(event);
      },
      logger: { trace: () => {}, warn: () => {} },
    });

    const result = await handler({
      input: { identityGrantId: "env-agent" },
      context: {
        caller: {
          type: "user",
          userId: userTrellisId,
        },
      },
    });
    const value = result.take();
    if (isErr(value)) throw value.error;

    assertEquals(value, { success: true });
    assertEquals(kicked, [{ serverId: "n1", clientId: 9 }]);
    assertEquals(revoked, [{
      origin: "github",
      id: "123",
      sessionKey: "sk_approval",
      revokedBy: "usr_123",
    }]);
    assertEquals(
      await contractApprovalStorage.get("env-agent"),
      undefined,
    );
    assertEquals(isErr(await sessionKV.get("sk_approval").take()), true);
    assertEquals(
      isErr(
        await connectionsKV.get(
          connectionKey("sk_approval", userTrellisId, "user_nkey"),
        ).take(),
      ),
      true,
    );
  });
});
