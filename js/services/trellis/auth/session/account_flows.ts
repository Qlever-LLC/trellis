import { isErr, Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import type { AuthLogger } from "../runtime_deps.ts";
import type {
  AccountFlow,
  AccountFlowKind,
  LocalCredential,
  Session,
  UserAccount,
  UserIdentity,
} from "../schemas.ts";
import type {
  SqlAccountFlowRepository,
  SqlUserAccountRepository,
} from "../storage.ts";
import { requireAdminFreshAuth } from "../admin/shared.ts";
import { hashKey, randomToken } from "../crypto.ts";
import {
  createLocalCredentialPassword,
  verifyLocalCredentialPassword,
} from "../local_credentials/passwords.ts";
import { revokeRuntimeAccessForSession } from "./revoke_runtime_access.ts";

type RpcCaller = {
  type: string;
  userId?: string;
  capabilities?: string[];
  lastAuth?: string;
};
type RpcUser = { userId: string; capabilities?: string[] };
type AccountFlowAccountStorage = Pick<SqlUserAccountRepository, "get">;
type AccountFlowStorage = Pick<SqlAccountFlowRepository, "put">;
type LocalCredentialStorage = {
  get(identityId: string): Promise<LocalCredential | undefined>;
  put(record: LocalCredential): Promise<void>;
};
type SessionStorage = {
  listEntriesByUser: (
    userId: string,
  ) => Promise<Array<{ sessionKey: string; session: Session }>>;
  deleteBySessionKey: (sessionKey: string) => Promise<void>;
};
type RuntimeConnectionKV = Parameters<typeof revokeRuntimeAccessForSession>[0][
  "connectionsKV"
];
type PublishSessionRevoked = (event: {
  origin: string;
  id: string;
  sessionKey: string;
  revokedBy: string;
}) => Promise<void>;
type AccountFlowIdentityStorage = {
  listByUser(userId: string): Promise<UserIdentity[]>;
};
type AccountFlowCreateInput = {
  userId: string;
  allowedProviders?: string[];
  expiresInSeconds?: number;
  returnTo?: string;
};
type IdentityLinkCreateInput = {
  returnTo?: string;
};
type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
};

const DEFAULT_ACCOUNT_FLOW_TTL_SECONDS = 24 * 60 * 60;
const MIN_ACCOUNT_FLOW_TTL_SECONDS = 60;
const MAX_ACCOUNT_FLOW_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACCOUNT_FLOW_TOKEN_BYTES = 32;

export type LocalPasswordResetFlowBinding = {
  localIdentityId: string;
  localUsername: string;
};

const ACCOUNT_FLOW_ROUTES = {
  identity_link: "/_trellis/portal/account/link",
  local_password_reset: "/_trellis/portal/account/password",
} as const satisfies Record<
  Exclude<AccountFlowKind, "admin_bootstrap">,
  string
>;

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

function requireFreshAdminCaller(caller: RpcCaller, now?: Date) {
  return requireAdminFreshAuth(caller, { now });
}

function expiresAtFrom(now: Date, expiresInSeconds?: number): Date {
  const ttlSeconds = expiresInSeconds === undefined
    ? DEFAULT_ACCOUNT_FLOW_TTL_SECONDS
    : Math.min(
      Math.max(expiresInSeconds, MIN_ACCOUNT_FLOW_TTL_SECONDS),
      MAX_ACCOUNT_FLOW_TTL_SECONDS,
    );
  return new Date(now.getTime() + ttlSeconds * 1_000);
}

function buildAccountFlowUrl(args: {
  baseUrl: string;
  kind: Exclude<AccountFlowKind, "admin_bootstrap">;
  flowId: string;
  returnTo?: string | null;
}): string {
  const url = new URL(ACCOUNT_FLOW_ROUTES[args.kind], args.baseUrl);
  url.searchParams.set("flowId", args.flowId);
  if (args.returnTo) url.searchParams.set("returnTo", args.returnTo);
  return url.toString();
}

function safeRelativeReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;
  return trimmed;
}

