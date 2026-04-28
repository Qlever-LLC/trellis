import { AuthError, UnexpectedError } from "@qlever-llc/trellis";
import { isErr, Result } from "@qlever-llc/result";

import type { AuthLogger, RuntimeKV } from "../runtime_deps.ts";
import {
  type CreateDeviceDeploymentRequest,
  type CreatePortalRequest,
  type DeviceActivationReview,
  type DeviceDeployment,
  type DeviceInstance,
  type DevicePortalSelection,
  type DevicePortalSelectionRequest,
  type DeviceProvisioningSecret,
  type InstanceGrantPolicyActor,
  type LoginPortalSelection,
  type LoginPortalSelectionRequest,
  normalizeDeviceAppliedContracts,
  type Portal,
  type PortalDefault,
  type PortalDefaultRequest,
  type PortalProfile,
  type ProvisionDeviceInstanceRequest,
  type SetPortalProfileRequest,
  type UpsertInstanceGrantPolicyRequest,
  validateDeviceDeploymentRequest,
  validateDevicePortalSelectionRequest,
  validateDeviceProvisionRequest,
  validateInstanceGrantPolicyRequest,
  validateLoginPortalSelectionRequest,
  validatePortalDefaultRequest,
  validatePortalProfileRequest,
  validatePortalRequest,
} from "./shared.ts";
import { deriveDeviceConfirmationCode } from "@qlever-llc/trellis/auth";
import type { ContractStore } from "../../catalog/store.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import { planUserContractApproval } from "../approval/plan.ts";
import {
  matchingInstanceGrantPolicies,
  userDelegationAllowed,
} from "../grants/policy.ts";
import type {
  Connection,
  InstanceGrantPolicy,
  Session,
  UserProjectionEntry,
} from "../schemas.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlInstanceGrantPolicyRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalProfileRepository,
  SqlPortalRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import {
  connectionFilterForSession,
  parseConnectionKey,
} from "../session/connections.ts";

type RpcUser = { capabilities?: string[]; origin?: string; id?: string };
type DeviceActivation = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  activatedBy?: {
    origin: string;
    id: string;
  };
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type DeviceActivationFlow = {
  flowId: string;
  instanceId: string;
  deploymentId: string;
  publicIdentityKey: string;
  nonce: string;
  qrMac: string;
  createdAt: Date | string;
  expiresAt: Date | string;
};

type DeviceActivationReviewRecord = {
  reviewId: string;
  flowId: string;
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string | Date;
  decidedAt: string | Date | null;
  reason?: string;
  requestedBy: {
    origin: string;
    id: string;
  };
};
type ActiveContractsDeps = { refreshActiveContracts: () => Promise<void> };
type ActiveCatalogValidator = (opts: {
  stagedDeviceDeployments?: Iterable<DeviceDeployment>;
  stagedDeviceInstances?: Iterable<DeviceInstance>;
}) => Promise<unknown>;

