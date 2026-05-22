import { assert, assertEquals, assertMatch } from "@std/assert";
import { isErr } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import type { UserAccount, UserIdentity } from "../schemas.ts";
import {
  createAuthCapabilitiesListHandler,
  createAuthCapabilityGroupsDeleteHandler,
  createAuthCapabilityGroupsGetHandler,
  createAuthCapabilityGroupsListHandler,
  createAuthCapabilityGroupsPutHandler,
  createAuthUserIdentitiesListHandler,
  createAuthUserIdentitiesUnlinkHandler,
  createAuthUsersCreateHandler,
  createAuthUsersGetHandler,
  createAuthUsersListHandler,
  createAuthUsersUpdateHandler,
} from "./users.ts";
import { identityIdForProviderSubject } from "../identity.ts";

const logger = { trace: () => {} };
const userCaller = {
  type: "user",
  userId: "usr_admin",
  capabilities: ["admin"],
};

function makeAccount(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    userId: "usr_ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    active: true,
    capabilities: ["catalog.read"],
    capabilityGroups: [],
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    identityId: "idn_github_ada",
    userId: "usr_ada",
    provider: "github",
    subject: "ada",
    displayName: "Ada",
    email: "ada@example.com",
    emailVerified: true,
    linkedAt: "2026-04-26T00:00:01.000Z",
    lastLoginAt: null,
    ...overrides,
  };
}

Deno.test("Auth.Capabilities.List returns platform and active contract capabilities", async () => {
  const contracts = createTestContracts();
  const contract: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description: "Auth contract.",
    kind: "service",
    capabilities: {
      "trellis.auth::device.review": {
        displayName: "Review device activation",
        description: "Review and decide pending device activation requests.",
      },
    },
  };
  contracts.activateTestContract({ digest: "digest-auth", contract });

  const result = await createAuthCapabilitiesListHandler(contracts, logger)({
    input: { limit: 10 },
    context: {
      caller: {
        type: "user",
        userId: "usr_admin",
        capabilities: ["admin"],
      },
    },
  });

  assertEquals(result.take(), {
    entries: [{
      key: "admin",
      displayName: "Administer Trellis",
      description:
        "Manage Trellis users, sessions, deployments, and runtime policy.",
      source: "platform",
    }, {
      key: "trellis.auth::device.review",
      displayName: "Review device activation",
      description: "Review and decide pending device activation requests.",
      source: "contract",
      contractId: "trellis.auth@v1",
      contractDigest: "digest-auth",
      contractDisplayName: "Trellis Auth",
    }],
    count: 2,
    offset: 0,
    limit: 10,
    nextOffset: undefined,
  });
});

