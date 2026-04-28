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
  normalizeAppliedContracts,
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

export type AdminRpcDeps = {
  browserFlowsKV: RuntimeKV<unknown>;
  connectionsKV: RuntimeKV<Connection>;
  contractApprovalStorage: SqlContractApprovalRepository;
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
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
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
  deviceProvisioningSecretStorage: SqlDeviceProvisioningSecretRepository;
  instanceGrantPolicyStorage: SqlInstanceGrantPolicyRepository;
  kick: (serverId: string, clientId: number) => Promise<void>;
  loadEffectiveGrantPolicies: (
    contractId: string,
  ) => Promise<InstanceGrantPolicy[]>;
  logger: Pick<AuthLogger, "trace" | "warn">;
  loginPortalSelectionStorage: SqlLoginPortalSelectionRepository;
  portalDefaultStorage: SqlPortalDefaultRepository;
  portalProfileStorage: SqlPortalProfileRepository;
  portalStorage: SqlPortalRepository;
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
    "deleteByInstanceKey" | "deleteBySessionKey" | "listEntries"
  >;
  userStorage: SqlUserProjectionRepository;
};

let configuredAdminRpcDeps: AdminRpcDeps | undefined;

/** Sets explicit dependencies used by admin RPC handlers registered by auth. */
export function setAdminRpcDeps(deps: AdminRpcDeps): void {
  configuredAdminRpcDeps = deps;
}

function adminRpcDeps(): AdminRpcDeps {
  if (!configuredAdminRpcDeps) {
    throw new Error("auth admin RPC dependencies have not been configured");
  }
  return configuredAdminRpcDeps;
}

const LOGIN_DEFAULT_KEY = "login.default";
const DEVICE_DEFAULT_KEY = "device.default";

const logger = {
  trace: (fields: Record<string, unknown>, message: string) =>
    adminRpcDeps().logger.trace(fields, message),
  warn: (fields: Record<string, unknown>, message: string) =>
    adminRpcDeps().logger.warn(fields, message),
};

