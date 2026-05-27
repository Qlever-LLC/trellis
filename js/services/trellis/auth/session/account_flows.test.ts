import { assert, assertEquals } from "@std/assert";
import { AsyncResult, isErr } from "@qlever-llc/result";

import type {
  AccountFlow,
  LocalCredential,
  Session,
  UserAccount,
  UserIdentity,
} from "../schemas.ts";
import { hashKey } from "../crypto.ts";
import {
  createLocalCredentialPassword,
  verifyLocalCredentialPassword,
} from "../local_credentials/passwords.ts";
import {
  createAuthUsersIdentityLinkCreateHandler,
  createAuthUsersPasswordChangeHandler,
  createAuthUsersPasswordResetCreateHandler,
} from "./account_flows.ts";

const logger = { trace: () => {} };
const caller = {
  type: "user",
  userId: "usr_admin",
  capabilities: ["admin"],
  lastAuth: "2026-05-10T12:00:00.000Z",
};
const now = new Date("2026-05-10T12:00:00.000Z");
const portalBaseUrl = "https://trellis.example";

function makeAccount(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    userId: "usr_ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    active: true,
    capabilities: ["catalog.read"],
    capabilityGroups: [],
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...overrides,
  };
}

function makeLocalIdentity(
  overrides: Partial<UserIdentity> = {},
): UserIdentity {
  return {
    identityId: "idn_local_ada",
    userId: "usr_ada",
    provider: "local",
    subject: "ada",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    emailVerified: false,
    linkedAt: "2026-05-10T00:00:00.000Z",
    lastLoginAt: null,
    ...overrides,
  };
}

function stores(
  saved: { flow?: AccountFlow },
  account?: UserAccount,
  identities: UserIdentity[] = account
    ? [makeLocalIdentity({
      userId: account.userId,
    })]
    : [],
) {
  return {
    accountStorage: {
      get: (userId: string) =>
        Promise.resolve(account?.userId === userId ? account : undefined),
    },
    userIdentityStorage: {
      listByUser: (userId: string) =>
        Promise.resolve(
          identities.filter((identity) => identity.userId === userId),
        ),
    },
    accountFlowStorage: {
      put: (record: AccountFlow) => {
        saved.flow = record;
        return Promise.resolve();
      },
    },
  };
}

function userSession(userId: string): Session {
  return {
    type: "user",
    userId,
    identity: {
      identityId: "idn_local_ada",
      provider: "local",
      subject: "ada",
    },
    email: "ada@example.com",
    name: "Ada Lovelace",
    identityEnvelopeId: "ienv_ada",
    contractId: "contract.test",
    contractDigest: "digest",
    contractDisplayName: "Test Contract",
    contractDescription: "Test contract",
    participantKind: "app",
    delegatedCapabilities: [],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    approvalSource: "stored_approval",
    createdAt: now,
    lastAuth: now,
  };
}

Deno.test("account flow create handlers map kind, route, providers, and default TTL", async () => {
  const cases = [{
    name: "password reset",
    create: createAuthUsersPasswordResetCreateHandler,
    input: { userId: "usr_ada" },
    kind: "local_password_reset",
    route: "/_trellis/portal/account/password",
    allowedProviders: ["local"],
  }];

  for (const testCase of cases) {
    const saved: { flow?: AccountFlow } = {};
    const handler = testCase.create({
      ...stores(saved, makeAccount()),
      logger,
      portalBaseUrl,
      now,
    });

    const result = await handler({
      input: testCase.input,
      context: { caller },
    });

    const value = result.take();
    assert(!isErr(value), testCase.name);
    assertEquals(
      value.url,
      `https://trellis.example${testCase.route}?flowId=${value.flowId}`,
    );
    assertEquals(value.expiresAt, "2026-05-11T12:00:00.000Z");
    assert(saved.flow !== undefined);
    assertEquals(saved.flow.kind, testCase.kind);
    assertEquals(saved.flow.allowedProviders, [...testCase.allowedProviders]);
    assertEquals(saved.flow.targetIdentityId, "idn_local_ada");
    assertEquals(saved.flow.targetLocalUsername, "ada");
    assertEquals(saved.flow.profileHint, null);
    assertEquals(saved.flow.capabilities, null);
  }
});