export type AdminRpcDeps = {
  browserFlowsKV: RuntimeKV<unknown>;
  connectionsKV: RuntimeKV<Connection>;
  contractApprovalStorage: Pick<SqlContractApprovalRepository, "get">;
  deviceActivationReviewStorage: {
    get(reviewId: string): Promise<DeviceActivationReviewRecord | undefined>;
    getByFlowId(
      flowId: string,
    ): Promise<DeviceActivationReviewRecord | undefined>;
    put(record: DeviceActivationReviewRecord): Promise<void>;
    list(): Promise<DeviceActivationReviewRecord[]>;
  };
  deviceActivationStorage: {
    get(instanceId: string): Promise<DeviceActivation | undefined>;
    put(record: DeviceActivation): Promise<void>;
    delete(instanceId: string): Promise<void>;
    list(): Promise<DeviceActivation[]>;
  };
  deviceDeploymentStorage: Pick<
    SqlDeviceDeploymentRepository,
    "get" | "put" | "delete" | "list"
  >;
  deviceInstanceStorage: {
    get(instanceId: string): Promise<DeviceInstance | undefined>;
    put(record: DeviceInstance): Promise<void>;
    delete(instanceId: string): Promise<void>;
    list(): Promise<DeviceInstance[]>;
  };
  devicePortalSelectionStorage: {
    get(deploymentId: string): Promise<DevicePortalSelection | undefined>;
    put(record: DevicePortalSelection): Promise<void>;
    delete(deploymentId: string): Promise<void>;
    list(): Promise<DevicePortalSelection[]>;
  };
  deviceProvisioningSecretStorage: Pick<
    SqlDeviceProvisioningSecretRepository,
    "get" | "put" | "delete"
  >;
  instanceGrantPolicyStorage: Pick<
    SqlInstanceGrantPolicyRepository,
    "get" | "put" | "list"
  >;
  kick: (serverId: string, clientId: number) => Promise<void>;
  loadEffectiveGrantPolicies: (
    contractId: string,
  ) => Promise<InstanceGrantPolicy[]>;
  logger: Pick<AuthLogger, "trace" | "warn">;
  loginPortalSelectionStorage: Pick<
    SqlLoginPortalSelectionRepository,
    "get" | "put" | "delete" | "list"
  >;
  portalDefaultStorage: Pick<
    SqlPortalDefaultRepository,
    "getLogin" | "getDevice" | "putLogin" | "putDevice"
  >;
  portalProfileStorage: Pick<
    SqlPortalProfileRepository,
    "get" | "put" | "list"
  >;
  portalStorage: Pick<SqlPortalRepository, "get" | "put" | "list">;
  publishSessionRevoked: (
    event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    },
  ) => Promise<void>;
  sessionStorage: Pick<
    SqlSessionRepository,
    | "deleteByPublicIdentityKey"
    | "deleteBySessionKey"
    | "listEntries"
  >;
  userStorage: Pick<SqlUserProjectionRepository, "get">;
};

type AdminRpcContext = AdminRpcDeps;

type AdminRpcHandler<Args, Response> = (
  args: Args,
  ctx: AdminRpcContext,
) => Promise<Response>;

function bindAdminRpcHandler<Args, Response>(
  deps: AdminRpcDeps,
  handler: AdminRpcHandler<Args, Response>,
): (args: Args) => Promise<Response> {
  return (args) => handler(args, deps);
}

const LOGIN_DEFAULT_KEY = "login.default";
const DEVICE_DEFAULT_KEY = "device.default";

function isAdmin(user: RpcUser): boolean {
  return user.capabilities?.includes("admin") ?? false;
}

function reviewableDeployments(user: RpcUser): Set<string> | null {
  if (isAdmin(user)) return null;
  const capabilities = user.capabilities ?? [];
  if (capabilities.includes("device.review")) return null;

  const deployments = new Set<string>();
  for (const capability of capabilities) {
    if (!capability.startsWith("device.review.")) continue;
    const deploymentId = capability.slice("device.review.".length).trim();
    if (deploymentId) deployments.add(deploymentId);
  }

  return deployments.size > 0 ? deployments : new Set<string>();
}

function canReview(user: RpcUser): boolean {
  const deployments = reviewableDeployments(user);
  return deployments === null || deployments.size > 0;
}

function canReviewDeployment(user: RpcUser, deploymentId: string): boolean {
  if (isAdmin(user)) return true;
  const deployments = reviewableDeployments(user);
  if (deployments === null) return true;
  return deployments.has(deploymentId);
}

function unwrapConnection(
  entry: unknown,
): { serverId: string; clientId: number } | null {
  if (!entry || typeof entry !== "object" || !("value" in entry)) return null;
  const value = entry.value;
  if (!value || typeof value !== "object") return null;
  const serverId = "serverId" in value ? value.serverId : undefined;
  const clientId = "clientId" in value ? value.clientId : undefined;
  if (typeof serverId !== "string" || typeof clientId !== "number") {
    return null;
  }
  return { serverId, clientId };
}

