import { AuthError } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";

import type { ContractStore } from "../../catalog/store.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import { planUserContractApproval } from "../approval/plan.ts";
import {
  matchingInstanceGrantPolicies,
  userDelegationAllowed,
} from "../grants/policy.ts";
import type {
  InstanceGrantPolicy,
  Session,
  UserProjectionEntry,
} from "../schemas.ts";
import {
  connectionFilterForSession,
  parseConnectionKey,
} from "../session/connections.ts";
import { revokeRuntimeAccessForSession } from "../session/revoke_runtime_access.ts";
import type { AdminRpcDeps } from "./rpc.ts";
import {
  type CreatePortalRequest,
  type DeviceDeployment,
  type DevicePortalSelection,
  type DevicePortalSelectionRequest,
  type InstanceGrantPolicyActor,
  type LoginPortalSelection,
  type LoginPortalSelectionRequest,
  type Portal,
  type PortalDefault,
  type PortalDefaultRequest,
  type PortalProfile,
  type SetPortalProfileRequest,
  type UpsertInstanceGrantPolicyRequest,
  validateDevicePortalSelectionRequest,
  validateInstanceGrantPolicyRequest,
  validateLoginPortalSelectionRequest,
  validatePortalDefaultRequest,
  validatePortalProfileRequest,
  validatePortalRequest,
} from "./shared.ts";

type RpcUser = { capabilities?: string[]; origin?: string; id?: string };
type AdminRpcContext = AdminRpcDeps;
type AdminRpcHandler<Args, Response> = (
  args: Args,
  ctx: AdminRpcContext,
) => Promise<Response>;

const LOGIN_DEFAULT_KEY = "login.default";
const DEVICE_DEFAULT_KEY = "device.default";

function bindAdminRpcHandler<Args, Response>(
  deps: AdminRpcDeps,
  handler: AdminRpcHandler<Args, Response>,
): (args: Args) => Promise<Response> {
  return (args) => handler(args, deps);
}

function isAdmin(user: RpcUser): boolean {
  return user.capabilities?.includes("admin") ?? false;
}

function insufficientPermissions() {
  return Result.err(new AuthError({ reason: "insufficient_permissions" }));
}

function invalidRequest(context?: Record<string, unknown>) {
  return Result.err(new AuthError({ reason: "invalid_request", context }));
}

async function loadPortal(
  ctx: AdminRpcContext,
  portalId: string,
): Promise<Portal | null> {
  return await ctx.portalStorage.get(portalId) ?? null;
}

async function loadInstanceGrantPolicy(
  ctx: AdminRpcContext,
  contractId: string,
): Promise<InstanceGrantPolicy | null> {
  return await ctx.instanceGrantPolicyStorage.get(contractId) ?? null;
}

async function loadPortalProfile(
  ctx: AdminRpcContext,
  portalId: string,
): Promise<PortalProfile | null> {
  return await ctx.portalProfileStorage.get(portalId) ?? null;
}

async function loadDeviceDeployment(
  ctx: AdminRpcContext,
  deploymentId: string,
): Promise<DeviceDeployment | null> {
  return await ctx.deviceDeploymentStorage.get(deploymentId) ?? null;
}

async function loadPortalDefault(
  ctx: AdminRpcContext,
  key: string,
): Promise<PortalDefault | null> {
  const defaultPortal = key === "login.default"
    ? await ctx.portalDefaultStorage.getLogin()
    : await ctx.portalDefaultStorage.getDevice();
  return defaultPortal ?? null;
}

async function loadLoginPortalSelection(
  ctx: AdminRpcContext,
  contractId: string,
): Promise<LoginPortalSelection | null> {
  return await ctx.loginPortalSelectionStorage.get(contractId) ?? null;
}

async function loadDevicePortalSelection(
  ctx: AdminRpcContext,
  deploymentId: string,
): Promise<DevicePortalSelection | null> {
  return await ctx.devicePortalSelectionStorage.get(deploymentId) ?? null;
}