const browserFlowsKV = {
  get: (key: string) => adminRpcDeps().browserFlowsKV.get(key),
};
const connectionsKV = {
  get: (key: string) => adminRpcDeps().connectionsKV.get(key),
  delete: (key: string) => adminRpcDeps().connectionsKV.delete(key),
  keys: (filter: string | string[]) =>
    adminRpcDeps().connectionsKV.keys(filter),
};
const contractApprovalStorage = {
  get: (userTrellisId: string, contractDigest: string) =>
    adminRpcDeps().contractApprovalStorage.get(
      userTrellisId,
      contractDigest,
    ),
};
const portalStorage = {
  get: (portalId: string) => adminRpcDeps().portalStorage.get(portalId),
  put: (record: Portal) => adminRpcDeps().portalStorage.put(record),
  list: () => adminRpcDeps().portalStorage.list(),
};
const portalProfileStorage = {
  get: (portalId: string) => adminRpcDeps().portalProfileStorage.get(portalId),
  put: (record: PortalProfile) =>
    adminRpcDeps().portalProfileStorage.put(record),
  list: () => adminRpcDeps().portalProfileStorage.list(),
};
const instanceGrantPolicyStorage = {
  get: (contractId: string) =>
    adminRpcDeps().instanceGrantPolicyStorage.get(contractId),
  put: (record: InstanceGrantPolicy) =>
    adminRpcDeps().instanceGrantPolicyStorage.put(record),
  list: () => adminRpcDeps().instanceGrantPolicyStorage.list(),
};
const deviceDeploymentStorage = {
  get: (deploymentId: string) =>
    adminRpcDeps().deviceDeploymentStorage.get(deploymentId),
  put: (record: DeviceDeployment) =>
    adminRpcDeps().deviceDeploymentStorage.put(record),
  delete: (deploymentId: string) =>
    adminRpcDeps().deviceDeploymentStorage.delete(deploymentId),
  list: () => adminRpcDeps().deviceDeploymentStorage.list(),
};
const deviceInstanceStorage = {
  get: (instanceId: string) =>
    adminRpcDeps().deviceInstanceStorage.get(instanceId),
  put: (record: DeviceInstance) =>
    adminRpcDeps().deviceInstanceStorage.put(record),
  delete: (instanceId: string) =>
    adminRpcDeps().deviceInstanceStorage.delete(instanceId),
  list: () => adminRpcDeps().deviceInstanceStorage.list(),
};
const deviceProvisioningSecretStorage = {
  get: (instanceId: string) =>
    adminRpcDeps().deviceProvisioningSecretStorage.get(instanceId),
  put: (record: DeviceProvisioningSecret) =>
    adminRpcDeps().deviceProvisioningSecretStorage.put(record),
  delete: (instanceId: string) =>
    adminRpcDeps().deviceProvisioningSecretStorage.delete(instanceId),
};
const deviceActivationReviewStorage = {
  get: (reviewId: string) =>
    adminRpcDeps().deviceActivationReviewStorage.get(reviewId),
  getByFlowId: (flowId: string) =>
    adminRpcDeps().deviceActivationReviewStorage.getByFlowId(flowId),
  put: (record: DeviceActivationReviewRecord) =>
    adminRpcDeps().deviceActivationReviewStorage.put(record),
  list: () => adminRpcDeps().deviceActivationReviewStorage.list(),
};
const deviceActivationStorage = {
  get: (instanceId: string) =>
    adminRpcDeps().deviceActivationStorage.get(instanceId),
  put: (record: DeviceActivation) =>
    adminRpcDeps().deviceActivationStorage.put(record),
  delete: (instanceId: string) =>
    adminRpcDeps().deviceActivationStorage.delete(instanceId),
  list: () => adminRpcDeps().deviceActivationStorage.list(),
};
const portalDefaultStorage = {
  getLogin: () => adminRpcDeps().portalDefaultStorage.getLogin(),
  getDevice: () => adminRpcDeps().portalDefaultStorage.getDevice(),
  putLogin: (record: PortalDefault) =>
    adminRpcDeps().portalDefaultStorage.putLogin(record),
  putDevice: (record: PortalDefault) =>
    adminRpcDeps().portalDefaultStorage.putDevice(record),
};
const loginPortalSelectionStorage = {
  get: (contractId: string) =>
    adminRpcDeps().loginPortalSelectionStorage.get(contractId),
  put: (record: LoginPortalSelection) =>
    adminRpcDeps().loginPortalSelectionStorage.put(record),
  delete: (contractId: string) =>
    adminRpcDeps().loginPortalSelectionStorage.delete(contractId),
  list: () => adminRpcDeps().loginPortalSelectionStorage.list(),
};
const devicePortalSelectionStorage = {
  get: (deploymentId: string) =>
    adminRpcDeps().devicePortalSelectionStorage.get(deploymentId),
  put: (record: DevicePortalSelection) =>
    adminRpcDeps().devicePortalSelectionStorage.put(record),
  delete: (deploymentId: string) =>
    adminRpcDeps().devicePortalSelectionStorage.delete(deploymentId),
  list: () => adminRpcDeps().devicePortalSelectionStorage.list(),
};
const userStorage = {
  get: (trellisId: string) => adminRpcDeps().userStorage.get(trellisId),
};
const sessionStorage = {
  deleteBySessionKey: (sessionKey: string) =>
    adminRpcDeps().sessionStorage.deleteBySessionKey(sessionKey),
  deleteByInstanceKey: (instanceKey: string) =>
    adminRpcDeps().sessionStorage.deleteByInstanceKey(instanceKey),
  listEntries: () => adminRpcDeps().sessionStorage.listEntries(),
};

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

async function loadPortal(portalId: string): Promise<Portal | null> {
  return await portalStorage.get(portalId) ?? null;
}

