import { AuthError, UnexpectedError } from "@qlever-llc/trellis";
import {
  type AsyncResult,
  type BaseError,
  isErr,
  Result,
} from "@qlever-llc/result";

import type { AuthLogger, RuntimeKV } from "../runtime_deps.ts";
import {
  type DeviceActivationReview,
  type DeviceDeployment,
  type DeviceInstance,
  type DevicePortalSelection,
  type DeviceProvisioningSecret,
  normalizeDeviceAppliedContracts,
  type ProvisionDeviceInstanceRequest,
  validateDeviceDeploymentRequest,
  validateDeviceProvisionRequest,
} from "./shared.ts";
import { deriveDeviceConfirmationCode } from "@qlever-llc/trellis/auth";
import type { Connection, InstanceGrantPolicy } from "../schemas.ts";
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
import { revokeRuntimeAccessForSession } from "../session/revoke_runtime_access.ts";
export {
  authClearDevicePortalSelectionHandler,
  authClearLoginPortalSelectionHandler,
  authDisableInstanceGrantPolicyHandler,
  authDisablePortalHandler,
  authDisablePortalProfileHandler,
  authGetDevicePortalDefaultHandler,
  authGetLoginPortalDefaultHandler,
  authListDevicePortalSelectionsHandler,
  authListInstanceGrantPoliciesHandler,
  authListLoginPortalSelectionsHandler,
  authListPortalProfilesHandler,
  authListPortalsHandler,
  authSetDevicePortalDefaultHandler,
  authSetDevicePortalSelectionHandler,
  authSetLoginPortalDefaultHandler,
  authSetLoginPortalSelectionHandler,
  authUpsertInstanceGrantPolicyHandler,
  createAuthCreatePortalHandler,
  createAuthSetPortalProfileHandler,
  createPortalPolicyAdminHandlers,
} from "./portal_policy_rpc.ts";

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
  operationId: string;
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
type DeviceActivationOperationOutput =
  | {
    status: "activated";
    instanceId: string;
    deploymentId: string;
    activatedAt: string;
    confirmationCode?: string;
  }
  | { status: "rejected"; reason?: string };

type OperationCompletion = {
  completeOperation(
    operationId: string,
    output: DeviceActivationOperationOutput,
  ): AsyncResult<unknown, BaseError>;
};

type ActiveContractsDeps = { refreshActiveContracts: () => Promise<void> };
type ActiveCatalogValidator = (opts: {
  stagedDeviceDeployments?: Iterable<DeviceDeployment>;
  stagedDeviceInstances?: Iterable<DeviceInstance>;
}) => Promise<unknown>;
type ActiveCatalogDeps = ActiveContractsDeps & {
  validateActiveCatalog: ActiveCatalogValidator;
};

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
  operationCompletion?: OperationCompletion;
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
  eventPublisher?: {
    publish(event: string, payload: unknown): AsyncResult<unknown, BaseError>;
  };
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

async function validateActiveCatalog(
  deps: ActiveCatalogDeps,
  opts: Parameters<ActiveCatalogValidator>[0],
) {
  try {
    await deps.validateActiveCatalog(opts);
    return Result.ok(undefined);
  } catch (error) {
    return Result.err(
      new UnexpectedError({
        cause: error instanceof Error ? error : new Error(String(error)),
      }),
    );
  }
}