async function listPortals(ctx: AdminRpcContext): Promise<Portal[]> {
  return await ctx.portalStorage.list();
}

async function listPortalProfiles(
  ctx: AdminRpcContext,
): Promise<PortalProfile[]> {
  return await ctx.portalProfileStorage.list();
}

async function listInstanceGrantPolicies(
  ctx: AdminRpcContext,
): Promise<InstanceGrantPolicy[]> {
  return await ctx.instanceGrantPolicyStorage.list();
}

async function listLoginPortalSelections(
  ctx: AdminRpcContext,
): Promise<LoginPortalSelection[]> {
  return await ctx.loginPortalSelectionStorage.list();
}

async function listDevicePortalSelections(
  ctx: AdminRpcContext,
): Promise<DevicePortalSelection[]> {
  return await ctx.devicePortalSelectionStorage.list();
}

function policyActor(caller: RpcUser): InstanceGrantPolicyActor | undefined {
  if (!caller.origin || !caller.id) return undefined;
  return { origin: caller.origin, id: caller.id };
}

async function loadUserProjection(
  ctx: AdminRpcContext,
  trellisId: string,
): Promise<UserProjectionEntry | null> {
  return await ctx.userStorage.get(trellisId) ?? null;
}

async function revokeUserSessionByKey(
  ctx: AdminRpcContext,
  sessionKey: string,
  session: Extract<Session, { type: "user" }>,
  revokedBy?: string,
): Promise<void> {
  await revokeRuntimeAccessForSession({
    sessionKey,
    connectionFilter: connectionFilterForSession(sessionKey),
    shouldRevokeConnectionKey: (connKey) => {
      const parsedKey = parseConnectionKey(connKey);
      return parsedKey !== null && parsedKey.scopeId === session.trellisId;
    },
    connectionsKV: ctx.connectionsKV,
    kick: ctx.kick,
    deleteSession: async () => {
      if (revokedBy) {
        await ctx.publishSessionRevoked({
          origin: session.origin,
          id: session.id,
          sessionKey,
          revokedBy,
        });
      }
      await ctx.sessionStorage.deleteBySessionKey(sessionKey);
    },
  });
}

async function revokeInvalidatedInstanceGrantSessions(args: {
  ctx: AdminRpcContext;
  contractId: string;
  policies: InstanceGrantPolicy[];
  revokedBy?: string;
}): Promise<void> {
  for (const entry of await args.ctx.sessionStorage.listEntries()) {
    const session = entry.session;
    if (session.type !== "user") continue;
    if (session.contractId !== args.contractId) continue;

    const projection = await loadUserProjection(args.ctx, session.trellisId);
    const storedApproval = await args.ctx.contractApprovalStorage.get(
      session.trellisId,
      session.contractDigest,
    ) ?? null;
    const matchedPolicies = matchingInstanceGrantPolicies({
      policies: args.policies,
      contractId: session.contractId,
      appOrigin: session.app?.origin,
    });
    const sessionAllowed = projection !== null &&
      userDelegationAllowed({
        active: projection.active,
        explicitCapabilities: projection.capabilities ?? [],
        delegatedCapabilities: session.delegatedCapabilities,
        storedApproval,
        matchedPolicies,
      });
    if (sessionAllowed) continue;

    await revokeUserSessionByKey(
      args.ctx,
      entry.sessionKey,
      session,
      args.revokedBy,
    );
  }
}

async function ensurePortalReference(
  ctx: AdminRpcContext,
  portalId: string | null,
) {
  if (portalId === null) return Result.ok(undefined);
  const portal = await loadPortal(ctx, portalId);
  if (!portal || portal.disabled) {
    return invalidRequest({ portalId, reason: "portal_not_found" });
  }
  return Result.ok(undefined);
}

async function loadInstalledContractPayloads(
  contractStorage: SqlContractStorageRepository,
  contractId: string,
): Promise<Record<string, unknown>[]> {
  const contracts: Record<string, unknown>[] = [];
  for (const record of await contractStorage.list()) {
    if (record.id !== contractId) continue;

    let contract: Record<string, unknown>;
    try {
      const parsed = JSON.parse(record.contract);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      contract = parsed as Record<string, unknown>;
    } catch {
      continue;
    }

    contracts.push(contract);
  }

  return contracts;
}