Deno.test("Auth.Users.IdentityLink.Create targets the caller account", async () => {
  const saved: { flow?: AccountFlow } = {};
  const account = makeAccount({ userId: "usr_self" });
  const result = await createAuthUsersIdentityLinkCreateHandler({
    ...stores(saved, account),
    logger,
    portalBaseUrl: "https://auth.example.test",
    now,
  })({
    input: {},
    context: { caller: { type: "user", userId: "usr_self" } },
  });

  const value = result.take();
  assert(!isErr(value));
  assert(saved.flow !== undefined);
  assertEquals(saved.flow.kind, "identity_link");
  assertEquals(saved.flow.targetUserId, "usr_self");
  assertEquals(saved.flow.allowedProviders, null);
  assert(
    value.url.startsWith(
      "https://auth.example.test/_trellis/portal/account/link?flowId=",
    ),
  );
});

Deno.test("Auth.Users.Password.Change replaces the caller local credential and preserves current session", async () => {
  const account = makeAccount({ userId: "usr_self" });
  const identity = makeLocalIdentity({ userId: account.userId });
  const credentials: LocalCredential[] = [
    await createLocalCredentialPassword({
      identityId: identity.identityId,
      password: "current password",
      now,
    }),
  ];
  const sessions = [
    { sessionKey: "sk_current", session: userSession(account.userId) },
    { sessionKey: "sk_other", session: userSession(account.userId) },
  ];
  class BoundSessionStorage {
    #deletedSessionKeys: string[] = [];

    constructor(
      readonly entries: Array<{ sessionKey: string; session: Session }>,
    ) {}

    listEntriesByUser(userId: string) {
      return Promise.resolve(
        this.entries.filter((entry) =>
          entry.session.type === "user" && entry.session.userId === userId
        ),
      );
    }

    deleteBySessionKey(sessionKey: string) {
      this.#deletedSessionKeys.push(sessionKey);
      return Promise.resolve();
    }

    deletedSessionKeys() {
      return this.#deletedSessionKeys;
    }
  }
  const sessionStorage = new BoundSessionStorage(sessions);
  const deletedConnectionKeys: string[] = [];
  const kickedConnections: Array<{ serverId: string; clientId: number }> = [];
  const publishedSessionRevocations: Array<{
    origin: string;
    id: string;
    sessionKey: string;
    revokedBy: string;
  }> = [];

  const result = await createAuthUsersPasswordChangeHandler({
    accountStorage: {
      get: (userId: string) =>
        Promise.resolve(account.userId === userId ? account : undefined),
    },
    userIdentityStorage: {
      listByUser: (userId: string) =>
        Promise.resolve(userId === account.userId ? [identity] : []),
    },
    localCredentialStorage: {
      get: (identityId: string) =>
        Promise.resolve(
          credentials.find((credential) =>
            credential.identityId === identityId
          ),
        ),
      put: (credential: LocalCredential) => {
        credentials.splice(0, credentials.length, credential);
        return Promise.resolve();
      },
    },
    sessionStorage,
    connectionsKV: {
      keys: () =>
        AsyncResult.ok((async function* () {
          yield "conn:key";
        })()),
      get: () => AsyncResult.ok({ value: { serverId: "srv_1", clientId: 7 } }),
      delete: (key: string) => {
        deletedConnectionKeys.push(key);
        return AsyncResult.ok(undefined);
      },
    },
    kick: (serverId: string, clientId: number) => {
      kickedConnections.push({ serverId, clientId });
      return Promise.resolve();
    },
    publishSessionRevoked: (event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    }) => {
      publishedSessionRevocations.push(event);
      return Promise.resolve();
    },
    logger,
    passwordMinLength: 8,
    now,
  })({
    input: {
      currentPassword: "current password",
      newPassword: "newpass8",
    },
    context: {
      caller: { type: "user", userId: account.userId },
      sessionKey: "sk_current",
    },
  });

  const value = result.take();
  assert(!isErr(value));
  assertEquals(value, { success: true });
  assertEquals(sessionStorage.deletedSessionKeys(), ["sk_other"]);
  assertEquals(deletedConnectionKeys, ["conn:key"]);
  assertEquals(kickedConnections, [{ serverId: "srv_1", clientId: 7 }]);
  assertEquals(publishedSessionRevocations, [{
    origin: "local",
    id: "ada",
    sessionKey: "sk_other",
    revokedBy: account.userId,
  }]);
  assertEquals(
    await verifyLocalCredentialPassword(
      credentials[0]!,
      "newpass8",
    ),
    true,
  );
});

