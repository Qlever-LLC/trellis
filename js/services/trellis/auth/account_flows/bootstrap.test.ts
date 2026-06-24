import { assertEquals, assertMatch } from "@std/assert";
import { AsyncResult } from "@qlever-llc/result";

import { hashKey } from "../crypto.ts";
import { identityIdForProviderSubject } from "../identity.ts";
import {
  createLocalCredentialPassword,
  verifyLocalCredentialPassword,
} from "../local_credentials/passwords.ts";
import type {
  AccountFlow,
  AccountFlowKind,
  LocalCredential,
  Session,
  UserAccount,
  UserIdentity,
} from "../schemas.ts";
import {
  buildLocalPasswordResetPortalUrl,
  ensureAdminBootstrapFlow,
} from "./bootstrap.ts";
import {
  completeAdminBootstrapLocalPassword,
  type CompleteAdminBootstrapLocalPasswordError,
} from "./local_password_completion.ts";

function account(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    userId: "usr_test",
    name: null,
    email: null,
    active: true,
    capabilities: [],
    capabilityGroups: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    ...overrides,
  };
}

function accountFlow(overrides: Partial<AccountFlow> = {}): AccountFlow {
  return {
    flowIdHash: "flow_hash",
    kind: "admin_bootstrap",
    targetUserId: null,
    targetIdentityId: null,
    targetLocalUsername: null,
    createdByUserId: null,
    allowedProviders: null,
    capabilities: ["admin"],
    profileHint: null,
    createdAt: "2026-05-09T00:00:00.000Z",
    expiresAt: "2026-05-10T00:00:00.000Z",
    consumedAt: null,
    ...overrides,
  };
}

function userSession(userId: string, subject = "ada"): Session {
  return {
    type: "user",
    userId,
    identity: {
      identityId: identityIdForProviderSubject("local", subject),
      provider: "local",
      subject,
    },
    email: "ada@example.com",
    name: "Ada",
    createdAt: new Date("2026-05-09T00:00:00.000Z"),
    lastAuth: new Date("2026-05-09T00:00:00.000Z"),
    participantKind: "app",
    contractDigest: "digest",
    contractId: "client.example@v1",
    contractDisplayName: "Client",
    contractDescription: "Client app",
    delegatedCapabilities: [],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
  };
}