async function derivePortalProfileCapabilities(args: {
  contractStorage: SqlContractStorageRepository;
  contractStore: ContractStore;
  contractId: string;
}) {
  const installedContracts = await loadInstalledContractPayloads(
    args.contractStorage,
    args.contractId,
  );
  if (installedContracts.length === 0) {
    return invalidRequest({
      contractId: args.contractId,
      reason: "portal_contract_not_installed",
    });
  }

  try {
    const impliedCapabilities = new Set<string>();
    for (const installedContract of installedContracts) {
      const plan = await planUserContractApproval(
        args.contractStore,
        installedContract,
      );
      if (plan.contract.kind !== "app") {
        return invalidRequest({
          contractId: args.contractId,
          reason: "portal_contract_not_browser_app",
        });
      }
      for (const capability of plan.approval.capabilities) {
        impliedCapabilities.add(capability);
      }
    }
    return Result.ok({
      impliedCapabilities: [...impliedCapabilities].sort((left, right) =>
        left.localeCompare(right)
      ),
    });
  } catch (error) {
    return invalidRequest({
      contractId: args.contractId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function adminPolicyActors(policy: InstanceGrantPolicy | null | undefined): {
  createdBy?: InstanceGrantPolicyActor;
  updatedBy?: InstanceGrantPolicyActor;
} {
  return policy?.source.kind === "admin_policy"
    ? {
      ...(policy.source.createdBy
        ? { createdBy: policy.source.createdBy }
        : {}),
      ...(policy.source.updatedBy
        ? { updatedBy: policy.source.updatedBy }
        : {}),
    }
    : {};
}

async function revokeInvalidatedEffectiveGrantSessions(args: {
  ctx: AdminRpcContext;
  contractId: string;
  revokedBy?: string;
}): Promise<void> {
  await revokeInvalidatedInstanceGrantSessions({
    ctx: args.ctx,
    contractId: args.contractId,
    policies: await args.ctx.loadEffectiveGrantPolicies(args.contractId),
    revokedBy: args.revokedBy,
  });
}

export function createAuthCreatePortalHandler() {
  return async (
    { input: req, context: { caller } }: {
      input: CreatePortalRequest;
      context: { caller: RpcUser };
    },
    ctx: AdminRpcContext,
  ) => {
    ctx.logger.trace(
      { rpc: "Auth.CreatePortal", portalId: req.portalId },
      "RPC request",
    );
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validatePortalRequest(req);
    if (validation.isErr()) return validation;
    const { portal } = validation.take() as { portal: Portal };
    await ctx.portalStorage.put(portal);
    return Result.ok({ portal });
  };
}

export const authListPortalsHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ portals: await listPortals(ctx) });
};

export const authDisablePortalHandler = async (
  { input: req, context: { caller } }: {
    input: { portalId: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const portal = await loadPortal(ctx, req.portalId);
  if (!portal) return Result.ok({ success: false });
  await ctx.portalStorage.put({ ...portal, disabled: true });

  const profile = await loadPortalProfile(ctx, req.portalId);
  if (profile && !profile.disabled) {
    await ctx.portalProfileStorage.put({
      ...profile,
      disabled: true,
      updatedAt: new Date().toISOString(),
    });
    await revokeInvalidatedEffectiveGrantSessions({
      ctx,
      contractId: profile.contractId,
      revokedBy: caller.origin && caller.id
        ? `${caller.origin}.${caller.id}`
        : undefined,
    });
  }
  return Result.ok({ success: true });
};

export const authListPortalProfilesHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ profiles: await listPortalProfiles(ctx) });
};

