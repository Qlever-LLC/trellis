import { assertEquals } from "@std/assert";
import { isErr, Result, UnexpectedError } from "@qlever-llc/result";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";

import {
  createAuthListUserGrantsHandler,
  createAuthRevokeUserGrantHandler,
} from "./user_grants.ts";
import type { Connection, ContractApprovalRecord, Session } from "../../state/schemas.ts";

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

  async keys(filter: string): Promise<Result<AsyncIterable<string>, UnexpectedError>> {
    async function* iter(store: Map<string, V>, matches: (filter: string, key: string) => boolean, currentFilter: string) {
      for (const key of store.keys()) {
        if (matches(currentFilter, key)) yield key;
      }
    }

    return Result.ok(iter(this.#store, this.#matches.bind(this), filter));
  }

  async get(key: string): Promise<Result<{ value: V }, UnexpectedError>> {
    const value = this.#store.get(key);
    if (value === undefined) {
      return Result.err(new UnexpectedError({ context: { key } }));
    }
    return Result.ok({ value });
  }

  async delete(key: string): Promise<Result<void, UnexpectedError>> {
    this.#store.delete(key);
    return Result.ok(undefined);
  }
}

Deno.test("Auth.ListUserGrants returns the caller's approved app and agent grants", async () => {
  const userTrellisId = await trellisIdFromOriginId("github", "123");
  const contractApprovalsKV = new InMemoryKV<ContractApprovalRecord>();

  contractApprovalsKV.seed(`${userTrellisId}.digest-agent`, {
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
  });
  contractApprovalsKV.seed(`${userTrellisId}.digest-denied`, {
    userTrellisId,
    origin: "github",
    id: "123",
    answer: "denied",
    answeredAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-11T00:00:00.000Z"),
    approval: {
      contractDigest: "digest-denied",
      contractId: "trellis.console@v1",
      displayName: "Console",
      description: "Admin app",
      participantKind: "app",
      capabilities: ["admin"],
    },
    publishSubjects: [],
    subscribeSubjects: [],
  });

  const handler = createAuthListUserGrantsHandler({ contractApprovalsKV });
  const result = await handler({}, {
    caller: {
      type: "user",
      trellisId: userTrellisId,
      origin: "github",
      id: "123",
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

Deno.test("Auth.RevokeUserGrant deletes the caller grant and matching user sessions", async () => {
  const userTrellisId = await trellisIdFromOriginId("github", "123");
  const contractApprovalsKV = new InMemoryKV<ContractApprovalRecord>();
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<Connection>();
  const kicked: Array<{ serverId: string; clientId: number }> = [];

  contractApprovalsKV.seed(`${userTrellisId}.digest-agent`, {
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
  });

  sessionKV.seed(`sk_123.${userTrellisId}`, {
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
  connectionsKV.seed(`sk_123.${userTrellisId}.user_nkey`, {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthRevokeUserGrantHandler({
    contractApprovalsKV,
    sessionKV,
    connectionsKV,
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    publishSessionRevoked: async () => {},
  });
  const result = await handler(
    { contractDigest: "digest-agent" },
    {
      caller: {
        type: "user",
        trellisId: userTrellisId,
        origin: "github",
        id: "123",
      },
    },
  );
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, { success: true });
  assertEquals(kicked.length, 1);
  assertEquals(kicked[0], { serverId: "n1", clientId: 7 });
  assertEquals(isErr((await contractApprovalsKV.get(`${userTrellisId}.digest-agent`)).take()), true);
  assertEquals(isErr((await sessionKV.get(`sk_123.${userTrellisId}`)).take()), true);
});