function createCompletionDeps(args: {
  flow?: AccountFlow;
  accounts?: UserAccount[];
  identities?: UserIdentity[];
  credentials?: LocalCredential[];
  sessions?: Array<{ sessionKey: string; session: Session }>;
  consumeSucceeds?: boolean;
} = {}) {
  const flows = args.flow ? [args.flow] : [];
  const accounts = [...(args.accounts ?? [])];
  const identities = [...(args.identities ?? [])];
  const credentials: LocalCredential[] = [...(args.credentials ?? [])];
  const sessions = [...(args.sessions ?? [])];
  const deletedSessionKeys: string[] = [];
  const kickedConnections: Array<{ serverId: string; clientId: number }> = [];
  const publishedSessionRevocations: Array<{
    origin: string;
    id: string;
    sessionKey: string;
    revokedBy: string;
  }> = [];
  return {
    accounts,
    identities,
    credentials,
    deletedSessionKeys,
    kickedConnections,
    publishedSessionRevocations,
    deps: {
      accountFlowStorage: {
        get: (flowIdHash: string) =>
          Promise.resolve(flows.find((flow) => flow.flowIdHash === flowIdHash)),
        consume: (flowIdHash: string, consumedAt: string) => {
          if (args.consumeSucceeds === false) return Promise.resolve(false);
          const flow = flows.find((entry) => entry.flowIdHash === flowIdHash);
          if (!flow || flow.consumedAt !== null) return Promise.resolve(false);
          flow.consumedAt = consumedAt;
          return Promise.resolve(true);
        },
      },
      accountStorage: {
        get: (userId: string) =>
          Promise.resolve(
            accounts.find((account) => account.userId === userId),
          ),
        listPage: ({ offset = 0, limit = 100 }) =>
          Promise.resolve(accounts.slice(offset, offset + limit)),
        put: (record: UserAccount) => {
          accounts.push(record);
          return Promise.resolve();
        },
      },
      userIdentityStorage: {
        getByProviderSubject: (provider: string, subject: string) =>
          Promise.resolve(
            identities.find((identity) =>
              identity.provider === provider && identity.subject === subject
            ),
          ),
        listByUser: (userId: string) =>
          Promise.resolve(
            identities.filter((identity) => identity.userId === userId),
          ),
        put: (record: UserIdentity) => {
          identities.push(record);
          return Promise.resolve();
        },
      },
      localCredentialStorage: {
        put: (record: LocalCredential) => {
          const index = credentials.findIndex((credential) =>
            credential.identityId === record.identityId
          );
          if (index === -1) credentials.push(record);
          else credentials[index] = record;
          return Promise.resolve();
        },
      },
      sessionStorage: {
        listEntriesByUser: (userId: string) =>
          Promise.resolve(
            sessions.filter((entry) =>
              entry.session.type === "user" && entry.session.userId === userId
            ),
          ),
        deleteBySessionKey: (sessionKey: string) => {
          deletedSessionKeys.push(sessionKey);
          const index = sessions.findIndex((entry) =>
            entry.sessionKey === sessionKey
          );
          if (index !== -1) sessions.splice(index, 1);
          return Promise.resolve();
        },
      },
      connectionsKV: {
        keys: () =>
          AsyncResult.ok((async function* () {
            yield "conn:key";
          })()),
        get: () =>
          AsyncResult.ok({ value: { serverId: "srv_1", clientId: 7 } }),
        delete: () => AsyncResult.ok(undefined),
      },
      kick: (serverId: string, clientId: number) => {
        kickedConnections.push({ serverId, clientId });
        return Promise.resolve();
      },
      publishSessionRevoked: (
        event: {
          origin: string;
          id: string;
          sessionKey: string;
          revokedBy: string;
        },
      ) => {
        publishedSessionRevocations.push(event);
        return Promise.resolve();
      },
    },
  };
}

Deno.test("buildLocalPasswordResetPortalUrl uses the built-in password reset route", () => {
  assertEquals(
    buildLocalPasswordResetPortalUrl({
      baseUrl: "https://trellis.example/auth/callback",
      flowId: "flow-1",
    }),
    "https://trellis.example/_trellis/portal/account/password?flowId=flow-1",
  );
});