export function createAuthSetPortalProfileHandler(deps: {
  contractStorage: SqlContractStorageRepository;
  contractStore: ContractStore;
}) {
  return async (
    { input: req, context: { caller } }: {
      input: SetPortalProfileRequest;
      context: { caller: RpcUser };
    },
    ctx: AdminRpcContext,
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validatePortalProfileRequest(req);
    if (validation.isErr()) return validation;
    const { profile: normalizedProfile } = validation.take() as {
      profile: Pick<
        PortalProfile,
        "portalId" | "entryUrl" | "contractId" | "allowedOrigins"
      >;
    };
    const derived = await derivePortalProfileCapabilities({
      contractStorage: deps.contractStorage,
      contractStore: deps.contractStore,
      contractId: normalizedProfile.contractId,
    });
    if (derived.isErr()) return derived;
    const { impliedCapabilities } = derived.take() as {
      impliedCapabilities: string[];
    };

    const existing = await loadPortalProfile(ctx, normalizedProfile.portalId);
    const now = new Date().toISOString();
    const profile: PortalProfile = {
      portalId: normalizedProfile.portalId,
      entryUrl: normalizedProfile.entryUrl,
      contractId: normalizedProfile.contractId,
      ...(normalizedProfile.allowedOrigins
        ? { allowedOrigins: normalizedProfile.allowedOrigins }
        : {}),
      impliedCapabilities,
      disabled: false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const existingPortal = await loadPortal(ctx, profile.portalId);
    await ctx.portalProfileStorage.put(profile);
    await ctx.portalStorage.put({
      portalId: profile.portalId,
      entryUrl: profile.entryUrl,
      disabled: existingPortal?.disabled ?? false,
    });

    const revokedBy = caller.origin && caller.id
      ? `${caller.origin}.${caller.id}`
      : undefined;
    const affectedContractIds = new Set([
      profile.contractId,
      ...(existing ? [existing.contractId] : []),
    ]);
    for (const contractId of affectedContractIds) {
      await revokeInvalidatedEffectiveGrantSessions({
        ctx,
        contractId,
        revokedBy,
      });
    }
    return Result.ok({ profile });
  };
}

export const authDisablePortalProfileHandler = async (
  { input: req, context: { caller } }: {
    input: { portalId: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const existing = await loadPortalProfile(ctx, req.portalId);
  if (!existing) {
    return invalidRequest({
      portalId: req.portalId,
      reason: "portal_profile_not_found",
    });
  }
  const profile: PortalProfile = {
    ...existing,
    disabled: true,
    updatedAt: new Date().toISOString(),
  };
  await ctx.portalProfileStorage.put(profile);

  await revokeInvalidatedEffectiveGrantSessions({
    ctx,
    contractId: profile.contractId,
    revokedBy: caller.origin && caller.id
      ? `${caller.origin}.${caller.id}`
      : undefined,
  });
  return Result.ok({ profile });
};

export const authGetLoginPortalDefaultHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({
    defaultPortal: (await loadPortalDefault(ctx, LOGIN_DEFAULT_KEY)) ??
      { portalId: null },
  });
};

export const authListInstanceGrantPoliciesHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ policies: await listInstanceGrantPolicies(ctx) });
};

