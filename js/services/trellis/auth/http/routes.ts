import type { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { HTTPException } from "@hono/hono/http-exception";
import { rateLimiter } from "@hono-rate-limiter/hono-rate-limiter";
import { AsyncResult, isErr } from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { hashKey, randomToken, verifyDomainSig } from "../crypto.ts";
import { ensureBoundUserSession } from "../session/bind.ts";
import { getConfig } from "../../config.ts";
import type { ContractStore } from "../../catalog/store.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import { authRuntimeDeps } from "../runtime_deps.ts";
import { getApprovalResolutionErrorMessage } from "./approval_errors.ts";
import { planUserContractApproval } from "../approval/plan.ts";
import { loadEffectiveGrantPolicies } from "../grants/store.ts";
import {
  applyApprovalDecision,
  buildAppIdentity,
  buildRedirectLocation,
  type CookieContext,
  getApprovalResolution,
  getApprovalResolutionBlocker,
  getCookie,
  type OAuthStateEntry,
  type PendingAuthEntry,
  resolveLoginPortal,
  setCookie,
  shouldUseSecureOauthCookie,
} from "./support.ts";
import { buildPortalFlowState } from "./portal_flow.ts";
import { createServiceBootstrapHandler } from "../bootstrap/service.ts";
import { createClientBootstrapHandler } from "../bootstrap/client.ts";
import {
  createDeviceBootstrapHandler,
  verifyDeviceBootstrapIdentityProof,
} from "../bootstrap/device.ts";
import { registerDeviceActivationHttpRoutes } from "../device_activation/http.ts";
import { kick } from "../callout/kick.ts";
import { buildClientTransports } from "../transports.ts";
import { OAuth2CodeRequest, OAuth2CodeResponse } from "../oauth.ts";
import type { Provider } from "../providers/index.ts";
import { createProviders } from "../providers/registry.ts";
import { resolveCorsOrigin, validateRedirectTo } from "../redirect.ts";
import {
  type PendingAuth,
  type Session,
  type SessionApprovalSource,
  type UserSession,
} from "../../state/schemas.ts";
import { upsertUserProjectionInSql } from "../session/projection.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import {
  type AuthStartBoundResponse,
  buildAuthStartSignaturePayload,
  createAuthStartRequestHandler,
  type CurrentUserSession,
} from "./start_request.ts";

function splitNatsServers(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter((entry) =>
    entry.length > 0
  );
}

function parseApprovalRequest(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== "approved") {
    return undefined;
  }
  const approved = entries[0][1];
  return typeof approved === "boolean" ? approved : undefined;
}

