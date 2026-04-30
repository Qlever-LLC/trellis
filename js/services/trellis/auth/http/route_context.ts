import { HTTPException } from "@hono/hono/http-exception";
import { isErr } from "@qlever-llc/result";

import type { Config } from "../../config.ts";
import type { ContractStore } from "../../catalog/store.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import { planUserContractApproval } from "../approval/plan.ts";
import { randomToken } from "../crypto.ts";
import type { Provider } from "../providers/index.ts";
import { createProviders } from "../providers/registry.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import {
  type InstanceGrantPolicy,
  type PendingAuth,
  type Session,
  type SessionApprovalSource,
} from "../schemas.ts";
import { ensureBoundUserSession } from "../session/bind.ts";
import { upsertUserProjectionInSql } from "../session/projection.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import { buildClientTransports } from "../transports.ts";
import { getApprovalResolutionErrorMessage } from "./approval_errors.ts";
import type {
  AuthStartBoundResponse,
  CurrentUserSession,
} from "./start_request.ts";
import {
  applyApprovalDecision,
  buildAppIdentity,
  getApprovalResolution,
  getApprovalResolutionBlocker,
  parseContractApprovalKey,
  type PendingAuthEntry,
  resolveLoginPortal,
} from "./support.ts";

export type HttpRouteRuntimeDeps = Pick<
  AuthRuntimeDeps,
  | "browserFlowsKV"
  | "connectionsKV"
  | "logger"
  | "natsTrellis"
  | "oauthStateKV"
  | "pendingAuthKV"
  | "sentinelCreds"
  | "sessionStorage"
>;

export type AuthHttpRouteOptions = {
  contractStorage: SqlContractStorageRepository;
  userStorage: SqlUserProjectionRepository;
  contractApprovalStorage: SqlContractApprovalRepository;
  portalStorage: SqlPortalRepository;
  portalDefaultStorage: SqlPortalDefaultRepository;
  loginPortalSelectionStorage: SqlLoginPortalSelectionRepository;
  devicePortalSelectionStorage: SqlDevicePortalSelectionRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceActivationReviewStorage: SqlDeviceActivationReviewRepository;
  deviceProvisioningSecretStorage: SqlDeviceProvisioningSecretRepository;
  config: Config;
  kick: (serverId: string, clientId: number) => Promise<void>;
  loadEffectiveGrantPolicies: (
    contractId: string,
  ) => Promise<InstanceGrantPolicy[]>;
  contractStore: ContractStore;
  providers?: Record<string, Provider>;
  runtimeDeps: HttpRouteRuntimeDeps;
};

export type BrowserFlowRecord = {
  flowId: string;
  kind: "login" | "device_activation";
  sessionKey?: string;
  redirectTo?: string;
  app?: {
    contractId: string;
    origin?: string;
  };
  context?: Record<string, unknown>;
  contract?: Record<string, unknown>;
  provider?: string;
  authToken?: string;
  deviceActivation?: {
    instanceId: string;
    deploymentId: string;
    publicIdentityKey: string;
    nonce: string;
    qrMac: string;
  };
  createdAt: Date;
  expiresAt: Date;
};

type ApprovalResolution = Awaited<ReturnType<typeof getApprovalResolution>>;

export type AuthHttpRouteContext = ReturnType<
  typeof createAuthHttpRouteContext
>;