function insufficientPermissions() {
  return Result.err(new AuthError({ reason: "insufficient_permissions" }));
}

function invalidRequest(context?: Record<string, unknown>) {
  return Result.err(new AuthError({ reason: "invalid_request", context }));
}

async function refreshActiveContracts(deps: ActiveContractsDeps) {
  try {
    await deps.refreshActiveContracts();
    return Result.ok(undefined);
  } catch (error) {
    return Result.err(
      new UnexpectedError({
        cause: error instanceof Error ? error : new Error(String(error)),
      }),
    );
  }
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

async function loadDeviceInstance(
  ctx: AdminRpcContext,
  instanceId: string,
): Promise<DeviceInstance | null> {
  return await ctx.deviceInstanceStorage.get(instanceId) ?? null;
}

async function loadDeviceProvisioningSecret(
  ctx: AdminRpcContext,
  instanceId: string,
): Promise<DeviceProvisioningSecret | null> {
  return await ctx.deviceProvisioningSecretStorage.get(instanceId) ?? null;
}

async function loadDeviceActivationReview(
  ctx: AdminRpcContext,
  reviewId: string,
): Promise<DeviceActivationReviewRecord | null> {
  return await ctx.deviceActivationReviewStorage.get(reviewId) ?? null;
}

async function loadDeviceActivationFlow(
  ctx: AdminRpcContext,
  flowId: string,
): Promise<DeviceActivationFlow | null> {
  const entry = await ctx.browserFlowsKV.get(flowId).take();
  if (isErr(entry)) return null;
  const flow = entry.value as {
    flowId?: string;
    kind?: string;
    deviceActivation?: {
      instanceId: string;
      deploymentId: string;
      publicIdentityKey: string;
      nonce: string;
      qrMac: string;
    };
    createdAt: Date | string;
    expiresAt: Date | string;
  };
  if (
    flow.kind !== "device_activation" || !flow.deviceActivation || !flow.flowId
  ) {
    return null;
  }
  return {
    flowId: flow.flowId,
    instanceId: flow.deviceActivation.instanceId,
    deploymentId: flow.deviceActivation.deploymentId,
    publicIdentityKey: flow.deviceActivation.publicIdentityKey,
    nonce: flow.deviceActivation.nonce,
    qrMac: flow.deviceActivation.qrMac,
    createdAt: flow.createdAt,
    expiresAt: flow.expiresAt,
  };
}

async function loadDeviceActivation(
  ctx: AdminRpcContext,
  instanceId: string,
): Promise<DeviceActivation | null> {
  return await ctx.deviceActivationStorage.get(instanceId) ?? null;
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

async function listDeviceDeployments(
  ctx: AdminRpcContext,
): Promise<DeviceDeployment[]> {
  return await ctx.deviceDeploymentStorage.list();
}

async function listDeviceInstances(
  ctx: AdminRpcContext,
): Promise<DeviceInstance[]> {
  return await ctx.deviceInstanceStorage.list();
}

async function listDeviceActivations(
  ctx: AdminRpcContext,
): Promise<DeviceActivation[]> {
  return await ctx.deviceActivationStorage.list();
}

async function listDeviceActivationReviews(ctx: AdminRpcContext): Promise<
  DeviceActivationReviewRecord[]
> {
  return await ctx.deviceActivationReviewStorage.list();
}

function toPublicReview(
  review: DeviceActivationReviewRecord,
): DeviceActivationReview {
  return {
    reviewId: review.reviewId,
    instanceId: review.instanceId,
    publicIdentityKey: review.publicIdentityKey,
    deploymentId: review.deploymentId,
    state: review.state,
    requestedAt: review.requestedAt instanceof Date
      ? review.requestedAt.toISOString()
      : review.requestedAt,
    decidedAt: review.decidedAt instanceof Date
      ? review.decidedAt.toISOString()
      : review.decidedAt,
    ...(review.reason ? { reason: review.reason } : {}),
  };
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
  const connIter = await ctx.connectionsKV.keys(
    connectionFilterForSession(sessionKey),
  )
    .take();
  if (!isErr(connIter)) {
    for await (const connKey of connIter) {
      const parsedKey = parseConnectionKey(connKey);
      if (!parsedKey || parsedKey.scopeId !== session.trellisId) continue;
      const entry = await ctx.connectionsKV.get(connKey).take();
      if (!isErr(entry)) {
        const connection = unwrapConnection(entry);
        if (connection) {
          await ctx.kick(connection.serverId, connection.clientId);
        }
      }
      await ctx.connectionsKV.delete(connKey);
    }
  }

  if (revokedBy) {
    await ctx.publishSessionRevoked({
      origin: session.origin,
      id: session.id,
      sessionKey,
      revokedBy,
    });
  }
  await ctx.sessionStorage.deleteBySessionKey(sessionKey);
}

async function kickDeviceRuntimeAccess(
  ctx: AdminRpcContext,
  publicIdentityKey: string,
): Promise<void> {
  const connIter = await ctx.connectionsKV.keys(
    connectionFilterForSession(publicIdentityKey),
  )
    .take();
  if (!isErr(connIter)) {
    for await (const connKey of connIter) {
      const entry = await ctx.connectionsKV.get(connKey).take();
      if (!isErr(entry)) {
        const connection = unwrapConnection(entry);
        if (connection) {
          await ctx.kick(connection.serverId, connection.clientId);
        }
      }
      await ctx.connectionsKV.delete(connKey);
    }
  }

  await ctx.sessionStorage.deleteByPublicIdentityKey(publicIdentityKey);
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

async function confirmationCodeForReview(
  ctx: AdminRpcContext,
  review: DeviceActivationReviewRecord,
): Promise<string | null> {
  const flow = await loadDeviceActivationFlow(ctx, review.flowId);
  const provisioningSecret = await loadDeviceProvisioningSecret(
    ctx,
    review.instanceId,
  );
  if (!flow || !provisioningSecret) return null;
  return await deriveDeviceConfirmationCode({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: review.publicIdentityKey,
    nonce: flow.nonce,
  });
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
): Promise<
  Record<string, unknown>[]
> {
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
    {
      input: req,
      context: { caller },
    }: {
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
    {
      input: req,
      context: { caller },
    }: {
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
  {
    input: req,
    context: { caller },
  }: {
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

export function createAuthCreateDeviceDeploymentHandler() {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: Parameters<typeof validateDeviceDeploymentRequest>[0];
      context: { caller: RpcUser };
    },
    ctx: AdminRpcContext,
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateDeviceDeploymentRequest(req);
    if (validation.isErr()) return validation;
    const { deployment } = validation.take() as {
      deployment: DeviceDeployment;
    };
    await ctx.deviceDeploymentStorage.put(deployment);
    return Result.ok({ deployment });
  };
}

export const authListDeviceDeploymentsHandler = async (
  { input: req, context: { caller } }: {
    input: { disabled?: boolean };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let deployments = await listDeviceDeployments(ctx);
  if (req.disabled !== undefined) {
    deployments = deployments.filter((deployment) =>
      deployment.disabled === req.disabled
    );
  }
  return Result.ok({ deployments });
};

export function createAuthApplyDeviceDeploymentContractHandler(deps: {
  installDeviceContract: (
    contract: unknown,
  ) => Promise<
    { id: string; digest: string; displayName: string; description: string }
  >;
  refreshActiveContracts: () => Promise<void>;
  validateActiveCatalog: ActiveCatalogValidator;
}) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; contract: unknown };
      context: { caller: RpcUser };
    },
    ctx: AdminRpcContext,
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const deployment = await loadDeviceDeployment(ctx, req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    let installed;
    try {
      installed = await deps.installDeviceContract(req.contract);
    } catch (error) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const nextDeployment: DeviceDeployment = {
      ...deployment,
      appliedContracts: normalizeDeviceAppliedContracts([
        ...deployment.appliedContracts,
        { contractId: installed.id, allowedDigests: [installed.digest] },
      ]),
    };
    try {
      await deps.validateActiveCatalog({
        stagedDeviceDeployments: [nextDeployment],
      });
    } catch (error) {
      return Result.err(
        new UnexpectedError({
          cause: error instanceof Error ? error : new Error(String(error)),
        }),
      );
    }
    await ctx.deviceDeploymentStorage.put(nextDeployment);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) {
      await ctx.deviceDeploymentStorage.put(deployment);
      return refreshed;
    }
    const instances = (await listDeviceInstances(ctx)).filter((instance) =>
      instance.deploymentId === deployment.deploymentId
    );
    for (const instance of instances) {
      await kickDeviceRuntimeAccess(ctx, instance.publicIdentityKey);
    }
    return Result.ok({
      deployment: nextDeployment,
      contract: {
        digest: installed.digest,
        id: installed.id,
        displayName: installed.displayName,
        description: installed.description,
        installedAt: new Date().toISOString(),
      },
    });
  };
}

export function createAuthUnapplyDeviceDeploymentContractHandler(
  deps: ActiveContractsDeps & { validateActiveCatalog: ActiveCatalogValidator },
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; contractId: string; digests?: string[] };
      context: { caller: RpcUser };
    },
    ctx: AdminRpcContext,
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const deployment = await loadDeviceDeployment(ctx, req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    const removeDigests = new Set(req.digests ?? []);
    const nextDeployment: DeviceDeployment = {
      ...deployment,
      appliedContracts: normalizeDeviceAppliedContracts(
        deployment.appliedContracts
          .map((applied) => {
            if (applied.contractId !== req.contractId) return applied;
            if (removeDigests.size === 0) return null;
            const remaining = applied.allowedDigests.filter((digest) =>
              !removeDigests.has(digest)
            );
            return remaining.length > 0
              ? { ...applied, allowedDigests: remaining }
              : null;
          })
          .filter((value): value is NonNullable<typeof value> =>
            value !== null
          ),
      ),
    };
    try {
      await deps.validateActiveCatalog({
        stagedDeviceDeployments: [nextDeployment],
      });
    } catch (error) {
      return Result.err(
        new UnexpectedError({
          cause: error instanceof Error ? error : new Error(String(error)),
        }),
      );
    }
    await ctx.deviceDeploymentStorage.put(nextDeployment);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) {
      await ctx.deviceDeploymentStorage.put(deployment);
      return refreshed;
    }
    const instances = (await listDeviceInstances(ctx)).filter((instance) =>
      instance.deploymentId === deployment.deploymentId
    );
    for (const instance of instances) {
      await kickDeviceRuntimeAccess(ctx, instance.publicIdentityKey);
    }
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthDisableDeviceDeploymentHandler(
  deps: ActiveContractsDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  }, ctx: AdminRpcContext) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const deployment = await loadDeviceDeployment(ctx, req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    const nextDeployment = { ...deployment, disabled: true };
    await ctx.deviceDeploymentStorage.put(nextDeployment);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
    for (
      const instance of (await listDeviceInstances(ctx)).filter((entry) =>
        entry.deploymentId === req.deploymentId
      )
    ) {
      await kickDeviceRuntimeAccess(ctx, instance.publicIdentityKey);
    }
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthEnableDeviceDeploymentHandler(
  deps: ActiveContractsDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  }, ctx: AdminRpcContext) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const deployment = await loadDeviceDeployment(ctx, req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    const nextDeployment = { ...deployment, disabled: false };
    await ctx.deviceDeploymentStorage.put(nextDeployment);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthRemoveDeviceDeploymentHandler(
  deps: ActiveContractsDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  }, ctx: AdminRpcContext) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const inUse = (await listDeviceInstances(ctx)).some((instance) =>
      instance.deploymentId === req.deploymentId
    );
    if (inUse) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_in_use",
      });
    }
    await ctx.deviceDeploymentStorage.delete(req.deploymentId);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
    return Result.ok({ success: true });
  };
}

