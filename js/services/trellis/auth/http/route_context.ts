import { HTTPException } from "@hono/hono/http-exception";
import { isErr } from "@qlever-llc/result";
import { approvalCapabilityKeys } from "@qlever-llc/trellis/auth";

import type { Config } from "../../config.ts";
import type { ContractsModule } from "../../catalog/runtime.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import { planUserContractApproval } from "../approval/plan.ts";
import { randomToken } from "../crypto.ts";
import { OAuth2CodeRequest, OAuth2CodeResponse } from "../oauth.ts";
import type { Provider } from "../providers/index.ts";
import { createProviders } from "../providers/registry.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type {
  AccountFlowKind,
  FlowRegistrationAvailability,
  IdentityEnvelopeRecord,
  LoginPortalRecord,
  LoginPortalSettings,
  PendingAuth,
  Session,
  SessionApprovalSource,
} from "../schemas.ts";
import { ensureBoundUserSession } from "../session/bind.ts";
import { upsertUserProjectionInSql } from "../session/projection.ts";
import type {
  SqlAccountFlowRepository,
  SqlCapabilityGroupRepository,
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeploymentGrantOverrideRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeploymentResourceBindingRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlEnvelopeExpansionRequestRepository,
  SqlIdentityEnvelopeRepository,
  SqlLocalCredentialRepository,
  SqlLoginPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import { BUILTIN_LOGIN_PORTAL_ID } from "../storage.ts";
import { buildClientTransports } from "../transports.ts";
import { resolveCorsOrigin } from "../redirect.ts";
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
  identityAnchorForApp,
  identityEnvelopeIdForAnchor,
  type PendingAuthEntry,
  resolveLinkedActiveUserIdentity as resolveLinkedActiveUserIdentityRecord,
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

type HttpContractStorage = Pick<
  SqlContractStorageRepository,
  "get" | "has" | "put"
>;
type HttpAccountFlowStorage = Pick<
  SqlAccountFlowRepository,
  | "completeAdminBootstrapLocalPassword"
  | "completeIdentityLinkLocalPassword"
  | "completeAdminBootstrapOAuth"
  | "completeTargetAccountOAuth"
  | "consume"
  | "get"
>;
type HttpAccountStorage = Pick<
  SqlUserAccountRepository,
  "get" | "listPage" | "put"
>;
type HttpUserIdentityStorage = Pick<
  SqlUserIdentityRepository,
  "getByProviderSubject" | "listByUser" | "put"
>;
type HttpLocalCredentialStorage = Pick<
  SqlLocalCredentialRepository,
  "get" | "put"
>;
type HttpUserProjectionStorage = Pick<
  SqlUserProjectionRepository,
  "get" | "put"
>;
type HttpCapabilityGroupStorage = Pick<SqlCapabilityGroupRepository, "get">;
type HttpIdentityEnvelopeStorage = Pick<
  SqlIdentityEnvelopeRepository,
  "listByUser" | "listPage" | "put"
>;
type HttpLoginPortalStorage = Pick<
  SqlLoginPortalRepository,
  | "getSelectedByPortalId"
  | "resolveForApp"
  | "registerLocalIdentity"
  | "registerFederatedIdentity"
>;

export type AuthHttpRouteOptions = {
  contractStorage: HttpContractStorage;
  accountFlowStorage: HttpAccountFlowStorage;
  accountStorage: HttpAccountStorage;
  userIdentityStorage: HttpUserIdentityStorage;
  localCredentialStorage: HttpLocalCredentialStorage;
  userStorage: HttpUserProjectionStorage;
  capabilityGroupStorage: HttpCapabilityGroupStorage;
  contractApprovalStorage: HttpIdentityEnvelopeStorage;
  loginPortalStorage?: HttpLoginPortalStorage;
  deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceActivationReviewStorage: SqlDeviceActivationReviewRepository;
  deviceProvisioningSecretStorage: SqlDeviceProvisioningSecretRepository;
  deploymentEnvelopeStorage: SqlDeploymentEnvelopeRepository;
  deploymentGrantOverrideStorage: SqlDeploymentGrantOverrideRepository;
  deploymentResourceBindingStorage: SqlDeploymentResourceBindingRepository;
  deploymentContractEvidenceStorage: SqlDeploymentContractEvidenceRepository;
  envelopeExpansionRequestStorage: SqlEnvelopeExpansionRequestRepository;
  config: Config;
  kick: (serverId: string, clientId: number) => Promise<void>;
  contracts: Pick<
    ContractsModule,
    | "getActiveEntries"
    | "getActiveContractsById"
    | "getContract"
    | "getKnownEntriesByContractId"
    | "getKnownContract"
    | "getKnownContractsById"
    | "validateContract"
  >;
  providers?: Record<string, Provider>;
  oauthCodeRequest?: typeof OAuth2CodeRequest;
  oauthCodeResponse?: typeof OAuth2CodeResponse;
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
  portalId?: string;
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

type SelectedLoginPortal = {
  portal: LoginPortalRecord;
  settings: LoginPortalSettings;
  defaultCapabilities: string[];
  defaultCapabilityGroups: string[];
};

function builtinLoginPortal(config: Config): SelectedLoginPortal {
  const now = new Date().toISOString();
  return {
    portal: {
      portalId: BUILTIN_LOGIN_PORTAL_ID,
      displayName: "Trellis Login",
      entryUrl: null,
      builtIn: true,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    },
    settings: {
      portalId: BUILTIN_LOGIN_PORTAL_ID,
      localRegistrationEnabled: true,
      federatedRegistrationEnabled: true,
      allowedFederatedProviders: null,
      selfRegisteredAccountActive: true,
      updatedAt: now,
    },
    defaultCapabilities: [],
    defaultCapabilityGroups: [],
  };
}

function isIdentityEnvelopeRecord(
  value: unknown,
): value is IdentityEnvelopeRecord {
  return !!value && typeof value === "object" &&
    "identityEnvelopeId" in value &&
    typeof value.identityEnvelopeId === "string" &&
    "userTrellisId" in value && typeof value.userTrellisId === "string";
}

function requireUserParticipantKind(value: unknown): "app" | "agent" {
  if (!value || typeof value !== "object") {
    throw new HTTPException(409, { message: "invalid_approval_evidence" });
  }
  const participantKind = Object.getOwnPropertyDescriptor(
    value,
    "participantKind",
  )?.value;
  if (participantKind !== "app" && participantKind !== "agent") {
    throw new HTTPException(409, { message: "invalid_approval_evidence" });
  }
  return participantKind;
}

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
  const contractApprovalStorage: {
    listByUser?: (trellisId: string) => Promise<IdentityEnvelopeRecord[]>;
    listPage?: (
      query: { offset?: number; limit: number },
    ) => Promise<unknown[]>;
  } = opts.contractApprovalStorage;
  const approvalResolutionDeps = {
    loadUserProjection: async (userId: string) => {
      return await opts.userStorage.get(userId) ?? null;
    },
    loadDeploymentEnvelopes: async () =>
      await opts.deploymentEnvelopeStorage.listEnabled(),
    loadDeploymentGrantOverrides: async (deploymentId: string) =>
      await opts.deploymentGrantOverrideStorage.listByDeployment(deploymentId),
    loadIdentityEnvelopesByUser: async (userId: string) => {
      if (contractApprovalStorage.listByUser) {
        return await contractApprovalStorage.listByUser(userId);
      }
      const envelopes =
        await contractApprovalStorage.listPage?.({ limit: 100 }) ??
          [];
      return envelopes.filter(isIdentityEnvelopeRecord).filter((envelope) =>
        envelope.userTrellisId === userId
      );
    },
    capabilityGroupStorage: opts.capabilityGroupStorage,
  };

  async function requireApprovalResolution(pending: PendingAuth) {
    try {
      return await getApprovalResolution(
        opts.contracts,
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

  async function resolveLinkedActiveUserIdentity(args: {
    provider: string;
    subject: string;
  }) {
    const resolution = await resolveLinkedActiveUserIdentityRecord(args, {
      loadIdentityByProviderSubject: (provider, subject) =>
        opts.userIdentityStorage.getByProviderSubject(provider, subject),
      loadAccount: (userId) => opts.accountStorage.get(userId),
    });
    if (!resolution.ok) {
      throw new HTTPException(403, { message: resolution.error });
    }
    return resolution;
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
      | "/_trellis/portal/admin/bootstrap"
      | "/_trellis/portal/admin/invite"
      | "/_trellis/portal/account/link"
      | "/_trellis/portal/account/password"
      | "/_trellis/portal/users/login"
      | "/_trellis/portal/devices/activate",
  ): string {
    const base = config.web.publicOrigin ?? config.oauth.redirectBase;
    return new URL(pathname, base).toString();
  }

  async function resolveSelectedLoginPortal(
    flow: Pick<BrowserFlowRecord, "app" | "contract" | "portalId">,
  ): Promise<SelectedLoginPortal> {
    if (!opts.loginPortalStorage) return builtinLoginPortal(config);
    if (flow.portalId) {
      const selected = await opts.loginPortalStorage.getSelectedByPortalId(
        flow.portalId,
      );
      if (selected) return selected;
    }
    const contractId = flow.app?.contractId ??
      (typeof flow.contract?.id === "string" ? flow.contract.id : undefined);
    return await opts.loginPortalStorage.resolveForApp({
      ...(contractId ? { contractId } : {}),
      ...(flow.app?.origin ? { origin: flow.app.origin } : {}),
    });
  }

  function portalEntryOrigin(selected: SelectedLoginPortal): string | null {
    if (!selected.portal.entryUrl) return null;
    try {
      return new URL(selected.portal.entryUrl).origin;
    } catch {
      return null;
    }
  }

  function requireSelectedPortalOrigin(
    selected: SelectedLoginPortal,
    requestOrigin: string | undefined,
  ): void {
    if (!requestOrigin) return;
    if (!selected.portal.entryUrl) return;
    const expectedOrigin = portalEntryOrigin(selected);
    if (!expectedOrigin || requestOrigin !== expectedOrigin) {
      throw new HTTPException(403, { message: "portal_origin_mismatch" });
    }
  }

  async function resolveBrowserFlowCorsOrigin(
    flowId: string,
    requestOrigin: string | undefined,
  ): Promise<string | undefined> {
    const configuredOrigin = resolveCorsOrigin(
      requestOrigin,
      config.web.origins,
    );
    if (configuredOrigin || !requestOrigin) return configuredOrigin;

    const flow = await loadBrowserFlow(flowId);
    if (!flow) return undefined;
    const selected = await resolveSelectedLoginPortal(flow);
    return portalEntryOrigin(selected) === requestOrigin
      ? requestOrigin
      : undefined;
  }

  async function resolveBrowserFlowBindCorsOrigin(
    flowId: string,
    requestOrigin: string | undefined,
  ): Promise<string | undefined> {
    if (!requestOrigin) return undefined;

    const flow = await loadBrowserFlow(flowId);
    return flow?.app?.origin === requestOrigin ? requestOrigin : undefined;
  }

  function registrationAvailability(
    selected: SelectedLoginPortal,
  ): FlowRegistrationAvailability {
    const federatedProviders = federatedProvidersForPortal(selected);
    return {
      localIdentity: {
        available: config.auth.localIdentity.enabled &&
          selected.settings.localRegistrationEnabled,
      },
      federatedIdentity: {
        available: federatedProviders.length > 0 &&
          selected.settings.federatedRegistrationEnabled,
        providers: federatedProviders,
      },
    };
  }

  function isFederatedProviderAllowed(
    selected: SelectedLoginPortal,
    providerId: string,
  ): boolean {
    const allowed = selected.settings.allowedFederatedProviders;
    return allowed === null || allowed.includes(providerId);
  }

  function federatedProvidersForPortal(selected: SelectedLoginPortal) {
    return Object.entries(providers)
      .filter(([id]) => isFederatedProviderAllowed(selected, id))
      .map(([id, provider]) => ({
        id,
        displayName: provider.displayName,
      }));
  }

  async function resolvePortalEntryUrlForContract(
    contract: Record<string, unknown>,
  ): Promise<string | null> {
    const selected = await resolveSelectedLoginPortal({ contract });
    if (selected.portal.entryUrl) return selected.portal.entryUrl;
    const contractId = typeof contract.id === "string" ? contract.id : null;
    if (contractId) {
      const envelopes = await opts.deploymentEnvelopeStorage
        .listEnabledByContractId(contractId);
      const route = await opts.deploymentPortalRouteStorage
        .getFirstEnabledForDeployments(
          envelopes.map((envelope) => envelope.deploymentId),
        );
      if (route?.entryUrl) return route.entryUrl;
    }

    return builtinPortalEntryUrl("/_trellis/portal/users/login");
  }

  function resolveAccountFlowPortalEntryUrl(kind: AccountFlowKind): string {
    if (kind === "admin_bootstrap") {
      return builtinPortalEntryUrl("/_trellis/portal/admin/bootstrap");
    }
    if (kind === "account_invite") {
      return builtinPortalEntryUrl("/_trellis/portal/admin/invite");
    }
    if (kind === "identity_link") {
      return builtinPortalEntryUrl("/_trellis/portal/account/link");
    }
    return builtinPortalEntryUrl("/_trellis/portal/account/password");
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
      userId: session.userId,
      identity: session.identity,
      origin: session.identity.provider,
      id: session.identity.subject,
      email: session.email,
      name: session.name,
      ...(session.image ? { image: session.image } : {}),
      contractId: session.contractId,
      ...(session.app ? { app: session.app } : {}),
      sessionPublicKey: sessionKey,
      delegatedCapabilities: session.delegatedCapabilities,
      delegatedPublishSubjects: session.delegatedPublishSubjects,
      delegatedSubscribeSubjects: session.delegatedSubscribeSubjects,
      ...(session.identityEnvelope
        ? { identityEnvelope: session.identityEnvelope }
        : {}),
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
    const validatedContract = await opts.contracts.validateContract(
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
    await upsertUserProjectionInSql(opts.userStorage, {
      origin: "account",
      id: args.resolution.userId,
      name: args.resolution.userName,
      email: args.resolution.userEmail,
      active: true,
      capabilities: args.resolution.existingCapabilities,
      capabilityGroups: args.resolution.existingProjection?.capabilityGroups ??
        [],
    });

    if (args.consumePending) {
      const consumed = await args.consumePending();
      if (!consumed) {
        throw new HTTPException(400, { message: "authtoken_already_used" });
      }
    }

    let storedApproval = args.resolution.storedApproval;
    if (
      args.approvalSource === "stored_approval" &&
      !storedApproval
    ) {
      const updatedResolution = applyApprovalDecision({
        resolution: args.resolution,
        approved: true,
        answeredAt: now,
      });
      storedApproval = updatedResolution.storedApproval;
      await opts.contractApprovalStorage.put(storedApproval);
    }

    const app = args.resolution.app ?? {
      contractId: args.resolution.plan.contract.id,
    };
    const identityAnchor = storedApproval?.identityAnchor ??
      identityAnchorForApp(app, args.pendingValue.sessionKey);
    const identityEnvelopeId = storedApproval?.identityEnvelopeId ??
      identityEnvelopeIdForAnchor(args.resolution.userId, identityAnchor);

    const sessionEnsured = await ensureBoundUserSession({
      sessionStorage,
      connectionsKV,
      kick: opts.kick,
      now,
      sessionKey: args.pendingValue.sessionKey,
      userId: args.resolution.userId,
      identity: {
        identityId: args.resolution.identityId,
        provider: args.resolution.identityProvider,
        subject: args.resolution.identitySubject,
      },
      email: args.resolution.userEmail,
      name: args.resolution.userName,
      image: args.pendingValue.user.image,
      participantKind: requireUserParticipantKind(
        args.resolution.plan.approval,
      ),
      identityEnvelopeId,
      contractDigest: args.resolution.plan.digest,
      contractId: args.resolution.plan.contract.id,
      contractDisplayName: args.resolution.plan.contract.displayName,
      contractDescription: args.resolution.plan.contract.description,
      ...(args.resolution.app ? { app: args.resolution.app } : {}),
      ...(args.approvalSource
        ? { approvalSource: args.approvalSource }
        : args.resolution.effectiveApproval.kind === "stored_approval"
        ? { approvalSource: "stored_approval" as const }
        : args.resolution.effectiveApproval.kind === "deployment_grant"
        ? { approvalSource: "deployment_grant" as const }
        : {}),
      ...(args.resolution.requestedBoundary
        ? { identityEnvelope: args.resolution.requestedBoundary }
        : {}),
      delegatedCapabilities: approvalCapabilityKeys(
        args.resolution.plan.approval,
      ),
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
    const app = buildAppIdentity({
      contractId: args.plan.contract.id,
      redirectTo: args.redirectTo,
    });
    const selectedPortal = await resolveSelectedLoginPortal({
      app,
      contract: args.contract,
    });
    const portalEntryUrl = selectedPortal.portal.entryUrl ??
      builtinPortalEntryUrl("/_trellis/portal/users/login");
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
      app,
      ...(args.context ? { context: args.context } : {}),
      contract: args.plan.contract,
      portalId: selectedPortal.portal.portalId,
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
        userCapabilities: [...resolution.effectiveCapabilities].sort((
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
    federatedProvidersForPortal,
    isFederatedProviderAllowed,
    oauthCodeRequest: opts.oauthCodeRequest ?? OAuth2CodeRequest,
    oauthCodeResponse: opts.oauthCodeResponse ?? OAuth2CodeResponse,
    loadBrowserFlow,
    saveBrowserFlow,
    resolvePortalEntryUrlForContract,
    resolveAccountFlowPortalEntryUrl,
    loadCurrentUserSession,
    requireApprovalResolution,
    resolveSelectedLoginPortal,
    requireSelectedPortalOrigin,
    resolveBrowserFlowCorsOrigin,
    resolveBrowserFlowBindCorsOrigin,
    registrationAvailability,
    resolveLinkedActiveUserIdentity,
    bindResolvedUserSession,
    createFlowStartResponse,
    completePendingBind,
  };
}
