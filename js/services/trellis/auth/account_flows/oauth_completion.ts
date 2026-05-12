import { hashKey, randomToken } from "../crypto.ts";
import { identityIdForProviderSubject } from "../identity.ts";
import type { OAuth2User } from "../providers/oauth2_user.ts";
import type { AccountFlow, UserAccount, UserIdentity } from "../schemas.ts";
import type { CapabilityGroupLoader } from "../capability_groups.ts";
import { resolvesActiveAdmin } from "../capability_groups.ts";

const ACCOUNT_PAGE_LIMIT = 100;

type AccountFlowStorage = {
  get(flowIdHash: string): Promise<AccountFlow | undefined>;
  consume(flowIdHash: string, consumedAt: string): Promise<boolean>;
  completeAdminBootstrapOAuth?: (
    record: CompleteAdminBootstrapOAuthAtomicRecord,
  ) => Promise<CompleteAccountFlowOAuthResult>;
  completeTargetAccountOAuth?: (
    record: CompleteTargetAccountOAuthAtomicRecord,
  ) => Promise<CompleteAccountFlowOAuthResult>;
};

type AccountStorage = {
  get(userId: string): Promise<UserAccount | undefined>;
  listPage(query: { offset?: number; limit?: number }): Promise<UserAccount[]>;
  put(record: UserAccount): Promise<void>;
};

type UserIdentityStorage = {
  getByProviderSubject(
    provider: string,
    subject: string,
  ): Promise<UserIdentity | undefined>;
  put(record: UserIdentity): Promise<void>;
};

export type CompleteAccountFlowOAuthError =
  | "flow_not_found"
  | "flow_wrong_kind"
  | "flow_already_consumed"
  | "flow_expired"
  | "flow_missing_admin_capability"
  | "flow_missing_target_user"
  | "provider_not_allowed"
  | "admin_already_exists"
  | "target_user_not_found"
  | "target_user_inactive"
  | "identity_conflict"
  | "flow_consume_conflict";

export type CompleteAccountFlowOAuthResult =
  | { ok: true; userId: string }
  | { ok: false; error: CompleteAccountFlowOAuthError };

export type CompleteAdminBootstrapOAuthAtomicRecord = {
  flowIdHash: string;
  now: Date;
  provider: string;
  user: OAuth2User;
  account: UserAccount;
  identity: UserIdentity;
};

export type CompleteTargetAccountOAuthAtomicRecord = {
  flowIdHash: string;
  now: Date;
  provider: string;
  user: OAuth2User;
};

export type CompleteAccountFlowOAuthOptions = {
  flowId: string;
  provider: string;
  user: OAuth2User;
  now?: Date;
  accountFlowStorage: AccountFlowStorage;
  accountStorage: AccountStorage;
  capabilityGroupStorage?: CapabilityGroupLoader;
  userIdentityStorage: UserIdentityStorage;
};

async function hasActiveAdminAccount(
  accountStorage: AccountStorage,
  capabilityGroupStorage?: CapabilityGroupLoader,
): Promise<boolean> {
  for (let offset = 0;; offset += ACCOUNT_PAGE_LIMIT) {
    const page = await accountStorage.listPage({
      offset,
      limit: ACCOUNT_PAGE_LIMIT,
    });
    if (
      (await Promise.all(
        page.map((account) =>
          resolvesActiveAdmin(account, capabilityGroupStorage)
        ),
      )).some((isAdmin) => isAdmin)
    ) {
      return true;
    }
    if (page.length < ACCOUNT_PAGE_LIMIT) return false;
  }
}

function providerAllowed(flow: AccountFlow, provider: string): boolean {
  return flow.allowedProviders === null ||
    flow.allowedProviders.includes(provider);
}

function providerFlowKindAllowed(flow: AccountFlow): boolean {
  return flow.kind === "admin_bootstrap" || flow.kind === "account_invite" ||
    flow.kind === "identity_link";
}

function profileName(user: OAuth2User): string | null {
  return user.name ?? null;
}

function profileEmail(user: OAuth2User): string | null {
  return user.email ?? null;
}

function identityFromOAuth(args: {
  userId: string;
  provider: string;
  user: OAuth2User;
  nowIso: string;
  existing?: UserIdentity;
}): UserIdentity {
  return {
    identityId: args.existing?.identityId ??
      identityIdForProviderSubject(args.provider, args.user.id),
    userId: args.userId,
    provider: args.provider,
    subject: args.user.id,
    displayName: profileName(args.user),
    email: profileEmail(args.user),
    emailVerified: args.user.emailVerified,
    linkedAt: args.existing?.linkedAt ?? args.nowIso,
    lastLoginAt: args.nowIso,
  };
}

