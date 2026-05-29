import { AuthError, UnexpectedError } from "@qlever-llc/trellis";
import {
  type AsyncResult,
  type BaseError,
  isErr,
  Result,
} from "@qlever-llc/result";
import type { StaticDecode } from "typebox";
import { ulid } from "ulid";

import type {
  AuthLogger,
  AuthRuntimeDeps,
  RuntimeKV,
} from "../runtime_deps.ts";
import {
  type AdminCaller,
  type DeviceActivationReview,
  type DeviceDeployment,
  type DeviceInstance,
  type DeviceProvisioningSecret,
  type ProvisionDeviceInstanceRequest,
  requireAdmin,
  validateDeviceDeploymentRequest,
  validateDeviceProvisionRequest,
} from "./shared.ts";
import {
  AuthRequestsValidateResponseSchema,
  deriveDeviceConfirmationCode,
} from "@qlever-llc/trellis/auth";
import type {
  Connection,
  DeploymentAuthority,
  IdentityGrantRecord,
} from "../schemas.ts";
import type {
  BoundedListQuery,
  ListPage,
  SqlDeviceProvisioningSecretRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import { MAX_STORAGE_LIST_LIMIT } from "../storage.ts";
import { revokeRuntimeAccessForSession } from "../session/revoke_runtime_access.ts";
import type { ActiveCatalogIssue } from "../../catalog/runtime.ts";
type RpcUser =
  & StaticDecode<
    typeof AuthRequestsValidateResponseSchema
  >["caller"]
  & AdminCaller;
type DeviceActivation = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  activatedBy?: DeviceActivationActor;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type DeviceActivationActor = {
  participantKind: "app" | "agent";
  userId: string;
  identity: {
    identityId: string;
    provider: string;
    subject: string;
  };
};

function deviceActivationActorFromCaller(
  caller: RpcUser,
): DeviceActivationActor | null {
  if (caller.type !== "user") return null;
  return {
    participantKind: caller.participantKind,
    userId: caller.userId,
    identity: caller.identity,
  };
}

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
  requestedBy: DeviceActivationActor;
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

type ActiveContractsDeps = {
  refreshActiveContracts: (
    opts?: Parameters<ActiveCatalogValidator>[0],
  ) => Promise<void>;
  refreshActiveContractsForRemoval?: (
    opts?: Parameters<ActiveCatalogValidator>[0],
  ) => Promise<void>;
};
type AuthorityReconciler = {
  reconcileDeployment(
    deploymentId: string,
    opts?: { desiredVersion?: string },
  ): Promise<unknown>;
};
type ActiveCatalogValidator = (opts: {
  stagedDeviceDeployments?: Iterable<DeviceDeployment>;
  stagedDeviceInstances?: Iterable<DeviceInstance>;
}) => Promise<unknown>;
type ActiveCatalogDeps = ActiveContractsDeps & {
  validateActiveCatalog: ActiveCatalogValidator;
  validateActiveCatalogForRemoval?: ActiveCatalogValidator;
  authorityReconciler?: AuthorityReconciler;
  getActiveCatalogIssues?: () => Promise<ActiveCatalogIssue[]>;
};

type AdminIdentityGrantStorage = {
  get(identityGrantId: string): Promise<IdentityGrantRecord | undefined>;
  listPage(query: BoundedListQuery): Promise<IdentityGrantRecord[]>;
  listByApprovalEvidenceContractDigests?(
    contractDigests: Iterable<string>,
  ): Promise<IdentityGrantRecord[]>;
};

export type AdminRpcDeps = {
  browserFlowsKV: RuntimeKV<unknown>;
  builtinContractDigests?: Iterable<string>;
  getActiveCatalogIssues?: () => Promise<ActiveCatalogIssue[]>;
  refreshActiveContracts: (
    opts?: Parameters<ActiveCatalogValidator>[0],
  ) => Promise<void>;
  connectionsKV: RuntimeKV<Connection>;
  contractApprovalStorage: AdminIdentityGrantStorage;
  contractStorage?: { delete(digest: string): Promise<void> };
  deviceActivationReviewStorage: {
    get(reviewId: string): Promise<DeviceActivationReviewRecord | undefined>;
    getByFlowId(
      flowId: string,
    ): Promise<DeviceActivationReviewRecord | undefined>;
    put(record: DeviceActivationReviewRecord): Promise<void>;
    delete(reviewId: string): Promise<void>;
    listPage(query: BoundedListQuery): Promise<DeviceActivationReviewRecord[]>;
    listFiltered?(filters: {
      instanceId?: string;
      deploymentId?: string;
      state?: string;
      deploymentIds?: Iterable<string>;
    }, query: BoundedListQuery): Promise<DeviceActivationReviewRecord[]>;
    listFilteredPage(
      filters: {
        instanceId?: string;
        deploymentId?: string;
        state?: string;
        deploymentIds?: Iterable<string>;
      },
      query: BoundedListQuery,
    ): Promise<ListPage<DeviceActivationReviewRecord>>;
  };
  deviceActivationStorage: {
    get(instanceId: string): Promise<DeviceActivation | undefined>;
    put(record: DeviceActivation): Promise<void>;
    delete(instanceId: string): Promise<void>;
    listPage(query: BoundedListQuery): Promise<DeviceActivation[]>;
    listFiltered?(filters: {
      instanceId?: string;
      deploymentId?: string;
      state?: string;
    }, query: BoundedListQuery): Promise<DeviceActivation[]>;
    listFilteredPage(filters: {
      instanceId?: string;
      deploymentId?: string;
      state?: string;
    }, query: BoundedListQuery): Promise<ListPage<DeviceActivation>>;
  };
  deviceDeploymentStorage: {
    get(deploymentId: string): Promise<DeviceDeployment | undefined>;
    put(record: DeviceDeployment): Promise<void>;
    delete(deploymentId: string): Promise<void>;
    listPage(query: BoundedListQuery): Promise<DeviceDeployment[]>;
    listFiltered?(
      filters: { disabled?: boolean },
      query: BoundedListQuery,
    ): Promise<DeviceDeployment[]>;
    listFilteredPage(
      filters: { disabled?: boolean },
      query: BoundedListQuery,
    ): Promise<ListPage<DeviceDeployment>>;
    listByDeploymentIds?(
      deploymentIds: Iterable<string>,
      filters?: { disabled?: boolean },
    ): Promise<Array<{ deploymentId: string; disabled?: boolean }>>;
  };
  deploymentAuthorityStorage: {
    get(deploymentId: string): Promise<DeploymentAuthority | undefined>;
    put(record: DeploymentAuthority): Promise<void>;
  };
  deviceInstanceStorage: {
    get(instanceId: string): Promise<DeviceInstance | undefined>;
    put(record: DeviceInstance): Promise<void>;
    delete(instanceId: string): Promise<void>;
    listPage(query: BoundedListQuery): Promise<DeviceInstance[]>;
    listByDeployment?(deploymentId: string): Promise<DeviceInstance[]>;
    listByDeployments?(
      deploymentIds: Iterable<string>,
    ): Promise<DeviceInstance[]>;
    listByDeploymentsAndStates?(
      deploymentIds: Iterable<string>,
      states: Iterable<string>,
    ): Promise<DeviceInstance[]>;
    listByStates?(states: Iterable<string>): Promise<DeviceInstance[]>;
    listFilteredPage(
      filters: { deploymentId?: string; state?: string },
      query: BoundedListQuery,
    ): Promise<ListPage<DeviceInstance>>;
  };
  deviceProvisioningSecretStorage: Pick<
    SqlDeviceProvisioningSecretRepository,
    "get" | "put" | "delete"
  >;
  kick: (serverId: string, clientId: number) => Promise<void>;
  logger: Pick<AuthLogger, "trace" | "warn">;
  operationCompletion?: OperationCompletion;
  authorityReconciler?: AuthorityReconciler;
  publishSessionRevoked: (
    event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    },
  ) => Promise<void>;
  sessionStorage:
    & Pick<
      SqlSessionRepository,
      | "deleteByPublicIdentityKey"
      | "deleteBySessionKey"
    >
    & Partial<Pick<SqlSessionRepository, "listEntriesByContractDigests">>;
  serviceDeploymentStorage?: {
    listPage(
      query: BoundedListQuery,
    ): Promise<Array<{ deploymentId: string; disabled?: boolean }>>;
    listByDeploymentIds?(
      deploymentIds: Iterable<string>,
      filters?: { disabled?: boolean },
    ): Promise<Array<{ deploymentId: string; disabled?: boolean }>>;
  };
  serviceInstanceStorage?: {
    listPage(
      query: BoundedListQuery,
    ): Promise<Array<unknown>>;
  };
  eventPublisher?: {
    event: Pick<
      AuthRuntimeDeps["trellis"]["event"],
      "auth"
    >;
  };
  userStorage: Pick<SqlUserProjectionRepository, "get">;
};