export function createAuthProvisionDeviceInstanceHandler() {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: ProvisionDeviceInstanceRequest;
      context: { caller: RpcUser };
    },
    ctx: AdminRpcContext,
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateDeviceProvisionRequest(req);
    if (validation.isErr()) return validation;
    const { instance, provisioningSecret } = validation.take() as {
      instance: DeviceInstance;
      provisioningSecret: DeviceProvisioningSecret;
    };
    const deployment = await loadDeviceDeployment(ctx, instance.deploymentId);
    if (!deployment || deployment.disabled) {
      return invalidRequest({
        deploymentId: instance.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    await ctx.deviceInstanceStorage.put(instance);
    await ctx.deviceProvisioningSecretStorage.put(provisioningSecret);
    return Result.ok({ instance });
  };
}

export const authListDeviceInstancesHandler = async (
  { input: req, context: { caller } }: {
    input: { deploymentId?: string; state?: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let instances = await listDeviceInstances(ctx);
  if (req.deploymentId) {
    instances = instances.filter((instance) =>
      instance.deploymentId === req.deploymentId
    );
  }
  if (req.state) {
    instances = instances.filter((instance) => instance.state === req.state);
  }
  return Result.ok({ instances });
};

export function createAuthDisableDeviceInstanceHandler(
  deps: ActiveContractsDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }, ctx: AdminRpcContext) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const instance = await loadDeviceInstance(ctx, req.instanceId);
    if (!instance) {
      return invalidRequest({
        instanceId: req.instanceId,
        reason: "unknown_device",
      });
    }
    const nextInstance = { ...instance, state: "disabled" as const };
    await ctx.deviceInstanceStorage.put(nextInstance);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
    await kickDeviceRuntimeAccess(ctx, instance.publicIdentityKey);
    return Result.ok({ instance: nextInstance });
  };
}