export const authUpsertInstanceGrantPolicyHandler = async (
  { input: req, context: { caller } }: {
    input: UpsertInstanceGrantPolicyRequest;
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validateInstanceGrantPolicyRequest(req);
  if (validation.isErr()) return validation;
  const { policy: normalizedPolicy } = validation.take() as {
    policy: Pick<
      InstanceGrantPolicy,
      "contractId" | "allowedOrigins" | "impliedCapabilities"
    >;
  };
  const existing = await loadInstanceGrantPolicy(
    ctx,
    normalizedPolicy.contractId,
  );
  const now = new Date().toISOString();
  const actor = policyActor(caller);
  const existingActors = adminPolicyActors(existing);
  const policy: InstanceGrantPolicy = {
    contractId: normalizedPolicy.contractId,
    ...(normalizedPolicy.allowedOrigins
      ? { allowedOrigins: normalizedPolicy.allowedOrigins }
      : {}),
    impliedCapabilities: normalizedPolicy.impliedCapabilities,
    disabled: false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    source: {
      kind: "admin_policy",
      ...(existingActors.createdBy || actor
        ? { createdBy: existingActors.createdBy ?? actor }
        : {}),
      ...(actor
        ? { updatedBy: actor }
        : existingActors.updatedBy
        ? { updatedBy: existingActors.updatedBy }
        : {}),
    },
  };
  await ctx.instanceGrantPolicyStorage.put(policy);
  await revokeInvalidatedEffectiveGrantSessions({
    ctx,
    contractId: policy.contractId,
    revokedBy: actor ? `${actor.origin}.${actor.id}` : undefined,
  });
  return Result.ok({ policy });
};

export const authDisableInstanceGrantPolicyHandler = async (
  { input: req, context: { caller } }: {
    input: { contractId: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  if (!req.contractId) return invalidRequest({ contractId: req.contractId });
  const existing = await loadInstanceGrantPolicy(ctx, req.contractId);
  if (!existing) {
    return invalidRequest({
      contractId: req.contractId,
      reason: "instance_grant_policy_not_found",
    });
  }
  const actor = policyActor(caller);
  const policy: InstanceGrantPolicy = {
    ...existing,
    disabled: true,
    updatedAt: new Date().toISOString(),
    source: {
      kind: "admin_policy",
      ...adminPolicyActors(existing),
      ...(actor ? { updatedBy: actor } : {}),
    },
  };
  await ctx.instanceGrantPolicyStorage.put(policy);
  await revokeInvalidatedEffectiveGrantSessions({
    ctx,
    contractId: policy.contractId,
    revokedBy: actor ? `${actor.origin}.${actor.id}` : undefined,
  });
  return Result.ok({ policy });
};

export const authSetLoginPortalDefaultHandler = async (
  { input: req, context: { caller } }: {
    input: PortalDefaultRequest;
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validatePortalDefaultRequest(req);
  if (validation.isErr()) return validation;
  const { defaultPortal } = validation.take() as {
    defaultPortal: PortalDefault;
  };
  const referenceCheck = await ensurePortalReference(
    ctx,
    defaultPortal.portalId,
  );
  if (referenceCheck.isErr()) return referenceCheck;
  await ctx.portalDefaultStorage.putLogin(defaultPortal);
  return Result.ok({ defaultPortal });
};

export const authListLoginPortalSelectionsHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ selections: await listLoginPortalSelections(ctx) });
};

export const authSetLoginPortalSelectionHandler = async (
  { input: req, context: { caller } }: {
    input: LoginPortalSelectionRequest;
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validateLoginPortalSelectionRequest(req);
  if (validation.isErr()) return validation;
  const { selection } = validation.take() as {
    selection: LoginPortalSelection;
  };
  const referenceCheck = await ensurePortalReference(ctx, selection.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await ctx.loginPortalSelectionStorage.put(selection);
  return Result.ok({ selection });
};

export const authClearLoginPortalSelectionHandler = async (
  { input: req, context: { caller } }: {
    input: { contractId: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const selection = await loadLoginPortalSelection(ctx, req.contractId);
  if (!selection) return Result.ok({ success: false });
  await ctx.loginPortalSelectionStorage.delete(req.contractId);
  return Result.ok({ success: true });
};

export const authGetDevicePortalDefaultHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({
    defaultPortal: (await loadPortalDefault(ctx, DEVICE_DEFAULT_KEY)) ??
      { portalId: null },
  });
};

export const authSetDevicePortalDefaultHandler = async (
  { input: req, context: { caller } }: {
    input: PortalDefaultRequest;
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validatePortalDefaultRequest(req);
  if (validation.isErr()) return validation;
  const { defaultPortal } = validation.take() as {
    defaultPortal: PortalDefault;
  };
  const referenceCheck = await ensurePortalReference(
    ctx,
    defaultPortal.portalId,
  );
  if (referenceCheck.isErr()) return referenceCheck;
  await ctx.portalDefaultStorage.putDevice(defaultPortal);
  return Result.ok({ defaultPortal });
};

export const authListDevicePortalSelectionsHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ selections: await listDevicePortalSelections(ctx) });
};

export const authSetDevicePortalSelectionHandler = async (
  { input: req, context: { caller } }: {
    input: DevicePortalSelectionRequest;
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validateDevicePortalSelectionRequest(req);
  if (validation.isErr()) return validation;
  const { selection } = validation.take() as {
    selection: DevicePortalSelection;
  };
  const deployment = await loadDeviceDeployment(ctx, selection.deploymentId);
  if (!deployment || deployment.disabled) {
    return invalidRequest({
      deploymentId: selection.deploymentId,
      reason: "device_deployment_not_found",
    });
  }
  const referenceCheck = await ensurePortalReference(ctx, selection.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await ctx.devicePortalSelectionStorage.put(selection);
  return Result.ok({ selection });
};

export const authClearDevicePortalSelectionHandler = async (
  { input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const selection = await loadDevicePortalSelection(ctx, req.deploymentId);
  if (!selection) return Result.ok({ success: false });
  await ctx.devicePortalSelectionStorage.delete(req.deploymentId);
  return Result.ok({ success: true });
};

/** Creates portal and policy admin handlers bound to explicit runtime deps. */
export function createPortalPolicyAdminHandlers(
  deps: AdminRpcDeps & {
    contractStorage: SqlContractStorageRepository;
    contractStore: ContractStore;
  },
) {
  return {
    createPortal: bindAdminRpcHandler(deps, createAuthCreatePortalHandler()),
    listPortals: bindAdminRpcHandler(deps, authListPortalsHandler),
    disablePortal: bindAdminRpcHandler(deps, authDisablePortalHandler),
    listPortalProfiles: bindAdminRpcHandler(
      deps,
      authListPortalProfilesHandler,
    ),
    setPortalProfile: bindAdminRpcHandler(
      deps,
      createAuthSetPortalProfileHandler({
        contractStorage: deps.contractStorage,
        contractStore: deps.contractStore,
      }),
    ),
    disablePortalProfile: bindAdminRpcHandler(
      deps,
      authDisablePortalProfileHandler,
    ),
    getLoginPortalDefault: bindAdminRpcHandler(
      deps,
      authGetLoginPortalDefaultHandler,
    ),
    listInstanceGrantPolicies: bindAdminRpcHandler(
      deps,
      authListInstanceGrantPoliciesHandler,
    ),
    upsertInstanceGrantPolicy: bindAdminRpcHandler(
      deps,
      authUpsertInstanceGrantPolicyHandler,
    ),
    disableInstanceGrantPolicy: bindAdminRpcHandler(
      deps,
      authDisableInstanceGrantPolicyHandler,
    ),
    setLoginPortalDefault: bindAdminRpcHandler(
      deps,
      authSetLoginPortalDefaultHandler,
    ),
    listLoginPortalSelections: bindAdminRpcHandler(
      deps,
      authListLoginPortalSelectionsHandler,
    ),
    setLoginPortalSelection: bindAdminRpcHandler(
      deps,
      authSetLoginPortalSelectionHandler,
    ),
    clearLoginPortalSelection: bindAdminRpcHandler(
      deps,
      authClearLoginPortalSelectionHandler,
    ),
    getDevicePortalDefault: bindAdminRpcHandler(
      deps,
      authGetDevicePortalDefaultHandler,
    ),
    setDevicePortalDefault: bindAdminRpcHandler(
      deps,
      authSetDevicePortalDefaultHandler,
    ),
    listDevicePortalSelections: bindAdminRpcHandler(
      deps,
      authListDevicePortalSelectionsHandler,
    ),
    setDevicePortalSelection: bindAdminRpcHandler(
      deps,
      authSetDevicePortalSelectionHandler,
    ),
    clearDevicePortalSelection: bindAdminRpcHandler(
      deps,
      authClearDevicePortalSelectionHandler,
    ),
  };
}