/** Creates shared dependencies and helpers for auth HTTP route modules. */
export function createAuthHttpRouteContext(opts: AuthHttpRouteOptions) {
  const { config } = opts;
  const {
    browserFlowsKV,
    connectionsKV,
    logger,
    pendingAuthKV,
    sentinelCreds,
    sessionStorage,
  } = opts.runtimeDeps;
  const providers = opts.providers ?? createProviders(config);
  const approvalResolutionDeps = {
    loadStoredApproval: async (key: string) => {
      const approvalKey = parseContractApprovalKey(key);
      if (!approvalKey) return null;
      return await opts.contractApprovalStorage.get(
        approvalKey.userTrellisId,
        approvalKey.contractDigest,
      ) ?? null;
    },
    loadUserProjection: async (trellisId: string) => {
      return await opts.userStorage.get(trellisId) ?? null;
    },
    loadInstanceGrantPolicies: async (contractId: string) => {
      return await opts.loadEffectiveGrantPolicies(contractId);
    },
  };

  async function requireApprovalResolution(pending: PendingAuth) {
    try {
      return await getApprovalResolution(
        opts.contractStore,
        pending,
        approvalResolutionDeps,
      );
    } catch (error) {
      const message = getApprovalResolutionErrorMessage(error);
      if (message) {
        logger.warn({ error }, "Unable to resolve app approval request");
        throw new HTTPException(409, { message });
      }
      logger.error({ error }, "Failed to resolve app approval request");
      throw error;
    }
  }

  async function loadBrowserFlow(
    flowId: string,
  ): Promise<BrowserFlowRecord | null> {
    const entry = await browserFlowsKV.get(flowId).take();
    if (isErr(entry)) return null;
    return entry.value as BrowserFlowRecord;
  }

  async function saveBrowserFlow(flow: BrowserFlowRecord): Promise<void> {
    const putResult = await browserFlowsKV.put(flow.flowId, flow).take();
    if (isErr(putResult)) {
      logger.error(
        { error: putResult.error, flowId: flow.flowId, kind: flow.kind },
        "Failed to store browser flow",
      );
      throw new HTTPException(500, {
        message: "Failed to create browser flow",
      });
    }
  }

  function builtinPortalEntryUrl(
    pathname:
      | "/_trellis/portal/users/login"
      | "/_trellis/portal/devices/activate",
  ): string {
    const base = config.web.publicOrigin ?? config.oauth.redirectBase;
    return new URL(pathname, base).toString();
  }

  async function resolvePortalEntryUrlForContract(
    contract: Record<string, unknown>,
  ): Promise<string | null> {
    const contractId = typeof contract.id === "string" ? contract.id : null;
    const resolved = resolveLoginPortal({
      contractId: contractId ?? "",
      portals: await opts.portalStorage.list(),
      defaultPortalId: (await opts.portalDefaultStorage.getLogin())?.portalId,
      selections: await opts.loginPortalSelectionStorage.list(),
    });
    if (resolved.kind === "custom") {
      return resolved.portal.entryUrl;
    }

    return builtinPortalEntryUrl("/_trellis/portal/users/login");
  }

  async function loadCurrentUserSession(
    sessionKey: string,
  ): Promise<CurrentUserSession | null> {
    let session: Session | undefined;
    try {
      session = await sessionStorage.getOneBySessionKey(sessionKey);
    } catch {
      return null;
    }
    if (!session) return null;
    if (session.type !== "user") return null;
    return {
      origin: session.origin,
      id: session.id,
      email: session.email,
      name: session.name,
      ...(session.image ? { image: session.image } : {}),
      contractId: session.contractId,
      ...(session.app ? { app: session.app } : {}),
      delegatedCapabilities: session.delegatedCapabilities,
      delegatedPublishSubjects: session.delegatedPublishSubjects,
      delegatedSubscribeSubjects: session.delegatedSubscribeSubjects,
      ...(session.approvalSource
        ? { approvalSource: session.approvalSource }
        : {}),
    };
  }

  async function bindResolvedUserSession(args: {
    pendingValue: PendingAuth;
    resolution: ApprovalResolution;
    approvalSource?: SessionApprovalSource;
    consumePending?: () => Promise<boolean>;
  }): Promise<AuthStartBoundResponse> {
    const now = new Date();
    const validatedContract = await opts.contractStore.validate(
      args.resolution.plan.contract,
    );
    const existingContract = await opts.contractStorage.get(
      validatedContract.digest,
    );
    if (!existingContract) {
      await opts.contractStorage.put({
        digest: validatedContract.digest,
        id: validatedContract.contract.id,
        displayName: validatedContract.contract.displayName,
        description: validatedContract.contract.description,
        installedAt: now,
        contract: validatedContract.canonical,
      });
    }
    opts.contractStore.add(
      validatedContract.digest,
      validatedContract.contract,
    );
    const trellisId = args.resolution.trellisId;
    await upsertUserProjectionInSql(opts.userStorage, {
      origin: args.pendingValue.user.origin,
      id: args.pendingValue.user.id,
      name: args.resolution.userName,
      email: args.resolution.userEmail,
      active: true,
      capabilities: args.resolution.existingCapabilities,
    });

    if (args.consumePending) {
      const consumed = await args.consumePending();
      if (!consumed) {
        throw new HTTPException(400, { message: "authtoken_already_used" });
      }
    }

    if (
      args.approvalSource === "stored_approval" &&
      !args.resolution.storedApproval
    ) {
      const updatedResolution = applyApprovalDecision({
        resolution: args.resolution,
        approved: true,
        answeredAt: now,
      });
      await opts.contractApprovalStorage.put(updatedResolution.storedApproval);
    }

    const sessionEnsured = await ensureBoundUserSession({
      sessionStorage,
      connectionsKV,
      kick: opts.kick,
      now,
      sessionKey: args.pendingValue.sessionKey,
      trellisId,
      origin: args.pendingValue.user.origin,
      id: args.pendingValue.user.id,
      email: args.resolution.userEmail,
      name: args.resolution.userName,
      image: args.pendingValue.user.image,
      participantKind: (
        args.resolution.plan.approval as
          & typeof args.resolution.plan.approval
          & {
            participantKind: "app" | "agent";
          }
      ).participantKind,
      contractDigest: args.resolution.plan.digest,
      contractId: args.resolution.plan.contract.id,
      contractDisplayName: args.resolution.plan.contract.displayName,
      contractDescription: args.resolution.plan.contract.description,
      ...(args.resolution.app ? { app: args.resolution.app } : {}),
      ...(args.approvalSource
        ? { approvalSource: args.approvalSource }
        : args.resolution.effectiveApproval.kind !== "none"
        ? { approvalSource: args.resolution.effectiveApproval.kind }
        : {}),
      delegatedCapabilities: args.resolution.plan.approval.capabilities,
      delegatedPublishSubjects: args.resolution.plan.publishSubjects,
      delegatedSubscribeSubjects: args.resolution.plan.subscribeSubjects,
    });
    const sessionEnsuredValue = sessionEnsured.take();
    if (isErr(sessionEnsuredValue)) {
      if (sessionEnsuredValue.error.reason === "session_already_bound") {
        throw new HTTPException(400, { message: "session_already_bound" });
      }
      logger.error(
        { error: sessionEnsuredValue.error },
        "Failed to ensure user session during bind",
      );
      throw new HTTPException(500, { message: "Failed to create session" });
    }

    const expiresAt = new Date(now.getTime() + config.ttlMs.sessions);

    return {
      status: "bound",
      inboxPrefix: `_INBOX.${args.pendingValue.sessionKey.slice(0, 16)}`,
      expires: expiresAt.toISOString(),
      sentinel: sentinelCreds,
      transports: buildClientTransports(config),
    };
  }

  async function createFlowStartResponse(args: {
    authUrl: string;
    provider?: string;
    sessionKey: string;
    redirectTo: string;
    contract: Record<string, unknown>;
    context?: Record<string, unknown>;
    plan: Awaited<ReturnType<typeof planUserContractApproval>>;
  }) {
    const portalEntryUrl = await resolvePortalEntryUrlForContract(
      args.contract,
    );
    if (!portalEntryUrl) {
      throw new HTTPException(503, {
        message: "Auth portal is not configured",
      });
    }

    const flowId = randomToken(16);
    await saveBrowserFlow({
      flowId,
      kind: "login",
      sessionKey: args.sessionKey,
      redirectTo: args.redirectTo,
      app: buildAppIdentity({
        contractId: args.plan.contract.id,
        redirectTo: args.redirectTo,
      }),
      ...(args.context ? { context: args.context } : {}),
      contract: args.plan.contract,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + config.ttlMs.oauth),
    });

    if (args.provider) {
      const providerUrl = new URL(args.authUrl);
      providerUrl.pathname = `/auth/login/${encodeURIComponent(args.provider)}`;
      providerUrl.search = "";
      providerUrl.searchParams.set("flowId", flowId);
      return {
        status: "flow_started" as const,
        flowId,
        loginUrl: providerUrl.toString(),
      };
    }

    const portalUrl = new URL(portalEntryUrl);
    portalUrl.searchParams.set("flowId", flowId);
    return {
      status: "flow_started" as const,
      flowId,
      loginUrl: portalUrl.toString(),
    };
  }

  async function completePendingBind(args: {
    pending: PendingAuthEntry;
    pendingValue: PendingAuth;
    sessionKey: string;
  }) {
    const resolution = await requireApprovalResolution(args.pendingValue);

    if (resolution.missingCapabilities.length > 0) {
      return {
        status: "insufficient_capabilities",
        approval: resolution.plan.approval,
        missingCapabilities: resolution.missingCapabilities,
        userCapabilities: [...resolution.existingCapabilities].sort((
          left,
          right,
        ) => left.localeCompare(right)),
      };
    }

    if (resolution.effectiveApproval.answer !== "approved") {
      throw new HTTPException(403, {
        message: resolution.effectiveApproval.answer === "denied"
          ? "approval_denied"
          : "approval_required",
      });
    }

    const resolutionBlocker = getApprovalResolutionBlocker(resolution);
    if (resolutionBlocker) {
      throw new HTTPException(403, { message: resolutionBlocker });
    }

    return bindResolvedUserSession({
      pendingValue: args.pendingValue,
      resolution,
      consumePending: async () => {
        const pendingDeleted = await args.pending.delete(true);
        return !isErr(pendingDeleted);
      },
    });
  }

  return {
    opts,
    config,
    providers,
    loadBrowserFlow,
    saveBrowserFlow,
    resolvePortalEntryUrlForContract,
    loadCurrentUserSession,
    requireApprovalResolution,
    bindResolvedUserSession,
    createFlowStartResponse,
    completePendingBind,
  };
}