async function rollbackRefreshFailure<T>(
  refreshError: UnexpectedError,
  rollback: () => Promise<void>,
): Promise<Result<T, UnexpectedError>> {
  try {
    await rollback();
  } catch (rollbackError) {
    return Result.err(
      new UnexpectedError({
        cause: new AggregateError(
          [
            refreshError,
            rollbackError instanceof Error
              ? rollbackError
              : new Error(String(rollbackError)),
          ],
          "active catalog refresh failed and rollback failed",
        ),
      }),
    );
  }
  return Result.err(refreshError);
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

async function kickDeviceRuntimeAccess(
  ctx: AdminRpcContext,
  publicIdentityKey: string,
): Promise<void> {
  await revokeRuntimeAccessForSession({
    sessionKey: publicIdentityKey,
    connectionsKV: ctx.connectionsKV,
    kick: ctx.kick,
    deleteSession: () =>
      ctx.sessionStorage.deleteByPublicIdentityKey(publicIdentityKey),
  });
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

async function completeDeviceActivationOperation(
  ctx: AdminRpcContext,
  review: DeviceActivationReviewRecord,
  output: DeviceActivationOperationOutput,
) {
  if (!ctx.operationCompletion) {
    return Result.err(
      new UnexpectedError({
        cause: new Error("Device activation operation completion unavailable"),
      }),
    );
  }
  const completed = await ctx.operationCompletion.completeOperation(
    review.operationId,
    output,
  ).take();
  if (isErr(completed)) return Result.err(completed.error);
  return Result.ok(undefined);
}

function requireDeviceActivationOperationCompletion(ctx: AdminRpcContext) {
  if (ctx.operationCompletion) return Result.ok(undefined);
  return Result.err(
    new UnexpectedError({
      cause: new Error("Device activation operation completion unavailable"),
    }),
  );
}

async function completeTerminalDeviceActivationReview(
  ctx: AdminRpcContext,
  review: DeviceActivationReviewRecord,
) {
  if (review.state === "rejected") {
    const output: DeviceActivationOperationOutput = {
      status: "rejected",
      ...(review.reason ? { reason: review.reason } : {}),
    };
    const completed = await completeDeviceActivationOperation(
      ctx,
      review,
      output,
    );
    if (completed.isErr()) return completed;
    return Result.ok({ review: toPublicReview(review) });
  }

  const activation = await loadDeviceActivation(ctx, review.instanceId);
  const confirmationCode = await confirmationCodeForReview(ctx, review);
  if (activation) {
    const output: DeviceActivationOperationOutput = {
      status: "activated",
      instanceId: activation.instanceId,
      deploymentId: activation.deploymentId,
      activatedAt: activation.activatedAt,
      ...(confirmationCode ? { confirmationCode } : {}),
    };
    const completed = await completeDeviceActivationOperation(
      ctx,
      review,
      output,
    );
    if (completed.isErr()) return completed;
  }

  return Result.ok({
    review: toPublicReview(review),
    ...(activation ? { activation } : {}),
    ...(confirmationCode ? { confirmationCode } : {}),
  });
}

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
      input: {
        deploymentId: string;
        contract: unknown;
        expectedDigest: string;
        replaceExisting?: boolean;
      };
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
    if (req.expectedDigest !== installed.digest) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "contract_digest_mismatch",
        expectedDigest: req.expectedDigest,
        actualDigest: installed.digest,
        contractId: installed.id,
      });
    }
    const nextDeployment: DeviceDeployment = {
      ...deployment,
      appliedContracts: normalizeDeviceAppliedContracts([
        ...(req.replaceExisting
          ? deployment.appliedContracts.filter((applied) =>
            applied.contractId !== installed.id
          )
          : deployment.appliedContracts),
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
  deps: ActiveCatalogDeps,
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
    const validated = await validateActiveCatalog(deps, {
      stagedDeviceDeployments: [nextDeployment],
    });
    if (isErr(validated)) return validated;
    await ctx.deviceDeploymentStorage.put(nextDeployment);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure<
        { deployment: typeof nextDeployment }
      >(
        refreshed.error,
        () => ctx.deviceDeploymentStorage.put(deployment),
      );
    }
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
  deps: ActiveCatalogDeps,
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
    const validated = await validateActiveCatalog(deps, {
      stagedDeviceDeployments: [nextDeployment],
    });
    if (isErr(validated)) return validated;
    await ctx.deviceDeploymentStorage.put(nextDeployment);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure<
        { deployment: typeof nextDeployment }
      >(
        refreshed.error,
        () => ctx.deviceDeploymentStorage.put(deployment),
      );
    }
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthRemoveDeviceDeploymentHandler(
  deps: ActiveCatalogDeps,
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
    const deployment = await loadDeviceDeployment(ctx, req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    const validated = await validateActiveCatalog(deps, {
      stagedDeviceDeployments: [{
        ...deployment,
        disabled: true,
        appliedContracts: [],
      }],
    });
    if (isErr(validated)) return validated;
    await ctx.deviceDeploymentStorage.delete(req.deploymentId);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure<{ success: boolean }>(
        refreshed.error,
        () => ctx.deviceDeploymentStorage.put(deployment),
      );
    }
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
    await ctx.deviceProvisioningSecretStorage.put({
      ...provisioningSecret,
      createdAt: provisioningSecret.createdAt instanceof Date
        ? provisioningSecret.createdAt
        : new Date(provisioningSecret.createdAt),
    });
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
  deps: ActiveCatalogDeps,
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
    const validated = await validateActiveCatalog(deps, {
      stagedDeviceInstances: [nextInstance],
    });
    if (isErr(validated)) return validated;
    await ctx.deviceInstanceStorage.put(nextInstance);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure<{ instance: typeof nextInstance }>(
        refreshed.error,
        () => ctx.deviceInstanceStorage.put(instance),
      );
    }
    await kickDeviceRuntimeAccess(ctx, instance.publicIdentityKey);
    return Result.ok({ instance: nextInstance });
  };
}