Deno.test("Auth.CapabilityGroups RPCs expose built-ins and manage custom groups", async () => {
  const contracts = createTestContracts();
  contracts.activateTestContract({
    digest: "digest-customer",
    contract: {
      format: "trellis.contract.v1",
      id: "customer@v1",
      displayName: "Customer",
      description: "Customer contract.",
      kind: "service",
      capabilities: {
        "customer.read": {
          displayName: "Read customers",
          description: "Read customer records.",
        },
      },
    },
  });
  const groups = new Map<string, {
    groupKey: string;
    displayName: string;
    description: string;
    capabilities: string[];
    includedGroups: string[];
    createdAt: string;
    updatedAt: string;
  }>();
  const storage = {
    get: (groupKey: string) => Promise.resolve(groups.get(groupKey)),
    listPage: ({ offset = 0, limit }: { offset?: number; limit: number }) =>
      Promise.resolve([...groups.values()].slice(offset, offset + limit)),
    put: (record: {
      groupKey: string;
      displayName: string;
      description: string;
      capabilities: string[];
      includedGroups: string[];
      createdAt: string;
      updatedAt: string;
    }) => {
      groups.set(record.groupKey, record);
      return Promise.resolve();
    },
    delete: (groupKey: string) => {
      groups.delete(groupKey);
      return Promise.resolve();
    },
  };

  const putResult = await createAuthCapabilityGroupsPutHandler(
    storage,
    contracts,
    logger,
  )(
    {
      input: {
        groupKey: "customer.default",
        displayName: "Customer Default",
        description: "Default customer permissions.",
        capabilities: ["customer.read"],
        includedGroups: ["nested.group"],
      },
      context: { caller: userCaller },
    },
  );
  const putValue = putResult.take();
  assert(!isErr(putValue));
  assertEquals(putValue.group.groupKey, "customer.default");
  assertEquals(putValue.group.capabilities, ["customer.read"]);

  const listResult = await createAuthCapabilityGroupsListHandler(
    storage,
    logger,
  )({ input: { limit: 10 }, context: { caller: userCaller } });
  const listValue = listResult.take();
  assert(!isErr(listValue));
  assertEquals(listValue.entries.map((group) => group.groupKey), [
    "customer.default",
  ]);

  const emptyPageResult = await createAuthCapabilityGroupsListHandler(
    storage,
    logger,
  )({ input: { limit: 0 }, context: { caller: userCaller } });
  assertEquals(emptyPageResult.take(), {
    entries: [],
    count: 0,
    offset: 0,
    limit: 0,
    nextOffset: undefined,
  });

  const builtinGet = await createAuthCapabilityGroupsGetHandler(
    storage,
    logger,
  )({ input: { groupKey: "admin" }, context: { caller: userCaller } });
  const builtinValue = builtinGet.take();
  assert(!isErr(builtinValue));
  assertEquals(builtinValue.group.capabilities.includes("service"), false);

  const overwriteBuiltin = await createAuthCapabilityGroupsPutHandler(
    storage,
    contracts,
    logger,
  )({
    input: {
      groupKey: "admin",
      displayName: "Admin",
      description: "Bad overwrite.",
    },
    context: { caller: userCaller },
  });
  const overwriteValue = overwriteBuiltin.take();
  assert(isErr(overwriteValue));
  assertEquals(overwriteValue.error.reason, "invalid_request");

  const unknownCapability = await createAuthCapabilityGroupsPutHandler(
    storage,
    contracts,
    logger,
  )({
    input: {
      groupKey: "customer.invalid",
      displayName: "Customer Invalid",
      description: "Invalid customer permissions.",
      capabilities: ["customer.unknown"],
    },
    context: { caller: userCaller },
  });
  const unknownValue = unknownCapability.take();
  assert(isErr(unknownValue));
  assertEquals(unknownValue.error.reason, "invalid_request");

  const deleteResult = await createAuthCapabilityGroupsDeleteHandler(
    storage,
    logger,
  )({
    input: { groupKey: "customer.default" },
    context: { caller: userCaller },
  });
  assertEquals(deleteResult.take(), { success: true });
});

Deno.test("Auth.Users.List returns account users with linked identities", async () => {
  const accounts = [
    makeAccount({
      userId: "usr_null_profile",
      name: null,
      email: null,
      capabilities: [],
    }),
    makeAccount({ userId: "usr_ada" }),
  ];
  const identities = new Map<string, UserIdentity[]>([
    ["usr_ada", [makeIdentity()]],
    [
      "usr_null_profile",
      [makeIdentity({
        identityId: "idn_local_null",
        userId: "usr_null_profile",
        provider: "local",
        subject: "null-profile",
        displayName: null,
        email: null,
        emailVerified: false,
      })],
    ],
  ]);

  const result = await createAuthUsersListHandler({
    listPage: () => Promise.resolve(accounts),
  }, {
    listByUser: (userId) => Promise.resolve(identities.get(userId) ?? []),
  }, logger)({
    input: { limit: 10 },
    context: { caller: userCaller },
  });

  assertEquals(result.take(), {
    entries: [{
      userId: "usr_ada",
      name: "Ada Lovelace",
      email: "ada@example.com",
      active: true,
      capabilities: ["catalog.read"],
      capabilityGroups: [],
      identities: [{
        identityId: "idn_github_ada",
        provider: "github",
        subject: "ada",
        displayName: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        linkedAt: "2026-04-26T00:00:01.000Z",
        lastLoginAt: null,
      }],
    }, {
      userId: "usr_null_profile",
      active: true,
      capabilities: [],
      capabilityGroups: [],
      identities: [{
        identityId: "idn_local_null",
        provider: "local",
        subject: "null-profile",
        displayName: null,
        email: null,
        emailVerified: false,
        linkedAt: "2026-04-26T00:00:01.000Z",
        lastLoginAt: null,
      }],
    }],
    count: 0,
    offset: 0,
    limit: 10,
    nextOffset: undefined,
  });
});

