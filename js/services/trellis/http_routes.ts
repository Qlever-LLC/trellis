import type { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { HTTPException } from "@hono/hono/http-exception";
import { rateLimiter } from "@hono-rate-limiter/hono-rate-limiter";
import { AsyncResult, isErr } from "@trellis/result";
import { Value } from "typebox/value";

import { hashKey, randomToken, verifyDomainSig } from "./auth_utils.ts";
import { ensureBoundUserSession } from "./bind_session.ts";
import { type Config, getConfig } from "./config.ts";
import type { ContractStore } from "./contracts_store.ts";
import {
  bindingTokenKV,
  connectionsKV,
  contractApprovalsKV,
  logger,
  oauthStateKV,
  pendingAuthKV,
  sentinelCreds,
  sessionKV,
  usersKV,
} from "./globals.ts";
import {
  buildFragmentRedirect,
  type CookieContext,
  contractApprovalKey,
  decodeContractQuery,
  encodeBase64Url,
  getApprovalResolution,
  getCookie,
  type OAuthStateEntry,
  type PendingAuthEntry,
  renderApprovalPage,
  setCookie,
  shouldUseSecureOauthCookie,
} from "./http_auth_support.ts";
import { kick } from "./kick.ts";
import { OAuth2CodeRequest, OAuth2CodeResponse } from "./oauth.ts";
import { GitHub } from "./providers/github.ts";
import type { OAuth2Provider } from "./providers/index.ts";
import { validateRedirectTo } from "./redirect_to.ts";
import {
  BindRequestSchema,
  type BindResponse,
  LoginQuerySchema,
  type PendingAuth,
} from "./schemas.ts";
import { upsertUserProjection } from "./user_projection.ts";

const config = getConfig();

function createProviders(currentConfig: Config): Record<string, OAuth2Provider> {
  return {
    github: new GitHub(
      currentConfig.oauth.providers.github.clientId,
      currentConfig.oauth.providers.github.clientSecret,
    ),
  };
}

export function registerHttpRoutes(
  app: Hono,
  opts: {
    contractStore: ContractStore;
    providers?: Record<string, OAuth2Provider>;
  },
): void {
  const providers = opts.providers ?? createProviders(config);
  if (config.web.origins.length > 0) {
    app.use(
      "/auth/*",
      cors({
        origin: config.web.origins,
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

  app.get("/auth/login/:provider", async (c) => {
    logger.trace({}, "Initiating login with external provider.");
    const provider = providers[c.req.param("provider")];
    if (!provider) {
      throw new HTTPException(400, { message: "Unknown OAuth Provider" });
    }

    const query = {
      redirectTo: c.req.query("redirectTo"),
      sessionKey: c.req.query("sessionKey"),
      sig: c.req.query("sig"),
      contract: c.req.query("contract"),
    };
    if (!Value.Check(LoginQuerySchema, query)) {
      const errors = [...Value.Errors(LoginQuerySchema, query)];
      throw new HTTPException(400, {
        message: `Invalid request: ${errors[0]?.message ?? "validation failed"}`,
      });
    }

    const { redirectTo: rawRedirectTo, sessionKey, sig, contract: rawContract } = query;
    const redirectToResult = validateRedirectTo(rawRedirectTo, config.web.origins);
    if (!redirectToResult.ok) {
      throw new HTTPException(400, { message: redirectToResult.error });
    }
    const redirectTo = redirectToResult.value;
    if (!redirectTo || !sessionKey || !sig || !rawContract) {
      throw new HTTPException(400, { message: "Invalid request" });
    }

    let contract: Record<string, unknown>;
    try {
      contract = decodeContractQuery(rawContract);
    } catch {
      throw new HTTPException(400, { message: "Invalid contract payload" });
    }

    if (!(await verifyDomainSig(sessionKey, "oauth-init", redirectTo, sig))) {
      throw new HTTPException(400, { message: "Invalid signature" });
    }

    const [redirectUrl, idpParams] = await OAuth2CodeRequest(provider);
    const stateHash = await hashKey(idpParams.state);
    const createResult = await oauthStateKV.create(stateHash, {
      redirectTo,
      codeVerifier: idpParams.codeVerifier,
      sessionKey,
      contract,
      createdAt: new Date(),
    });
    if (isErr(createResult)) {
      logger.error({ error: createResult.error }, "Failed to store oauth state");
      throw new HTTPException(500, { message: "Failed to create oauth state" });
    }

    setCookie(c as CookieContext, "trellis_oauth", idpParams.state, {
      maxAgeSeconds: 300,
      path: "/auth",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureOauthCookie(config),
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
    const oauthStateEntry = (await oauthStateKV.get(stateHash)).take();
    if (isErr(oauthStateEntry)) {
      throw new HTTPException(400, { message: "Invalid or expired state" });
    }
    const oauthEntry = oauthStateEntry as OAuthStateEntry;

    const oauthDeleted = await oauthEntry.delete(true);
    if (isErr(oauthDeleted)) {
      throw new HTTPException(400, { message: "Invalid or expired state" });
    }
    setCookie(c as CookieContext, "trellis_oauth", "", {
      maxAgeSeconds: 0,
      path: "/auth",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureOauthCookie(config),
    });

    const { accessToken } = await OAuth2CodeResponse(
      provider,
      url,
      state,
      oauthEntry.value.codeVerifier,
    );

    const user = await provider.getUserInfo(accessToken);
    logger.debug({ user: user.id }, "Authentication successful.");

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
      contract: oauthEntry.value.contract,
      createdAt: new Date(),
    };

    const pendingPut = await pendingAuthKV.create(authTokenHash, pending);
    if (isErr(pendingPut)) {
      logger.error({ error: pendingPut.error }, "Failed to store pending auth");
      throw new HTTPException(500, { message: "Failed to store auth token" });
    }

    const resolution = await getApprovalResolution(opts.contractStore, pending);
    if (resolution.missingCapabilities.length > 0) {
      return new Response(
        renderApprovalPage({
          authToken,
          redirectTo: pending.redirectTo,
          status: "insufficient_capabilities",
          approval: resolution.plan.approval,
          missingCapabilities: resolution.missingCapabilities,
          userCapabilities: resolution.existingCapabilities,
        }),
        { headers: { "content-type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" } },
      );
    }

    if (resolution.storedApproval?.answer !== "approved") {
      return c.redirect(`/auth/approve?authToken=${encodeURIComponent(authToken)}`);
    }

    c.header("Referrer-Policy", "no-referrer");
    return c.redirect(buildFragmentRedirect(pending.redirectTo, { authToken }));
  });

  app.get("/auth/approve", async (c) => {
    const authToken = c.req.query("authToken");
    if (!authToken) {
      throw new HTTPException(400, { message: "Missing authToken" });
    }

    const pendingEntry = (await pendingAuthKV.get(await hashKey(authToken))).take();
    if (isErr(pendingEntry)) {
      throw new HTTPException(400, { message: "Invalid or expired authToken" });
    }
    const pending = (pendingEntry as PendingAuthEntry).value;
    const resolution = await getApprovalResolution(opts.contractStore, pending);

    const status = resolution.missingCapabilities.length > 0
      ? "insufficient_capabilities"
      : resolution.storedApproval?.answer === "denied"
      ? "approval_denied"
      : "approval_required";

    return new Response(
      renderApprovalPage({
        authToken,
        redirectTo: pending.redirectTo,
        status,
        approval: resolution.plan.approval,
        missingCapabilities: resolution.missingCapabilities,
        userCapabilities: resolution.existingCapabilities,
      }),
      { headers: { "content-type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" } },
    );
  });

  app.post("/auth/approve", async (c) => {
    const form = await c.req.formData();
    const authToken = form.get("authToken");
    const decision = form.get("decision");
    if (typeof authToken !== "string" || (decision !== "approved" && decision !== "denied")) {
      throw new HTTPException(400, { message: "Invalid approval request" });
    }

    const authTokenHash = await hashKey(authToken);
    const pendingEntry = (await pendingAuthKV.get(authTokenHash)).take();
    if (isErr(pendingEntry)) {
      throw new HTTPException(400, { message: "Invalid or expired authToken" });
    }
    const pending = pendingEntry as PendingAuthEntry;
    const resolution = await getApprovalResolution(opts.contractStore, pending.value);

    if (resolution.missingCapabilities.length > 0) {
      return new Response(
        renderApprovalPage({
          authToken,
          redirectTo: pending.value.redirectTo,
          status: "insufficient_capabilities",
          approval: resolution.plan.approval,
          missingCapabilities: resolution.missingCapabilities,
          userCapabilities: resolution.existingCapabilities,
        }),
        { headers: { "content-type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" } },
      );
    }

    const now = new Date();
    (await contractApprovalsKV.put(contractApprovalKey(resolution.trellisId, resolution.plan.digest), {
      userTrellisId: resolution.trellisId,
      origin: pending.value.user.origin,
      id: pending.value.user.id,
      answer: decision,
      answeredAt: now,
      updatedAt: now,
      approval: resolution.plan.approval,
      publishSubjects: resolution.plan.publishSubjects,
      subscribeSubjects: resolution.plan.subscribeSubjects,
    })).take();

    if (decision === "approved") {
      c.header("Referrer-Policy", "no-referrer");
      return c.redirect(buildFragmentRedirect(pending.value.redirectTo, { authToken }));
    }

    const pendingDeleted = await pending.delete(true);
    if (isErr(pendingDeleted)) {
      throw new HTTPException(400, { message: "authtoken_already_used" });
    }
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect(buildFragmentRedirect(pending.value.redirectTo, { authError: "approval_denied" }));
  });

  app.post("/auth/bind", async (c) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const body = bodyResult.take();

    if (!Value.Check(BindRequestSchema, body)) {
      const errors = [...Value.Errors(BindRequestSchema, body)];
      throw new HTTPException(400, {
        message: `Invalid request: ${errors[0]?.message ?? "validation failed"}`,
      });
    }

    const { authToken, sessionKey, sig } = body;
    const authTokenHash = await hashKey(authToken);
    const pendingEntry = (await pendingAuthKV.get(authTokenHash)).take();
    if (isErr(pendingEntry)) {
      throw new HTTPException(400, { message: "Invalid or expired authToken" });
    }
    const pending = pendingEntry as PendingAuthEntry;

    if (pending.value.sessionKey !== sessionKey) {
      throw new HTTPException(400, { message: "Session key mismatch" });
    }
    if (!(await verifyDomainSig(sessionKey, "bind", authToken, sig))) {
      throw new HTTPException(400, { message: "Invalid signature" });
    }

    const now = new Date();

    const resolution = await getApprovalResolution(opts.contractStore, pending.value);
    const trellisId = resolution.trellisId;
    const userEmail = resolution.userEmail;
    const userName = resolution.userName;

    if (resolution.missingCapabilities.length > 0) {
      const response = {
        status: "insufficient_capabilities",
        approval: resolution.plan.approval,
        missingCapabilities: resolution.missingCapabilities,
        userCapabilities: [...resolution.existingCapabilities].sort((left, right) => left.localeCompare(right)),
      };
      return c.json(response);
    }

    if (resolution.storedApproval?.answer !== "approved") {
      throw new HTTPException(403, {
        message: resolution.storedApproval?.answer === "denied"
          ? "approval_denied"
          : "approval_required",
      });
    }

    const pendingDeleted = await pending.delete(true);
    if (isErr(pendingDeleted)) {
      throw new HTTPException(400, { message: "authtoken_already_used" });
    }

    const sessionEnsured = await ensureBoundUserSession({
      sessionKV,
      connectionsKV,
      kick,
      now,
      sessionKey,
      trellisId,
      origin: pending.value.user.origin,
      id: pending.value.user.id,
      email: userEmail,
      name: userName,
      image: pending.value.user.image,
      contractDigest: resolution.plan.digest,
      contractId: resolution.plan.contract.id,
      contractDisplayName: resolution.plan.contract.displayName,
      contractDescription: resolution.plan.contract.description,
      contractKind: resolution.plan.contract.kind,
      delegatedCapabilities: resolution.plan.approval.capabilities,
      delegatedPublishSubjects: resolution.plan.publishSubjects,
      delegatedSubscribeSubjects: resolution.plan.subscribeSubjects,
    });
    const sessionEnsuredValue = sessionEnsured.take();
    if (isErr(sessionEnsuredValue)) {
      if (sessionEnsuredValue.error.reason === "session_already_bound") {
        throw new HTTPException(400, { message: "session_already_bound" });
      }
      logger.error({ error: sessionEnsuredValue.error }, "Failed to ensure user session during bind");
      throw new HTTPException(500, { message: "Failed to create session" });
    }

    await upsertUserProjection(usersKV, {
      origin: pending.value.user.origin,
      id: pending.value.user.id,
      name: userName,
      email: userEmail,
      active: true,
      capabilities: resolution.existingCapabilities,
    });

    const bindingToken = randomToken(32);
    const bindingTokenHash = await hashKey(bindingToken);
    const bindingExpiresAt = new Date(now.getTime() + config.ttlMs.bindingTokens.initial);
    await bindingTokenKV.put(bindingTokenHash, {
      sessionKey,
      kind: "initial",
      createdAt: now,
      expiresAt: bindingExpiresAt,
    });

    const response = {
      status: "bound",
      bindingToken,
      inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}`,
      expires: bindingExpiresAt.toISOString(),
      sentinel: sentinelCreds,
    };
    return c.json(response);
  });
}