async function createAccountFlow(args: {
  accountStorage: AccountFlowAccountStorage;
  accountFlowStorage: AccountFlowStorage;
  logger: Pick<AuthLogger, "trace">;
  rpc: string;
  kind: Exclude<AccountFlowKind, "admin_bootstrap">;
  input: AccountFlowCreateInput;
  caller: RpcCaller;
  portalBaseUrl: string;
  allowedProviders: string[] | null;
  targetIdentityId?: string | null;
  targetLocalUsername?: string | null;
  now?: Date;
}) {
  const caller = requireUserCaller(args.caller);
  args.logger.trace({
    rpc: args.rpc,
    target: args.input.userId,
    caller: caller.userId,
  }, "RPC request");

  const account = await args.accountStorage.get(args.input.userId);
  if (account === undefined) {
    return Result.err(
      new AuthError({
        reason: "user_not_found",
        context: { userId: args.input.userId },
      }),
    );
  }

  const now = args.now ?? new Date();
  const expiresAt = expiresAtFrom(now, args.input.expiresInSeconds);
  const flowId = randomToken(ACCOUNT_FLOW_TOKEN_BYTES);
  const flow: AccountFlow = {
    flowIdHash: await hashKey(flowId),
    kind: args.kind,
    targetUserId: account.userId,
    targetIdentityId: args.targetIdentityId ?? null,
    targetLocalUsername: args.targetLocalUsername ?? null,
    createdByUserId: caller.userId,
    allowedProviders: args.allowedProviders,
    capabilities: null,
    profileHint: null,
    returnTo: safeRelativeReturnTo(args.input.returnTo) ?? null,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    consumedAt: null,
  };

  await args.accountFlowStorage.put(flow);

  return Result.ok({
    flowId,
    url: buildAccountFlowUrl({
      baseUrl: args.portalBaseUrl,
      kind: args.kind,
      flowId,
      returnTo: flow.returnTo,
    }),
    expiresAt: flow.expiresAt,
  });
}

async function requireSingleLocalIdentityForReset(args: {
  userId: string;
  identityStorage: AccountFlowIdentityStorage;
}): Promise<Result<UserIdentity, AuthError>> {
  const localIdentities = (await args.identityStorage.listByUser(args.userId))
    .filter((identity) => identity.provider === "local");
  if (localIdentities.length !== 1) {
    return Result.err(
      new AuthError({
        reason: "invalid_request",
        context: {
          userId: args.userId,
          localIdentityCount: localIdentities.length,
          message: localIdentities.length === 0
            ? "This account does not have a local password to change."
            : "This account has more than one local password identity. Contact an administrator.",
        },
      }),
    );
  }
  return Result.ok(localIdentities[0]!);
}

async function revokeOtherSessionsByUser(args: {
  sessionStorage?: SessionStorage;
  connectionsKV?: RuntimeConnectionKV;
  kick?: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked?: PublishSessionRevoked;
  userId: string;
  currentSessionKey?: string;
  revokedBy: string;
}): Promise<void> {
  const sessionStorage = args.sessionStorage;
  if (!sessionStorage) return;

  const entries = await sessionStorage.listEntriesByUser(args.userId);
  const deleteSession = async (
    entry: { sessionKey: string; session: Session },
  ) => {
    const event = sessionRevocationEvent(
      entry.sessionKey,
      entry.session,
      args.revokedBy,
    );
    if (event && args.publishSessionRevoked) {
      await args.publishSessionRevoked(event);
    }
    await sessionStorage.deleteBySessionKey(entry.sessionKey);
  };
  for (const entry of entries) {
    if (entry.sessionKey === args.currentSessionKey) continue;
    if (!args.connectionsKV || !args.kick) {
      await deleteSession(entry);
      continue;
    }
    await revokeRuntimeAccessForSession({
      sessionKey: entry.sessionKey,
      connectionsKV: args.connectionsKV,
      kick: args.kick,
      deleteSession: () => deleteSession(entry),
    });
  }
}

function sessionRevocationEvent(
  sessionKey: string,
  session: Session,
  revokedBy: string,
): Parameters<PublishSessionRevoked>[0] | null {
  if (session.type === "device") return null;
  if (session.type === "user") {
    return {
      origin: session.identity.provider,
      id: session.identity.subject,
      sessionKey,
      revokedBy,
    };
  }
  return {
    origin: session.origin,
    id: session.id,
    sessionKey,
    revokedBy,
  };
}

/** Creates the self-service Auth.Users.IdentityLink.Create RPC handler. */
export function createAuthUsersIdentityLinkCreateHandler(args: {
  accountStorage: AccountFlowAccountStorage;
  accountFlowStorage: AccountFlowStorage;
  logger: Pick<AuthLogger, "trace">;
  portalBaseUrl: string;
  now?: Date;
}) {
  return async ({ input, context: { caller } }: {
    input: IdentityLinkCreateInput;
    context: {
      caller: RpcCaller;
    };
  }) => {
    void input;
    const user = requireUserCaller(caller);
    return await createAccountFlow({
      ...args,
      rpc: "Auth.Users.IdentityLink.Create",
      kind: "identity_link",
      input: { userId: user.userId, returnTo: input.returnTo },
      caller,
      allowedProviders: null,
    });
  };
}

