import { Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import type { AuthLogger } from "../runtime_deps.ts";
import type { AccountFlow, AccountFlowKind, UserAccount } from "../schemas.ts";
import type {
  SqlAccountFlowRepository,
  SqlUserAccountRepository,
} from "../storage.ts";
import { hashKey, randomToken } from "../crypto.ts";

type RpcUser = { userId: string; capabilities?: string[] };
type AccountFlowAccountStorage = Pick<SqlUserAccountRepository, "get">;
type AccountFlowStorage = Pick<SqlAccountFlowRepository, "put">;
type AccountFlowCreateInput = {
  userId: string;
  allowedProviders?: string[];
  profileHint?: Record<string, unknown>;
  expiresInSeconds?: number;
};

const DEFAULT_ACCOUNT_FLOW_TTL_SECONDS = 24 * 60 * 60;
const MIN_ACCOUNT_FLOW_TTL_SECONDS = 60;
const MAX_ACCOUNT_FLOW_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACCOUNT_FLOW_TOKEN_BYTES = 32;

const ACCOUNT_FLOW_ROUTES = {
  account_invite: "/_trellis/portal/admin/invite",
  identity_link: "/_trellis/portal/account/link",
  local_password_setup: "/_trellis/portal/account/password",
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
}): string {
  const url = new URL(ACCOUNT_FLOW_ROUTES[args.kind], args.baseUrl);
  url.searchParams.set("flowId", args.flowId);
  return url.toString();
}

async function createAccountFlow(args: {
  accountStorage: AccountFlowAccountStorage;
  accountFlowStorage: AccountFlowStorage;
  logger: Pick<AuthLogger, "trace">;
  rpc: string;
  kind: Exclude<AccountFlowKind, "admin_bootstrap">;
  input: AccountFlowCreateInput;
  caller: { type: string; userId?: string; capabilities?: string[] };
  portalBaseUrl: string;
  allowedProviders: string[] | null;
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
    createdByUserId: caller.userId,
    allowedProviders: args.allowedProviders,
    capabilities: null,
    profileHint: args.input.profileHint ?? null,
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
    }),
    expiresAt: flow.expiresAt,
  });
}

/** Creates the Auth.AccountFlows.CreateInvite RPC handler backed by SQL storage. */
export function createAuthAccountFlowsCreateInviteHandler(args: {
  accountStorage: AccountFlowAccountStorage;
  accountFlowStorage: AccountFlowStorage;
  logger: Pick<AuthLogger, "trace">;
  portalBaseUrl: string;
  now?: Date;
}) {
  return async ({ input, context: { caller } }: {
    input: AccountFlowCreateInput;
    context: {
      caller: { type: string; userId?: string; capabilities?: string[] };
    };
  }) =>
    await createAccountFlow({
      ...args,
      rpc: "Auth.AccountFlows.CreateInvite",
      kind: "account_invite",
      input,
      caller,
      allowedProviders: input.allowedProviders ?? null,
    });
}

/** Creates the self-service Auth.AccountFlows.CreateIdentityLink RPC handler. */
export function createAuthAccountFlowsCreateIdentityLinkHandler(args: {
  accountStorage: AccountFlowAccountStorage;
  accountFlowStorage: AccountFlowStorage;
  logger: Pick<AuthLogger, "trace">;
  portalBaseUrl: string;
  now?: Date;
}) {
  return async ({ input, context: { caller } }: {
    input: object;
    context: {
      caller: { type: string; userId?: string; capabilities?: string[] };
    };
  }) => {
    void input;
    const user = requireUserCaller(caller);
    return await createAccountFlow({
      ...args,
      rpc: "Auth.AccountFlows.CreateIdentityLink",
      kind: "identity_link",
      input: { userId: user.userId },
      caller,
      allowedProviders: null,
    });
  };
}

/** Creates the Auth.AccountFlows.CreatePasswordSetup RPC handler backed by SQL storage. */
export function createAuthAccountFlowsCreatePasswordSetupHandler(args: {
  accountStorage: AccountFlowAccountStorage;
  accountFlowStorage: AccountFlowStorage;
  logger: Pick<AuthLogger, "trace">;
  portalBaseUrl: string;
  now?: Date;
}) {
  return async ({ input, context: { caller } }: {
    input: Omit<AccountFlowCreateInput, "allowedProviders">;
    context: {
      caller: { type: string; userId?: string; capabilities?: string[] };
    };
  }) =>
    await createAccountFlow({
      ...args,
      rpc: "Auth.AccountFlows.CreatePasswordSetup",
      kind: "local_password_setup",
      input,
      caller,
      allowedProviders: ["local"],
    });
}

/** Creates the Auth.AccountFlows.CreatePasswordReset RPC handler backed by SQL storage. */
export function createAuthAccountFlowsCreatePasswordResetHandler(args: {
  accountStorage: AccountFlowAccountStorage;
  accountFlowStorage: AccountFlowStorage;
  logger: Pick<AuthLogger, "trace">;
  portalBaseUrl: string;
  now?: Date;
}) {
  return async ({ input, context: { caller } }: {
    input: Omit<AccountFlowCreateInput, "allowedProviders">;
    context: {
      caller: { type: string; userId?: string; capabilities?: string[] };
    };
  }) =>
    await createAccountFlow({
      ...args,
      rpc: "Auth.AccountFlows.CreatePasswordReset",
      kind: "local_password_reset",
      input,
      caller,
      allowedProviders: ["local"],
    });
}