export function registerHttpRoutes(
  app: Hono,
  opts: {
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
    contractStore: ContractStore;
    refreshActiveContracts?: () => Promise<void>;
    providers?: Record<string, Provider>;
  },
): void {
  const config = getConfig();
  const {
    browserFlowsKV,
    connectionsKV,
    logger,
    natsTrellis,
    oauthStateKV,
    pendingAuthKV,
    sentinelCreds,
    sessionStorage,
  } = authRuntimeDeps();
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
      return await loadEffectiveGrantPolicies(contractId);
    },
  };

  function parseContractApprovalKey(
    key: string,
  ): { userTrellisId: string; contractDigest: string } | null {
    const separator = key.lastIndexOf(".");
    if (separator <= 0 || separator >= key.length - 1) return null;
    return {
      userTrellisId: key.slice(0, separator),
      contractDigest: key.slice(separator + 1),
    };
  }

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
        throw new HTTPException(409, { message });
      }
      throw error;
    }
  }

  type BrowserFlowRecord = {
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

  async function listPortals(): Promise<
    Array<{ portalId: string; entryUrl: string; disabled?: boolean }>
  > {
    return await opts.portalStorage.list();
  }

  async function listLoginPortalSelections(): Promise<
    Array<{ contractId: string; portalId: string | null }>
  > {
    return await opts.loginPortalSelectionStorage.list();
  }

  async function loadLoginPortalDefaultId(): Promise<
    string | null | undefined
  > {
    return (await opts.portalDefaultStorage.getLogin())?.portalId;
  }

  async function resolvePortalEntryUrlForContract(
    contract: Record<string, unknown>,
  ): Promise<string | null> {
    const contractId = typeof contract.id === "string" ? contract.id : null;
    const resolved = resolveLoginPortal({
      contractId: contractId ?? "",
      portals: await listPortals(),
      defaultPortalId: await loadLoginPortalDefaultId(),
      selections: await listLoginPortalSelections(),
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
    resolution: Awaited<ReturnType<typeof requireApprovalResolution>>;
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
    opts.contractStore.activate(
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
      kick,
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

  const FlowBindRequestSchema = Type.Object({
    sessionKey: Type.String({ minLength: 1 }),
    sig: Type.String({ minLength: 1 }),
  }, { additionalProperties: false });

  const AuthStartRequestSchema = Type.Object({
    provider: Type.Optional(Type.String({ minLength: 1 })),
    redirectTo: Type.String(),
    sessionKey: Type.String({ minLength: 1 }),
    sig: Type.String({ minLength: 1 }),
    contract: Type.Object({}, { additionalProperties: true }),
    context: Type.Optional(Type.Object({}, { additionalProperties: true })),
  }, { additionalProperties: false });

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

  if (config.web.origins.length > 0) {
    app.use(
      "/auth/*",
      cors({
        origin: (origin) => resolveCorsOrigin(origin, config.web.origins),
        allowMethods: ["GET", "POST", "OPTIONS"],
        credentials: true,
      }),
    );
    app.use(
      "/bootstrap/*",
      cors({
        origin: (origin) => resolveCorsOrigin(origin, config.web.origins),
        allowMethods: ["GET", "POST", "OPTIONS"],
        credentials: true,
      }),
    );
  }

  app.use(
    "/auth/*",
    rateLimiter({
      windowMs: config.httpRateLimit.windowMs,
      limit: config.httpRateLimit.max,
      keyGenerator: (c) => {
        const forwarded = c.req.header("x-forwarded-for");
        if (forwarded) {
          const first = forwarded.split(",")[0]?.trim();
          if (first) return first;
        }
        return c.req.header("x-real-ip") ??
          c.req.header("cf-connecting-ip") ??
          "unknown";
      },
    }),
  );

  app.post(
    "/bootstrap/client",
    createClientBootstrapHandler({
      contractStore: opts.contractStore,
      transports: buildClientTransports(config),
      sentinel: sentinelCreds,
      sessionStorage,
      loadUserProjection: async (trellisId) => {
        return await opts.userStorage.get(trellisId) ?? null;
      },
      loadStoredApproval: async (key) => {
        const approvalKey = parseContractApprovalKey(key);
        if (!approvalKey) return null;
        return await opts.contractApprovalStorage.get(
          approvalKey.userTrellisId,
          approvalKey.contractDigest,
        ) ?? null;
      },
      loadInstanceGrantPolicies: async (contractId: string) => {
        return await loadEffectiveGrantPolicies(contractId);
      },
      verifyIdentityProof: ({ sessionKey, iat, sig }) =>
        verifyDomainSig(sessionKey, "bootstrap-client", String(iat), sig),
    }),
  );

  app.post(
    "/bootstrap/service",
    createServiceBootstrapHandler({
      contractStore: opts.contractStore,
      nats: natsTrellis,
      transports: buildClientTransports(config),
      sentinel: sentinelCreds,
      loadServiceInstance: async (instanceKey) => {
        return await opts.serviceInstanceStorage.getByInstanceKey(
          instanceKey,
        ) ??
          null;
      },
      saveServiceInstance: async (instance) => {
        await opts.serviceInstanceStorage.put({
          ...instance,
          createdAt: instance.createdAt instanceof Date
            ? instance.createdAt.toISOString()
            : instance.createdAt,
        });
      },
      loadServiceDeployment: async (deploymentId) => {
        return await opts.serviceDeploymentStorage.get(deploymentId) ?? null;
      },
      refreshActiveContracts: opts.refreshActiveContracts ?? (async () => {}),
      verifyIdentityProof: ({ sessionKey, iat, sig }) =>
        verifyDomainSig(sessionKey, "nats-connect", String(iat), sig),
    }),
  );

  app.post(
    "/bootstrap/device",
    createDeviceBootstrapHandler({
      transports: buildClientTransports(config),
      sentinel: sentinelCreds,
      loadDeviceInstance: async (instanceId) => {
        return await opts.deviceInstanceStorage.get(instanceId) ?? null;
      },
      loadDeviceActivation: async (instanceId) => {
        return await opts.deviceActivationStorage.get(instanceId) ?? null;
      },
      loadDeviceDeployment: async (deploymentId) => {
        return await opts.deviceDeploymentStorage.get(deploymentId) ?? null;
      },
      saveDeviceInstance: async (instance) => {
        await opts.deviceInstanceStorage.put({
          ...instance,
          createdAt: instance.createdAt instanceof Date
            ? instance.createdAt.toISOString()
            : instance.createdAt,
          activatedAt: instance.activatedAt instanceof Date
            ? instance.activatedAt.toISOString()
            : instance.activatedAt,
          revokedAt: instance.revokedAt instanceof Date
            ? instance.revokedAt.toISOString()
            : instance.revokedAt,
        });
      },
      refreshActiveContracts: opts.refreshActiveContracts ?? (async () => {}),
      verifyIdentityProof: verifyDeviceBootstrapIdentityProof,
    }),
  );

  const authStartRequestHandler = createAuthStartRequestHandler({
    verifyInitRequest: async (req) => {
      return verifyDomainSig(
        req.sessionKey,
        "oauth-init",
        buildAuthStartSignaturePayload(req),
        req.sig,
      );
    },
    loadCurrentUserSession,
    getApprovalResolution: requireApprovalResolution,
    planContract: async (contract) => {
      try {
        return await planUserContractApproval(opts.contractStore, contract);
      } catch (error) {
        const message = getApprovalResolutionErrorMessage(error);
        if (message) {
          throw new HTTPException(409, { message });
        }
        if (error instanceof Error) {
          throw new HTTPException(409, { message: error.message });
        }
        throw error;
      }
    },
    bindApprovedSession: (args) => bindResolvedUserSession(args),
    createFlow: createFlowStartResponse,
  });

  app.post("/auth/requests", async (c) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const body = bodyResult.take();
    if (!Value.Check(AuthStartRequestSchema, body)) {
      const errors = [...Value.Errors(AuthStartRequestSchema, body)];
      throw new HTTPException(400, {
        message: `Invalid request: ${
          errors[0]?.message ?? "validation failed"
        }`,
      });
    }

    const redirectToResult = validateRedirectTo(
      body.redirectTo,
      config.web.origins,
    );
    if (!redirectToResult.ok) {
      throw new HTTPException(400, { message: redirectToResult.error });
    }
    if (body.provider && !providers[body.provider]) {
      throw new HTTPException(400, { message: "Unknown OAuth Provider" });
    }
    const request = Value.Parse(AuthStartRequestSchema, body) as {
      provider?: string;
      redirectTo: string;
      sessionKey: string;
      sig: string;
      contract: Record<string, unknown>;
      context?: Record<string, unknown>;
    };

    return c.json(
      await authStartRequestHandler({
        provider: request.provider,
        redirectTo: redirectToResult.value,
        sessionKey: request.sessionKey,
        sig: request.sig,
        contract: request.contract,
        ...(request.context ? { context: request.context } : {}),
      }, {
        authUrl: new URL(c.req.url).origin,
      }),
    );
  });

  app.get("/auth/login/:provider", async (c) => {
    logger.trace({}, "Initiating login with external provider.");
    const provider = providers[c.req.param("provider")];
    if (!provider) {
      throw new HTTPException(400, { message: "Unknown OAuth Provider" });
    }

    const flowId = c.req.query("flowId");
    if (!flowId) {
      throw new HTTPException(400, { message: "Missing flowId" });
    }

    const flow = await loadBrowserFlow(flowId);
    if (!flow) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }

    const [redirectUrl, idpParams] = await OAuth2CodeRequest(provider);
    const stateHash = await hashKey(idpParams.state);
    const createResult = await oauthStateKV.create(stateHash, {
      provider: c.req.param("provider"),
      flowId,
      redirectTo: flow.redirectTo ?? "",
      codeVerifier: idpParams.codeVerifier,
      sessionKey: flow.sessionKey,
      app: flow.app,
      context: flow.context,
      contract: flow.contract,
      createdAt: new Date(),
    });
    if (isErr(createResult)) {
      logger.error(
        { error: createResult.error },
        "Failed to store oauth state",
      );
      throw new HTTPException(500, { message: "Failed to create oauth state" });
    }

    await saveBrowserFlow({
      ...flow,
      provider: c.req.param("provider"),
    });

    setCookie(c as CookieContext, "trellis_oauth", idpParams.state, {
      maxAgeSeconds: 300,
      path: "/auth",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureOauthCookie(config, { logger }),
    });

    return c.redirect(redirectUrl);
  });

  app.get("/auth/callback/:provider", async (c) => {
    logger.trace({}, "Handling auth provider redirect");
    const provider = providers[c.req.param("provider")];
    if (!provider) {
      throw new HTTPException(404, { message: "Unknown OAuth Provider" });
    }

    const url = new URL(c.req.url);
    const state = url.searchParams.get("state");
    if (!state) {
      throw new HTTPException(400, { message: "Missing state parameter" });
    }

    const cookieState = getCookie(c as CookieContext, "trellis_oauth");
    if (!cookieState || cookieState !== state) {
      throw new HTTPException(400, { message: "OAuth cookie mismatch" });
    }

    const stateHash = await hashKey(state);
    const oauthStateEntry = await oauthStateKV.get(stateHash).take();
    if (isErr(oauthStateEntry)) {
      throw new HTTPException(400, { message: "Invalid or expired state" });
    }
    const oauthEntry = oauthStateEntry as OAuthStateEntry;
    if (oauthEntry.value.provider !== c.req.param("provider")) {
      throw new HTTPException(400, { message: "OAuth provider mismatch" });
    }

    const oauthDeleted = await oauthEntry.delete(true);
    if (isErr(oauthDeleted)) {
      throw new HTTPException(400, { message: "Invalid or expired state" });
    }
    setCookie(c as CookieContext, "trellis_oauth", "", {
      maxAgeSeconds: 0,
      path: "/auth",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureOauthCookie(config, { logger }),
    });

    const { accessToken } = await OAuth2CodeResponse(
      provider,
      url,
      state,
      oauthEntry.value.codeVerifier,
    );

    const user = await provider.getUserInfo(accessToken);
    logger.debug({ user: user.id }, "Authentication successful.");

    await upsertUserProjectionInSql(opts.userStorage, {
      origin: user.provider,
      id: user.id,
      name: user.name,
      email: user.email,
      active: true,
      capabilities: [],
    });

    const authToken = randomToken(32);
    const authTokenHash = await hashKey(authToken);
    const pending: PendingAuth = {
      user: {
        origin: user.provider,
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.picture,
      },
      sessionKey: oauthEntry.value.sessionKey,
      redirectTo: oauthEntry.value.redirectTo,
      ...(oauthEntry.value.app ? { app: oauthEntry.value.app } : {}),
      contract: oauthEntry.value.contract,
      createdAt: new Date(),
    };

    const pendingPut = await pendingAuthKV.create(authTokenHash, pending);
    if (isErr(pendingPut)) {
      logger.error({ error: pendingPut.error }, "Failed to store pending auth");
      throw new HTTPException(500, { message: "Failed to store auth token" });
    }

    const flowId = oauthEntry.value.flowId;
    if (!flowId) {
      throw new HTTPException(400, { message: "Invalid browser flow state" });
    }

    const flow = await loadBrowserFlow(flowId);
    if (!flow) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }

    await saveBrowserFlow({
      ...flow,
      authToken,
    });

    const contract = flow.contract ?? {};
    const portalEntryUrl = await resolvePortalEntryUrlForContract(contract);
    if (!portalEntryUrl) {
      throw new HTTPException(503, {
        message: "Auth portal is not configured",
      });
    }

    const portalUrl = new URL(portalEntryUrl);
    portalUrl.searchParams.set("flowId", flowId);
    return c.redirect(portalUrl.toString());
  });

  app.get("/auth/flow/:flowId", async (c) => {
    const flowId = c.req.param("flowId");
    const flow = await loadBrowserFlow(flowId);
    if (!flow) {
      return c.json({ status: "expired" });
    }

    const providersList = Object.entries(providers).map(([id, provider]) => ({
      id,
      displayName: provider.displayName,
    }));
    const contract = flow.contract ?? {};
    let resolution = null;
    let redirectLocation = undefined;
    let returnLocation = undefined;
    if (flow.authToken) {
      const pendingEntry = await pendingAuthKV.get(
        await hashKey(flow.authToken),
      ).take();
      if (!isErr(pendingEntry)) {
        const pending = pendingEntry.value as PendingAuth;
        resolution = await requireApprovalResolution(pending);
        returnLocation = buildRedirectLocation(pending.redirectTo, { flowId });
        if (
          resolution.effectiveApproval.answer === "approved" &&
          resolution.missingCapabilities.length === 0 &&
          !getApprovalResolutionBlocker(resolution)
        ) {
          redirectLocation = buildRedirectLocation(pending.redirectTo, {
            flowId,
          });
        }
      }
    }

    const appMeta = {
      contractId: typeof contract["id"] === "string" &&
          contract["id"].length > 0
        ? contract["id"]
        : "unknown",
      contractDigest: resolution?.plan.digest ??
        (typeof contract["digest"] === "string" && contract["digest"].length > 0
          ? contract["digest"]
          : "unknown"),
      displayName: typeof contract["displayName"] === "string" &&
          contract["displayName"].length > 0
        ? contract["displayName"]
        : config.instanceName,
      description: typeof contract["description"] === "string" &&
          contract["description"].length > 0
        ? contract["description"]
        : config.instanceName,
      ...(flow.context ? { context: flow.context } : {}),
    };

    return c.json(
      await buildPortalFlowState({
        flowId,
        flow,
        app: appMeta,
        providers: providersList,
        resolution,
        redirectLocation,
        returnLocation,
      }),
    );
  });

  app.post("/auth/flow/:flowId/approval", async (c) => {
    const flowId = c.req.param("flowId");
    const flow = await loadBrowserFlow(flowId);
    if (!flow || !flow.authToken) {
      return c.json({ status: "expired" });
    }

    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const approved = parseApprovalRequest(bodyResult.take());
    if (approved === undefined) {
      return c.json({ error: "Invalid approval request" }, 400);
    }

    const authTokenHash = await hashKey(flow.authToken);
    const pendingEntry = await pendingAuthKV.get(authTokenHash).take();
    if (isErr(pendingEntry)) {
      return c.json({ status: "expired" });
    }
    const pending = pendingEntry.value as PendingAuth;
    const resolution = await requireApprovalResolution(pending);
    const providersList = Object.entries(providers).map(([id, provider]) => ({
      id,
      displayName: provider.displayName,
    }));
    const contract = flow.contract ?? {};
    const appMeta = {
      contractId: typeof contract["id"] === "string" &&
          contract["id"].length > 0
        ? contract["id"]
        : "unknown",
      contractDigest: resolution.plan.digest ??
        (typeof contract["digest"] === "string" && contract["digest"].length > 0
          ? contract["digest"]
          : "unknown"),
      displayName: typeof contract["displayName"] === "string" &&
          contract["displayName"].length > 0
        ? contract["displayName"]
        : config.instanceName,
      description: typeof contract["description"] === "string" &&
          contract["description"].length > 0
        ? contract["description"]
        : config.instanceName,
      ...(flow.context ? { context: flow.context } : {}),
    };
    const returnLocation = buildRedirectLocation(pending.redirectTo, {
      flowId,
    });

    if (
      resolution.effectiveApproval.kind === "admin_policy" ||
      resolution.effectiveApproval.kind === "portal_profile"
    ) {
      return c.json(
        await buildPortalFlowState({
          flowId,
          flow,
          app: appMeta,
          providers: providersList,
          resolution,
          ...(resolution.missingCapabilities.length === 0 &&
              !getApprovalResolutionBlocker(resolution)
            ? {
              redirectLocation: buildRedirectLocation(pending.redirectTo, {
                flowId,
              }),
            }
            : { returnLocation }),
        }),
      );
    }

    if (resolution.missingCapabilities.length > 0) {
      return c.json(
        await buildPortalFlowState({
          flowId,
          flow,
          app: appMeta,
          providers: providersList,
          resolution,
          returnLocation,
        }),
      );
    }

    const now = new Date();
    const updatedResolution = applyApprovalDecision({
      resolution,
      approved,
      answeredAt: now,
    });
    await opts.contractApprovalStorage.put(updatedResolution.storedApproval);

    if (!approved) {
      return c.json(
        await buildPortalFlowState({
          flowId,
          flow,
          app: appMeta,
          providers: providersList,
          resolution: updatedResolution,
          returnLocation,
        }),
      );
    }

    return c.json(
      await buildPortalFlowState({
        flowId,
        flow,
        app: appMeta,
        providers: providersList,
        resolution: updatedResolution,
        redirectLocation: buildRedirectLocation(pending.redirectTo, { flowId }),
      }),
    );
  });

  registerDeviceActivationHttpRoutes(app, {
    portalStorage: opts.portalStorage,
    portalDefaultStorage: opts.portalDefaultStorage,
    devicePortalSelectionStorage: opts.devicePortalSelectionStorage,
  });

  app.post("/auth/flow/:flowId/bind", async (c) => {
    const flowId = c.req.param("flowId");
    const flow = await loadBrowserFlow(flowId);
    if (!flow || !flow.authToken) {
      return c.json({ status: "expired" });
    }

    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const body = bodyResult.take();
    if (!Value.Check(FlowBindRequestSchema, body)) {
      return c.json({ error: "Invalid bind request" }, 400);
    }

    const { sessionKey, sig } = body as {
      sessionKey: string;
      sig: string;
    };
    const pendingEntry = await pendingAuthKV.get(await hashKey(flow.authToken))
      .take();
    if (isErr(pendingEntry)) {
      return c.json({ status: "expired" });
    }
    const pending = pendingEntry as PendingAuthEntry;
    const pendingValue = pending.value as PendingAuth;

    if (pendingValue.sessionKey !== sessionKey) {
      throw new HTTPException(400, { message: "Session key mismatch" });
    }
    if (!(await verifyDomainSig(sessionKey, "bind-flow", flowId, sig))) {
      throw new HTTPException(400, { message: "Invalid signature" });
    }

    return c.json(
      await completePendingBind({ pending, pendingValue, sessionKey }),
    );
  });
}
