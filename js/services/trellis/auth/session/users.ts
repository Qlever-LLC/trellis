import { Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";
import { ulid } from "ulid";

import type { AuthLogger } from "../runtime_deps.ts";
import type {
  CapabilityGroup,
  DeploymentAuthorityCapabilityDefinition,
  UserAccount,
  UserIdentity,
} from "../schemas.ts";
import {
  getBuiltinCapabilityGroup,
  isBuiltinCapabilityGroup,
  resolvesActiveAdmin,
} from "../capability_groups.ts";
import type {
  BoundedListQuery,
  CreateUserWithLocalIdentityResult,
  ListPage,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
} from "../storage.ts";
import { listPage } from "../../storage/list_query.ts";
import { identityIdForProviderSubject } from "../identity.ts";

type RpcUser = { userId: string; capabilities?: string[] };
type UserReadAccountStorage = Pick<SqlUserAccountRepository, "get">;
type UserCreateAccountStorage =
  & Pick<
    SqlUserAccountRepository,
    "create"
  >
  & Partial<Pick<SqlUserAccountRepository, "createWithLocalIdentity">>;
type UserListAccountStorage =
  & Pick<SqlUserAccountRepository, "listPage">
  & Partial<Pick<SqlUserAccountRepository, "listCountedPage">>;
type UserUpdateAccountStorage = Pick<
  SqlUserAccountRepository,
  "get" | "put" | "listPage"
>;
type ActiveAdminAccountStorage = Pick<
  SqlUserAccountRepository,
  "listPage"
>;
type UserListIdentityStorage =
  & Pick<SqlUserIdentityRepository, "listByUser">
  & Partial<Pick<SqlUserIdentityRepository, "listPageByUser">>;
type UserUnlinkIdentityStorage = Pick<
  SqlUserIdentityRepository,
  "listByUser" | "unlink"
>;
type CapabilityGroupStorage = {
  get(groupKey: string): Promise<CapabilityGroup | undefined>;
  listPage(query: BoundedListQuery): Promise<CapabilityGroup[]>;
  listCountedPage?: (
    query: BoundedListQuery,
  ) => Promise<ListPage<CapabilityGroup>>;
  put(record: CapabilityGroup): Promise<void>;
  delete(groupKey: string): Promise<void>;
};

type CapabilityDefinitionStorage = {
  listEnabled(): Promise<DeploymentAuthorityCapabilityDefinition[]>;
};

type CapabilityCatalogEntry = DeploymentAuthorityCapabilityDefinition | {
  key: string;
  displayName: string;
  description: string;
  source: "platform";
};

const ACCOUNT_PAGE_LIMIT = 100;

const PLATFORM_CAPABILITIES: CapabilityCatalogEntry[] = [{
  key: "admin",
  displayName: "Administer Trellis",
  description:
    "Manage Trellis users, sessions, deployments, and runtime policy.",
  source: "platform",
}];

function capabilitySortParts(capability: {
  key: string;
  deploymentId?: string;
  contractId?: string;
  contractDigest?: string;
}): string[] {
  return [
    capability.key,
    capability.deploymentId ?? "",
    capability.contractId ?? "",
    capability.contractDigest ?? "",
  ];
}

function compareCapabilityCatalogEntries(
  left: CapabilityCatalogEntry,
  right: CapabilityCatalogEntry,
): number {
  const leftParts = capabilitySortParts(left);
  const rightParts = capabilitySortParts(right);
  for (const [index, leftPart] of leftParts.entries()) {
    const compared = leftPart.localeCompare(rightParts[index] ?? "");
    if (compared !== 0) return compared;
  }
  return 0;
}

function uniqueCapabilityCatalogEntries(
  entries: CapabilityCatalogEntry[],
): CapabilityCatalogEntry[] {
  const byKey = new Map<string, CapabilityCatalogEntry>();
  for (const entry of entries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
  }
  return [...byKey.values()];
}

function requireUserCaller(caller: {
  type: string;
  userId?: string;
  capabilities?: string[];
}): RpcUser {
  if (caller.type !== "user" || !caller.userId) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
  return {
    userId: caller.userId,
    capabilities: caller.capabilities,
  };
}

async function isActiveAdmin(
  account: {
    active: boolean;
    capabilities: string[];
    capabilityGroups: string[];
  },
  capabilityGroupStorage?: Pick<CapabilityGroupStorage, "get">,
): Promise<boolean> {
  return await resolvesActiveAdmin(account, capabilityGroupStorage);
}

function generateAccountId(): string {
  return `usr_${ulid()}`;
}

function localIdentityForAccount(args: {
  account: UserAccount;
  username: string;
  now: string;
}): UserIdentity {
  return {
    identityId: identityIdForProviderSubject("local", args.username),
    userId: args.account.userId,
    provider: "local",
    subject: args.username,
    displayName: args.account.name,
    email: args.account.email,
    emailVerified: false,
    linkedAt: args.now,
    lastLoginAt: null,
  };
}

function createUserError(
  result:
    | Extract<CreateUserWithLocalIdentityResult, { ok: false }>
    | { ok: false; error: "user_already_exists" },
  context: Record<string, unknown>,
): AuthError {
  if (result.error === "identity_already_exists") {
    return new AuthError({
      reason: "username_taken",
      message: "That username is already in use.",
      context,
    });
  }
  return new AuthError({
    reason: result.error,
    context,
  });
}

function userView(entry: UserAccount, identities: UserIdentity[]) {
  return {
    userId: entry.userId,
    ...(entry.name === null ? {} : { name: entry.name }),
    ...(entry.email === null ? {} : { email: entry.email }),
    active: entry.active,
    capabilities: entry.capabilities,
    capabilityGroups: entry.capabilityGroups,
    identities: identities.map((identity) => ({
      identityId: identity.identityId,
      provider: identity.provider,
      subject: identity.subject,
      displayName: identity.displayName,
      email: identity.email,
      emailVerified: identity.emailVerified,
      linkedAt: identity.linkedAt,
      lastLoginAt: identity.lastLoginAt,
    })).sort((left, right) => left.identityId.localeCompare(right.identityId)),
  };
}

async function hasOtherActiveAdmin(
  accountStorage: ActiveAdminAccountStorage,
  userId: string,
  capabilityGroupStorage?: Pick<CapabilityGroupStorage, "get">,
): Promise<boolean> {
  for (let offset = 0;; offset += ACCOUNT_PAGE_LIMIT) {
    const page = await accountStorage.listPage({
      offset,
      limit: ACCOUNT_PAGE_LIMIT,
    });
    if (
      (await Promise.all(
        page
          .filter((account) => account.userId !== userId)
          .map((account) => isActiveAdmin(account, capabilityGroupStorage)),
      )).some((isAdmin) => isAdmin)
    ) {
      return true;
    }
    if (page.length < ACCOUNT_PAGE_LIMIT) return false;
  }
}

/** Creates the Auth.Users.List RPC handler backed by SQL user storage. */
export function createAuthUsersListHandler(
  accountStorage: UserListAccountStorage,
  identityStorage: UserListIdentityStorage,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    {
      input,
      context: { caller },
    }: {
      input: BoundedListQuery;
      context: {
        caller: {
          type: string;
          userId?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace(
      { rpc: "Auth.Users.List", caller: user.userId },
      "RPC request",
    );

    const page = accountStorage.listCountedPage
      ? await accountStorage.listCountedPage(input)
      : listPage(await accountStorage.listPage(input), 0, input);
    const users = await Promise.all(
      page.entries.map(async (entry) => {
        const identities = await identityStorage.listByUser(entry.userId);
        return userView(entry, identities);
      }),
    );

    users.sort((a, b) => a.userId.localeCompare(b.userId));
    return Result.ok({ ...page, entries: users });
  };
}

/** Creates the Auth.Users.Get RPC handler backed by SQL user storage. */
export function createAuthUsersGetHandler(
  accountStorage: UserReadAccountStorage,
  identityStorage: UserListIdentityStorage,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { userId: string };
      context: {
        caller: {
          type: string;
          userId?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.Users.Get",
      target: req.userId,
      caller: user.userId,
    }, "RPC request");

    const account = await accountStorage.get(req.userId);
    if (account === undefined) {
      return Result.err(
        new AuthError({
          reason: "user_not_found",
          context: { userId: req.userId },
        }),
      );
    }

    const identities = await identityStorage.listByUser(req.userId);
    return Result.ok({ user: userView(account, identities) });
  };
}

/** Creates the Auth.Users.Create RPC handler backed by SQL user storage. */
export function createAuthUsersCreateHandler(
  accountStorage: UserCreateAccountStorage,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: {
        name?: string;
        email?: string;
        username?: string;
        active?: boolean;
        capabilities?: string[];
        capabilityGroups?: string[];
      };
      context: {
        caller: {
          type: string;
          userId?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const callerUser = requireUserCaller(caller);
    const userId = generateAccountId();
    logger.trace({
      rpc: "Auth.Users.Create",
      target: userId,
      caller: callerUser.userId,
    }, "RPC request");

    const now = new Date().toISOString();
    const account: UserAccount = {
      userId,
      name: req.name ?? null,
      email: req.email ?? null,
      active: req.active ?? true,
      capabilities: req.capabilities ?? [],
      capabilityGroups: req.capabilityGroups ?? [],
      createdAt: now,
      updatedAt: now,
    };

    const identity = req.username === undefined
      ? undefined
      : localIdentityForAccount({
        account,
        username: req.username,
        now,
      });

    if (identity) {
      if (!accountStorage.createWithLocalIdentity) {
        throw new Error(
          "User storage does not support local identity creation",
        );
      }
      const created = await accountStorage.createWithLocalIdentity(
        account,
        identity,
      );
      if (!created.ok) {
        return Result.err(createUserError(created, {
          userId,
          username: req.username,
        }));
      }

      return Result.ok({ user: userView(account, [identity]) });
    }

    const created = await accountStorage.create(account);
    if (!created) {
      return Result.err(
        createUserError({ ok: false, error: "user_already_exists" }, {
          userId,
        }),
      );
    }

    return Result.ok({ user: userView(account, []) });
  };
}

/** Creates the Auth.Capabilities.List RPC handler backed by deployment authority. */
export function createAuthCapabilitiesListHandler(
  capabilityDefinitions: CapabilityDefinitionStorage,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    {
      input,
      context: { caller },
    }: {
      input: BoundedListQuery;
      context: {
        caller: {
          type: string;
          userId?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace(
      { rpc: "Auth.Capabilities.List", caller: user.userId },
      "RPC request",
    );

    const capabilities = uniqueCapabilityCatalogEntries([
      ...PLATFORM_CAPABILITIES,
      ...(await capabilityDefinitions.listEnabled()),
    ].sort(compareCapabilityCatalogEntries));

    const offset = input.offset ?? 0;
    return Result.ok(listPage(
      capabilities.slice(offset, offset + input.limit),
      capabilities.length,
      input,
    ));
  };
}

function capabilityGroupView(group: CapabilityGroup) {
  return {
    groupKey: group.groupKey,
    displayName: group.displayName,
    description: group.description,
    capabilities: group.capabilities,
    includedGroups: group.includedGroups,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

/** Creates the Auth.CapabilityGroups.List RPC handler backed by SQL storage. */
export function createAuthCapabilityGroupsListHandler(
  storage: Pick<CapabilityGroupStorage, "listPage" | "listCountedPage">,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    { input, context: { caller } }: {
      input: BoundedListQuery;
      context: { caller: { type: string; userId?: string } };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace(
      { rpc: "Auth.CapabilityGroups.List", caller: user.userId },
      "RPC request",
    );
    const groups = storage.listCountedPage
      ? await storage.listCountedPage(input)
      : listPage(await storage.listPage(input), 0, input);
    return Result.ok({
      ...groups,
      entries: groups.entries.map(capabilityGroupView),
    });
  };
}

/** Creates the Auth.CapabilityGroups.Get RPC handler backed by SQL storage. */
export function createAuthCapabilityGroupsGetHandler(
  storage: Pick<CapabilityGroupStorage, "get">,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    { input: req, context: { caller } }: {
      input: { groupKey: string };
      context: { caller: { type: string; userId?: string } };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.CapabilityGroups.Get",
      groupKey: req.groupKey,
      caller: user.userId,
    }, "RPC request");
    const group = getBuiltinCapabilityGroup(req.groupKey) ??
      await storage.get(req.groupKey);
    if (!group) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }
    return Result.ok({ group: capabilityGroupView(group) });
  };
}

/** Creates the Auth.CapabilityGroups.Put RPC handler backed by SQL storage. */
export function createAuthCapabilityGroupsPutHandler(
  storage: Pick<CapabilityGroupStorage, "put">,
  capabilityDefinitions: CapabilityDefinitionStorage,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    { input: req, context: { caller } }: {
      input: {
        groupKey: string;
        displayName: string;
        description: string;
        capabilities?: string[];
        includedGroups?: string[];
      };
      context: { caller: { type: string; userId?: string } };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.CapabilityGroups.Put",
      groupKey: req.groupKey,
      caller: user.userId,
    }, "RPC request");
    if (isBuiltinCapabilityGroup(req.groupKey)) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }
    const catalogedCapabilities = new Set([
      ...PLATFORM_CAPABILITIES.map((capability) => capability.key),
      ...(await capabilityDefinitions.listEnabled()).map((capability) =>
        capability.key
      ),
    ]);
    const unknownCapabilities = (req.capabilities ?? []).filter((capability) =>
      !catalogedCapabilities.has(capability)
    );
    if (unknownCapabilities.length > 0) {
      return Result.err(
        new AuthError({
          reason: "invalid_request",
          context: { capabilities: unknownCapabilities },
        }),
      );
    }
    const now = new Date().toISOString();
    const group: CapabilityGroup = {
      groupKey: req.groupKey,
      displayName: req.displayName,
      description: req.description,
      capabilities: req.capabilities ?? [],
      includedGroups: req.includedGroups ?? [],
      createdAt: now,
      updatedAt: now,
    };
    await storage.put(group);
    return Result.ok({ group: capabilityGroupView(group) });
  };
}

/** Creates the Auth.CapabilityGroups.Delete RPC handler backed by SQL storage. */
export function createAuthCapabilityGroupsDeleteHandler(
  storage: Pick<CapabilityGroupStorage, "delete">,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    { input: req, context: { caller } }: {
      input: { groupKey: string };
      context: { caller: { type: string; userId?: string } };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.CapabilityGroups.Delete",
      groupKey: req.groupKey,
      caller: user.userId,
    }, "RPC request");
    if (isBuiltinCapabilityGroup(req.groupKey)) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }
    await storage.delete(req.groupKey);
    return Result.ok({ success: true });
  };
}