async function loadInstanceGrantPolicy(
  contractId: string,
): Promise<InstanceGrantPolicy | null> {
  return await instanceGrantPolicyStorage.get(contractId) ?? null;
}

async function loadPortalProfile(
  portalId: string,
): Promise<PortalProfile | null> {
  return await portalProfileStorage.get(portalId) ?? null;
}

async function loadDeviceDeployment(
  deploymentId: string,
): Promise<DeviceDeployment | null> {
  return await deviceDeploymentStorage.get(deploymentId) ?? null;
}

async function loadDeviceInstance(
  instanceId: string,
): Promise<DeviceInstance | null> {
  return await deviceInstanceStorage.get(instanceId) ?? null;
}

async function loadDeviceProvisioningSecret(
  instanceId: string,
): Promise<DeviceProvisioningSecret | null> {
  return await deviceProvisioningSecretStorage.get(instanceId) ?? null;
}

async function loadDeviceActivationReview(
  reviewId: string,
): Promise<DeviceActivationReviewRecord | null> {
  return await deviceActivationReviewStorage.get(reviewId) ?? null;
}

async function loadDeviceActivationFlow(
  flowId: string,
): Promise<DeviceActivationFlow | null> {
  const entry = await browserFlowsKV.get(flowId).take();
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
  instanceId: string,
): Promise<DeviceActivation | null> {
  return await deviceActivationStorage.get(instanceId) ?? null;
}

async function loadPortalDefault(key: string): Promise<PortalDefault | null> {
  const defaultPortal = key === "login.default"
    ? await portalDefaultStorage.getLogin()
    : await portalDefaultStorage.getDevice();
  return defaultPortal ?? null;
}

async function loadLoginPortalSelection(
  contractId: string,
): Promise<LoginPortalSelection | null> {
  return await loginPortalSelectionStorage.get(contractId) ?? null;
}

async function loadDevicePortalSelection(
  deploymentId: string,
): Promise<DevicePortalSelection | null> {
  return await devicePortalSelectionStorage.get(deploymentId) ?? null;
}

async function listPortals(): Promise<Portal[]> {
  return await portalStorage.list();
}

async function listPortalProfiles(): Promise<PortalProfile[]> {
  return await portalProfileStorage.list();
}

async function listInstanceGrantPolicies(): Promise<InstanceGrantPolicy[]> {
  return await instanceGrantPolicyStorage.list();
}

async function listLoginPortalSelections(): Promise<LoginPortalSelection[]> {
  return await loginPortalSelectionStorage.list();
}

async function listDevicePortalSelections(): Promise<DevicePortalSelection[]> {
  return await devicePortalSelectionStorage.list();
}

async function listDeviceDeployments(): Promise<DeviceDeployment[]> {
  return await deviceDeploymentStorage.list();
}

async function listDeviceInstances(): Promise<DeviceInstance[]> {
  return await deviceInstanceStorage.list();
}

async function listDeviceActivations(): Promise<DeviceActivation[]> {
  return await deviceActivationStorage.list();
}

async function listDeviceActivationReviews(): Promise<
  DeviceActivationReviewRecord[]
> {
  return await deviceActivationReviewStorage.list();
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
  trellisId: string,
): Promise<UserProjectionEntry | null> {
  return await userStorage.get(trellisId) ?? null;
}

async function revokeUserSessionByKey(
  sessionKey: string,
  session: Extract<Session, { type: "user" }>,
  revokedBy?: string,
): Promise<void> {
  const connIter = await connectionsKV.keys(
    connectionFilterForSession(sessionKey),
  )
    .take();
  if (!isErr(connIter)) {
    for await (const connKey of connIter) {
      const parsedKey = parseConnectionKey(connKey);
      if (!parsedKey || parsedKey.scopeId !== session.trellisId) continue;
      const entry = await connectionsKV.get(connKey).take();
      if (!isErr(entry)) {
        const connection = unwrapConnection(entry);
        if (connection) {
          await adminRpcDeps().kick(connection.serverId, connection.clientId);
        }
      }
      await connectionsKV.delete(connKey);
    }
  }

  if (revokedBy) {
    await adminRpcDeps().publishSessionRevoked({
      origin: session.origin,
      id: session.id,
      sessionKey,
      revokedBy,
    });
  }
  await sessionStorage.deleteBySessionKey(sessionKey);
}

