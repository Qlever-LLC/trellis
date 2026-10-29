import { Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import { resolvesActiveAdmin } from "../capability_groups.ts";
import type { IdentityGrantRecord } from "../schemas.ts";
import type {
  SqlCapabilityGroupRepository,
  SqlSessionRepository,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
} from "../storage.ts";
import type { AuthLogger, RuntimeKV } from "../runtime_deps.ts";
import type { Connection } from "../schemas.ts";
import { revokeSessionByKey } from "./revoke.ts";

type LifecycleInput = {
  userId: string;
  provider: string;
  subject: string;
};

type ServiceCaller = {
  type: string;
  id?: string;
};

type LifecycleDeps = {
  accountStorage: Pick<SqlUserAccountRepository, "get" | "put">;
  userIdentityStorage: Pick<
    SqlUserIdentityRepository,
    "getByProviderSubject" | "unlink"
  >;
  capabilityGroupStorage: Pick<SqlCapabilityGroupRepository, "get">;
  sessionStorage: Pick<
    SqlSessionRepository,
    "getOneBySessionKey" | "listEntriesByUser" | "deleteBySessionKey"
  >;
  connectionsKV: RuntimeKV<Connection>;
  contractApprovalStorage: {
    get(identityGrantId: string): Promise<IdentityGrantRecord | undefined>;
    delete(identityGrantId: string): Promise<void>;
  };
  kick: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked: (
    event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    },
  ) => Promise<void>;
  logger: AuthLogger;
};

function requireServiceCaller(caller: ServiceCaller): string {
  if (caller.type !== "service" || !caller.id) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
  return caller.id;
}

async function requireExactIdentity(
  deps: LifecycleDeps,
  input: LifecycleInput,
) {
  const identity = await deps.userIdentityStorage.getByProviderSubject(
    input.provider,
    input.subject,
  );
  if (!identity || identity.userId !== input.userId) {
    throw new AuthError({
      reason: "identity_not_found",
      context: { userId: input.userId },
    });
  }
  const account = await deps.accountStorage.get(input.userId);
  if (!account) {
    throw new AuthError({
      reason: "user_not_found",
      context: { userId: input.userId },
    });
  }
  return { account, identity };
}

/** Creates the exact-identity lifecycle inspection RPC handler. */
export function createAuthUserLifecycleInspectHandler(deps: LifecycleDeps) {
  return async ({
    input,
    context: { caller },
  }: {
    input: { provider: string; subject: string };
    context: { caller: ServiceCaller };
  }) => {
    const serviceId = requireServiceCaller(caller);
    deps.logger.trace({
      rpc: "Auth.UserLifecycle.Inspect",
      provider: input.provider,
      caller: serviceId,
    }, "RPC request");
    const identity = await deps.userIdentityStorage.getByProviderSubject(
      input.provider,
      input.subject,
    );
    if (!identity) {
      return Result.ok({
        found: false,
        userId: null,
        active: null,
        email: null,
        identityId: null,
        provider: null,
        subject: null,
      });
    }
    const account = await deps.accountStorage.get(identity.userId);
    if (!account) {
      return Result.err(new AuthError({ reason: "user_not_found" }));
    }
    return Result.ok({
      found: true,
      userId: account.userId,
      active: account.active,
      email: account.email,
      identityId: identity.identityId,
      provider: identity.provider,
      subject: identity.subject,
    });
  };
}

/** Creates the exact-identity deactivation and session-revocation RPC handler. */
export function createAuthUserLifecycleDeactivateHandler(deps: LifecycleDeps) {
  return async ({ input, context: { caller } }: {
    input: LifecycleInput;
    context: { caller: ServiceCaller };
  }) => {
    const serviceId = requireServiceCaller(caller);
    const { account } = await requireExactIdentity(deps, input);
    if (
      await resolvesActiveAdmin(account, deps.capabilityGroupStorage)
    ) {
      return Result.err(
        new AuthError({
          reason: "invalid_request",
          context: { userId: input.userId, protected: "admin" },
        }),
      );
    }
    const sessions = await deps.sessionStorage.listEntriesByUser(input.userId);
    await deps.accountStorage.put({
      ...account,
      active: false,
      updatedAt: new Date().toISOString(),
    });
    for (const entry of sessions) {
      await revokeSessionByKey(deps, {
        sessionKey: entry.sessionKey,
        revokedBy: serviceId,
      });
    }
    deps.logger.info({
      rpc: "Auth.UserLifecycle.Deactivate",
      targetUserId: input.userId,
      provider: input.provider,
      revokedSessions: sessions.length,
      caller: serviceId,
    }, "User lifecycle identity deactivated");
    return Result.ok({
      deactivated: account.active,
      revokedSessions: sessions.length,
    });
  };
}

/** Creates the exact-identity unlink RPC handler. */
export function createAuthUserLifecycleUnlinkHandler(deps: LifecycleDeps) {
  return async ({ input, context: { caller } }: {
    input: LifecycleInput;
    context: { caller: ServiceCaller };
  }) => {
    const serviceId = requireServiceCaller(caller);
    const identity = await deps.userIdentityStorage.getByProviderSubject(
      input.provider,
      input.subject,
    );
    if (!identity) return Result.ok({ unlinked: false });
    const { account } = await requireExactIdentity(deps, input);
    if (account.active) {
      return Result.err(
        new AuthError({
          reason: "invalid_request",
          context: { userId: input.userId, requiredState: "inactive" },
        }),
      );
    }
    const unlinked = await deps.userIdentityStorage.unlink(
      input.userId,
      identity.identityId,
    );
    deps.logger.info({
      rpc: "Auth.UserLifecycle.Unlink",
      targetUserId: input.userId,
      identityId: identity.identityId,
      provider: input.provider,
      caller: serviceId,
    }, "User lifecycle identity unlinked");
    return Result.ok({ unlinked });
  };
}