Deno.test("Auth.Users.Password.Change rejects the wrong current password", async () => {
  const account = makeAccount({ userId: "usr_self" });
  const identity = makeLocalIdentity({ userId: account.userId });
  const credential = await createLocalCredentialPassword({
    identityId: identity.identityId,
    password: "current password",
    now,
  });
  let savedCredential: LocalCredential | undefined;

  const result = await createAuthUsersPasswordChangeHandler({
    accountStorage: {
      get: (userId: string) =>
        Promise.resolve(account.userId === userId ? account : undefined),
    },
    userIdentityStorage: {
      listByUser: (userId: string) =>
        Promise.resolve(userId === account.userId ? [identity] : []),
    },
    localCredentialStorage: {
      get: () => Promise.resolve(credential),
      put: (record: LocalCredential) => {
        savedCredential = record;
        return Promise.resolve();
      },
    },
    logger,
    now,
  })({
    input: { currentPassword: "wrong password", newPassword: "replacement" },
    context: { caller: { type: "user", userId: account.userId } },
  });

  assert(result.isErr());
  assertEquals(result.error.reason, "invalid_request");
  assertEquals(
    result.error.getContext().message,
    "Current password is incorrect.",
  );
  assertEquals(savedCredential, undefined);
});

Deno.test("Auth.Users.Password.Change requires exactly one local identity", async () => {
  const account = makeAccount({ userId: "usr_self" });
  const result = await createAuthUsersPasswordChangeHandler({
    accountStorage: {
      get: (userId: string) =>
        Promise.resolve(account.userId === userId ? account : undefined),
    },
    userIdentityStorage: { listByUser: () => Promise.resolve([]) },
    localCredentialStorage: {
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
    },
    logger,
    now,
  })({
    input: { currentPassword: "current", newPassword: "replacement" },
    context: { caller: { type: "user", userId: account.userId } },
  });

  assert(result.isErr());
  assertEquals(result.error.reason, "invalid_request");
  assertEquals(
    result.error.getContext().message,
    "This account does not have a local password to change.",
  );
});

Deno.test("account flow creation returns user_not_found for a missing target account", async () => {
  const saved: { flow?: AccountFlow } = {};
  const handler = createAuthUsersPasswordResetCreateHandler({
    ...stores(saved, undefined),
    logger,
    portalBaseUrl,
    now,
  });

  const result = await handler({
    input: { userId: "usr_missing" },
    context: { caller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "user_not_found");
  assertEquals(value.error.toSerializable().context, { userId: "usr_missing" });
  assertEquals(saved.flow, undefined);
});

Deno.test("password reset creation requires exactly one existing local identity", async () => {
  const cases = [{ name: "none", identities: [] }, {
    name: "multiple",
    identities: [
      makeLocalIdentity(),
      makeLocalIdentity({ identityId: "idn_local_ada2", subject: "ada2" }),
    ],
  }];

  for (const testCase of cases) {
    const saved: { flow?: AccountFlow } = {};
    const handler = createAuthUsersPasswordResetCreateHandler({
      ...stores(saved, makeAccount(), testCase.identities),
      logger,
      portalBaseUrl,
      now,
    });

    const result = await handler({
      input: { userId: "usr_ada" },
      context: { caller },
    });

    const value = result.take();
    assert(isErr(value), testCase.name);
    assertEquals(value.error.reason, "invalid_request", testCase.name);
    assertEquals(saved.flow, undefined, testCase.name);
  }
});

Deno.test("admin account flow creation requires an admin user caller", async () => {
  const saved: { flow?: AccountFlow } = {};
  const handler = createAuthUsersPasswordResetCreateHandler({
    ...stores(saved, makeAccount()),
    logger,
    portalBaseUrl,
    now,
  });

  const result = await handler({
    input: { userId: "usr_ada" },
    context: { caller: { type: "service" } },
  });

  assert(result.isErr());
  assertEquals(result.error.reason, "insufficient_permissions");
  assertEquals(saved.flow, undefined);
});