type AdminRpcContext = AdminRpcDeps;

type CatalogIssueResolveRequest = {
  issueId: string;
  action: "keep-current" | "force-replace";
};

type DeviceDeploymentRpcContext = AdminRpcDeps;

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

async function authResolveCatalogIssueHandler(
  { input: req, context: { caller } }: {
    input: CatalogIssueResolveRequest;
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
): Promise<
  Result<{
    success: true;
    issueId: string;
    action: "keep-current" | "force-replace";
  }, AuthError | UnexpectedError>
> {
  const authorized = requireAdmin(caller);
  if (authorized.isErr()) return authorized;
  if (!ctx.getActiveCatalogIssues) {
    return Result.err(
      new UnexpectedError({
        cause: new Error(
          "catalog issue resolution requires getActiveCatalogIssues",
        ),
      }),
    );
  }
  try {
    const issue = (await ctx.getActiveCatalogIssues()).find((candidate) =>
      candidate.issueId === req.issueId
    );
    if (!issue) {
      return invalidRequest({
        issueId: req.issueId,
      });
    }
    const action = issue.actions.find((candidate) =>
      candidate.action === req.action
    );
    if (!action) {
      return invalidRequest({
        issueId: req.issueId,
        action: req.action,
      });
    }
    if (!issue.contractId) {
      return invalidRequest({
        issueId: req.issueId,
        action: req.action,
      });
    }
    await ctx.refreshActiveContracts();
    return Result.ok({
      success: true,
      issueId: req.issueId,
      action: req.action,
    });
  } catch (error) {
    return Result.err(new UnexpectedError({ cause: toError(error) }));
  }
}

function isAdmin(user: RpcUser): boolean {
  return user.capabilities?.includes("admin") ?? false;
}

function reviewableDeployments(user: RpcUser): Set<string> | null {
  if (isAdmin(user)) return null;
  const capabilities = user.capabilities ?? [];
  if (capabilities.includes("trellis.auth::device.review")) return null;

  const deployments = new Set<string>();
  for (const capability of capabilities) {
    if (!capability.startsWith("trellis.auth::device.review.")) continue;
    const deploymentId = capability.slice("trellis.auth::device.review.".length)
      .trim();
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function refreshActiveContracts(
  deps: ActiveContractsDeps,
  opts?: Parameters<ActiveCatalogValidator>[0],
) {
  try {
    await deps.refreshActiveContracts(opts);
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

async function deleteBrowserFlow(
  ctx: AdminRpcContext,
  flowId: string,
): Promise<void> {
  const deleted = await ctx.browserFlowsKV.delete(flowId).take();
  if (isErr(deleted)) {
    ctx.logger.warn(
      { error: deleted.error, flowId },
      "Failed to delete device activation browser flow",
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
  ctx: DeviceDeploymentRpcContext,
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

function emptyDeploymentAuthority(args: {
  deploymentId: string;
  kind: DeploymentAuthority["kind"];
  disabled?: boolean;
  now?: string;
}): DeploymentAuthority {
  const now = args.now ?? new Date().toISOString();
  return {
    deploymentId: args.deploymentId,
    kind: args.kind,
    disabled: args.disabled ?? false,
    desiredState: { needs: [], capabilities: [], resources: [], surfaces: [] },
    version: ulid(),
    createdAt: now,
    updatedAt: now,
  };
}

async function setDeviceDeploymentAuthorityDisabled(args: {
  ctx: DeviceDeploymentRpcContext;
  deploymentId: string;
  disabled: boolean;
}): Promise<DeploymentAuthority | undefined> {
  const authority = await args.ctx.deploymentAuthorityStorage.get(
    args.deploymentId,
  );
  if (!authority) throw new Error("deployment authority not found");
  if (authority.disabled === args.disabled) return undefined;
  const updatedAt = new Date().toISOString();
  const updatedAuthority = {
    ...authority,
    disabled: args.disabled,
    version: ulid(),
    updatedAt,
  };
  await args.ctx.deploymentAuthorityStorage.put(updatedAuthority);
  return updatedAuthority;
}

async function setDeviceDeploymentAuthorityDisabledIfPresent(args: {
  ctx: DeviceDeploymentRpcContext;
  deploymentId: string;
  disabled: boolean;
}): Promise<
  | { previous: DeploymentAuthority; updated: DeploymentAuthority }
  | undefined
> {
  const authority = await args.ctx.deploymentAuthorityStorage.get(
    args.deploymentId,
  );
  if (!authority || authority.disabled === args.disabled) return undefined;
  const updatedAt = new Date().toISOString();
  const updatedAuthority = {
    ...authority,
    disabled: args.disabled,
    version: ulid(),
    updatedAt,
  };
  await args.ctx.deploymentAuthorityStorage.put(updatedAuthority);
  return { previous: authority, updated: updatedAuthority };
}

async function reconcileDeploymentAuthorityChange(args: {
  authority: DeploymentAuthority | undefined;
  ctx: DeviceDeploymentRpcContext;
}): Promise<void> {
  if (!args.authority || !args.ctx.authorityReconciler) return;
  try {
    await args.ctx.authorityReconciler.reconcileDeployment(
      args.authority.deploymentId,
      { desiredVersion: args.authority.version },
    );
  } catch (error) {
    args.ctx.logger.warn({
      err: toError(error),
      deploymentId: args.authority.deploymentId,
    }, "Deployment authority reconciliation trigger failed");
  }
}

async function listDeviceDeployments(
  ctx: DeviceDeploymentRpcContext,
  filters: { disabled?: boolean },
  query: BoundedListQuery,
): Promise<ListPage<DeviceDeployment>> {
  return await ctx.deviceDeploymentStorage.listFilteredPage(filters, query);
}

async function listDeviceInstances(
  ctx: DeviceDeploymentRpcContext,
  query: BoundedListQuery,
): Promise<DeviceInstance[]> {
  return await ctx.deviceInstanceStorage.listPage(query);
}

async function listDeviceInstancesForDeployment(
  ctx: DeviceDeploymentRpcContext,
  deploymentId: string,
): Promise<DeviceInstance[]> {
  return await ctx.deviceInstanceStorage.listByDeployment!(deploymentId);
}

async function listDeviceInstancesFiltered(
  ctx: DeviceDeploymentRpcContext,
  filters: { deploymentId?: string; state?: string },
  query: BoundedListQuery,
): Promise<ListPage<DeviceInstance>> {
  return await ctx.deviceInstanceStorage.listFilteredPage(filters, query);
}

async function listDeviceActivations(
  ctx: AdminRpcContext,
  filters: { instanceId?: string; deploymentId?: string; state?: string },
  query: BoundedListQuery,
): Promise<ListPage<DeviceActivation>> {
  return await ctx.deviceActivationStorage.listFilteredPage(filters, query);
}

async function listDeviceActivationReviews(
  ctx: AdminRpcContext,
  filters: {
    instanceId?: string;
    deploymentId?: string;
    state?: string;
    deploymentIds?: Iterable<string>;
  },
  query: BoundedListQuery,
): Promise<ListPage<DeviceActivationReviewRecord>> {
  return await ctx.deviceActivationReviewStorage.listFilteredPage(
    filters,
    query,
  );
}

async function listDeviceActivationReviewsForDeploymentRemoval(
  ctx: AdminRpcContext,
  deploymentId: string,
  instances: DeviceInstance[],
): Promise<DeviceActivationReviewRecord[]> {
  const reviews = new Map<string, DeviceActivationReviewRecord>();
  for (
    const review of await ctx.deviceActivationReviewStorage.listFiltered!({
      deploymentId,
    }, { limit: MAX_STORAGE_LIST_LIMIT })
  ) {
    reviews.set(review.reviewId, review);
  }
  for (const instance of instances) {
    for (
      const review of await ctx.deviceActivationReviewStorage.listFiltered!({
        instanceId: instance.instanceId,
      }, { limit: MAX_STORAGE_LIST_LIMIT })
    ) {
      reviews.set(review.reviewId, review);
    }
  }
  return [...reviews.values()];
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
  ctx: DeviceDeploymentRpcContext,
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

export function createAuthDeploymentsDeviceCreateHandler() {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: Parameters<typeof validateDeviceDeploymentRequest>[0];
      context: { caller: RpcUser };
    },
    ctx: DeviceDeploymentRpcContext,
  ) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const validation = validateDeviceDeploymentRequest(req);
    if (validation.isErr()) return validation;
    const { deployment } = validation.take() as {
      deployment: DeviceDeployment;
    };
    const previous = await ctx.deviceDeploymentStorage.get(
      deployment.deploymentId,
    );
    try {
      await ctx.deviceDeploymentStorage.put(deployment);
      await ctx.deploymentAuthorityStorage.put(emptyDeploymentAuthority({
        deploymentId: deployment.deploymentId,
        kind: "device",
      }));
    } catch (error) {
      if (previous) {
        await ctx.deviceDeploymentStorage.put(previous).catch(() => undefined);
      } else {
        await ctx.deviceDeploymentStorage.delete(deployment.deploymentId).catch(
          () => undefined,
        );
      }
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    return Result.ok({ deployment });
  };
}

export const authListDeviceDeploymentsHandler = async (
  { input: req, context: { caller } }: {
    input: BoundedListQuery & { disabled?: boolean };
    context: { caller: RpcUser };
  },
  ctx: DeviceDeploymentRpcContext,
) => {
  const authorized = requireAdmin(caller);
  if (authorized.isErr()) return authorized;
  const deployments = await listDeviceDeployments(ctx, {
    disabled: req.disabled,
  }, req);
  return Result.ok(deployments);
};

export function createAuthDeploymentsDeviceDisableHandler(
  deps: ActiveCatalogDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  }, ctx: DeviceDeploymentRpcContext) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const deployment = await loadDeviceDeployment(ctx, req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    const nextDeployment = { ...deployment, disabled: true };
    const authority = await ctx.deploymentAuthorityStorage.get(
      req.deploymentId,
    );
    if (!authority) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "deployment_authority_not_found",
      });
    }
    const validated = await validateActiveCatalog(deps, {
      stagedDeviceDeployments: [nextDeployment],
    });
    if (isErr(validated)) return validated;
    try {
      await ctx.deviceDeploymentStorage.put(nextDeployment);
      const updatedAuthority = await setDeviceDeploymentAuthorityDisabled({
        ctx,
        deploymentId: nextDeployment.deploymentId,
        disabled: true,
      });
      const refreshed = await refreshActiveContracts(deps);
      if (isErr(refreshed)) {
        return await rollbackRefreshFailure<
          { deployment: typeof nextDeployment }
        >(
          refreshed.error,
          async () => {
            await ctx.deviceDeploymentStorage.put(deployment);
            await ctx.deploymentAuthorityStorage.put(authority);
          },
        );
      }
      await reconcileDeploymentAuthorityChange({
        authority: updatedAuthority,
        ctx,
      });
    } catch (error) {
      await ctx.deviceDeploymentStorage.put(deployment).catch(() => undefined);
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    for (
      const instance of await listDeviceInstancesForDeployment(
        ctx,
        req.deploymentId,
      )
    ) {
      await kickDeviceRuntimeAccess(ctx, instance.publicIdentityKey);
    }
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthDeploymentsDeviceEnableHandler(
  deps: ActiveCatalogDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  }, ctx: DeviceDeploymentRpcContext) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const deployment = await loadDeviceDeployment(ctx, req.deploymentId);
    if (!deployment) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "device_deployment_not_found",
      });
    }
    const nextDeployment = { ...deployment, disabled: false };
    const authority = await ctx.deploymentAuthorityStorage.get(
      req.deploymentId,
    );
    if (!authority) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "deployment_authority_not_found",
      });
    }
    const validated = await validateActiveCatalog(deps, {
      stagedDeviceDeployments: [nextDeployment],
    });
    if (isErr(validated)) return validated;
    try {
      await ctx.deviceDeploymentStorage.put(nextDeployment);
      const updatedAuthority = await setDeviceDeploymentAuthorityDisabled({
        ctx,
        deploymentId: nextDeployment.deploymentId,
        disabled: false,
      });
      const refreshed = await refreshActiveContracts(deps);
      if (isErr(refreshed)) {
        return await rollbackRefreshFailure<
          { deployment: typeof nextDeployment }
        >(
          refreshed.error,
          async () => {
            await ctx.deviceDeploymentStorage.put(deployment);
            await ctx.deploymentAuthorityStorage.put(authority);
          },
        );
      }
      await reconcileDeploymentAuthorityChange({
        authority: updatedAuthority,
        ctx,
      });
    } catch (error) {
      await ctx.deviceDeploymentStorage.put(deployment).catch(() => undefined);
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthDeploymentsDeviceRemoveHandler(
  deps: ActiveCatalogDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: {
      deploymentId: string;
      cascade?: boolean;
      purgeUnusedContracts?: boolean;
    };
    context: { caller: RpcUser };
  }, ctx: DeviceDeploymentRpcContext) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    if (req.purgeUnusedContracts === true && req.cascade !== true) {
      return invalidRequest({
        deploymentId: req.deploymentId,
        reason: "unused_contract_purge_requires_cascade",
      });
    }
    const instances = await listDeviceInstancesForDeployment(
      ctx,
      req.deploymentId,
    );
    if (instances.length > 0 && req.cascade !== true) {
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
    const validationOpts: Parameters<ActiveCatalogValidator>[0] = {
      stagedDeviceDeployments: [{
        ...deployment,
        disabled: true,
      }],
    };
    if (instances.length > 0) {
      validationOpts.stagedDeviceInstances = instances.map((instance) => ({
        ...instance,
        state: "disabled" as const,
      }));
    }
    const removalDeps: ActiveCatalogDeps = {
      refreshActiveContracts: deps.refreshActiveContractsForRemoval ??
        deps.refreshActiveContracts,
      validateActiveCatalog: deps.validateActiveCatalogForRemoval ??
        deps.validateActiveCatalog,
    };
    const validated = await validateActiveCatalog(removalDeps, validationOpts);
    if (isErr(validated)) return validated;
    if (req.purgeUnusedContracts === true) {
      ctx.logger.warn(
        { deploymentId: req.deploymentId },
        "Unused contract purge no longer applies to offer-backed runtime state and was skipped",
      );
    }
    const provisioningSecrets: DeviceProvisioningSecret[] = [];
    const activations: DeviceActivation[] = [];
    for (const instance of instances) {
      const provisioningSecret = await loadDeviceProvisioningSecret(
        ctx,
        instance.instanceId,
      );
      if (provisioningSecret) provisioningSecrets.push(provisioningSecret);
      const activation = await loadDeviceActivation(ctx, instance.instanceId);
      if (activation) activations.push(activation);
    }
    const activationReviews =
      await listDeviceActivationReviewsForDeploymentRemoval(
        ctx,
        req.deploymentId,
        instances,
      );
    try {
      for (const instance of instances) {
        await kickDeviceRuntimeAccess(ctx, instance.publicIdentityKey);
      }
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    let previousAuthority: DeploymentAuthority | undefined;
    const restoreDeletedRecords = async () => {
      await ctx.deviceDeploymentStorage.put(deployment);
      if (previousAuthority) {
        await ctx.deploymentAuthorityStorage.put(previousAuthority);
      }
      for (const instance of instances) {
        await ctx.deviceInstanceStorage.put(instance);
      }
      for (const provisioningSecret of provisioningSecrets) {
        await ctx.deviceProvisioningSecretStorage.put({
          ...provisioningSecret,
          createdAt: provisioningSecret.createdAt instanceof Date
            ? provisioningSecret.createdAt
            : new Date(provisioningSecret.createdAt),
        });
      }
      for (const activation of activations) {
        await ctx.deviceActivationStorage.put(activation);
      }
      for (const review of activationReviews) {
        await ctx.deviceActivationReviewStorage.put(review);
      }
    };
    let updatedAuthority: DeploymentAuthority | undefined;
    try {
      const authorityChange =
        await setDeviceDeploymentAuthorityDisabledIfPresent({
          ctx,
          deploymentId: req.deploymentId,
          disabled: true,
        });
      previousAuthority = authorityChange?.previous;
      updatedAuthority = authorityChange?.updated;
      for (const instance of instances) {
        await ctx.deviceInstanceStorage.delete(instance.instanceId);
        await ctx.deviceProvisioningSecretStorage.delete(instance.instanceId);
        await ctx.deviceActivationStorage.delete(instance.instanceId);
      }
      for (const review of activationReviews) {
        await ctx.deviceActivationReviewStorage.delete(review.reviewId);
      }
      await ctx.deviceDeploymentStorage.delete(req.deploymentId);
    } catch (error) {
      try {
        await restoreDeletedRecords();
      } catch (rollbackError) {
        return Result.err(
          new UnexpectedError({
            cause: new AggregateError(
              [toError(error), toError(rollbackError)],
              "device deployment removal failed and rollback failed",
            ),
          }),
        );
      }
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(removalDeps);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure<{ success: boolean }>(
        refreshed.error,
        restoreDeletedRecords,
      );
    }
    await reconcileDeploymentAuthorityChange({
      authority: updatedAuthority,
      ctx,
    });
    for (const review of activationReviews) {
      await deleteBrowserFlow(ctx, review.flowId);
    }
    return Result.ok({ success: true });
  };
}