export function createAuthEnableDeviceInstanceHandler(
  deps: ActiveContractsDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }, ctx: AdminRpcContext) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const instance = await loadDeviceInstance(ctx, req.instanceId);
    if (!instance) {
      return invalidRequest({
        instanceId: req.instanceId,
        reason: "unknown_device",
      });
    }
    const activation = await loadDeviceActivation(ctx, req.instanceId);
    const nextState: DeviceInstance["state"] =
      activation && activation.state === "activated" &&
        activation.revokedAt === null
        ? "activated"
        : "registered";
    const nextInstance = { ...instance, state: nextState };
    await ctx.deviceInstanceStorage.put(nextInstance);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
    return Result.ok({ instance: nextInstance });
  };
}

export function createAuthRemoveDeviceInstanceHandler(
  deps: ActiveContractsDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }, ctx: AdminRpcContext) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const instance = await loadDeviceInstance(ctx, req.instanceId);
    if (!instance) {
      return invalidRequest({
        instanceId: req.instanceId,
        reason: "unknown_device",
      });
    }
    await kickDeviceRuntimeAccess(ctx, instance.publicIdentityKey);
    await ctx.deviceInstanceStorage.delete(req.instanceId);
    await ctx.deviceProvisioningSecretStorage.delete(req.instanceId);
    await ctx.deviceActivationStorage.delete(req.instanceId);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
    return Result.ok({ success: true });
  };
}