/** Creates the Auth.Users.Update RPC handler backed by SQL user storage. */
export function createAuthUsersUpdateHandler(
  accountStorage: UserUpdateAccountStorage,
  logger: Pick<AuthLogger, "trace">,
  capabilityGroupStorage?: Pick<CapabilityGroupStorage, "get">,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: {
        userId: string;
        active?: boolean;
        capabilities?: string[];
        capabilityGroups?: string[];
        name?: string;
        email?: string;
      };
      context: {
        caller: {
          type: string;
          userId?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.Users.Update",
      target: req.userId,
      caller: user.userId,
    }, "RPC request");

    const existing = await accountStorage.get(req.userId);
    if (existing === undefined) {
      return Result.err(
        new AuthError({
          reason: "user_not_found",
          context: { userId: req.userId },
        }),
      );
    }

    const updated = { ...existing, updatedAt: new Date().toISOString() };
    if (req.active !== undefined) updated.active = req.active;
    if (req.capabilities !== undefined) updated.capabilities = req.capabilities;
    if (req.capabilityGroups !== undefined) {
      updated.capabilityGroups = req.capabilityGroups;
    }
    if (req.name !== undefined) updated.name = req.name;
    if (req.email !== undefined) updated.email = req.email;

    if (
      await isActiveAdmin(existing, capabilityGroupStorage) &&
      !(await isActiveAdmin(updated, capabilityGroupStorage)) &&
      !(await hasOtherActiveAdmin(
        accountStorage,
        req.userId,
        capabilityGroupStorage,
      ))
    ) {
      return Result.err(
        new AuthError({
          reason: "last_admin_required",
          context: { userId: req.userId },
        }),
      );
    }

    await accountStorage.put(updated);

    return Result.ok({ success: true });
  };
}