Deno.test("ensureAdminBootstrapFlow creates an admin account, local identity, and reset flow", async () => {
  const flows: AccountFlow[] = [];
  const accounts: UserAccount[] = [];
  const identities: UserIdentity[] = [];
  const logEntries: Array<
    { fields: Record<string, unknown>; message: string }
  > = [];

  const result = await ensureAdminBootstrapFlow({
    accountStorage: {
      get: (userId: string) =>
        Promise.resolve(accounts.find((account) => account.userId === userId)),
      listPage: ({ offset = 0, limit = 100 }) =>
        Promise.resolve(accounts.slice(offset, offset + limit)),
      put: (record: UserAccount) => {
        accounts.push(record);
        return Promise.resolve();
      },
    },
    userIdentityStorage: {
      getByProviderSubject: (provider: string, subject: string) =>
        Promise.resolve(
          identities.find((identity) =>
            identity.provider === provider && identity.subject === subject
          ),
        ),
      put: (record: UserIdentity) => {
        identities.push(record);
        return Promise.resolve();
      },
    },
    localCredentialStorage: { get: () => Promise.resolve(undefined) },
    accountFlowStorage: {
      put: (record) => {
        flows.push(record);
        return Promise.resolve();
      },
    },
    portalBaseUrl: "https://trellis.example",
    logger: {
      info: (fields, message) => logEntries.push({ fields, message }),
    },
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(accounts.length, 1);
  const admin = accounts[0]!;
  assertMatch(admin.userId, /^usr_[A-Za-z0-9_-]+$/);
  assertEquals(admin.name, "admin");
  assertEquals(admin.active, true);
  assertEquals(admin.capabilityGroups, ["admin"]);
  assertEquals(identities, [{
    identityId: identityIdForProviderSubject("local", "admin"),
    userId: admin.userId,
    provider: "local",
    subject: "admin",
    displayName: "admin",
    email: null,
    emailVerified: false,
    linkedAt: "2026-05-09T00:00:00.000Z",
    lastLoginAt: null,
  }]);
  assertEquals(flows.length, 1);
  assertEquals(flows[0]?.kind, "local_password_reset");
  assertEquals(flows[0]?.targetUserId, admin.userId);
  assertEquals(
    flows[0]?.targetIdentityId,
    identityIdForProviderSubject("local", "admin"),
  );
  assertEquals(flows[0]?.targetLocalUsername, "admin");
  assertEquals(flows[0]?.allowedProviders, ["local"]);
  assertEquals(flows[0]?.capabilities, null);
  assertEquals(flows[0]?.profileHint, null);
  assertEquals(flows[0]?.createdAt, "2026-05-09T00:00:00.000Z");
  assertEquals(flows[0]?.expiresAt, "2026-05-10T00:00:00.000Z");
  assertEquals(flows[0]?.consumedAt, null);
  assertMatch(flows[0]?.flowIdHash ?? "", /^[A-Za-z0-9_-]+$/);
  assertMatch(
    result?.url ?? "",
    /^https:\/\/trellis\.example\/_trellis\/portal\/account\/password\?flowId=[A-Za-z0-9_-]+$/,
  );
  assertEquals(logEntries.length, 1);
  assertEquals(logEntries[0]?.fields.bootstrapUrl, result?.url);
});

Deno.test("ensureAdminBootstrapFlow keeps issuing reset links until local admin has a credential", async () => {
  const admin = account({
    userId: "usr_admin",
    name: "admin",
    capabilities: [],
    capabilityGroups: ["admin"],
  });
  const identity: UserIdentity = {
    identityId: identityIdForProviderSubject("local", "admin"),
    userId: admin.userId,
    provider: "local",
    subject: "admin",
    displayName: "admin",
    email: null,
    emailVerified: false,
    linkedAt: "2026-05-09T00:00:00.000Z",
    lastLoginAt: null,
  };
  const flows: AccountFlow[] = [];

  const result = await ensureAdminBootstrapFlow({
    accountStorage: {
      get: (userId: string) =>
        Promise.resolve(userId === admin.userId ? admin : undefined),
      listPage: () => Promise.resolve([admin]),
      put: () => Promise.resolve(),
    },
    userIdentityStorage: {
      getByProviderSubject: (provider: string, subject: string) =>
        Promise.resolve(
          provider === "local" && subject === "admin" ? identity : undefined,
        ),
      put: () => Promise.resolve(),
    },
    localCredentialStorage: { get: () => Promise.resolve(undefined) },
    accountFlowStorage: {
      put: (record) => {
        flows.push(record);
        return Promise.resolve();
      },
    },
    portalBaseUrl: "https://trellis.example",
    logger: { info: () => undefined },
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertMatch(result?.url ?? "", /\/account\/password\?flowId=/);
  assertEquals(flows.length, 1);
  assertEquals(flows[0]?.kind, "local_password_reset");
  assertEquals(flows[0]?.targetUserId, admin.userId);
  assertEquals(flows[0]?.targetIdentityId, identity.identityId);
  assertEquals(flows[0]?.targetLocalUsername, "admin");
  assertEquals(flows[0]?.profileHint, null);
});

Deno.test("ensureAdminBootstrapFlow skips creation when an active admin exists", async () => {
  const flows: AccountFlow[] = [];
  const result = await ensureAdminBootstrapFlow({
    accountStorage: {
      get: () => Promise.resolve(undefined),
      listPage: () => Promise.resolve([account({ capabilities: ["admin"] })]),
      put: () => Promise.resolve(),
    },
    userIdentityStorage: {
      getByProviderSubject: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
    },
    localCredentialStorage: { get: () => Promise.resolve(undefined) },
    accountFlowStorage: {
      put: (record) => {
        flows.push(record);
        return Promise.resolve();
      },
    },
    portalBaseUrl: "https://trellis.example",
    logger: { info: () => undefined },
  });

  assertEquals(result, null);
  assertEquals(flows, []);
});

Deno.test("ensureAdminBootstrapFlow ignores inactive admin accounts", async () => {
  const flows: AccountFlow[] = [];
  const result = await ensureAdminBootstrapFlow({
    accountStorage: {
      get: () => Promise.resolve(undefined),
      listPage: () =>
        Promise.resolve([
          account({ active: false, capabilities: ["admin"] }),
        ]),
      put: () => Promise.resolve(),
    },
    userIdentityStorage: {
      getByProviderSubject: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
    },
    localCredentialStorage: { get: () => Promise.resolve(undefined) },
    accountFlowStorage: {
      put: (record) => {
        flows.push(record);
        return Promise.resolve();
      },
    },
    portalBaseUrl: "https://trellis.example",
    logger: { info: () => undefined },
  });

  assertEquals(flows.length, 1);
  assertMatch(result?.url ?? "", /flowId=/);
});

Deno.test("ensureAdminBootstrapFlow detects an active admin on a later page", async () => {
  const flows: AccountFlow[] = [];
  const pages = [
    Array.from(
      { length: 100 },
      (_, index) => account({ userId: `usr_${index}`, capabilities: [] }),
    ),
    [account({ userId: "usr_admin", capabilities: ["admin"] })],
  ];
  const result = await ensureAdminBootstrapFlow({
    accountStorage: {
      get: () => Promise.resolve(undefined),
      listPage: ({ offset = 0 }) =>
        Promise.resolve(pages[Math.floor(offset / 100)] ?? []),
      put: () => Promise.resolve(),
    },
    userIdentityStorage: {
      getByProviderSubject: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
    },
    localCredentialStorage: { get: () => Promise.resolve(undefined) },
    accountFlowStorage: {
      put: (record) => {
        flows.push(record);
        return Promise.resolve();
      },
    },
    portalBaseUrl: "https://trellis.example",
    logger: { info: () => undefined },
  });

  assertEquals(result, null);
  assertEquals(flows, []);
});

Deno.test("completeAdminBootstrapLocalPassword rejects expired and consumed bootstrap flows", async () => {
  const cases: Array<{
    consumedAt?: string | null;
    expiresAt?: string;
    error: CompleteAdminBootstrapLocalPasswordError;
  }> = [
    { expiresAt: "2026-05-08T00:00:00.000Z", error: "flow_expired" },
    { consumedAt: "2026-05-09T00:00:00.000Z", error: "flow_already_consumed" },
  ];

  for (const testCase of cases) {
    const flowId = `flow-${testCase.error}`;
    const state = createCompletionDeps({
      flow: accountFlow({
        flowIdHash: await hashKey(flowId),
        ...(testCase.consumedAt !== undefined
          ? { consumedAt: testCase.consumedAt }
          : {}),
        ...(testCase.expiresAt ? { expiresAt: testCase.expiresAt } : {}),
      }),
    });
    const result = await completeAdminBootstrapLocalPassword({
      ...state.deps,
      flowId,
      username: "ada",
      password: "long-password",
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assertEquals(result, { ok: false, error: testCase.error });
    assertEquals(state.accounts, []);
  }
});

Deno.test("completeAdminBootstrapLocalPassword rejects when an active admin exists", async () => {
  const flowId = "bootstrap-flow";
  const state = createCompletionDeps({
    flow: accountFlow({ flowIdHash: await hashKey(flowId) }),
    accounts: [account({ userId: "usr_admin", capabilities: ["admin"] })],
  });

  const result = await completeAdminBootstrapLocalPassword({
    ...state.deps,
    flowId,
    username: "ada",
    password: "long-password",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: false, error: "admin_already_exists" });
  assertEquals(state.accounts.length, 1);
});

Deno.test("completeAdminBootstrapLocalPassword rejects duplicate local usernames", async () => {
  const flowId = "bootstrap-flow";
  const state = createCompletionDeps({
    flow: accountFlow({ flowIdHash: await hashKey(flowId) }),
    identities: [{
      identityId: "local/ada",
      userId: "usr_ada",
      provider: "local",
      subject: "ada",
      displayName: null,
      email: null,
      emailVerified: false,
      linkedAt: "2026-05-09T00:00:00.000Z",
      lastLoginAt: null,
    }],
  });

  const result = await completeAdminBootstrapLocalPassword({
    ...state.deps,
    flowId,
    username: "ada",
    password: "long-password",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: false, error: "local_identity_exists" });
  assertEquals(state.accounts, []);
});

Deno.test("completeAdminBootstrapLocalPassword rejects a double-consume race without creating the admin", async () => {
  const flowId = "bootstrap-flow";
  const state = createCompletionDeps({
    flow: accountFlow({ flowIdHash: await hashKey(flowId) }),
    consumeSucceeds: false,
  });

  const result = await completeAdminBootstrapLocalPassword({
    ...state.deps,
    flowId,
    username: "ada",
    password: "long-password",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: false, error: "flow_consume_conflict" });
  assertEquals(state.accounts, []);
  assertEquals(state.identities, []);
  assertEquals(state.credentials, []);
});

Deno.test("completeAdminBootstrapLocalPassword resets the bound local identity", async () => {
  const flowId = "reset-flow";
  const target = account({ userId: "usr_target", capabilities: ["admin"] });
  const identityId = identityIdForProviderSubject("local", "ada");
  const existingIdentity: UserIdentity = {
    identityId,
    userId: target.userId,
    provider: "local",
    subject: "ada",
    displayName: null,
    email: null,
    emailVerified: false,
    linkedAt: "2026-05-01T00:00:00.000Z",
    lastLoginAt: null,
  };
  const state = createCompletionDeps({
    flow: accountFlow({
      flowIdHash: await hashKey(flowId),
      kind: "local_password_reset",
      targetUserId: target.userId,
      targetIdentityId: identityId,
      targetLocalUsername: "ada",
      allowedProviders: ["local"],
      capabilities: null,
    }),
    accounts: [target],
    identities: [existingIdentity],
    sessions: [{
      sessionKey: "session-1",
      session: userSession(target.userId),
    }],
  });

  const result = await completeAdminBootstrapLocalPassword({
    ...state.deps,
    flowId,
    username: "ada",
    password: "new password",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: true, userId: target.userId });
  assertEquals(state.accounts, [target]);
  assertEquals(state.identities, [existingIdentity]);
  assertEquals(state.credentials.length, 1);
  assertEquals(state.credentials[0]?.identityId, identityId);
  assertEquals(state.deletedSessionKeys, ["session-1"]);
  assertEquals(state.kickedConnections, [{ serverId: "srv_1", clientId: 7 }]);
  assertEquals(state.publishedSessionRevocations, [{
    origin: "local",
    id: "ada",
    sessionKey: "session-1",
    revokedBy: "system",
  }]);
  assertEquals(state.accounts[0]?.capabilities, ["admin"]);
});

Deno.test("completeAdminBootstrapLocalPassword rejects a second local identity link", async () => {
  const flowId = "identity-link-flow";
  const target = account({ userId: "usr_target" });
  const existingIdentity: UserIdentity = {
    identityId: identityIdForProviderSubject("local", "ada"),
    userId: target.userId,
    provider: "local",
    subject: "ada",
    displayName: null,
    email: null,
    emailVerified: false,
    linkedAt: "2026-05-01T00:00:00.000Z",
    lastLoginAt: null,
  };
  const state = createCompletionDeps({
    flow: accountFlow({
      flowIdHash: await hashKey(flowId),
      kind: "identity_link",
      targetUserId: target.userId,
      allowedProviders: ["local"],
      capabilities: null,
    }),
    accounts: [target],
    identities: [existingIdentity],
  });

  const result = await completeAdminBootstrapLocalPassword({
    ...state.deps,
    flowId,
    username: "ada-second",
    password: "new password",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: false, error: "local_identity_exists" });
  assertEquals(state.identities, [existingIdentity]);
  assertEquals(state.credentials, []);
  assertEquals(state.deletedSessionKeys, []);
});

Deno.test("completeAdminBootstrapLocalPassword replaces a same-account local credential and revokes reset sessions", async () => {
  const flowId = "reset-flow";
  const target = account({ userId: "usr_target" });
  const identityId = identityIdForProviderSubject("local", "ada");
  const existingIdentity: UserIdentity = {
    identityId,
    userId: target.userId,
    provider: "local",
    subject: "ada",
    displayName: null,
    email: null,
    emailVerified: false,
    linkedAt: "2026-05-01T00:00:00.000Z",
    lastLoginAt: null,
  };
  const existingCredential = await createLocalCredentialPassword({
    identityId,
    password: "old password",
    now: new Date("2026-05-01T00:00:00.000Z"),
  });
  const state = createCompletionDeps({
    flow: accountFlow({
      flowIdHash: await hashKey(flowId),
      kind: "local_password_reset",
      targetUserId: target.userId,
      targetIdentityId: identityId,
      targetLocalUsername: "ada",
      allowedProviders: ["local"],
      capabilities: null,
    }),
    accounts: [target],
    identities: [existingIdentity],
    credentials: [existingCredential],
    sessions: [{
      sessionKey: "session-2",
      session: userSession(target.userId),
    }],
  });

  const result = await completeAdminBootstrapLocalPassword({
    ...state.deps,
    flowId,
    username: "ada",
    password: "new password",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: true, userId: target.userId });
  assertEquals(state.identities, [existingIdentity]);
  assertEquals(state.credentials.length, 1);
  assertEquals(
    await verifyLocalCredentialPassword(state.credentials[0]!, "new password"),
    true,
  );
  assertEquals(state.deletedSessionKeys, ["session-2"]);
});

Deno.test("completeAdminBootstrapLocalPassword deletes reset sessions without live connection deps", async () => {
  const flowId = "reset-flow";
  const target = account({ userId: "usr_target" });
  const identityId = identityIdForProviderSubject("local", "ada");
  const existingIdentity: UserIdentity = {
    identityId,
    userId: target.userId,
    provider: "local",
    subject: "ada",
    displayName: null,
    email: null,
    emailVerified: false,
    linkedAt: "2026-05-01T00:00:00.000Z",
    lastLoginAt: null,
  };
  const state = createCompletionDeps({
    flow: accountFlow({
      flowIdHash: await hashKey(flowId),
      kind: "local_password_reset",
      targetUserId: target.userId,
      targetIdentityId: identityId,
      targetLocalUsername: "ada",
      allowedProviders: ["local"],
      capabilities: null,
      createdByUserId: "usr_admin",
    }),
    accounts: [target],
    identities: [existingIdentity],
    sessions: [{
      sessionKey: "session-3",
      session: userSession(target.userId),
    }],
  });

  const result = await completeAdminBootstrapLocalPassword({
    accountFlowStorage: state.deps.accountFlowStorage,
    accountStorage: state.deps.accountStorage,
    userIdentityStorage: state.deps.userIdentityStorage,
    localCredentialStorage: state.deps.localCredentialStorage,
    sessionStorage: state.deps.sessionStorage,
    publishSessionRevoked: state.deps.publishSessionRevoked,
    flowId,
    username: "ada",
    password: "new password",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: true, userId: target.userId });
  assertEquals(state.deletedSessionKeys, ["session-3"]);
  assertEquals(state.kickedConnections, []);
  assertEquals(state.publishedSessionRevocations, [{
    origin: "local",
    id: "ada",
    sessionKey: "session-3",
    revokedBy: "usr_admin",
  }]);
});

Deno.test("completeAdminBootstrapLocalPassword rejects a mismatching username during reset", async () => {
  const flowId = "reset-flow";
  const target = account({ userId: "usr_target" });
  const existingIdentity: UserIdentity = {
    identityId: identityIdForProviderSubject("local", "ada"),
    userId: target.userId,
    provider: "local",
    subject: "ada",
    displayName: null,
    email: null,
    emailVerified: false,
    linkedAt: "2026-05-01T00:00:00.000Z",
    lastLoginAt: null,
  };
  const state = createCompletionDeps({
    flow: accountFlow({
      flowIdHash: await hashKey(flowId),
      kind: "local_password_reset",
      targetUserId: target.userId,
      targetIdentityId: existingIdentity.identityId,
      targetLocalUsername: "ada",
      allowedProviders: ["local"],
      capabilities: null,
    }),
    accounts: [target],
    identities: [existingIdentity],
  });

  const result = await completeAdminBootstrapLocalPassword({
    ...state.deps,
    flowId,
    username: "ada-second",
    password: "new password",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: false, error: "local_username_mismatch" });
  assertEquals(state.identities, [existingIdentity]);
  assertEquals(state.credentials, []);
  assertEquals(state.deletedSessionKeys, []);
});

Deno.test("completeAdminBootstrapLocalPassword rejects invalid target account flow completions", async () => {
  const target = account({ userId: "usr_target" });
  const cases: Array<{
    kind: AccountFlowKind;
    targetUserId: string | null;
    allowedProviders: string[] | null;
    accounts: UserAccount[];
    identities?: UserIdentity[];
    error: CompleteAdminBootstrapLocalPasswordError;
  }> = [
    {
      kind: "identity_link",
      targetUserId: target.userId,
      allowedProviders: ["github"],
      accounts: [target],
      error: "local_provider_not_allowed",
    },
    {
      kind: "local_password_reset",
      targetUserId: null,
      allowedProviders: ["local"],
      accounts: [target],
      error: "flow_missing_target_user",
    },
    {
      kind: "local_password_reset",
      targetUserId: "usr_missing",
      allowedProviders: ["local"],
      accounts: [target],
      error: "target_user_not_found",
    },
    {
      kind: "local_password_reset",
      targetUserId: target.userId,
      allowedProviders: ["local"],
      accounts: [account({ userId: target.userId, active: false })],
      error: "target_user_inactive",
    },
    {
      kind: "local_password_reset",
      targetUserId: target.userId,
      allowedProviders: ["local"],
      accounts: [target],
      identities: [{
        identityId: identityIdForProviderSubject("local", "ada"),
        userId: "usr_other",
        provider: "local",
        subject: "ada",
        displayName: null,
        email: null,
        emailVerified: false,
        linkedAt: "2026-05-01T00:00:00.000Z",
        lastLoginAt: null,
      }],
      error: "flow_missing_local_identity",
    },
  ];

  for (const testCase of cases) {
    const flowId = `flow-${testCase.error}`;
    const state = createCompletionDeps({
      flow: accountFlow({
        flowIdHash: await hashKey(flowId),
        kind: testCase.kind,
        targetUserId: testCase.targetUserId,
        targetIdentityId: testCase.kind === "local_password_reset" &&
            testCase.targetUserId === target.userId
          ? identityIdForProviderSubject("local", "ada")
          : null,
        targetLocalUsername: testCase.kind === "local_password_reset" &&
            testCase.targetUserId === target.userId
          ? "ada"
          : null,
        allowedProviders: testCase.allowedProviders,
        capabilities: null,
      }),
      accounts: testCase.accounts,
      identities: testCase.identities,
    });

    const result = await completeAdminBootstrapLocalPassword({
      ...state.deps,
      flowId,
      username: "ada",
      password: "long-password",
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assertEquals(result, { ok: false, error: testCase.error });
    assertEquals(state.credentials, []);
    assertEquals(state.deletedSessionKeys, []);
  }
});