export function createAuthDevicesProvisionHandler() {
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
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
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
    input: BoundedListQuery & { deploymentId?: string; state?: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  const authorized = requireAdmin(caller);
  if (authorized.isErr()) return authorized;
  const instances = await listDeviceInstancesFiltered(ctx, req, req);
  return Result.ok(instances);
};

export function createAuthDevicesDisableHandler(
  deps: ActiveCatalogDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }, ctx: AdminRpcContext) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
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

export function createAuthDevicesEnableHandler(
  deps: ActiveCatalogDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }, ctx: AdminRpcContext) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
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

export function createAuthDevicesRemoveHandler(
  deps: ActiveCatalogDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }, ctx: AdminRpcContext) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
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
    input: BoundedListQuery & {
      instanceId?: string;
      deploymentId?: string;
      state?: string;
    };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  const authorized = requireAdmin(caller);
  if (authorized.isErr()) return authorized;
  const activations = await listDeviceActivations(ctx, req, req);
  return Result.ok(activations);
};

export const authRevokeDeviceActivationHandler = async (
  { input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  },
  ctx: AdminRpcContext,
) => {
  const authorized = requireAdmin(caller);
  if (authorized.isErr()) return authorized;
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
    input: BoundedListQuery & {
      instanceId?: string;
      deploymentId?: string;
      state?: string;
    };
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
  const reviews = await listDeviceActivationReviews(ctx, {
    instanceId: req.instanceId,
    deploymentId: req.deploymentId,
    state: req.state,
    ...(allowedDeployments !== null && !req.deploymentId
      ? { deploymentIds: allowedDeployments }
      : {}),
  }, req);
  return Result.ok({
    ...reviews,
    entries: reviews.entries.map(toPublicReview),
  });
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
  const approvalActor = deviceActivationActorFromCaller(caller);
  if (req.decision === "approve" && !approvalActor) {
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
  (await ctx.eventPublisher?.event.auth.deviceUserAuthoritiesApproved.publish({
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
    approvedBy: approvalActor,
  }))?.inspectErr((error: unknown) =>
    ctx.logger.warn(
      { error, reviewId: updatedReview.reviewId },
      "Failed to publish Auth.DeviceUserAuthorities.Approved",
    )
  );
  (await ctx.eventPublisher?.event.auth.deviceUserAuthoritiesResolved.publish({
    instanceId: activation.instanceId,
    publicIdentityKey: activation.publicIdentityKey,
    deploymentId: activation.deploymentId,
    resolvedAt: activation.activatedAt,
    resolvedBy: activation.activatedBy,
    flowId: updatedReview.flowId,
    reviewId: updatedReview.reviewId,
  }))?.inspectErr((error: unknown) =>
    ctx.logger.warn(
      { error, instanceId: activation.instanceId },
      "Failed to publish Auth.DeviceUserAuthorities.Resolved",
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
    refreshActiveContracts: ActiveContractsDeps["refreshActiveContracts"];
    refreshActiveContractsForRemoval?: ActiveContractsDeps[
      "refreshActiveContractsForRemoval"
    ];
    validateActiveCatalog: ActiveCatalogValidator;
    validateActiveCatalogForRemoval?: ActiveCatalogValidator;
  },
) {
  const activeContractsDeps = {
    refreshActiveContracts: deps.refreshActiveContracts,
    refreshActiveContractsForRemoval: deps.refreshActiveContractsForRemoval,
    validateActiveCatalog: deps.validateActiveCatalog,
    validateActiveCatalogForRemoval: deps.validateActiveCatalogForRemoval,
  };
  return {
    createDeviceDeployment: bindAdminRpcHandler(
      deps,
      createAuthDeploymentsDeviceCreateHandler(),
    ),
    listDeviceDeployments: bindAdminRpcHandler(
      deps,
      authListDeviceDeploymentsHandler,
    ),
    disableDeviceDeployment: bindAdminRpcHandler(
      deps,
      createAuthDeploymentsDeviceDisableHandler(activeContractsDeps),
    ),
    enableDeviceDeployment: bindAdminRpcHandler(
      deps,
      createAuthDeploymentsDeviceEnableHandler(activeContractsDeps),
    ),
    removeDeviceDeployment: bindAdminRpcHandler(
      deps,
      createAuthDeploymentsDeviceRemoveHandler(activeContractsDeps),
    ),
    provisionDeviceInstance: bindAdminRpcHandler(
      deps,
      createAuthDevicesProvisionHandler(),
    ),
    listDeviceInstances: bindAdminRpcHandler(
      deps,
      authListDeviceInstancesHandler,
    ),
    disableDeviceInstance: bindAdminRpcHandler(
      deps,
      createAuthDevicesDisableHandler(activeContractsDeps),
    ),
    enableDeviceInstance: bindAdminRpcHandler(
      deps,
      createAuthDevicesEnableHandler(activeContractsDeps),
    ),
    removeDeviceInstance: bindAdminRpcHandler(
      deps,
      createAuthDevicesRemoveHandler(activeContractsDeps),
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
    resolveCatalogIssue: bindAdminRpcHandler(
      deps,
      authResolveCatalogIssueHandler,
    ),
  };
}
