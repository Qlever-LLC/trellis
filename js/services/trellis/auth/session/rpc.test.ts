import { assert, assertEquals } from "@std/assert";
import { isErr, Result, UnexpectedError } from "@qlever-llc/result";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import Value from "typebox/value";

import { AuthMeResponseSchema } from "@qlever-llc/trellis/auth";
import { createAuthMeHandler } from "./me.ts";
import {
  createAuthListConnectionsHandler,
  createAuthListSessionsHandler,
} from "./listing.ts";
import { createAuthRevokeSessionHandler } from "./revoke.ts";
import type { ServiceRegistryEntry, Session, UserProjectionEntry } from "../../state/schemas.ts";

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

  async keys(filter: string): Promise<Result<AsyncIterable<string>, UnexpectedError>> {
    async function* iter(store: Map<string, V>) {
      for (const key of store.keys()) {
        if (matchFilter(filter, key)) yield key;
      }
    }

    return Result.ok(iter(this.#store));
  }

  async get(key: string): Promise<Result<{ value: V }, UnexpectedError>> {
    const value = this.#store.get(key);
    if (value === undefined) {
      return Result.err(new UnexpectedError({ context: { key } }));
    }
    return Result.ok({ value });
  }

  async put(key: string, value: V): Promise<Result<void, UnexpectedError>> {
    this.#store.set(key, value);
    return Result.ok(undefined);
  }

  async delete(key: string): Promise<Result<void, UnexpectedError>> {
    this.#store.delete(key);
    return Result.ok(undefined);
  }
}

function baseSessionFields() {
  return {
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    lastAuth: new Date("2026-04-10T00:00:00.000Z"),
  };
}

Deno.test("Auth.Me returns user, device, and service envelopes", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const usersKV = new InMemoryKV<UserProjectionEntry>();
  const servicesKV = new InMemoryKV<ServiceRegistryEntry>();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    activatedBy?: { origin: string; id: string };
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const deviceProfilesKV = new InMemoryKV<{ profileId: string; disabled: boolean }>();

  const handler = createAuthMeHandler({
    sessionKV,
    usersKV,
    servicesKV,
    deviceActivationsKV,
    deviceProfilesKV,
  });

  const userTrellisId = await trellisIdFromOriginId("github", "123");
  usersKV.seed(userTrellisId, {
    origin: "github",
    id: "123",
    name: "Ada",
    email: "ada@example.com",
    active: true,
    capabilities: ["users.read"],
  });

  const userSessionKey = "sk_user";
  sessionKV.seed(`${userSessionKey}.${userTrellisId}`, {
    type: "user",
    trellisId: userTrellisId,
    origin: "github",
    id: "123",
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

  const userResult = await handler({}, { sessionKey: userSessionKey, caller: undefined });
  const userValue = userResult.take();
  if (isErr(userValue)) throw userValue.error;
  assert(Value.Check(AuthMeResponseSchema, userValue));
  assertEquals(userValue, {
    participantKind: "app",
    user: {
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["users.read"],
      lastLogin: "2026-04-10T00:00:00.000Z",
    },
    device: null,
    service: null,
  });

  const deviceSessionKey = "sk_device";
  sessionKV.seed(`${deviceSessionKey}.dev_1`, {
    type: "device",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "reader.default",
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
    profileId: "reader.default",
    activatedBy: { origin: "github", id: "123" },
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  deviceProfilesKV.seed("reader.default", {
    profileId: "reader.default",
    disabled: false,
  });

  const deviceResult = await handler({}, { sessionKey: deviceSessionKey, caller: undefined });
  const deviceValue = deviceResult.take();
  if (isErr(deviceValue)) throw deviceValue.error;
  assertEquals(deviceValue, {
    participantKind: "device",
    user: {
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["users.read"],
    },
    device: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "reader",
      runtimePublicKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["device.sync"],
    },
    service: null,
  });

  const serviceSessionKey = "sk_service";
  sessionKV.seed(`${serviceSessionKey}.svc_1`, {
    type: "service",
    trellisId: "svc_1",
    origin: "service",
    id: "billing",
    email: "billing@trellis.internal",
    name: "Billing",
    instanceId: "svc_1",
    profileId: "billing.default",
    instanceKey: serviceSessionKey,
    currentContractId: null,
    currentContractDigest: null,
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
  });
  servicesKV.seed(serviceSessionKey, {
    displayName: "Billing",
    active: true,
    capabilities: ["service"],
    description: "Billing service",
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
  });

  const serviceResult = await handler({}, { sessionKey: serviceSessionKey, caller: undefined });
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

Deno.test("Auth.Me falls back to validated caller context for user sessions", async () => {
  const handler = createAuthMeHandler({
    sessionKV: new InMemoryKV<Session>(),
    usersKV: new InMemoryKV<UserProjectionEntry>(),
    servicesKV: new InMemoryKV<ServiceRegistryEntry>(),
      deviceActivationsKV: new InMemoryKV<{
      instanceId: string;
      publicIdentityKey: string;
      profileId: string;
      activatedBy?: { origin: string; id: string };
      state: "activated" | "revoked";
      activatedAt: string;
      revokedAt: string | null;
    }>(),
      deviceProfilesKV: new InMemoryKV<{ profileId: string; disabled: boolean }>(),
  });

  const result = await handler({}, {
    sessionKey: "missing",
    caller: {
      type: "user",
      trellisId: "tid_123",
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["admin"],
    },
  });
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, {
    participantKind: "app",
    user: {
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["admin"],
    },
      device: null,
    service: null,
  });
});

Deno.test("Auth.Me falls back to device activation context for device sessions", async () => {
  const usersKV = new InMemoryKV<UserProjectionEntry>();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    activatedBy?: { origin: string; id: string };
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const deviceProfilesKV = new InMemoryKV<{ profileId: string; disabled: boolean }>();

  const handler = createAuthMeHandler({
    sessionKV: new InMemoryKV<Session>(),
    usersKV,
    servicesKV: new InMemoryKV<ServiceRegistryEntry>(),
    deviceActivationsKV,
    deviceProfilesKV,
  });

  const userTrellisId = await trellisIdFromOriginId("github", "123");
  usersKV.seed(userTrellisId, {
    origin: "github",
    id: "123",
    name: "Ada",
    email: "ada@example.com",
    active: true,
    capabilities: ["users.read"],
  });
  deviceActivationsKV.seed("dev_1", {
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "reader.default",
    activatedBy: { origin: "github", id: "123" },
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  deviceProfilesKV.seed("reader.default", {
    profileId: "reader.default",
    disabled: false,
  });

  const result = await handler({}, {
    sessionKey: "missing",
    caller: {
      type: "device",
      deviceId: "dev_1",
      runtimePublicKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["device.sync"],
    },
  });
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, {
    participantKind: "device",
    user: {
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["users.read"],
    },
    device: {
      type: "device",
      deviceId: "dev_1",
      deviceType: "reader",
      runtimePublicKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["device.sync"],
    },
    service: null,
  });
});

Deno.test("Auth.ListSessions returns explicit participant metadata for app, agent, device, and service sessions", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const userTrellisId = await trellisIdFromOriginId("github", "123");

  sessionKV.seed(`sk_app.${userTrellisId}`, {
    type: "user",
    trellisId: userTrellisId,
    origin: "github",
    id: "123",
    email: "ada@example.com",
    name: "Ada",
    participantKind: "app",
    contractDigest: "digest-app",
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    contractDescription: "Admin app",
    app: { contractId: "trellis.console@v1", origin: "https://console.example.com" },
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    ...baseSessionFields(),
  });
  sessionKV.seed(`sk_agent.${userTrellisId}`, {
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
    app: { contractId: "trellis.agent@v1", origin: "https://agent.example.com" },
    delegatedCapabilities: ["jobs.read"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    ...baseSessionFields(),
  });
  sessionKV.seed("sk_device.dev_1", {
    type: "device",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "reader.default",
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
  sessionKV.seed("sk_service.svc_1", {
    type: "service",
    trellisId: "svc_1",
    origin: "service",
    id: "billing",
    email: "billing@trellis.internal",
    name: "Billing",
    instanceId: "svc_1",
    profileId: "billing.default",
    instanceKey: "sk_service",
    currentContractId: null,
    currentContractDigest: null,
    ...baseSessionFields(),
  });

  const handler = createAuthListSessionsHandler({ sessionKV });
  const result = await handler({});
  const value = result.take();
  if (isErr(value)) throw value.error;

  const sessionsByKey = new Map(value.sessions.map((session) => [session.key, session]));
  assertEquals(new Set(sessionsByKey.keys()), new Set([
    "github.123.sk_app",
    "github.123.sk_agent",
    `dev_1.${"A".repeat(43)}.sk_device`,
    "service.billing.sk_service",
  ]));
  assertEquals(sessionsByKey.get("github.123.sk_app"), {
    key: "github.123.sk_app",
    sessionKey: "sk_app",
    participantKind: "app",
    principal: {
      type: "user",
      trellisId: userTrellisId,
      origin: "github",
      id: "123",
      name: "Ada",
    },
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    appOrigin: "https://console.example.com",
    createdAt: "2026-04-10T00:00:00.000Z",
    lastAuth: "2026-04-10T00:00:00.000Z",
  });
  assertEquals(sessionsByKey.get("github.123.sk_agent")?.participantKind, "agent");
  assertEquals(sessionsByKey.get(`dev_1.${"A".repeat(43)}.sk_device`)?.participantKind, "device");
  assertEquals(sessionsByKey.get("service.billing.sk_service")?.participantKind, "service");
});

Deno.test("Auth.ListConnections returns explicit participant metadata for user sessions", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<{ serverId: string; clientId: number; connectedAt: Date }>();
  const userTrellisId = await trellisIdFromOriginId("github", "123");

  sessionKV.seed(`sk_agent.${userTrellisId}`, {
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
    app: { contractId: "trellis.agent@v1", origin: "https://agent.example.com" },
    delegatedCapabilities: ["jobs.read"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    ...baseSessionFields(),
  });
  connectionsKV.seed(`sk_agent.${userTrellisId}.user_nkey`, {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-10T00:00:00.000Z"),
  });

  const handler = createAuthListConnectionsHandler({ sessionKV, connectionsKV });
  const result = await handler({});
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value.connections, [
    {
      key: "github.123.sk_agent.user_nkey",
      userNkey: "user_nkey",
      sessionKey: "sk_agent",
      participantKind: "agent",
      principal: {
        type: "user",
        trellisId: userTrellisId,
        origin: "github",
        id: "123",
        name: "Ada",
      },
      contractId: "trellis.agent@v1",
      contractDisplayName: "Trellis Agent",
      appOrigin: "https://agent.example.com",
      serverId: "n1",
      clientId: 7,
      connectedAt: "2026-04-10T00:00:00.000Z",
    },
  ]);
});

Deno.test("Auth.RevokeSession cascades agent revocation to the grant and sibling agent sessions", async () => {
  const userTrellisId = await trellisIdFromOriginId("github", "123");
  const contractApprovalsKV = new InMemoryKV<{
    userTrellisId: string;
    origin: string;
    id: string;
    answer: "approved" | "denied";
    answeredAt: Date;
    updatedAt: Date;
    approval: {
      contractDigest: string;
      contractId: string;
      displayName: string;
      description: string;
      participantKind: "app" | "agent";
      capabilities: string[];
    };
    publishSubjects: string[];
    subscribeSubjects: string[];
  }>();
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<{ serverId: string; clientId: number; connectedAt: Date }>();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const revoked: Array<{ origin: string; id: string; sessionKey: string; revokedBy: string }> = [];

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

  sessionKV.seed(`sk_agent_1.${userTrellisId}`, {
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
    ...baseSessionFields(),
  });
  sessionKV.seed(`sk_agent_2.${userTrellisId}`, {
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
    ...baseSessionFields(),
  });
  sessionKV.seed(`sk_app.${userTrellisId}`, {
    type: "user",
    trellisId: userTrellisId,
    origin: "github",
    id: "123",
    email: "ada@example.com",
    name: "Ada",
    participantKind: "app",
    contractDigest: "digest-app",
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    contractDescription: "Admin app",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    ...baseSessionFields(),
  });

  connectionsKV.seed(`sk_agent_1.${userTrellisId}.user_nkey_1`, {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });
  connectionsKV.seed(`sk_agent_2.${userTrellisId}.user_nkey_2`, {
    serverId: "n2",
    clientId: 8,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });
  connectionsKV.seed(`sk_app.${userTrellisId}.user_nkey_3`, {
    serverId: "n3",
    clientId: 9,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthRevokeSessionHandler({
    sessionKV,
    connectionsKV,
    contractApprovalsKV,
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
        trellisId: userTrellisId,
        origin: "github",
        id: "123",
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
    { origin: "github", id: "123", sessionKey: "sk_agent_1", revokedBy: "github.123" },
    { origin: "github", id: "123", sessionKey: "sk_agent_2", revokedBy: "github.123" },
  ]);
  assertEquals(isErr(await contractApprovalsKV.get(`${userTrellisId}.digest-agent`).take()), true);
  assertEquals(isErr(await sessionKV.get(`sk_agent_1.${userTrellisId}`).take()), true);
  assertEquals(isErr(await sessionKV.get(`sk_agent_2.${userTrellisId}`).take()), true);
  assertEquals(isErr(await connectionsKV.get(`sk_agent_1.${userTrellisId}.user_nkey_1`).take()), true);
  assertEquals(isErr(await connectionsKV.get(`sk_agent_2.${userTrellisId}.user_nkey_2`).take()), true);
  assertEquals(isErr(await sessionKV.get(`sk_app.${userTrellisId}`).take()), false);
  assertEquals(isErr(await connectionsKV.get(`sk_app.${userTrellisId}.user_nkey_3`).take()), false);
});

Deno.test("Auth.RevokeSession cascades app revocation to the grant and sibling user sessions", async () => {
  const userTrellisId = await trellisIdFromOriginId("github", "123");
  const contractApprovalsKV = new InMemoryKV<{
    userTrellisId: string;
    origin: string;
    id: string;
    answer: "approved" | "denied";
    answeredAt: Date;
    updatedAt: Date;
    approval: {
      contractDigest: string;
      contractId: string;
      displayName: string;
      description: string;
      participantKind: "app" | "agent";
      capabilities: string[];
    };
    publishSubjects: string[];
    subscribeSubjects: string[];
  }>();
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<{ serverId: string; clientId: number; connectedAt: Date }>();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const serviceInstancesKV = new InMemoryKV<{
    instanceId: string;
    profileId: string;
    instanceKey: string;
    disabled: boolean;
    capabilities: string[];
    createdAt: string;
  }>();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const revoked: Array<{ origin: string; id: string; sessionKey: string; revokedBy: string }> = [];

  contractApprovalsKV.seed(`${userTrellisId}.digest-app`, {
    userTrellisId,
    origin: "github",
    id: "123",
    answer: "approved",
    answeredAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-11T00:00:00.000Z"),
    approval: {
      contractDigest: "digest-app",
      contractId: "trellis.console@v1",
      displayName: "Console",
      description: "Admin app",
      participantKind: "app",
      capabilities: ["admin"],
    },
    publishSubjects: [],
    subscribeSubjects: [],
  });

  sessionKV.seed(`sk_app_1.${userTrellisId}`, {
    type: "user",
    trellisId: userTrellisId,
    origin: "github",
    id: "123",
    email: "ada@example.com",
    name: "Ada",
    participantKind: "app",
    contractDigest: "digest-app",
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    contractDescription: "Admin app",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    ...baseSessionFields(),
  });
  sessionKV.seed(`sk_app_2.${userTrellisId}`, {
    type: "user",
    trellisId: userTrellisId,
    origin: "github",
    id: "123",
    email: "ada@example.com",
    name: "Ada",
    participantKind: "app",
    contractDigest: "digest-app",
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    contractDescription: "Admin app",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    ...baseSessionFields(),
  });
  sessionKV.seed(`sk_agent.${userTrellisId}`, {
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
    ...baseSessionFields(),
  });

  connectionsKV.seed(`sk_app_1.${userTrellisId}.user_nkey_1`, {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });
  connectionsKV.seed(`sk_app_2.${userTrellisId}.user_nkey_2`, {
    serverId: "n2",
    clientId: 8,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });
  connectionsKV.seed(`sk_agent.${userTrellisId}.user_nkey_3`, {
    serverId: "n3",
    clientId: 9,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthRevokeSessionHandler({
    sessionKV,
    connectionsKV,
    contractApprovalsKV,
    deviceActivationsKV,
    serviceInstancesKV,
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
        trellisId: userTrellisId,
        origin: "github",
        id: "123",
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
    { origin: "github", id: "123", sessionKey: "sk_app_1", revokedBy: "github.123" },
    { origin: "github", id: "123", sessionKey: "sk_app_2", revokedBy: "github.123" },
  ]);
  assertEquals(isErr(await contractApprovalsKV.get(`${userTrellisId}.digest-app`).take()), true);
  assertEquals(isErr(await sessionKV.get(`sk_app_1.${userTrellisId}`).take()), true);
  assertEquals(isErr(await sessionKV.get(`sk_app_2.${userTrellisId}`).take()), true);
  assertEquals(isErr(await sessionKV.get(`sk_agent.${userTrellisId}`).take()), false);
});

Deno.test("Auth.RevokeSession revokes device activation so the device cannot reconnect", async () => {
  const contractApprovalsKV = new InMemoryKV<{
    userTrellisId: string;
    origin: string;
    id: string;
    answer: "approved" | "denied";
    answeredAt: Date;
    updatedAt: Date;
    approval: {
      contractDigest: string;
      contractId: string;
      displayName: string;
      description: string;
      participantKind: "app" | "agent";
      capabilities: string[];
    };
    publishSubjects: string[];
    subscribeSubjects: string[];
  }>();
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<{ serverId: string; clientId: number; connectedAt: Date }>();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const serviceInstancesKV = new InMemoryKV<{
    instanceId: string;
    profileId: string;
    instanceKey: string;
    disabled: boolean;
    capabilities: string[];
    createdAt: string;
  }>();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const revoked: Array<{ origin: string; id: string; sessionKey: string; revokedBy: string }> = [];

  sessionKV.seed("sk_device.dev_1", {
    type: "device",
    instanceId: "dev_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "reader.default",
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
    profileId: "reader.default",
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  connectionsKV.seed("sk_device.dev_1.user_nkey", {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthRevokeSessionHandler({
    sessionKV,
    connectionsKV,
    contractApprovalsKV,
    deviceActivationsKV,
    serviceInstancesKV,
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
        trellisId: "user-1",
        origin: "github",
        id: "123",
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
  assertEquals(isErr(await sessionKV.get("sk_device.dev_1").take()), true);
});

Deno.test("Auth.RevokeSession disables the service instance so it cannot reconnect", async () => {
  const contractApprovalsKV = new InMemoryKV<{
    userTrellisId: string;
    origin: string;
    id: string;
    answer: "approved" | "denied";
    answeredAt: Date;
    updatedAt: Date;
    approval: {
      contractDigest: string;
      contractId: string;
      displayName: string;
      description: string;
      participantKind: "app" | "agent";
      capabilities: string[];
    };
    publishSubjects: string[];
    subscribeSubjects: string[];
  }>();
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<{ serverId: string; clientId: number; connectedAt: Date }>();
  const deviceActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const serviceInstancesKV = new InMemoryKV<{
    instanceId: string;
    profileId: string;
    instanceKey: string;
    disabled: boolean;
    capabilities: string[];
    createdAt: string;
  }>();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const revoked: Array<{ origin: string; id: string; sessionKey: string; revokedBy: string }> = [];

  sessionKV.seed("sk_service.svc_1", {
    type: "service",
    trellisId: "svc_1",
    origin: "service",
    id: "billing",
    email: "billing@trellis.internal",
    name: "Billing",
    instanceId: "svc_1",
    profileId: "billing.default",
    instanceKey: "sk_service",
    currentContractId: null,
    currentContractDigest: null,
    ...baseSessionFields(),
  });
  serviceInstancesKV.seed("svc_1", {
    instanceId: "svc_1",
    profileId: "billing.default",
    instanceKey: "sk_service",
    disabled: false,
    capabilities: ["service"],
    createdAt: "2026-04-10T00:00:00.000Z",
  });
  connectionsKV.seed("sk_service.svc_1.user_nkey", {
    serverId: "n1",
    clientId: 7,
    connectedAt: new Date("2026-04-11T00:00:00.000Z"),
  });

  const handler = createAuthRevokeSessionHandler({
    sessionKV,
    connectionsKV,
    contractApprovalsKV,
    deviceActivationsKV,
    serviceInstancesKV,
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
        trellisId: "user-1",
        origin: "github",
        id: "123",
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
    revokedBy: "github.123",
  }]);
  const serviceEntry = await serviceInstancesKV.get("svc_1").take();
  if (isErr(serviceEntry)) throw serviceEntry.error;
  assertEquals(serviceEntry.value.disabled, true);
  assertEquals(isErr(await sessionKV.get("sk_service.svc_1").take()), true);
});
