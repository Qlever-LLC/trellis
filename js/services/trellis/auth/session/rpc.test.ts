import { assert, assertEquals } from "@std/assert";
import { isErr, Result, UnexpectedError } from "@qlever-llc/result";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import Value from "typebox/value";

import { AuthMeResponseSchema } from "../../../../packages/auth/protocol.ts";
import { createAuthMeHandler } from "./me.ts";
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
}

function baseSessionFields() {
  return {
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    lastAuth: new Date("2026-04-10T00:00:00.000Z"),
  };
}

Deno.test("Auth.Me returns user, workload, and service envelopes", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const usersKV = new InMemoryKV<UserProjectionEntry>();
  const servicesKV = new InMemoryKV<ServiceRegistryEntry>();
  const workloadActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    activatedBy?: { origin: string; id: string };
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const workloadProfilesKV = new InMemoryKV<{ profileId: string; disabled: boolean }>();

  const handler = createAuthMeHandler({
    sessionKV,
    usersKV,
    servicesKV,
    workloadActivationsKV,
    workloadProfilesKV,
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
    contractDigest: "digest-a",
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    contractDescription: "Admin app",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    ...baseSessionFields(),
  });

  const userResult = await handler({}, { sessionKey: userSessionKey });
  const userValue = userResult.take();
  if (isErr(userValue)) throw userValue.error;
  assert(Value.Check(AuthMeResponseSchema, userValue));
  assertEquals(userValue, {
    user: {
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["users.read"],
      lastLogin: "2026-04-10T00:00:00.000Z",
    },
    workload: null,
    service: null,
  });

  const workloadSessionKey = "sk_workload";
  sessionKV.seed(`${workloadSessionKey}.wrk_1`, {
    type: "workload",
    instanceId: "wrk_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "reader.default",
    contractId: "trellis.reader@v1",
    contractDigest: "digest-w",
    delegatedCapabilities: ["workload.sync"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    createdAt: baseSessionFields().createdAt,
    lastAuth: baseSessionFields().lastAuth,
    activatedAt: null,
    revokedAt: null,
  });
  workloadActivationsKV.seed("wrk_1", {
    instanceId: "wrk_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "reader.default",
    activatedBy: { origin: "github", id: "123" },
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  workloadProfilesKV.seed("reader.default", {
    profileId: "reader.default",
    disabled: false,
  });

  const workloadResult = await handler({}, { sessionKey: workloadSessionKey });
  const workloadValue = workloadResult.take();
  if (isErr(workloadValue)) throw workloadValue.error;
  assertEquals(workloadValue, {
    user: {
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["users.read"],
    },
    workload: {
      type: "workload",
      instanceId: "wrk_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["workload.sync"],
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

  const serviceResult = await handler({}, { sessionKey: serviceSessionKey });
  const serviceValue = serviceResult.take();
  if (isErr(serviceValue)) throw serviceValue.error;
  assertEquals(serviceValue, {
    user: null,
    workload: null,
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
    workloadActivationsKV: new InMemoryKV<{
      instanceId: string;
      publicIdentityKey: string;
      profileId: string;
      activatedBy?: { origin: string; id: string };
      state: "activated" | "revoked";
      activatedAt: string;
      revokedAt: string | null;
    }>(),
    workloadProfilesKV: new InMemoryKV<{ profileId: string; disabled: boolean }>(),
  });

  const result = await handler({}, {
    sessionKey: "missing",
    caller: {
      type: "user",
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
    user: {
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["admin"],
    },
    workload: null,
    service: null,
  });
});

Deno.test("Auth.Me falls back to workload activation context for workload sessions", async () => {
  const usersKV = new InMemoryKV<UserProjectionEntry>();
  const workloadActivationsKV = new InMemoryKV<{
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    activatedBy?: { origin: string; id: string };
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  }>();
  const workloadProfilesKV = new InMemoryKV<{ profileId: string; disabled: boolean }>();

  const handler = createAuthMeHandler({
    sessionKV: new InMemoryKV<Session>(),
    usersKV,
    servicesKV: new InMemoryKV<ServiceRegistryEntry>(),
    workloadActivationsKV,
    workloadProfilesKV,
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
  workloadActivationsKV.seed("wrk_1", {
    instanceId: "wrk_1",
    publicIdentityKey: "A".repeat(43),
    profileId: "reader.default",
    activatedBy: { origin: "github", id: "123" },
    state: "activated",
    activatedAt: "2026-04-10T00:00:00.000Z",
    revokedAt: null,
  });
  workloadProfilesKV.seed("reader.default", {
    profileId: "reader.default",
    disabled: false,
  });

  const result = await handler({}, {
    sessionKey: "missing",
    caller: {
      type: "workload",
      instanceId: "wrk_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["workload.sync"],
    },
  });
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, {
    user: {
      id: "123",
      origin: "github",
      active: true,
      name: "Ada",
      email: "ada@example.com",
      capabilities: ["users.read"],
    },
    workload: {
      type: "workload",
      instanceId: "wrk_1",
      publicIdentityKey: "A".repeat(43),
      profileId: "reader.default",
      active: true,
      capabilities: ["workload.sync"],
    },
    service: null,
  });
});