async function completeTargetAccountOAuth(
  options: CompleteAccountFlowOAuthOptions,
  flow: AccountFlow,
  flowIdHash: string,
  now: Date,
): Promise<CompleteAccountFlowOAuthResult> {
  if (flow.kind !== "account_invite" && flow.kind !== "identity_link") {
    return { ok: false, error: "flow_wrong_kind" };
  }
  if (!providerAllowed(flow, options.provider)) {
    return { ok: false, error: "provider_not_allowed" };
  }
  if (flow.targetUserId === null) {
    return { ok: false, error: "flow_missing_target_user" };
  }

  const targetAccount = await options.accountStorage.get(flow.targetUserId);
  if (!targetAccount) return { ok: false, error: "target_user_not_found" };
  if (!targetAccount.active) {
    return { ok: false, error: "target_user_inactive" };
  }

  const existingIdentity = await options.userIdentityStorage
    .getByProviderSubject(
      options.provider,
      options.user.id,
    );
  if (existingIdentity && existingIdentity.userId !== targetAccount.userId) {
    return { ok: false, error: "identity_conflict" };
  }

  const nowIso = now.toISOString();
  const identity = identityFromOAuth({
    userId: targetAccount.userId,
    provider: options.provider,
    user: options.user,
    nowIso,
    ...(existingIdentity ? { existing: existingIdentity } : {}),
  });

  const consumed = await options.accountFlowStorage.consume(flowIdHash, nowIso);
  if (!consumed) return { ok: false, error: "flow_consume_conflict" };

  await options.userIdentityStorage.put(identity);
  return { ok: true, userId: targetAccount.userId };
}

/** Completes a durable account flow using an OAuth/OIDC provider identity. */
export async function completeAccountFlowOAuth(
  options: CompleteAccountFlowOAuthOptions,
): Promise<CompleteAccountFlowOAuthResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const flowIdHash = await hashKey(options.flowId);
  const flow = await options.accountFlowStorage.get(flowIdHash);
  if (!flow) return { ok: false, error: "flow_not_found" };
  if (flow.consumedAt !== null) {
    return { ok: false, error: "flow_already_consumed" };
  }
  if (new Date(flow.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, error: "flow_expired" };
  }
  if (!providerFlowKindAllowed(flow)) {
    return { ok: false, error: "flow_wrong_kind" };
  }
  if (!providerAllowed(flow, options.provider)) {
    return { ok: false, error: "provider_not_allowed" };
  }

  if (flow.kind !== "admin_bootstrap") {
    if (options.accountFlowStorage.completeTargetAccountOAuth) {
      return await options.accountFlowStorage.completeTargetAccountOAuth({
        flowIdHash,
        now,
        provider: options.provider,
        user: options.user,
      });
    }
    return await completeTargetAccountOAuth(options, flow, flowIdHash, now);
  }

  const userId = `usr_${randomToken(18)}`;
  const account: UserAccount = {
    userId,
    name: profileName(options.user),
    email: profileEmail(options.user),
    active: true,
    capabilities: [],
    capabilityGroups: ["admin"],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const identity = identityFromOAuth({
    userId,
    provider: options.provider,
    user: options.user,
    nowIso,
  });

  if (options.accountFlowStorage.completeAdminBootstrapOAuth) {
    return await options.accountFlowStorage.completeAdminBootstrapOAuth({
      flowIdHash,
      now,
      provider: options.provider,
      user: options.user,
      account,
      identity,
    });
  }

  if (!flow.capabilities?.includes("admin")) {
    return { ok: false, error: "flow_missing_admin_capability" };
  }
  if (
    await hasActiveAdminAccount(
      options.accountStorage,
      options.capabilityGroupStorage,
    )
  ) {
    return { ok: false, error: "admin_already_exists" };
  }
  const existingIdentity = await options.userIdentityStorage
    .getByProviderSubject(
      options.provider,
      options.user.id,
    );
  if (existingIdentity) return { ok: false, error: "identity_conflict" };

  const consumed = await options.accountFlowStorage.consume(flowIdHash, nowIso);
  if (!consumed) return { ok: false, error: "flow_consume_conflict" };
  await options.accountStorage.put(account);
  await options.userIdentityStorage.put(identity);
  return { ok: true, userId };
}