async function kickInstanceRuntimeAccess(instanceKey: string): Promise<void> {
  const connIter = await connectionsKV.keys(
    connectionFilterForSession(instanceKey),
  )
    .take();
  if (!isErr(connIter)) {
    for await (const connKey of connIter) {
      const entry = await connectionsKV.get(connKey).take();
      if (!isErr(entry)) {
        const connection = unwrapConnection(entry);
        if (connection) {
          await adminRpcDeps().kick(connection.serverId, connection.clientId);
        }
      }
      await connectionsKV.delete(connKey);
    }
  }

  await sessionStorage.deleteByInstanceKey(instanceKey);
}

async function revokeInvalidatedInstanceGrantSessions(args: {
  contractId: string;
  policies: InstanceGrantPolicy[];
  revokedBy?: string;
}): Promise<void> {
  for (const entry of await sessionStorage.listEntries()) {
    const session = entry.session;
    if (session.type !== "user") continue;
    if (session.contractId !== args.contractId) continue;

    const projection = await loadUserProjection(session.trellisId);
    const storedApproval = await contractApprovalStorage.get(
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
      entry.sessionKey,
      session,
      args.revokedBy,
    );
  }
}

async function confirmationCodeForReview(
  review: DeviceActivationReviewRecord,
): Promise<string | null> {
  const flow = await loadDeviceActivationFlow(review.flowId);
  const provisioningSecret = await loadDeviceProvisioningSecret(
    review.instanceId,
  );
  if (!flow || !provisioningSecret) return null;
  return await deriveDeviceConfirmationCode({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: review.publicIdentityKey,
    nonce: flow.nonce,
  });
}

async function ensurePortalReference(portalId: string | null) {
  if (portalId === null) return Result.ok(undefined);
  const portal = await loadPortal(portalId);
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
  contractId: string;
  revokedBy?: string;
}): Promise<void> {
  await revokeInvalidatedInstanceGrantSessions({
    contractId: args.contractId,
    policies: await adminRpcDeps().loadEffectiveGrantPolicies(args.contractId),
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
  ) => {
    logger.trace(
      { rpc: "Auth.CreatePortal", portalId: req.portalId },
      "RPC request",
    );
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validatePortalRequest(req);
    if (validation.isErr()) return validation;
    const { portal } = validation.take() as { portal: Portal };
    await portalStorage.put(portal);
    return Result.ok({ portal });
  };
}

export const authListPortalsHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ portals: await listPortals() });
};

export const authDisablePortalHandler = async (
  { input: req, context: { caller } }: {
    input: { portalId: string };
    context: { caller: RpcUser };
  },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const portal = await loadPortal(req.portalId);
  if (!portal) return Result.ok({ success: false });
  await portalStorage.put({ ...portal, disabled: true });

  const profile = await loadPortalProfile(req.portalId);
  if (profile && !profile.disabled) {
    await portalProfileStorage.put({
      ...profile,
      disabled: true,
      updatedAt: new Date().toISOString(),
    });
    await revokeInvalidatedEffectiveGrantSessions({
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
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ profiles: await listPortalProfiles() });
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

    const existing = await loadPortalProfile(normalizedProfile.portalId);
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
    const existingPortal = await loadPortal(profile.portalId);
    await portalProfileStorage.put(profile);
    await portalStorage.put({
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
      await revokeInvalidatedEffectiveGrantSessions({ contractId, revokedBy });
    }
    return Result.ok({ profile });
  };
}

export const authDisablePortalProfileHandler = async (
  { input: req, context: { caller } }: {
    input: { portalId: string };
    context: { caller: RpcUser };
  },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const existing = await loadPortalProfile(req.portalId);
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
  await portalProfileStorage.put(profile);

  await revokeInvalidatedEffectiveGrantSessions({
    contractId: profile.contractId,
    revokedBy: caller.origin && caller.id
      ? `${caller.origin}.${caller.id}`
      : undefined,
  });
  return Result.ok({ profile });
};

export const authGetLoginPortalDefaultHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({
    defaultPortal: (await loadPortalDefault(LOGIN_DEFAULT_KEY)) ??
      { portalId: null },
  });
};

export const authListInstanceGrantPoliciesHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ policies: await listInstanceGrantPolicies() });
};

export const authUpsertInstanceGrantPolicyHandler = async (
  {
    input: req,
    context: { caller },
  }: {
    input: UpsertInstanceGrantPolicyRequest;
    context: { caller: RpcUser };
  },
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
  const existing = await loadInstanceGrantPolicy(normalizedPolicy.contractId);
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
  await instanceGrantPolicyStorage.put(policy);
  await revokeInvalidatedEffectiveGrantSessions({
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
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  if (!req.contractId) return invalidRequest({ contractId: req.contractId });
  const existing = await loadInstanceGrantPolicy(req.contractId);
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
  await instanceGrantPolicyStorage.put(policy);
  await revokeInvalidatedEffectiveGrantSessions({
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
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validatePortalDefaultRequest(req);
  if (validation.isErr()) return validation;
  const { defaultPortal } = validation.take() as {
    defaultPortal: PortalDefault;
  };
  const referenceCheck = await ensurePortalReference(defaultPortal.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await portalDefaultStorage.putLogin(defaultPortal);
  return Result.ok({ defaultPortal });
};

export const authListLoginPortalSelectionsHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ selections: await listLoginPortalSelections() });
};

export const authSetLoginPortalSelectionHandler = async (
  { input: req, context: { caller } }: {
    input: LoginPortalSelectionRequest;
    context: { caller: RpcUser };
  },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validateLoginPortalSelectionRequest(req);
  if (validation.isErr()) return validation;
  const { selection } = validation.take() as {
    selection: LoginPortalSelection;
  };
  const referenceCheck = await ensurePortalReference(selection.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await loginPortalSelectionStorage.put(selection);
  return Result.ok({ selection });
};

export const authClearLoginPortalSelectionHandler = async (
  { input: req, context: { caller } }: {
    input: { contractId: string };
    context: { caller: RpcUser };
  },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const selection = await loadLoginPortalSelection(req.contractId);
  if (!selection) return Result.ok({ success: false });
  await loginPortalSelectionStorage.delete(req.contractId);
  return Result.ok({ success: true });
};

export const authGetDevicePortalDefaultHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({
    defaultPortal: (await loadPortalDefault(DEVICE_DEFAULT_KEY)) ??
      { portalId: null },
  });
};

export const authSetDevicePortalDefaultHandler = async (
  { input: req, context: { caller } }: {
    input: PortalDefaultRequest;
    context: { caller: RpcUser };
  },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validatePortalDefaultRequest(req);
  if (validation.isErr()) return validation;
  const { defaultPortal } = validation.take() as {
    defaultPortal: PortalDefault;
  };
  const referenceCheck = await ensurePortalReference(defaultPortal.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await portalDefaultStorage.putDevice(defaultPortal);
  return Result.ok({ defaultPortal });
};

export const authListDevicePortalSelectionsHandler = async (
  { context: { caller } }: { context: { caller: RpcUser } },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ selections: await listDevicePortalSelections() });
};

export const authSetDevicePortalSelectionHandler = async (
  { input: req, context: { caller } }: {
    input: DevicePortalSelectionRequest;
    context: { caller: RpcUser };
  },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validateDevicePortalSelectionRequest(req);
  if (validation.isErr()) return validation;
  const { selection } = validation.take() as {
    selection: DevicePortalSelection;
  };
  const deployment = await loadDeviceDeployment(selection.deploymentId);
  if (!deployment || deployment.disabled) {
    return invalidRequest({
      deploymentId: selection.deploymentId,
      reason: "device_deployment_not_found",
    });
  }
  const referenceCheck = await ensurePortalReference(selection.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await devicePortalSelectionStorage.put(selection);
  return Result.ok({ selection });
};

export const authClearDevicePortalSelectionHandler = async (
  { input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const selection = await loadDevicePortalSelection(req.deploymentId);
  if (!selection) return Result.ok({ success: false });
  await devicePortalSelectionStorage.delete(req.deploymentId);
  return Result.ok({ success: true });
};

export function createAuthCreateDeviceDeploymentHandler(deps: {
  installDeviceContract: (
    contract: unknown,
  ) => Promise<
    { id: string; digest: string; displayName: string; description: string }
  >;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: Parameters<typeof validateDeviceDeploymentRequest>[0];
      context: { caller: RpcUser };
    },
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateDeviceDeploymentRequest(req);
    if (validation.isErr()) return validation;
    const { deployment } = validation.take() as {
      deployment: DeviceDeployment;
    };
    await deviceDeploymentStorage.put(deployment);
    return Result.ok({ deployment });
  };
}

export const authListDeviceDeploymentsHandler = async (
  { input: req, context: { caller } }: {
    input: { disabled?: boolean };
    context: { caller: RpcUser };
  },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let deployments = await listDeviceDeployments();
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
}) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; contract: unknown };
      context: { caller: RpcUser };
    },
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const deployment = await loadDeviceDeployment(req.deploymentId);
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
      appliedContracts: normalizeAppliedContracts([
        ...deployment.appliedContracts,
        { contractId: installed.id, allowedDigests: [installed.digest] },
      ]),
    };
    await deviceDeploymentStorage.put(nextDeployment);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
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
  deps: ActiveContractsDeps,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; contractId: string; digests?: string[] };
      context: { caller: RpcUser };
    },
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const deployment = await loadDeviceDeployment(req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    const removeDigests = new Set(req.digests ?? []);
    const nextDeployment: DeviceDeployment = {
      ...deployment,
      appliedContracts: normalizeAppliedContracts(
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
    await deviceDeploymentStorage.put(nextDeployment);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
    const instances = (await listDeviceInstances()).filter((instance) =>
      instance.deploymentId === deployment.deploymentId
    );
    for (const instance of instances) {
      await kickInstanceRuntimeAccess(instance.publicIdentityKey);
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
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const deployment = await loadDeviceDeployment(req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    const nextDeployment = { ...deployment, disabled: true };
    await deviceDeploymentStorage.put(nextDeployment);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
    for (
      const instance of (await listDeviceInstances()).filter((entry) =>
        entry.deploymentId === req.deploymentId
      )
    ) {
      await kickInstanceRuntimeAccess(instance.publicIdentityKey);
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
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const deployment = await loadDeviceDeployment(req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    const nextDeployment = { ...deployment, disabled: false };
    await deviceDeploymentStorage.put(nextDeployment);
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
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const inUse = (await listDeviceInstances()).some((instance) =>
      instance.deploymentId === req.deploymentId
    );
    if (inUse) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_in_use",
      });
    }
    await deviceDeploymentStorage.delete(req.deploymentId);
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
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateDeviceProvisionRequest(req);
    if (validation.isErr()) return validation;
    const { instance, provisioningSecret } = validation.take() as {
      instance: DeviceInstance;
      provisioningSecret: DeviceProvisioningSecret;
    };
    const deployment = await loadDeviceDeployment(instance.deploymentId);
    if (!deployment || deployment.disabled) {
      return invalidRequest({
        deploymentId: instance.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    await deviceInstanceStorage.put(instance);
    await deviceProvisioningSecretStorage.put(provisioningSecret);
    return Result.ok({ instance });
  };
}

export const authListDeviceInstancesHandler = async (
  { input: req, context: { caller } }: {
    input: { deploymentId?: string; state?: string };
    context: { caller: RpcUser };
  },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let instances = await listDeviceInstances();
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
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const instance = await loadDeviceInstance(req.instanceId);
    if (!instance) {
      return invalidRequest({
        instanceId: req.instanceId,
        reason: "unknown_device",
      });
    }
    const nextInstance = { ...instance, state: "disabled" as const };
    await deviceInstanceStorage.put(nextInstance);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) return refreshed;
    await kickInstanceRuntimeAccess(instance.publicIdentityKey);
    return Result.ok({ instance: nextInstance });
  };
}

export function createAuthEnableDeviceInstanceHandler(
  deps: ActiveContractsDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const instance = await loadDeviceInstance(req.instanceId);
    if (!instance) {
      return invalidRequest({
        instanceId: req.instanceId,
        reason: "unknown_device",
      });
    }
    const activation = await loadDeviceActivation(req.instanceId);
    const nextState: DeviceInstance["state"] =
      activation && activation.state === "activated" &&
        activation.revokedAt === null
        ? "activated"
        : "registered";
    const nextInstance = { ...instance, state: nextState };
    await deviceInstanceStorage.put(nextInstance);
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
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const instance = await loadDeviceInstance(req.instanceId);
    if (!instance) {
      return invalidRequest({
        instanceId: req.instanceId,
        reason: "unknown_device",
      });
    }
    await kickInstanceRuntimeAccess(instance.publicIdentityKey);
    await deviceInstanceStorage.delete(req.instanceId);
    await deviceProvisioningSecretStorage.delete(req.instanceId);
    await deviceActivationStorage.delete(req.instanceId);
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
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let activations = await listDeviceActivations();
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
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const activation = await deviceActivationStorage.get(req.instanceId);
  if (!activation) return Result.ok({ success: false });
  const nextActivation = {
    ...activation,
    state: "revoked" as const,
    revokedAt: new Date().toISOString(),
  };
  await deviceActivationStorage.put(nextActivation);
  await kickInstanceRuntimeAccess(nextActivation.publicIdentityKey);
  return Result.ok({ success: true });
};

export const authListDeviceActivationReviewsHandler = async (
  { input: req, context: { caller } }: {
    input: { instanceId?: string; deploymentId?: string; state?: string };
    context: { caller: RpcUser };
  },
) => {
  if (!canReview(caller)) return insufficientPermissions();
  const allowedDeployments = reviewableDeployments(caller);
  if (
    allowedDeployments !== null && req.deploymentId &&
    !allowedDeployments.has(req.deploymentId)
  ) {
    return insufficientPermissions();
  }
  let reviews = await listDeviceActivationReviews();
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
) => {
  const review = await loadDeviceActivationReview(req.reviewId);
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
      ? await loadDeviceActivation(review.instanceId)
      : null;
    const confirmationCode = review.state === "approved"
      ? await confirmationCodeForReview(review)
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
    await deviceActivationReviewStorage.put(updatedReview);
    return Result.ok({ review: toPublicReview(updatedReview) });
  }

  const instance = await loadDeviceInstance(review.instanceId);
  const deployment = await loadDeviceDeployment(review.deploymentId);
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
  await deviceActivationStorage.put(activation);
  await deviceInstanceStorage.put({
    ...instance,
    state: "activated",
    activatedAt,
    revokedAt: null,
  });
  await deviceActivationReviewStorage.put(updatedReview);
  const confirmationCode = await confirmationCodeForReview(updatedReview);
  return Result.ok({
    review: toPublicReview(updatedReview),
    activation,
    ...(confirmationCode ? { confirmationCode } : {}),
  });
};
