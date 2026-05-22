import { ulid } from "ulid";

import type { AuthLogger } from "../runtime_deps.ts";
import type { AccountFlow, UserAccount, UserIdentity } from "../schemas.ts";
import { hashKey } from "../crypto.ts";
import { identityIdForProviderSubject } from "../identity.ts";
import type { CapabilityGroupLoader } from "../capability_groups.ts";
import { resolvesActiveAdmin } from "../capability_groups.ts";

const LOCAL_PASSWORD_RESET_PATH = "/_trellis/portal/account/password";
const ADMIN_BOOTSTRAP_TTL_MS = 24 * 60 * 60_000;
const ACCOUNT_PAGE_LIMIT = 100;
const DEFAULT_BOOTSTRAP_ADMIN_USERNAME = "admin";

type AccountReader = {
  get(userId: string): Promise<UserAccount | undefined>;
  listPage(query: { offset?: number; limit?: number }): Promise<UserAccount[]>;
  put(record: UserAccount): Promise<void>;
};

type IdentityStorage = {
  getByProviderSubject(
    provider: string,
    subject: string,
  ): Promise<UserIdentity | undefined>;
  put(record: UserIdentity): Promise<void>;
};

type LocalCredentialStorage = {
  get(identityId: string): Promise<unknown>;
};

type AccountFlowWriter = {
  put(record: AccountFlow): Promise<void>;
};

/** Builds the built-in local password reset portal URL for a durable account flow. */
export function buildLocalPasswordResetPortalUrl(args: {
  baseUrl: string;
  flowId: string;
}): string {
  const url = new URL(LOCAL_PASSWORD_RESET_PATH, args.baseUrl);
  url.searchParams.set("flowId", args.flowId);
  return url.toString();
}

async function hasActiveAdminAccount(
  accounts: AccountReader,
  capabilityGroupStorage?: CapabilityGroupLoader,
): Promise<boolean> {
  for (let offset = 0;; offset += ACCOUNT_PAGE_LIMIT) {
    const page = await accounts.listPage({ offset, limit: ACCOUNT_PAGE_LIMIT });
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

async function activeLocalAdminNeedsCredential(args: {
  accountStorage: AccountReader;
  userIdentityStorage: IdentityStorage;
  localCredentialStorage: LocalCredentialStorage;
  capabilityGroupStorage?: CapabilityGroupLoader;
  username: string;
}): Promise<UserIdentity | undefined> {
  const identity = await args.userIdentityStorage.getByProviderSubject(
    "local",
    args.username,
  );
  if (identity === undefined) return undefined;
  const account = await args.accountStorage.get(identity.userId);
  if (account === undefined) return undefined;
  if (!(await resolvesActiveAdmin(account, args.capabilityGroupStorage))) {
    return undefined;
  }
  const credential = await args.localCredentialStorage.get(identity.identityId);
  return credential === undefined ? identity : undefined;
}

/** Creates and logs a fresh admin bootstrap flow when no active admin exists. */
export async function ensureAdminBootstrapFlow(args: {
  accountStorage: AccountReader;
  userIdentityStorage: IdentityStorage;
  localCredentialStorage: LocalCredentialStorage;
  capabilityGroupStorage?: CapabilityGroupLoader;
  accountFlowStorage: AccountFlowWriter;
  portalBaseUrl: string;
  logger: Pick<AuthLogger, "info">;
  username?: string;
  now?: Date;
}): Promise<{ url: string; flowId: string } | null> {
  const username = args.username ?? DEFAULT_BOOTSTRAP_ADMIN_USERNAME;
  const activeAdminWithoutCredential = await activeLocalAdminNeedsCredential({
    accountStorage: args.accountStorage,
    userIdentityStorage: args.userIdentityStorage,
    localCredentialStorage: args.localCredentialStorage,
    capabilityGroupStorage: args.capabilityGroupStorage,
    username,
  });
  if (
    activeAdminWithoutCredential === undefined &&
    await hasActiveAdminAccount(
      args.accountStorage,
      args.capabilityGroupStorage,
    )
  ) return null;

  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const existingIdentity = activeAdminWithoutCredential ??
    await args.userIdentityStorage.getByProviderSubject("local", username);
  const existingAccount = existingIdentity
    ? await args.accountStorage.get(existingIdentity.userId)
    : undefined;
  const account: UserAccount = existingAccount ?? {
    userId: `usr_${ulid()}`,
    name: username,
    email: null,
    active: true,
    capabilities: [],
    capabilityGroups: ["admin"],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const adminAccount: UserAccount = {
    ...account,
    active: true,
    capabilityGroups: account.capabilityGroups.includes("admin")
      ? account.capabilityGroups
      : [...account.capabilityGroups, "admin"],
    updatedAt: nowIso,
  };
  const identity: UserIdentity = existingIdentity ?? {
    identityId: identityIdForProviderSubject("local", username),
    userId: adminAccount.userId,
    provider: "local",
    subject: username,
    displayName: adminAccount.name,
    email: adminAccount.email,
    emailVerified: false,
    linkedAt: nowIso,
    lastLoginAt: null,
  };

  await args.accountStorage.put(adminAccount);
  await args.userIdentityStorage.put(identity);

  const flowId = ulid();
  const expiresAt = new Date(now.getTime() + ADMIN_BOOTSTRAP_TTL_MS);
  const flow: AccountFlow = {
    flowIdHash: await hashKey(flowId),
    kind: "local_password_reset",
    targetUserId: adminAccount.userId,
    targetIdentityId: identity.identityId,
    targetLocalUsername: identity.subject,
    createdByUserId: null,
    allowedProviders: ["local"],
    capabilities: null,
    profileHint: null,
    returnTo: null,
    createdAt: nowIso,
    expiresAt: expiresAt.toISOString(),
    consumedAt: null,
  };

  await args.accountFlowStorage.put(flow);
  const url = buildLocalPasswordResetPortalUrl({
    baseUrl: args.portalBaseUrl,
    flowId,
  });
  args.logger.info(
    {
      bootstrapUrl: url,
      flowIdHash: flow.flowIdHash,
      targetUserId: adminAccount.userId,
      expiresAt: flow.expiresAt,
    },
    "No active admin account exists; local admin password reset URL is available",
  );
  return { url, flowId };
}