/** Creates the Auth.UserIdentities.List RPC handler backed by SQL user storage. */
export function createAuthUserIdentitiesListHandler(
  accountStorage: Pick<SqlUserAccountRepository, "get">,
  identityStorage: UserListIdentityStorage,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { userId: string; offset?: number; limit?: number };
      context: {
        caller: {
          type: string;
          userId?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.UserIdentities.List",
      target: req.userId,
      caller: user.userId,
    }, "RPC request");

    const account = await accountStorage.get(req.userId);
    if (account === undefined) {
      return Result.err(
        new AuthError({
          reason: "user_not_found",
          context: { userId: req.userId },
        }),
      );
    }

    const query = { offset: req.offset, limit: req.limit ?? 500 };
    const page = identityStorage.listPageByUser
      ? await identityStorage.listPageByUser(req.userId, query)
      : listPage(await identityStorage.listByUser(req.userId), 0, query);
    const identities = page.entries.map(
      (identity) => ({
        identityId: identity.identityId,
        provider: identity.provider,
        subject: identity.subject,
        displayName: identity.displayName,
        email: identity.email,
        emailVerified: identity.emailVerified,
        linkedAt: identity.linkedAt,
        lastLoginAt: identity.lastLoginAt,
      }),
    ).sort((left, right) => left.identityId.localeCompare(right.identityId));

    return Result.ok({ ...page, entries: identities });
  };
}

