import { ulid } from "ulid";

import { hashKey } from "../crypto.ts";
import { identityIdForProviderSubject } from "../identity.ts";
import {
  createLocalCredentialPassword,
  validateLocalCredentialPasswordPolicy,
} from "../local_credentials/passwords.ts";
import type {
  AccountFlow,
  AccountFlowKind,
  LocalCredential,
  Session,
  UserAccount,
  UserIdentity,
} from "../schemas.ts";
import type { CapabilityGroupLoader } from "../capability_groups.ts";
import { resolvesActiveAdmin } from "../capability_groups.ts";
import { revokeRuntimeAccessForSession } from "../session/revoke_runtime_access.ts";

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
  listEntriesByUser?: (
    userId: string,
  ) => Promise<Array<{ sessionKey: string; session: Session }>>;
  deleteBySessionKey?: (sessionKey: string) => Promise<void>;
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
  | "flow_missing_local_identity"
  | "local_username_mismatch"
  | "local_password_too_short"
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
  username?: string;
  password: string;
  passwordMinLength?: number;
  name?: string;
  email?: string;
  now?: Date;
  accountFlowStorage: AccountFlowStorage;
  accountStorage: AccountStorage;
  capabilityGroupStorage?: CapabilityGroupLoader;
  userIdentityStorage: UserIdentityStorage;
  localCredentialStorage: LocalCredentialStorage;
  sessionStorage?: SessionStorage;
  connectionsKV?: RuntimeConnectionKV;
  kick?: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked?: PublishSessionRevoked;
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
  return kind === "identity_link" || kind === "local_password_reset";
}

function localProviderAllowed(flow: AccountFlow): boolean {
  return flow.allowedProviders === null ||
    flow.allowedProviders.includes("local");
}

function shouldRevokeTargetUserSessions(
  kind: TargetAccountLocalPasswordFlowKind,
): boolean {
  return kind === "local_password_reset";
}

function validateRequestedPassword(
  options: CompleteAdminBootstrapLocalPasswordOptions,
): CompleteAdminBootstrapLocalPasswordResult | null {
  const minLength = options.passwordMinLength ?? 12;
  try {
    validateLocalCredentialPasswordPolicy(options.password, minLength);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `Password must be at least ${minLength} characters`
    ) {
      return { ok: false, error: "local_password_too_short" };
    }
    throw error;
  }
  return null;
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

async function revokeSessionsByUser(
  options: CompleteAdminBootstrapLocalPasswordOptions,
  userId: string,
  revokedBy: string,
): Promise<void> {
  const sessionStorage = options.sessionStorage;
  if (!sessionStorage) return;
  if (!sessionStorage.listEntriesByUser || !sessionStorage.deleteBySessionKey) {
    return;
  }
  const deleteBySessionKey = sessionStorage.deleteBySessionKey;
  const entries = await sessionStorage.listEntriesByUser(userId);
  const deleteSession = async (
    entry: { sessionKey: string; session: Session },
  ) => {
    const event = sessionRevocationEvent(
      entry.sessionKey,
      entry.session,
      revokedBy,
    );
    if (event && options.publishSessionRevoked) {
      await options.publishSessionRevoked(event);
    }
    await deleteBySessionKey(entry.sessionKey);
  };
  for (const entry of entries) {
    if (!options.connectionsKV || !options.kick) {
      await deleteSession(entry);
      continue;
    }
    await revokeRuntimeAccessForSession({
      sessionKey: entry.sessionKey,
      connectionsKV: options.connectionsKV,
      kick: options.kick,
      deleteSession: () => deleteSession(entry),
    });
  }
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
  if (flow.kind === "local_password_reset") {
    if (flow.targetIdentityId === null || flow.targetLocalUsername === null) {
      return { ok: false, error: "flow_missing_local_identity" };
    }
    if (
      options.username !== undefined &&
      options.username !== flow.targetLocalUsername
    ) {
      return { ok: false, error: "local_username_mismatch" };
    }
  }

  const localIdentities = (await options.userIdentityStorage.listByUser(
    targetAccount.userId,
  )).filter((identity) => identity.provider === "local");
  if (flow.kind === "local_password_reset") {
    if (localIdentities.length !== 1) {
      return { ok: false, error: "flow_missing_local_identity" };
    }
    const [localIdentity] = localIdentities;
    if (
      localIdentity === undefined ||
      localIdentity.identityId !== flow.targetIdentityId ||
      localIdentity.subject !== flow.targetLocalUsername
    ) {
      return { ok: false, error: "flow_missing_local_identity" };
    }
  }

  const username = flow.kind === "local_password_reset"
    ? flow.targetLocalUsername
    : options.username;
  if (!username) return { ok: false, error: "local_username_mismatch" };

  const passwordPolicyError = validateRequestedPassword(options);
  if (passwordPolicyError) return passwordPolicyError;

  const identityId = identityIdForProviderSubject("local", username);
  const existingIdentity = await options.userIdentityStorage
    .getByProviderSubject("local", username);
  if (existingIdentity && existingIdentity.userId !== targetAccount.userId) {
    return { ok: false, error: "local_identity_exists" };
  }
  const existingTargetLocalIdentity = localIdentities[0];
  if (
    existingTargetLocalIdentity &&
    existingTargetLocalIdentity.identityId !== existingIdentity?.identityId
  ) {
    return { ok: false, error: "local_identity_exists" };
  }

  const identity: UserIdentity = existingIdentity ?? {
    identityId,
    userId: targetAccount.userId,
    provider: "local",
    subject: username,
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
    minLength: options.passwordMinLength,
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
    await revokeSessionsByUser(
      options,
      targetAccount.userId,
      flow.createdByUserId ?? "system",
    );
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

  const userId = `usr_${ulid()}`;
  if (!options.username) return { ok: false, error: "local_username_mismatch" };

  const passwordPolicyError = validateRequestedPassword(options);
  if (passwordPolicyError) return passwordPolicyError;

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
    minLength: options.passwordMinLength,
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
