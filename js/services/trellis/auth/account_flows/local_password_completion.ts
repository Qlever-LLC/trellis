import { hashKey, randomToken } from "../crypto.ts";
import { identityIdForProviderSubject } from "../identity.ts";
import { createLocalCredentialPassword } from "../local_credentials/passwords.ts";
import type {
  AccountFlow,
  AccountFlowKind,
  LocalCredential,
  UserAccount,
  UserIdentity,
} from "../schemas.ts";
import type { CapabilityGroupLoader } from "../capability_groups.ts";
import { resolvesActiveAdmin } from "../capability_groups.ts";

const ACCOUNT_PAGE_LIMIT = 100;

type AccountFlowStorage = {
  get(flowIdHash: string): Promise<AccountFlow | undefined>;
  consume(flowIdHash: string, consumedAt: string): Promise<boolean>;
  completeAdminBootstrapLocalPassword?: (
    record: CompleteAdminBootstrapLocalPasswordAtomicRecord,
  ) => Promise<CompleteAdminBootstrapLocalPasswordResult>;
  completeIdentityLinkLocalPassword?: (
    record: CompleteIdentityLinkLocalPasswordAtomicRecord,
  ) => Promise<CompleteAdminBootstrapLocalPasswordResult>;
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
  listByUser(userId: string): Promise<UserIdentity[]>;
  put(record: UserIdentity): Promise<void>;
};

type LocalCredentialStorage = {
  put(record: LocalCredential): Promise<void>;
};

type SessionStorage = {
  deleteByUser?: (userId: string) => Promise<void>;
  listEntriesByUser?: (
    userId: string,
  ) => Promise<Array<{ sessionKey: string }>>;
  deleteBySessionKey?: (sessionKey: string) => Promise<void>;
};

type TargetAccountLocalPasswordFlowKind = Exclude<
  AccountFlowKind,
  "admin_bootstrap"
>;

export type CompleteAdminBootstrapLocalPasswordError =
  | "flow_not_found"
  | "flow_wrong_kind"
  | "flow_already_consumed"
  | "flow_expired"
  | "flow_missing_admin_capability"
  | "flow_missing_target_user"
  | "local_provider_not_allowed"
  | "admin_already_exists"
  | "target_user_not_found"
  | "target_user_inactive"
  | "local_identity_exists"
  | "flow_consume_conflict";

export type CompleteAdminBootstrapLocalPasswordResult =
  | { ok: true; userId: string }
  | { ok: false; error: CompleteAdminBootstrapLocalPasswordError };

export type CompleteAdminBootstrapLocalPasswordAtomicRecord = {
  flowIdHash: string;
  now: Date;
  account: UserAccount;
  identity: UserIdentity;
  credential: LocalCredential;
};

export type CompleteIdentityLinkLocalPasswordAtomicRecord = {
  flowIdHash: string;
  now: Date;
  identity: UserIdentity;
  credential: LocalCredential;
};