/** Creates the Auth.UserIdentities.Unlink RPC handler backed by SQL user storage. */
export function createAuthUserIdentitiesUnlinkHandler(
  accountStorage: UserUpdateAccountStorage,
  identityStorage: UserUnlinkIdentityStorage,
  logger: Pick<AuthLogger, "trace">,
  capabilityGroupStorage?: Pick<CapabilityGroupStorage, "get">,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { userId: string; identityId: string };
      context: {
        caller: {
          type: string;
          userId?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.UserIdentities.Unlink",
      target: req.userId,
      identityId: req.identityId,
      caller: user.userId,
    }, "RPC request");

    const account = await accountStorage.get(req.userId);
    if (account === undefined) {
      return Result.err(
        new AuthError({
          reason: "user_not_found",
          context: { userId: req.userId },
        }),
      );
    }

    const identities = await identityStorage.listByUser(req.userId);
    if (
      !identities.some((identity) => identity.identityId === req.identityId)
    ) {
      return Result.err(
        new AuthError({
          reason: "identity_not_found",
          context: { userId: req.userId, identityId: req.identityId },
        }),
      );
    }

    if (
      await isActiveAdmin(account, capabilityGroupStorage) &&
      identities.length <= 1 &&
      !(await hasOtherActiveAdmin(
        accountStorage,
        req.userId,
        capabilityGroupStorage,
      ))
    ) {
      return Result.err(
        new AuthError({
          reason: "last_admin_required",
          context: { userId: req.userId, identityId: req.identityId },
        }),
      );
    }

    const unlinked = await identityStorage.unlink(req.userId, req.identityId);
    if (!unlinked) {
      return Result.err(
        new AuthError({
          reason: "identity_not_found",
          context: { userId: req.userId, identityId: req.identityId },
        }),
      );
    }

    return Result.ok({ success: true });
  };
}