Deno.test("Auth.Users.Get returns one account with linked identities in stable order", async () => {
  const account = makeAccount();
  const identities = [
    makeIdentity({ identityId: "idn_zed", subject: "zed" }),
    makeIdentity({ identityId: "idn_ada" }),
  ];

  const result = await createAuthUsersGetHandler({
    get: (userId) =>
      Promise.resolve(userId === account.userId ? account : undefined),
  }, {
    listByUser: () => Promise.resolve(identities),
  }, logger)({
    input: { userId: account.userId },
    context: { caller: userCaller },
  });

  assertEquals(result.take(), {
    user: {
      userId: "usr_ada",
      name: "Ada Lovelace",
      email: "ada@example.com",
      active: true,
      capabilities: ["catalog.read"],
      capabilityGroups: [],
      identities: [{
        identityId: "idn_ada",
        provider: "github",
        subject: "ada",
        displayName: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        linkedAt: "2026-04-26T00:00:01.000Z",
        lastLoginAt: null,
      }, {
        identityId: "idn_zed",
        provider: "github",
        subject: "zed",
        displayName: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        linkedAt: "2026-04-26T00:00:01.000Z",
        lastLoginAt: null,
      }],
    },
  });
});

Deno.test("Auth.Users.Get returns user_not_found for a missing account", async () => {
  const result = await createAuthUsersGetHandler({
    get: () => Promise.resolve(undefined),
  }, {
    listByUser: () => Promise.resolve([]),
  }, logger)({
    input: { userId: "usr_missing" },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "user_not_found");
  assertEquals(value.error.toSerializable().context, { userId: "usr_missing" });
});

Deno.test("Auth.Users.Create creates an identityless account with defaults", async () => {
  let saved: UserAccount | undefined;

  const result = await createAuthUsersCreateHandler({
    create: (record) => {
      saved = record;
      return Promise.resolve(true);
    },
  }, logger)({
    input: {},
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(!isErr(value));
  assertMatch(value.user.userId, /^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
  assertEquals(value.user.active, true);
  assertEquals(value.user.capabilities, []);
  assertEquals(value.user.capabilityGroups, []);
  assertEquals(value.user.identities, []);
  assertEquals(Reflect.has(value.user, "name"), false);
  assertEquals(Reflect.has(value.user, "email"), false);

  assert(saved !== undefined);
  assertEquals(saved.userId, value.user.userId);
  assertEquals(saved.name, null);
  assertEquals(saved.email, null);
  assertEquals(saved.active, true);
  assertEquals(saved.capabilities, []);
  assertEquals(saved.capabilityGroups, []);
  assertEquals(saved.createdAt, saved.updatedAt);
  assertMatch(saved.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test("Auth.Users.Create stores explicit account fields", async () => {
  let saved: UserAccount | undefined;

  const result = await createAuthUsersCreateHandler({
    create: (record) => {
      saved = record;
      return Promise.resolve(true);
    },
  }, logger)({
    input: {
      name: "Grace Hopper",
      email: "grace@example.com",
      active: false,
      capabilities: ["catalog.read"],
      capabilityGroups: ["customer.default"],
    },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(!isErr(value));
  assertMatch(value.user.userId, /^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
  assertEquals(value, {
    user: {
      userId: value.user.userId,
      name: "Grace Hopper",
      email: "grace@example.com",
      active: false,
      capabilities: ["catalog.read"],
      capabilityGroups: ["customer.default"],
      identities: [],
    },
  });
  assert(saved !== undefined);
  assertEquals(saved.userId, value.user.userId);
  assertEquals(saved.name, "Grace Hopper");
  assertEquals(saved.email, "grace@example.com");
  assertEquals(saved.capabilityGroups, ["customer.default"]);
});

Deno.test("Auth.Users.Create can create the initial local identity", async () => {
  let savedAccount: UserAccount | undefined;
  let savedIdentity: UserIdentity | undefined;

  const result = await createAuthUsersCreateHandler({
    create: () => Promise.resolve(false),
    createWithLocalIdentity: (account, identity) => {
      savedAccount = account;
      savedIdentity = identity;
      return Promise.resolve({ ok: true });
    },
  }, logger)({
    input: {
      name: "Grace Hopper",
      email: "grace@example.com",
      username: "grace",
    },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(!isErr(value));
  assertMatch(value.user.userId, /^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert(savedAccount !== undefined);
  assert(savedIdentity !== undefined);
  assertEquals(value.user.identities, [{
    identityId: identityIdForProviderSubject("local", "grace"),
    provider: "local",
    subject: "grace",
    displayName: "Grace Hopper",
    email: "grace@example.com",
    emailVerified: false,
    linkedAt: savedIdentity.linkedAt,
    lastLoginAt: null,
  }]);
  assertEquals(savedIdentity.userId, savedAccount.userId);
  assertEquals(savedIdentity.subject, "grace");
});

Deno.test("Auth.Users.Create rejects duplicate local usernames", async () => {
  const result = await createAuthUsersCreateHandler({
    create: () => Promise.resolve(false),
    createWithLocalIdentity: () =>
      Promise.resolve({ ok: false, error: "identity_already_exists" }),
  }, logger)({
    input: { username: "grace" },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "username_taken");
  assertEquals(value.error.message, "That username is already in use.");
  assertEquals(value.error.toSerializable().context?.username, "grace");
});

Deno.test("Auth.Users.Create reports generated userId collisions", async () => {
  let createCalled = false;
  let generatedUserId = "";

  const result = await createAuthUsersCreateHandler({
    create: (record) => {
      createCalled = true;
      generatedUserId = record.userId;
      return Promise.resolve(false);
    },
  }, logger)({
    input: {},
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "user_already_exists");
  assertEquals(value.error.toSerializable().context, {
    userId: generatedUserId,
  });
  assertEquals(createCalled, true);
  assertMatch(generatedUserId, /^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
});

Deno.test("Auth.Users.Update updates account row and preserves createdAt", async () => {
  const existing = makeAccount();
  let saved: UserAccount | undefined;

  const result = await createAuthUsersUpdateHandler({
    get: (userId) =>
      Promise.resolve(
        userId === existing.userId ? existing : undefined,
      ),
    listPage: () => Promise.resolve([existing]),
    put: (record) => {
      saved = record;
      return Promise.resolve();
    },
  }, logger)({
    input: {
      userId: existing.userId,
      active: false,
      capabilities: ["admin"],
      capabilityGroups: ["customer.default"],
      name: "Ada Admin",
      email: "admin@example.com",
    },
    context: { caller: userCaller },
  });

  assertEquals(result.take(), { success: true });
  assert(saved !== undefined);
  assertEquals(saved.userId, existing.userId);
  assertEquals(saved.createdAt, existing.createdAt);
  assertEquals(saved.active, false);
  assertEquals(saved.capabilities, ["admin"]);
  assertEquals(saved.capabilityGroups, ["customer.default"]);
  assertEquals(saved.name, "Ada Admin");
  assertEquals(saved.email, "admin@example.com");
  assertMatch(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test("Auth.Users.Update returns user_not_found for missing account", async () => {
  const result = await createAuthUsersUpdateHandler({
    get: () => Promise.resolve(undefined),
    listPage: () => Promise.resolve([]),
    put: () => Promise.resolve(),
  }, logger)({
    input: { userId: "usr_missing", active: false },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "user_not_found");
});

Deno.test("Auth.Users.Update rejects deactivating the only active admin", async () => {
  const existing = makeAccount({ capabilities: ["admin"] });
  let saved: UserAccount | undefined;

  const result = await createAuthUsersUpdateHandler({
    get: (userId) =>
      Promise.resolve(userId === existing.userId ? existing : undefined),
    listPage: () => Promise.resolve([existing]),
    put: (record) => {
      saved = record;
      return Promise.resolve();
    },
  }, logger)({
    input: { userId: existing.userId, active: false },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "last_admin_required");
  assertEquals(value.error.toSerializable().context, {
    userId: existing.userId,
  });
  assertEquals(saved, undefined);
});

Deno.test("Auth.Users.Update rejects removing admin from the only active admin", async () => {
  const existing = makeAccount({ capabilities: ["admin", "catalog.read"] });
  let saved: UserAccount | undefined;

  const result = await createAuthUsersUpdateHandler({
    get: (userId) =>
      Promise.resolve(userId === existing.userId ? existing : undefined),
    listPage: () => Promise.resolve([existing]),
    put: (record) => {
      saved = record;
      return Promise.resolve();
    },
  }, logger)({
    input: { userId: existing.userId, capabilities: ["catalog.read"] },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "last_admin_required");
  assertEquals(value.error.toSerializable().context, {
    userId: existing.userId,
  });
  assertEquals(saved, undefined);
});

Deno.test("Auth.Users.Update treats capability-group admin as an active admin", async () => {
  const existing = makeAccount({ capabilityGroups: ["admin"] });
  let saved: UserAccount | undefined;

  const result = await createAuthUsersUpdateHandler({
    get: (userId) =>
      Promise.resolve(userId === existing.userId ? existing : undefined),
    listPage: () => Promise.resolve([existing]),
    put: (record) => {
      saved = record;
      return Promise.resolve();
    },
  }, logger)({
    input: { userId: existing.userId, active: false },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "last_admin_required");
  assertEquals(saved, undefined);
});

Deno.test("Auth.Users.Update allows converting direct admin to admin group", async () => {
  const existing = makeAccount({ capabilities: ["admin"] });
  let saved: UserAccount | undefined;

  const result = await createAuthUsersUpdateHandler({
    get: (userId) =>
      Promise.resolve(userId === existing.userId ? existing : undefined),
    listPage: () => Promise.resolve([existing]),
    put: (record) => {
      saved = record;
      return Promise.resolve();
    },
  }, logger)({
    input: {
      userId: existing.userId,
      capabilities: [],
      capabilityGroups: ["admin"],
    },
    context: { caller: userCaller },
  });

  assertEquals(result.take(), { success: true });
  assert(saved !== undefined);
  assertEquals(saved.capabilities, []);
  assertEquals(saved.capabilityGroups, ["admin"]);
});

Deno.test("Auth.Users.Update allows deactivating admin when another active admin exists", async () => {
  const existing = makeAccount({ capabilities: ["admin"] });
  const otherAdmin = makeAccount({
    userId: "usr_grace",
    capabilities: ["admin"],
  });
  let saved: UserAccount | undefined;

  const result = await createAuthUsersUpdateHandler({
    get: (userId) =>
      Promise.resolve(userId === existing.userId ? existing : undefined),
    listPage: () => Promise.resolve([existing, otherAdmin]),
    put: (record) => {
      saved = record;
      return Promise.resolve();
    },
  }, logger)({
    input: { userId: existing.userId, active: false },
    context: { caller: userCaller },
  });

  assertEquals(result.take(), { success: true });
  assert(saved !== undefined);
  assertEquals(saved.active, false);
});

Deno.test("Auth.Users.Update allows removing admin when another active admin is on a later page", async () => {
  const existing = makeAccount({ capabilities: ["admin"] });
  const accounts = [
    existing,
    ...Array.from({ length: 99 }, (_, index) =>
      makeAccount({
        userId: `usr_non_admin_${index.toString().padStart(3, "0")}`,
        capabilities: ["catalog.read"],
      })),
    makeAccount({ userId: "usr_later_admin", capabilities: ["admin"] }),
  ];
  let saved: UserAccount | undefined;

  const result = await createAuthUsersUpdateHandler({
    get: (userId) =>
      Promise.resolve(userId === existing.userId ? existing : undefined),
    listPage: ({ offset = 0, limit }) =>
      Promise.resolve(accounts.slice(offset, offset + limit)),
    put: (record) => {
      saved = record;
      return Promise.resolve();
    },
  }, logger)({
    input: { userId: existing.userId, capabilities: ["catalog.read"] },
    context: { caller: userCaller },
  });

  assertEquals(result.take(), { success: true });
  assert(saved !== undefined);
  assertEquals(saved.capabilities, ["catalog.read"]);
});

Deno.test("Auth.UserIdentities.List returns identities for an existing account in stable order", async () => {
  const account = makeAccount();
  const identities = [
    makeIdentity({ identityId: "idn_zed", subject: "zed" }),
    makeIdentity({ identityId: "idn_ada" }),
  ];

  const result = await createAuthUserIdentitiesListHandler({
    get: (userId) =>
      Promise.resolve(userId === account.userId ? account : undefined),
  }, {
    listByUser: () => Promise.resolve(identities),
  }, logger)({
    input: { userId: account.userId },
    context: { caller: userCaller },
  });

  assertEquals(result.take(), {
    entries: [{
      identityId: "idn_ada",
      provider: "github",
      subject: "ada",
      displayName: "Ada",
      email: "ada@example.com",
      emailVerified: true,
      linkedAt: "2026-04-26T00:00:01.000Z",
      lastLoginAt: null,
    }, {
      identityId: "idn_zed",
      provider: "github",
      subject: "zed",
      displayName: "Ada",
      email: "ada@example.com",
      emailVerified: true,
      linkedAt: "2026-04-26T00:00:01.000Z",
      lastLoginAt: null,
    }],
    count: 0,
    offset: 0,
    limit: 500,
    nextOffset: undefined,
  });
});

Deno.test("Auth.UserIdentities.List returns user_not_found for a missing account", async () => {
  const result = await createAuthUserIdentitiesListHandler({
    get: () => Promise.resolve(undefined),
  }, {
    listByUser: () => Promise.resolve([]),
  }, logger)({
    input: { userId: "usr_missing" },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "user_not_found");
});

Deno.test("Auth.UserIdentities.Unlink removes an associated identity", async () => {
  const account = makeAccount({ capabilities: ["admin"] });
  const identities = [
    makeIdentity({ identityId: "idn_ada" }),
    makeIdentity({ identityId: "idn_local_ada", provider: "local" }),
  ];
  let unlinked: { userId: string; identityId: string } | undefined;

  const result = await createAuthUserIdentitiesUnlinkHandler({
    get: (userId) =>
      Promise.resolve(userId === account.userId ? account : undefined),
    listPage: () => Promise.resolve([account]),
    put: () => Promise.resolve(),
  }, {
    listByUser: () => Promise.resolve(identities),
    unlink: (userId, identityId) => {
      unlinked = { userId, identityId };
      return Promise.resolve(true);
    },
  }, logger)({
    input: { userId: account.userId, identityId: "idn_local_ada" },
    context: { caller: userCaller },
  });

  assertEquals(result.take(), { success: true });
  assertEquals(unlinked, {
    userId: account.userId,
    identityId: "idn_local_ada",
  });
});

Deno.test("Auth.UserIdentities.Unlink returns identity_not_found for an unassociated identity", async () => {
  const account = makeAccount();
  let unlinkCalled = false;

  const result = await createAuthUserIdentitiesUnlinkHandler({
    get: (userId) =>
      Promise.resolve(userId === account.userId ? account : undefined),
    listPage: () => Promise.resolve([account]),
    put: () => Promise.resolve(),
  }, {
    listByUser: () =>
      Promise.resolve([makeIdentity({ identityId: "idn_ada" })]),
    unlink: () => {
      unlinkCalled = true;
      return Promise.resolve(true);
    },
  }, logger)({
    input: { userId: account.userId, identityId: "idn_other" },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "identity_not_found");
  assertEquals(unlinkCalled, false);
});

Deno.test("Auth.UserIdentities.Unlink returns identity_not_found when delete is a no-op", async () => {
  const account = makeAccount();

  const result = await createAuthUserIdentitiesUnlinkHandler({
    get: (userId) =>
      Promise.resolve(userId === account.userId ? account : undefined),
    listPage: () => Promise.resolve([account]),
    put: () => Promise.resolve(),
  }, {
    listByUser: () => Promise.resolve([makeIdentity()]),
    unlink: () => Promise.resolve(false),
  }, logger)({
    input: { userId: account.userId, identityId: "idn_github_ada" },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "identity_not_found");
});

Deno.test("Auth.UserIdentities.Unlink rejects the last identity from the only active admin", async () => {
  const account = makeAccount({ capabilities: ["admin"] });
  let unlinkCalled = false;

  const result = await createAuthUserIdentitiesUnlinkHandler({
    get: (userId) =>
      Promise.resolve(userId === account.userId ? account : undefined),
    listPage: () => Promise.resolve([account]),
    put: () => Promise.resolve(),
  }, {
    listByUser: () => Promise.resolve([makeIdentity()]),
    unlink: () => {
      unlinkCalled = true;
      return Promise.resolve(true);
    },
  }, logger)({
    input: { userId: account.userId, identityId: "idn_github_ada" },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "last_admin_required");
  assertEquals(unlinkCalled, false);
});

Deno.test("Auth.UserIdentities.Unlink treats capability-group admin as last admin", async () => {
  const account = makeAccount({ capabilityGroups: ["admin"] });
  let unlinkCalled = false;

  const result = await createAuthUserIdentitiesUnlinkHandler({
    get: (userId) =>
      Promise.resolve(userId === account.userId ? account : undefined),
    listPage: () => Promise.resolve([account]),
    put: () => Promise.resolve(),
  }, {
    listByUser: () => Promise.resolve([makeIdentity()]),
    unlink: () => {
      unlinkCalled = true;
      return Promise.resolve(true);
    },
  }, logger)({
    input: { userId: account.userId, identityId: "idn_github_ada" },
    context: { caller: userCaller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "last_admin_required");
  assertEquals(unlinkCalled, false);
});
