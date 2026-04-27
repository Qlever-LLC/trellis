import { assertEquals } from "@std/assert";
import {
  AsyncResult,
  isErr,
  Result,
  UnexpectedError,
} from "@qlever-llc/result";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";

import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../../storage/db.ts";
import type { TrellisStorage } from "../../storage/db.ts";
import { SqlContractApprovalRepository } from "../storage.ts";
import {
  createAuthListUserGrantsHandler,
  createAuthRevokeUserGrantHandler,
} from "./user_grants.ts";
import { connectionKey } from "../session/connections.ts";
import type {
  Connection,
  ContractApprovalRecord,
  Session,
} from "../../state/schemas.ts";

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
      trellisId: string;
      session: Session;
    }>;
    if (isErr(iter)) return result;
    for await (const key of iter) {
      const entry = await kv.get(key).take();
      if (isErr(entry)) continue;
      const session = entry.value;
      const trellisId = session.type === "user" ? session.trellisId : "";
      if (!key || !trellisId) continue;
      result.push({ sessionKey: key, trellisId, session });
    }
    return result;
  }

  return {
    listEntriesByUser: async (trellisId: string) =>
      (await entries(">")).filter((entry) => entry.trellisId === trellisId),
    deleteBySessionKey: async (sessionKey: string) => {
      await kv.delete(sessionKey).take();
    },
  };
}

async function withApprovalRepository(
  test: (
    approvals: SqlContractApprovalRepository,
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
    await test(new SqlContractApprovalRepository(storage.db), storage);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function makeApproval(
  userTrellisId: string,
  overrides: Partial<ContractApprovalRecord> = {},
): ContractApprovalRecord {
  return {
    userTrellisId,
    origin: "github",
    id: "123",
    answer: "approved",
    answeredAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-11T00:00:00.000Z"),
    approval: {
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      displayName: "Trellis Agent",
      description: "Local delegated tooling",
      participantKind: "agent",
      capabilities: ["jobs.read"],
    },
    publishSubjects: [],
    subscribeSubjects: [],
    ...overrides,
  };
}

Deno.test("Auth.ListUserGrants returns the caller's approved app and agent grants", async () => {
  await withApprovalRepository(async (contractApprovalStorage) => {
    const userTrellisId = await trellisIdFromOriginId("github", "123");
    await contractApprovalStorage.put(makeApproval(userTrellisId));
    await contractApprovalStorage.put(makeApproval(userTrellisId, {
      answer: "denied",
      approval: {
        contractDigest: "digest-denied",
        contractId: "trellis.console@v1",
        displayName: "Console",
        description: "Admin app",
        participantKind: "app",
        capabilities: ["admin"],
      },
    }));

    const handler = createAuthListUserGrantsHandler({
      contractApprovalStorage,
    });
    const result = await handler({
      context: {
        caller: {
          type: "user",
          trellisId: userTrellisId,
          origin: "github",
          id: "123",
        },
      },
    });
    const value = result.take();
    if (isErr(value)) throw value.error;

    assertEquals(value, {
      grants: [
        {
          contractDigest: "digest-agent",
          contractId: "trellis.agent@v1",
          displayName: "Trellis Agent",
          description: "Local delegated tooling",
          participantKind: "agent",
          capabilities: ["jobs.read"],
          grantedAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
      ],
    });
  });
});

Deno.test("Auth.RevokeUserGrant deletes the caller grant and matching user sessions", async () => {
  await withApprovalRepository(async (contractApprovalStorage) => {
    const userTrellisId = await trellisIdFromOriginId("github", "123");
    const sessionKV = new InMemoryKV<Session>();
    const connectionsKV = new InMemoryKV<Connection>();
    const kicked: Array<{ serverId: string; clientId: number }> = [];

    await contractApprovalStorage.put(makeApproval(userTrellisId));

    sessionKV.seed("sk_123", {
      type: "user",
      trellisId: userTrellisId,
      origin: "github",
      id: "123",
      email: "ada@example.com",
      name: "Ada",
      participantKind: "agent",
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

    const handler = createAuthRevokeUserGrantHandler({
      contractApprovalStorage,
      sessionStorage: sessionStorageFromKV(sessionKV),
      connectionsKV,
      kick: async (serverId, clientId) => {
        kicked.push({ serverId, clientId });
      },
      publishSessionRevoked: async () => {},
    });
    const result = await handler({
      input: { contractDigest: "digest-agent" },
      context: {
        caller: {
          type: "user",
          trellisId: userTrellisId,
          origin: "github",
          id: "123",
        },
      },
    });
    const value = result.take();
    if (isErr(value)) throw value.error;

    assertEquals(value, { success: true });
    assertEquals(kicked.length, 1);
    assertEquals(kicked[0], { serverId: "n1", clientId: 7 });
    assertEquals(
      await contractApprovalStorage.get(userTrellisId, "digest-agent"),
      undefined,
    );
    assertEquals(
      isErr(await sessionKV.get("sk_123").take()),
      true,
    );
  });
});