export function createAuthEnableDeviceInstanceHandler(
  deps: ActiveCatalogDeps,
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
    const validated = await validateActiveCatalog(deps, {
      stagedDeviceInstances: [nextInstance],
    });
    if (isErr(validated)) return validated;
    await ctx.deviceInstanceStorage.put(nextInstance);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure<{ instance: typeof nextInstance }>(
        refreshed.error,
        () => ctx.deviceInstanceStorage.put(instance),
      );
    }
    return Result.ok({ instance: nextInstance });
  };
}

export function createAuthRemoveDeviceInstanceHandler(
  deps: ActiveCatalogDeps,
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
    const provisioningSecret = await loadDeviceProvisioningSecret(
      ctx,
      req.instanceId,
    );
    const activation = await loadDeviceActivation(ctx, req.instanceId);
    const validated = await validateActiveCatalog(deps, {
      stagedDeviceInstances: [{ ...instance, state: "disabled" }],
    });
    if (isErr(validated)) return validated;
    await ctx.deviceInstanceStorage.delete(req.instanceId);
    await ctx.deviceProvisioningSecretStorage.delete(req.instanceId);
    await ctx.deviceActivationStorage.delete(req.instanceId);
    const refreshed = await refreshActiveContracts(deps);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure<{ success: boolean }>(
        refreshed.error,
        async () => {
          await ctx.deviceInstanceStorage.put(instance);
          if (provisioningSecret) {
            await ctx.deviceProvisioningSecretStorage.put({
              ...provisioningSecret,
              createdAt: provisioningSecret.createdAt instanceof Date
                ? provisioningSecret.createdAt
                : new Date(provisioningSecret.createdAt),
            });
          }
          if (activation) await ctx.deviceActivationStorage.put(activation);
        },
      );
    }
    await kickDeviceRuntimeAccess(ctx, instance.publicIdentityKey);
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

  const canComplete = requireDeviceActivationOperationCompletion(ctx);
  if (canComplete.isErr()) return canComplete;

  if (review.state !== "pending") {
    return await completeTerminalDeviceActivationReview(ctx, review);
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
    const operationOutput: DeviceActivationOperationOutput = {
      status: "rejected",
      ...(req.reason ? { reason: req.reason } : {}),
    };
    const completed = await completeDeviceActivationOperation(
      ctx,
      updatedReview,
      operationOutput,
    );
    if (completed.isErr()) return completed;
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
  const operationOutput: DeviceActivationOperationOutput = {
    status: "activated",
    instanceId: activation.instanceId,
    deploymentId: activation.deploymentId,
    activatedAt: activation.activatedAt,
    ...(confirmationCode ? { confirmationCode } : {}),
  };
  const completed = await completeDeviceActivationOperation(
    ctx,
    updatedReview,
    operationOutput,
  );
  if (completed.isErr()) return completed;
  (await ctx.eventPublisher?.publish("Auth.DeviceActivationApproved", {
    reviewId: updatedReview.reviewId,
    flowId: updatedReview.flowId,
    instanceId: updatedReview.instanceId,
    publicIdentityKey: updatedReview.publicIdentityKey,
    deploymentId: updatedReview.deploymentId,
    requestedAt: updatedReview.requestedAt instanceof Date
      ? updatedReview.requestedAt.toISOString()
      : updatedReview.requestedAt,
    approvedAt: decidedAt,
    requestedBy: updatedReview.requestedBy,
    approvedBy: {
      id: caller.id ?? "unknown",
      ...(caller.origin ? { origin: caller.origin } : {}),
    },
  }))?.inspectErr((error: unknown) =>
    ctx.logger.warn(
      { error, reviewId: updatedReview.reviewId },
      "Failed to publish Auth.DeviceActivationApproved",
    )
  );
  (await ctx.eventPublisher?.publish("Auth.DeviceActivated", {
    instanceId: activation.instanceId,
    publicIdentityKey: activation.publicIdentityKey,
    deploymentId: activation.deploymentId,
    activatedAt: activation.activatedAt,
    activatedBy: activation.activatedBy,
    flowId: updatedReview.flowId,
    reviewId: updatedReview.reviewId,
  }))?.inspectErr((error: unknown) =>
    ctx.logger.warn(
      { error, instanceId: activation.instanceId },
      "Failed to publish Auth.DeviceActivated",
    )
  );
  return Result.ok({
    review: toPublicReview(updatedReview),
    activation,
    ...(confirmationCode ? { confirmationCode } : {}),
  });
};

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
