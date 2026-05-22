import type { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { AsyncResult, isErr } from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ulid } from "ulid";

import { planUserContractApproval } from "../approval/plan.ts";
import {
  completeAccountFlowOAuth,
  type CompleteAccountFlowOAuthError,
} from "../account_flows/oauth_completion.ts";
import { hashKey, randomToken, verifyDomainSig } from "../crypto.ts";
import {
  isLocalCredentialLocked,
  recordLocalCredentialLoginFailure,
  resetLocalCredentialLoginFailures,
} from "../local_credentials/login_attempts.ts";
import {
  validateLocalCredentialPasswordPolicy,
  verifyLocalCredentialPassword,
} from "../local_credentials/passwords.ts";
import {
  type PendingAuth,
  SessionKeySchema,
  SignatureSchema,
} from "../schemas.ts";
import { validateRedirectTo } from "../redirect.ts";
import { getApprovalResolutionErrorMessage } from "./approval_errors.ts";
import type { AuthHttpRouteContext } from "./route_context.ts";
import {
  buildRedirectLocation,
  type CookieContext,
  getCookie,
  type OAuthStateEntry,
  setCookie,
  shouldUseSecureOauthCookie,
} from "./support.ts";
import {
  buildAuthStartSignaturePayload,
  createAuthStartRequestHandler,
} from "./start_request.ts";

const JsonObjectSchema = Type.Unsafe<Record<string, unknown>>({
  type: "object",
});

const AuthStartRequestSchema = Type.Object({
  provider: Type.Optional(Type.String({ minLength: 1 })),
  redirectTo: Type.String(),
  sessionKey: SessionKeySchema,
  sig: SignatureSchema,
  contractDigest: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9_-]+$" })),
  contract: Type.Optional(JsonObjectSchema),
  context: Type.Optional(JsonObjectSchema),
});

const LocalLoginRequestSchema = Type.Object({
  flowId: Type.String({ minLength: 1 }),
  username: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
});

const LocalRegistrationRequestSchema = Type.Object({
  username: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  email: Type.String({ minLength: 1 }),
});

async function createPendingAuthForIdentity(args: {
  context: AuthHttpRouteContext;
  flowId: string;
  flow: Awaited<ReturnType<AuthHttpRouteContext["loadBrowserFlow"]>> & {
    sessionKey: string;
  };
  account: { userId: string; email: string | null; name: string | null };
  identity: {
    identityId: string;
    provider: string;
    subject: string;
    email: string | null;
    displayName: string | null;
  };
  user: {
    id: string;
    origin: string;
    email?: string;
    name?: string;
    image?: string;
  };
  provider?: string;
  pendingAuthKV: AuthHttpRouteContext["opts"]["runtimeDeps"]["pendingAuthKV"];
  logger: AuthHttpRouteContext["opts"]["runtimeDeps"]["logger"];
}) {
  const authToken = randomToken(32);
  const authTokenHash = await hashKey(authToken);
  const email = args.account.email ?? args.identity.email ?? args.user.email;
  const name = args.account.name ?? args.identity.displayName ?? args.user.name;
  const pending: PendingAuth = {
    userId: args.account.userId,
    identity: {
      identityId: args.identity.identityId,
      provider: args.identity.provider,
      subject: args.identity.subject,
    },
    user: {
      origin: args.user.origin,
      id: args.user.id,
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(args.user.image ? { image: args.user.image } : {}),
    },
    sessionKey: args.flow.sessionKey,
    redirectTo: args.flow.redirectTo ?? "",
    ...(args.flow.app ? { app: args.flow.app } : {}),
    contract: args.flow.contract ?? {},
    createdAt: new Date(),
  };

  const pendingPut = await args.pendingAuthKV.create(authTokenHash, pending);
  if (isErr(pendingPut)) {
    args.logger.error(
      { error: pendingPut.error },
      "Failed to store pending auth",
    );
    throw new HTTPException(500, { message: "Failed to store auth token" });
  }

  await args.context.saveBrowserFlow({
    ...args.flow,
    ...(args.provider ? { provider: args.provider } : {}),
    authToken,
  });
}

function accountFlowOAuthErrorStatus(
  error: CompleteAccountFlowOAuthError,
): 400 | 403 | 404 | 409 | 410 {
  switch (error) {
    case "flow_not_found":
    case "target_user_not_found":
      return 404;
    case "flow_expired":
      return 410;
    case "flow_already_consumed":
    case "admin_already_exists":
    case "identity_conflict":
    case "flow_consume_conflict":
      return 409;
    case "flow_wrong_kind":
    case "flow_missing_admin_capability":
    case "flow_missing_target_user":
    case "provider_not_allowed":
    case "target_user_inactive":
      return 403;
  }
}

