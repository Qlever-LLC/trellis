import { assertEquals, assertMatch } from "@std/assert";

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
  UserAccount,
  UserIdentity,
} from "../schemas.ts";
import {
  buildAdminBootstrapPortalUrl,
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

function createCompletionDeps(args: {
  flow?: AccountFlow;
  accounts?: UserAccount[];
  identities?: UserIdentity[];
  credentials?: LocalCredential[];
  consumeSucceeds?: boolean;
} = {}) {
  const flows = args.flow ? [args.flow] : [];
  const accounts = [...(args.accounts ?? [])];
  const identities = [...(args.identities ?? [])];
  const credentials: LocalCredential[] = [...(args.credentials ?? [])];
  const deletedSessionUserIds: string[] = [];
  return {
    accounts,
    identities,
    credentials,
    deletedSessionUserIds,
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
        deleteByUser: (userId: string) => {
          deletedSessionUserIds.push(userId);
          return Promise.resolve();
        },
      },
    },
  };
}

Deno.test("buildAdminBootstrapPortalUrl uses the built-in admin bootstrap route", () => {
  assertEquals(
    buildAdminBootstrapPortalUrl({
      baseUrl: "https://trellis.example/auth/callback",
      flowId: "flow-1",
    }),
    "https://trellis.example/_trellis/portal/admin/bootstrap?flowId=flow-1",
  );
});

Deno.test("ensureAdminBootstrapFlow creates and logs a durable bootstrap flow without an active admin", async () => {
  const flows: AccountFlow[] = [];
  const logEntries: Array<
    { fields: Record<string, unknown>; message: string }
  > = [];

  const result = await ensureAdminBootstrapFlow({
    accountStorage: {
      listPage: () =>
        Promise.resolve([account({ capabilities: ["catalog.read"] })]),
    },
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

  assertEquals(flows.length, 1);
  assertEquals(flows[0]?.kind, "admin_bootstrap");
  assertEquals(flows[0]?.capabilities, ["admin"]);
  assertEquals(flows[0]?.createdAt, "2026-05-09T00:00:00.000Z");
  assertEquals(flows[0]?.expiresAt, "2026-05-10T00:00:00.000Z");
  assertEquals(flows[0]?.consumedAt, null);
  assertMatch(flows[0]?.flowIdHash ?? "", /^[A-Za-z0-9_-]+$/);
  assertMatch(
    result?.url ?? "",
    /^https:\/\/trellis\.example\/_trellis\/portal\/admin\/bootstrap\?flowId=[A-Za-z0-9_-]+$/,
  );
  assertEquals(logEntries.length, 1);
  assertEquals(logEntries[0]?.fields.bootstrapUrl, result?.url);
});

Deno.test("ensureAdminBootstrapFlow skips creation when an active admin exists", async () => {
  const flows: AccountFlow[] = [];
  const result = await ensureAdminBootstrapFlow({
    accountStorage: {
      listPage: () => Promise.resolve([account({ capabilities: ["admin"] })]),
    },
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
      listPage: () =>
        Promise.resolve([
          account({ active: false, capabilities: ["admin"] }),
        ]),
    },
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
      listPage: ({ offset = 0 }) =>
        Promise.resolve(pages[Math.floor(offset / 100)] ?? []),
    },
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

Deno.test("completeAdminBootstrapLocalPassword creates the first active local admin", async () => {
  const flowId = "bootstrap-flow";
  const state = createCompletionDeps({
    flow: accountFlow({ flowIdHash: await hashKey(flowId) }),
  });

  const result = await completeAdminBootstrapLocalPassword({
    ...state.deps,
    flowId,
    username: "ada",
    password: "correct horse battery staple",
    name: "Ada Lovelace",
    email: "ada@example.com",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  if (!result.ok) throw new Error(result.error);
  assertMatch(result.userId, /^usr_[A-Za-z0-9_-]+$/);
  assertEquals(state.accounts, [{
    userId: result.userId,
    name: "Ada Lovelace",
    email: "ada@example.com",
    active: true,
    capabilities: [],
    capabilityGroups: ["admin"],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  }]);
  assertEquals(state.identities, [{
    identityId: identityIdForProviderSubject("local", "ada"),
    userId: result.userId,
    provider: "local",
    subject: "ada",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    emailVerified: false,
    linkedAt: "2026-05-09T00:00:00.000Z",
    lastLoginAt: null,
  }]);
  assertEquals(state.credentials.length, 1);
  const credential = state.credentials[0];
  if (!credential) throw new Error("expected local credential");
  assertEquals(
    credential.identityId,
    identityIdForProviderSubject("local", "ada"),
  );
  assertEquals(
    await verifyLocalCredentialPassword(
      credential,
      "correct horse battery staple",
    ),
    true,
  );
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
      password: "password",
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
    password: "password",
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
    password: "password",
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
    password: "password",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: false, error: "flow_consume_conflict" });
  assertEquals(state.accounts, []);
  assertEquals(state.identities, []);
  assertEquals(state.credentials, []);
});

Deno.test("completeAdminBootstrapLocalPassword links a local password for a target account flow", async () => {
  const flowId = "invite-flow";
  const target = account({ userId: "usr_target", capabilities: ["admin"] });
  const state = createCompletionDeps({
    flow: accountFlow({
      flowIdHash: await hashKey(flowId),
      kind: "account_invite",
      targetUserId: target.userId,
      allowedProviders: ["local"],
      capabilities: null,
    }),
    accounts: [target],
  });

  const result = await completeAdminBootstrapLocalPassword({
    ...state.deps,
    flowId,
    username: "ada",
    password: "new password",
    name: "Ada Local",
    email: "ada.local@example.com",
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(result, { ok: true, userId: target.userId });
  assertEquals(state.accounts, [target]);
  assertEquals(state.identities, [{
    identityId: identityIdForProviderSubject("local", "ada"),
    userId: target.userId,
    provider: "local",
    subject: "ada",
    displayName: "Ada Local",
    email: "ada.local@example.com",
    emailVerified: false,
    linkedAt: "2026-05-09T00:00:00.000Z",
    lastLoginAt: null,
  }]);
  assertEquals(state.credentials.length, 1);
  assertEquals(state.deletedSessionUserIds, []);
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
  assertEquals(state.deletedSessionUserIds, []);
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
      allowedProviders: ["local"],
      capabilities: null,
    }),
    accounts: [target],
    identities: [existingIdentity],
    credentials: [existingCredential],
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
  assertEquals(state.deletedSessionUserIds, [target.userId]);
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
      kind: "local_password_setup",
      targetUserId: null,
      allowedProviders: ["local"],
      accounts: [target],
      error: "flow_missing_target_user",
    },
    {
      kind: "local_password_setup",
      targetUserId: "usr_missing",
      allowedProviders: ["local"],
      accounts: [target],
      error: "target_user_not_found",
    },
    {
      kind: "local_password_setup",
      targetUserId: target.userId,
      allowedProviders: ["local"],
      accounts: [account({ userId: target.userId, active: false })],
      error: "target_user_inactive",
    },
    {
      kind: "local_password_setup",
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
      error: "local_identity_exists",
    },
  ];

  for (const testCase of cases) {
    const flowId = `flow-${testCase.error}`;
    const state = createCompletionDeps({
      flow: accountFlow({
        flowIdHash: await hashKey(flowId),
        kind: testCase.kind,
        targetUserId: testCase.targetUserId,
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
      password: "password",
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assertEquals(result, { ok: false, error: testCase.error });
    assertEquals(state.credentials, []);
    assertEquals(state.deletedSessionUserIds, []);
  }
});