export type CompleteAdminBootstrapLocalPasswordOptions = {
  flowId: string;
  username: string;
  password: string;
  name?: string;
  email?: string;
  now?: Date;
  accountFlowStorage: AccountFlowStorage;
  accountStorage: AccountStorage;
  capabilityGroupStorage?: CapabilityGroupLoader;
  userIdentityStorage: UserIdentityStorage;
  localCredentialStorage: LocalCredentialStorage;
  sessionStorage?: SessionStorage;
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

function isTargetAccountLocalPasswordFlowKind(
  kind: AccountFlowKind,
): kind is TargetAccountLocalPasswordFlowKind {
  return kind === "account_invite" || kind === "identity_link" ||
    kind === "local_password_setup" || kind === "local_password_reset";
}

function localProviderAllowed(flow: AccountFlow): boolean {
  return flow.allowedProviders === null ||
    flow.allowedProviders.includes("local");
}

function shouldRevokeTargetUserSessions(
  kind: TargetAccountLocalPasswordFlowKind,
): boolean {
  return kind === "local_password_setup" || kind === "local_password_reset";
}

async function deleteSessionsByUser(
  sessionStorage: SessionStorage | undefined,
  userId: string,
): Promise<void> {
  if (!sessionStorage) return;
  if (sessionStorage.deleteByUser) {
    await sessionStorage.deleteByUser(userId);
    return;
  }
  if (!sessionStorage.listEntriesByUser || !sessionStorage.deleteBySessionKey) {
    return;
  }
  const entries = await sessionStorage.listEntriesByUser(userId);
  const deleteBySessionKey = sessionStorage.deleteBySessionKey;
  await Promise.all(
    entries.map((entry) => deleteBySessionKey(entry.sessionKey)),
  );
}

async function completeTargetAccountLocalPassword(
  options: CompleteAdminBootstrapLocalPasswordOptions,
  flow: AccountFlow,
  flowIdHash: string,
  now: Date,
): Promise<CompleteAdminBootstrapLocalPasswordResult> {
  if (!isTargetAccountLocalPasswordFlowKind(flow.kind)) {
    return { ok: false, error: "flow_wrong_kind" };
  }
  if (!localProviderAllowed(flow)) {
    return { ok: false, error: "local_provider_not_allowed" };
  }
  if (flow.targetUserId === null) {
    return { ok: false, error: "flow_missing_target_user" };
  }

  const targetAccount = await options.accountStorage.get(flow.targetUserId);
  if (!targetAccount) return { ok: false, error: "target_user_not_found" };
  if (!targetAccount.active) {
    return { ok: false, error: "target_user_inactive" };
  }

  const nowIso = now.toISOString();
  const identityId = identityIdForProviderSubject("local", options.username);
  const existingIdentity = await options.userIdentityStorage
    .getByProviderSubject("local", options.username);
  if (existingIdentity && existingIdentity.userId !== targetAccount.userId) {
    return { ok: false, error: "local_identity_exists" };
  }
  if (flow.kind === "identity_link") {
    const existingTargetLocalIdentity = (await options.userIdentityStorage
      .listByUser(targetAccount.userId)).find((identity) =>
        identity.provider === "local"
      );
    if (
      existingTargetLocalIdentity &&
      existingTargetLocalIdentity.identityId !== existingIdentity?.identityId
    ) {
      return { ok: false, error: "local_identity_exists" };
    }
  }

  const identity: UserIdentity = existingIdentity ?? {
    identityId,
    userId: targetAccount.userId,
    provider: "local",
    subject: options.username,
    displayName: options.name ?? null,
    email: options.email ?? null,
    emailVerified: false,
    linkedAt: nowIso,
    lastLoginAt: null,
  };
  const credential = await createLocalCredentialPassword({
    identityId,
    password: options.password,
    now,
  });

  if (
    flow.kind === "identity_link" &&
    options.accountFlowStorage.completeIdentityLinkLocalPassword
  ) {
    return await options.accountFlowStorage.completeIdentityLinkLocalPassword({
      flowIdHash,
      now,
      identity,
      credential,
    });
  }

  const consumed = await options.accountFlowStorage.consume(flowIdHash, nowIso);
  if (!consumed) return { ok: false, error: "flow_consume_conflict" };

  if (!existingIdentity) await options.userIdentityStorage.put(identity);
  await options.localCredentialStorage.put(credential);
  if (shouldRevokeTargetUserSessions(flow.kind)) {
    await deleteSessionsByUser(options.sessionStorage, targetAccount.userId);
  }

  return { ok: true, userId: targetAccount.userId };
}

/** Completes a durable admin bootstrap flow with a first local-password admin. */
export async function completeAdminBootstrapLocalPassword(
  options: CompleteAdminBootstrapLocalPasswordOptions,
): Promise<CompleteAdminBootstrapLocalPasswordResult> {
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

  if (flow.kind !== "admin_bootstrap") {
    return await completeTargetAccountLocalPassword(
      options,
      flow,
      flowIdHash,
      now,
    );
  }

  const userId = `usr_${randomToken(18)}`;
  const identityId = identityIdForProviderSubject("local", options.username);
  const account: UserAccount = {
    userId,
    name: options.name ?? null,
    email: options.email ?? null,
    active: true,
    capabilities: [],
    capabilityGroups: ["admin"],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const identity: UserIdentity = {
    identityId,
    userId,
    provider: "local",
    subject: options.username,
    displayName: options.name ?? null,
    email: options.email ?? null,
    emailVerified: false,
    linkedAt: nowIso,
    lastLoginAt: null,
  };
  const credential = await createLocalCredentialPassword({
    identityId,
    password: options.password,
    now,
  });

  if (options.accountFlowStorage.completeAdminBootstrapLocalPassword) {
    return await options.accountFlowStorage.completeAdminBootstrapLocalPassword(
      {
        flowIdHash,
        now,
        account,
        identity,
        credential,
      },
    );
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
    .getByProviderSubject("local", options.username);
  if (existingIdentity) return { ok: false, error: "local_identity_exists" };

  const consumed = await options.accountFlowStorage.consume(flowIdHash, nowIso);
  if (!consumed) return { ok: false, error: "flow_consume_conflict" };

  await options.accountStorage.put(account);
  await options.userIdentityStorage.put(identity);
  await options.localCredentialStorage.put(credential);

  return { ok: true, userId };
}