function invalidCredentialsResponse(c: {
  json: (body: unknown, status?: number) => Response;
}): Response {
  return c.json({ error: "invalid_credentials" }, 403);
}

/** Registers browser login and OAuth callback HTTP endpoints. */
export function registerBrowserAuthRoutes(
  app: Hono,
  context: AuthHttpRouteContext,
): void {
  const { config, opts, providers } = context;
  const { logger, oauthStateKV, pendingAuthKV } = opts.runtimeDeps;

  const authStartRequestHandler = createAuthStartRequestHandler({
    verifyInitRequest: async (req) => {
      return verifyDomainSig(
        req.sessionKey,
        "oauth-init",
        buildAuthStartSignaturePayload(req),
        req.sig,
      );
    },
    loadCurrentUserSession: context.loadCurrentUserSession,
    getApprovalResolution: context.requireApprovalResolution,
    planContract: async (contract) => {
      try {
        return await planUserContractApproval(opts.contracts, contract);
      } catch (error) {
        const message = getApprovalResolutionErrorMessage(error);
        if (message) {
          logger.warn({ error }, "Unable to plan app approval request");
          throw new HTTPException(409, { message });
        }
        if (error instanceof Error) {
          logger.warn({ error }, "Unable to plan app approval request");
          throw new HTTPException(409, { message: error.message });
        }
        logger.error({ error }, "Failed to plan app approval request");
        throw error;
      }
    },
    resolveContract: async (req) => {
      if (!req.contractDigest) {
        throw new HTTPException(400, { message: "contract is required" });
      }

      const known = await opts.contracts.getKnownContract(req.contractDigest);
      if (known && req.contract === undefined) {
        return known;
      }
      if (req.contract === undefined) {
        throw new HTTPException(409, { message: "manifest_required" });
      }

      let validated;
      try {
        validated = await opts.contracts.validateContract(req.contract);
      } catch (error) {
        logger.warn({ error }, "Unable to validate app auth contract manifest");
        throw new HTTPException(409, { message: "invalid_manifest" });
      }
      if (validated.digest !== req.contractDigest) {
        throw new HTTPException(409, { message: "contract_digest_mismatch" });
      }

      const existingContract = await opts.contractStorage.get(validated.digest);
      if (!existingContract) {
        await opts.contractStorage.put({
          digest: validated.digest,
          id: validated.contract.id,
          displayName: validated.contract.displayName,
          description: validated.contract.description,
          installedAt: new Date(),
          contract: validated.canonical,
        });
      }
      return validated.contract;
    },
    bindApprovedSession: (args) => context.bindResolvedUserSession(args),
    createFlow: context.createFlowStartResponse,
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
    const request = Value.Parse(AuthStartRequestSchema, body);

    return c.json(
      await authStartRequestHandler({
        provider: request.provider,
        redirectTo: redirectToResult.value,
        sessionKey: request.sessionKey,
        sig: request.sig,
        ...(request.contractDigest
          ? { contractDigest: request.contractDigest }
          : {}),
        ...(request.contract ? { contract: request.contract } : {}),
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

    const flow = await context.loadBrowserFlow(flowId);
    if (!flow) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }
    if (flow.kind === "login" && flow.expiresAt <= new Date()) {
      if (flow.redirectTo) {
        return c.redirect(
          buildRedirectLocation(flow.redirectTo, { authError: "flow_expired" }),
        );
      }
      throw new HTTPException(404, { message: "Expired browser flow" });
    }
    if (flow.kind !== "login") {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }
    if (!flow.sessionKey) {
      throw new HTTPException(400, { message: "Invalid browser flow state" });
    }
    const selectedPortal = await context.resolveSelectedLoginPortal(flow);
    if (
      !context.isFederatedProviderAllowed(
        selectedPortal,
        c.req.param("provider"),
      )
    ) {
      throw new HTTPException(403, { message: "OAuth Provider not allowed" });
    }

    const [redirectUrl, idpParams] = await context.oauthCodeRequest(provider);
    const stateHash = await hashKey(idpParams.state);
    const createResult = await oauthStateKV.create(stateHash, {
      kind: "browser_login",
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

    await context.saveBrowserFlow({
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

  app.post("/auth/login/local", async (c) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const body = bodyResult.take();
    if (!Value.Check(LocalLoginRequestSchema, body)) {
      return c.json({ error: "Invalid local login request" }, 400);
    }

    const request = Value.Parse(LocalLoginRequestSchema, body);
    const flow = await context.loadBrowserFlow(request.flowId);
    if (!flow) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }
    if (flow.kind !== "login" || flow.expiresAt <= new Date()) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }
    if (!flow.sessionKey) {
      throw new HTTPException(400, { message: "Invalid browser flow state" });
    }
    const selectedPortal = await context.resolveSelectedLoginPortal(flow);
    context.requireSelectedPortalOrigin(
      selectedPortal,
      c.req.header("origin"),
    );

    const identity = await opts.userIdentityStorage.getByProviderSubject(
      "local",
      request.username,
    );
    if (!identity) return invalidCredentialsResponse(c);

    const account = await opts.accountStorage.get(identity.userId);
    if (!account) return invalidCredentialsResponse(c);

    const credential = await opts.localCredentialStorage.get(
      identity.identityId,
    );
    if (!credential) return invalidCredentialsResponse(c);
    const now = new Date();
    if (isLocalCredentialLocked(credential, now)) {
      return invalidCredentialsResponse(c);
    }

    const passwordValid = await verifyLocalCredentialPassword(
      credential,
      request.password,
    );
    if (!passwordValid) {
      await opts.localCredentialStorage.put(
        recordLocalCredentialLoginFailure(credential, now),
      );
      return invalidCredentialsResponse(c);
    }
    await opts.localCredentialStorage.put(
      resetLocalCredentialLoginFailures(credential, now),
    );
    if (!account.active) return c.json({ error: "user_inactive" }, 403);

    await opts.userIdentityStorage.put({
      ...identity,
      lastLoginAt: now.toISOString(),
    });

    await createPendingAuthForIdentity({
      context,
      flowId: request.flowId,
      flow: { ...flow, sessionKey: flow.sessionKey },
      account,
      identity,
      user: { origin: "local", id: identity.subject },
      provider: "local",
      pendingAuthKV,
      logger,
    });

    return c.json({ status: "authenticated", flowId: request.flowId });
  });

  app.post("/auth/flow/:flowId/register/local", async (c) => {
    const flowId = c.req.param("flowId");
    const flow = await context.loadBrowserFlow(flowId);
    if (!flow) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }
    if (flow.kind !== "login" || flow.expiresAt <= new Date()) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }
    if (!flow.sessionKey) {
      throw new HTTPException(400, { message: "Invalid browser flow state" });
    }
    const selectedPortal = await context.resolveSelectedLoginPortal(flow);
    context.requireSelectedPortalOrigin(
      selectedPortal,
      c.req.header("origin"),
    );

    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) return c.json({ error: "Invalid JSON body" }, 400);
    const body = bodyResult.take();
    if (!Value.Check(LocalRegistrationRequestSchema, body)) {
      return c.json({ error: "Invalid local registration request" }, 400);
    }
    if (!opts.loginPortalStorage) {
      throw new HTTPException(503, { message: "registration_unavailable" });
    }
    const registration = context.registrationAvailability(selectedPortal);
    if (!registration.localIdentity.available) {
      throw new HTTPException(403, { message: "registration_unavailable" });
    }

    const request = Value.Parse(LocalRegistrationRequestSchema, body);
    try {
      validateLocalCredentialPasswordPolicy(
        request.password,
        config.auth.localIdentity.passwordPolicy.minLength,
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Invalid password" },
        400,
      );
    }
    const result = await opts.loginPortalStorage.registerLocalIdentity({
      username: request.username,
      password: request.password,
      name: request.name,
      email: request.email,
      active: selectedPortal.settings.selfRegisteredAccountActive,
      capabilities: selectedPortal.defaultCapabilities,
      capabilityGroups: selectedPortal.defaultCapabilityGroups,
      userId: `usr_${ulid()}`,
      passwordMinLength: config.auth.localIdentity.passwordPolicy.minLength,
    });
    if (!result.ok) {
      if (result.error === "identity_conflict") {
        return c.json({ error: "username_taken" }, 409);
      }
      throw new Error("Generated user id collision during local registration");
    }

    await createPendingAuthForIdentity({
      context,
      flowId,
      flow: { ...flow, sessionKey: flow.sessionKey },
      account: result.account,
      identity: result.identity,
      user: { origin: "local", id: result.identity.subject },
      provider: "local",
      pendingAuthKV,
      logger,
    });

    return c.json({ status: "authenticated", flowId });
  });

  app.get("/auth/callback/:provider", async (c) => {
    logger.trace({}, "Handling auth provider redirect");
    const providerId = c.req.param("provider");
    const provider = providers[providerId];
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
    if (oauthEntry.value.provider !== providerId) {
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

    const { accessToken } = await context.oauthCodeResponse(
      provider,
      url,
      state,
      oauthEntry.value.codeVerifier,
    );

    const user = await provider.getUserInfo(accessToken);
    if (user.provider !== providerId) {
      throw new HTTPException(400, { message: "OAuth provider mismatch" });
    }
    logger.debug({ user: user.id }, "Authentication successful.");

    if (oauthEntry.value.kind === "account_flow") {
      const result = await completeAccountFlowOAuth({
        flowId: oauthEntry.value.flowId,
        provider: providerId,
        user,
        accountFlowStorage: opts.accountFlowStorage,
        accountStorage: opts.accountStorage,
        capabilityGroupStorage: opts.capabilityGroupStorage,
        userIdentityStorage: opts.userIdentityStorage,
      });
      if (!result.ok) {
        return c.json(
          { error: result.error },
          accountFlowOAuthErrorStatus(result.error),
        );
      }

      const flow = await opts.accountFlowStorage.get(
        await hashKey(oauthEntry.value.flowId),
      );
      const portalUrl = new URL(
        context.resolveAccountFlowPortalEntryUrl(flow?.kind ?? "identity_link"),
      );
      portalUrl.searchParams.set("flowId", oauthEntry.value.flowId);
      portalUrl.searchParams.set("status", "completed");
      portalUrl.searchParams.set("userId", result.userId);
      const returnTo = oauthEntry.value.returnTo ?? flow?.returnTo;
      if (returnTo) {
        portalUrl.searchParams.set("returnTo", returnTo);
      }
      return c.redirect(portalUrl.toString());
    }

    let linkedUser = await context.resolveLinkedActiveUserIdentity({
      provider: providerId,
      subject: user.id,
    }).catch(async (error) => {
      if (!(error instanceof HTTPException) || error.status !== 403) {
        throw error;
      }
      if (!opts.loginPortalStorage) throw error;
      const flow = await context.loadBrowserFlow(oauthEntry.value.flowId);
      if (!flow || flow.kind !== "login" || flow.expiresAt <= new Date()) {
        throw error;
      }
      const selectedPortal = await context.resolveSelectedLoginPortal(flow);
      const registration = context.registrationAvailability(selectedPortal);
      if (
        !registration.federatedIdentity.available ||
        !context.isFederatedProviderAllowed(selectedPortal, providerId)
      ) {
        throw error;
      }
      const result = await opts.loginPortalStorage.registerFederatedIdentity({
        provider: providerId,
        user,
        active: selectedPortal.settings.selfRegisteredAccountActive,
        capabilities: selectedPortal.defaultCapabilities,
        capabilityGroups: selectedPortal.defaultCapabilityGroups,
        userId: `usr_${ulid()}`,
      });
      if (!result.ok) {
        if (result.error === "account_conflict") {
          throw new Error(
            "Generated user id collision during federated registration",
          );
        }
        throw error;
      }
      return {
        account: result.account,
        identity: result.identity,
        ok: true as const,
      };
    });
    await opts.userIdentityStorage.put({
      ...linkedUser.identity,
      displayName: user.name ?? linkedUser.identity.displayName,
      email: user.email ?? linkedUser.identity.email,
      lastLoginAt: new Date().toISOString(),
    });

    const flowId = oauthEntry.value.flowId;
    if (!flowId) {
      throw new HTTPException(400, { message: "Invalid browser flow state" });
    }

    const flow = await context.loadBrowserFlow(flowId);
    if (!flow) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }

    await createPendingAuthForIdentity({
      context,
      flowId,
      flow: { ...flow, sessionKey: oauthEntry.value.sessionKey },
      account: linkedUser.account,
      identity: linkedUser.identity,
      user: {
        origin: providerId,
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.picture,
      },
      pendingAuthKV,
      logger,
    });

    const selectedPortal = await context.resolveSelectedLoginPortal(flow);
    const resolvedPortalEntryUrl = selectedPortal.portal.entryUrl ??
      (await context.resolvePortalEntryUrlForContract(flow.contract ?? {}));
    if (!resolvedPortalEntryUrl) {
      throw new HTTPException(503, {
        message: "Auth portal is not configured",
      });
    }

    const portalUrl = new URL(resolvedPortalEntryUrl);
    portalUrl.searchParams.set("flowId", flowId);
    return c.redirect(portalUrl.toString());
  });
}