export const authListDeviceActivationsHandler = async (
  { input: req, context: { caller } }: {
    input: { instanceId?: string; deploymentId?: string; state?: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let activations = await listDeviceActivations(ctx);
  if (req.instanceId) {
    activations = activations.filter((activation) =>
      activation.instanceId === req.instanceId
    );
  }
  if (req.deploymentId) {
    activations = activations.filter((activation) =>
      activation.deploymentId === req.deploymentId
    );
  }
  if (req.state) {
    activations = activations.filter((activation) =>
      activation.state === req.state
    );
  }
  return Result.ok({ activations });
};

export const authRevokeDeviceActivationHandler = async (
  { input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const activation = await ctx.deviceActivationStorage.get(req.instanceId);
  if (!activation) return Result.ok({ success: false });
  const nextActivation = {
    ...activation,
    state: "revoked" as const,
    revokedAt: new Date().toISOString(),
  };
  await ctx.deviceActivationStorage.put(nextActivation);
  await kickDeviceRuntimeAccess(ctx, nextActivation.publicIdentityKey);
  return Result.ok({ success: true });
};

export const authListDeviceActivationReviewsHandler = async (
  { input: req, context: { caller } }: {
    input: { instanceId?: string; deploymentId?: string; state?: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  if (!canReview(caller)) return insufficientPermissions();
  const allowedDeployments = reviewableDeployments(caller);
  if (
    allowedDeployments !== null && req.deploymentId &&
    !allowedDeployments.has(req.deploymentId)
  ) {
    return insufficientPermissions();
  }
  let reviews = await listDeviceActivationReviews(ctx);
  if (req.instanceId) {
    reviews = reviews.filter((review) => review.instanceId === req.instanceId);
  }
  if (req.deploymentId) {
    reviews = reviews.filter((review) =>
      review.deploymentId === req.deploymentId
    );
  }
  if (req.state) {
    reviews = reviews.filter((review) => review.state === req.state);
  }
  if (allowedDeployments !== null) {
    reviews = reviews.filter((review) =>
      allowedDeployments.has(review.deploymentId)
    );
  }
  return Result.ok({ reviews: reviews.map(toPublicReview) });
};

export const authDecideDeviceActivationReviewHandler = async (
  {
    input: req,
    context: { caller },
  }: {
    input: {
      reviewId: string;
      decision: "approve" | "reject";
      reason?: string;
    };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  const review = await loadDeviceActivationReview(ctx, req.reviewId);
  if (!review) {
    return invalidRequest({
      reviewId: req.reviewId,
      reason: "device_review_not_found",
    });
  }
  if (!canReviewDeployment(caller, review.deploymentId)) {
    return insufficientPermissions();
  }

  if (review.state !== "pending") {
    const activation = review.state === "approved"
      ? await loadDeviceActivation(ctx, review.instanceId)
      : null;
    const confirmationCode = review.state === "approved"
      ? await confirmationCodeForReview(ctx, review)
      : null;
    return Result.ok({
      review: toPublicReview(review),
      ...(activation ? { activation } : {}),
      ...(confirmationCode ? { confirmationCode } : {}),
    });
  }

  const decidedAt = new Date().toISOString();
  const nextState = req.decision === "approve" ? "approved" : "rejected";
  const updatedReview: DeviceActivationReviewRecord = {
    ...review,
    state: nextState,
    decidedAt,
    ...(req.reason ? { reason: req.reason } : {}),
  };

  if (req.decision === "reject") {
    await ctx.deviceActivationReviewStorage.put(updatedReview);
    return Result.ok({ review: toPublicReview(updatedReview) });
  }

  const instance = await loadDeviceInstance(ctx, review.instanceId);
  const deployment = await loadDeviceDeployment(ctx, review.deploymentId);
  if (!instance || instance.state === "disabled") {
    return invalidRequest({
      instanceId: review.instanceId,
      reason: "unknown_device",
    });
  }
  if (!deployment || deployment.disabled) {
    return invalidRequest({
      deploymentId: review.deploymentId,
      reason: "device_deployment_not_found",
    });
  }

  const activatedAt = decidedAt;
  const activation: DeviceActivation = {
    instanceId: instance.instanceId,
    publicIdentityKey: instance.publicIdentityKey,
    deploymentId: deployment.deploymentId,
    activatedBy: review.requestedBy,
    state: "activated",
    activatedAt,
    revokedAt: null,
  };
  await ctx.deviceActivationStorage.put(activation);
  await ctx.deviceInstanceStorage.put({
    ...instance,
    state: "activated",
    activatedAt,
    revokedAt: null,
  });
  await ctx.deviceActivationReviewStorage.put(updatedReview);
  const confirmationCode = await confirmationCodeForReview(ctx, updatedReview);
  return Result.ok({
    review: toPublicReview(updatedReview),
    activation,
    ...(confirmationCode ? { confirmationCode } : {}),
  });
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

/** Creates device admin handlers bound to explicit runtime deps. */
export function createDeviceAdminHandlers(
  deps: AdminRpcDeps & {
    installDeviceContract: (
      contract: unknown,
    ) => Promise<
      { id: string; digest: string; displayName: string; description: string }
    >;
    refreshActiveContracts: () => Promise<void>;
    validateActiveCatalog: ActiveCatalogValidator;
  },
) {
  const activeContractsDeps = {
    refreshActiveContracts: deps.refreshActiveContracts,
    validateActiveCatalog: deps.validateActiveCatalog,
  };
  return {
    createDeviceDeployment: bindAdminRpcHandler(
      deps,
      createAuthCreateDeviceDeploymentHandler(),
    ),
    applyDeviceDeploymentContract: bindAdminRpcHandler(
      deps,
      createAuthApplyDeviceDeploymentContractHandler({
        installDeviceContract: deps.installDeviceContract,
        refreshActiveContracts: deps.refreshActiveContracts,
        validateActiveCatalog: deps.validateActiveCatalog,
      }),
    ),
    unapplyDeviceDeploymentContract: bindAdminRpcHandler(
      deps,
      createAuthUnapplyDeviceDeploymentContractHandler(activeContractsDeps),
    ),
    listDeviceDeployments: bindAdminRpcHandler(
      deps,
      authListDeviceDeploymentsHandler,
    ),
    disableDeviceDeployment: bindAdminRpcHandler(
      deps,
      createAuthDisableDeviceDeploymentHandler(activeContractsDeps),
    ),
    enableDeviceDeployment: bindAdminRpcHandler(
      deps,
      createAuthEnableDeviceDeploymentHandler(activeContractsDeps),
    ),
    removeDeviceDeployment: bindAdminRpcHandler(
      deps,
      createAuthRemoveDeviceDeploymentHandler(activeContractsDeps),
    ),
    provisionDeviceInstance: bindAdminRpcHandler(
      deps,
      createAuthProvisionDeviceInstanceHandler(),
    ),
    listDeviceInstances: bindAdminRpcHandler(
      deps,
      authListDeviceInstancesHandler,
    ),
    disableDeviceInstance: bindAdminRpcHandler(
      deps,
      createAuthDisableDeviceInstanceHandler(activeContractsDeps),
    ),
    enableDeviceInstance: bindAdminRpcHandler(
      deps,
      createAuthEnableDeviceInstanceHandler(activeContractsDeps),
    ),
    removeDeviceInstance: bindAdminRpcHandler(
      deps,
      createAuthRemoveDeviceInstanceHandler(activeContractsDeps),
    ),
    listDeviceActivations: bindAdminRpcHandler(
      deps,
      authListDeviceActivationsHandler,
    ),
    revokeDeviceActivation: bindAdminRpcHandler(
      deps,
      authRevokeDeviceActivationHandler,
    ),
    listDeviceActivationReviews: bindAdminRpcHandler(
      deps,
      authListDeviceActivationReviewsHandler,
    ),
    decideDeviceActivationReview: bindAdminRpcHandler(
      deps,
      authDecideDeviceActivationReviewHandler,
    ),
  };
}