/** Creates the self-service Auth.Users.Password.Change RPC handler. */
export function createAuthUsersPasswordChangeHandler(args: {
  accountStorage: AccountFlowAccountStorage;
  userIdentityStorage: AccountFlowIdentityStorage;
  localCredentialStorage: LocalCredentialStorage;
  sessionStorage?: SessionStorage;
  connectionsKV?: RuntimeConnectionKV;
  kick?: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked?: PublishSessionRevoked;
  logger: Pick<AuthLogger, "trace">;
  passwordMinLength?: number;
  now?: Date;
}) {
  return async ({ input, context: { caller, sessionKey } }: {
    input: PasswordChangeInput;
    context: {
      caller: RpcCaller;
      sessionKey?: string;
    };
  }) => {
    const user = requireUserCaller(caller);
    args.logger.trace({
      rpc: "Auth.Users.Password.Change",
      target: user.userId,
      caller: user.userId,
    }, "RPC request");

    const account = await args.accountStorage.get(user.userId);
    if (account === undefined) {
      return Result.err(
        new AuthError({
          reason: "user_not_found",
          context: { userId: user.userId },
        }),
      );
    }

    const localIdentity = await requireSingleLocalIdentityForReset({
      userId: account.userId,
      identityStorage: args.userIdentityStorage,
    });
    const localIdentityValue = localIdentity.take();
    if (isErr(localIdentityValue)) return Result.err(localIdentityValue.error);

    const currentCredential = await args.localCredentialStorage.get(
      localIdentityValue.identityId,
    );
    if (currentCredential === undefined) {
      return Result.err(
        new AuthError({
          reason: "invalid_request",
          context: {
            userId: account.userId,
            message: "This account does not have a local password to change.",
          },
        }),
      );
    }

    const currentPasswordMatches = await verifyLocalCredentialPassword(
      currentCredential,
      input.currentPassword,
    );
    if (!currentPasswordMatches) {
      return Result.err(
        new AuthError({
          reason: "invalid_request",
          context: { message: "Current password is incorrect." },
        }),
      );
    }

    let newCredential: LocalCredential;
    try {
      newCredential = await createLocalCredentialPassword({
        identityId: localIdentityValue.identityId,
        password: input.newPassword,
        minLength: args.passwordMinLength,
        now: args.now,
      });
    } catch (error) {
      return Result.err(
        new AuthError({
          reason: "invalid_request",
          context: { message: error instanceof Error ? error.message : "" },
        }),
      );
    }

    await args.localCredentialStorage.put(newCredential);
    await revokeOtherSessionsByUser({
      sessionStorage: args.sessionStorage,
      connectionsKV: args.connectionsKV,
      kick: args.kick,
      publishSessionRevoked: args.publishSessionRevoked,
      userId: account.userId,
      currentSessionKey: sessionKey,
      revokedBy: user.userId,
    });

    return Result.ok({ success: true });
  };
}

/** Creates the Auth.Users.PasswordReset.Create RPC handler backed by SQL storage. */
export function createAuthUsersPasswordResetCreateHandler(args: {
  accountStorage: AccountFlowAccountStorage;
  userIdentityStorage: AccountFlowIdentityStorage;
  accountFlowStorage: AccountFlowStorage;
  logger: Pick<AuthLogger, "trace">;
  portalBaseUrl: string;
  now?: Date;
}) {
  return async ({ input, context: { caller } }: {
    input: Omit<AccountFlowCreateInput, "allowedProviders">;
    context: {
      caller: RpcCaller;
    };
  }) => {
    const authorized = requireFreshAdminCaller(caller, args.now);
    if (authorized.isErr()) return authorized;
    const targetAccount = await args.accountStorage.get(input.userId);
    if (targetAccount === undefined) {
      return Result.err(
        new AuthError({
          reason: "user_not_found",
          context: { userId: input.userId },
        }),
      );
    }
    const localIdentity = await requireSingleLocalIdentityForReset({
      userId: targetAccount.userId,
      identityStorage: args.userIdentityStorage,
    });
    const localIdentityValue = localIdentity.take();
    if (isErr(localIdentityValue)) return Result.err(localIdentityValue.error);
    return await createAccountFlow({
      ...args,
      rpc: "Auth.Users.PasswordReset.Create",
      kind: "local_password_reset",
      input,
      caller,
      allowedProviders: ["local"],
      targetIdentityId: localIdentityValue.identityId,
      targetLocalUsername: localIdentityValue.subject,
    });
  };
}
