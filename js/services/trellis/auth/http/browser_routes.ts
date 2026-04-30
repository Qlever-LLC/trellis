import type { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { AsyncResult, isErr } from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { planUserContractApproval } from "../approval/plan.ts";
import { hashKey, randomToken, verifyDomainSig } from "../crypto.ts";
import { OAuth2CodeRequest, OAuth2CodeResponse } from "../oauth.ts";
import {
  type PendingAuth,
  SessionKeySchema,
  SignatureSchema,
} from "../schemas.ts";
import { upsertUserProjectionInSql } from "../session/projection.ts";
import { validateRedirectTo } from "../redirect.ts";
import { getApprovalResolutionErrorMessage } from "./approval_errors.ts";
import type { AuthHttpRouteContext } from "./route_context.ts";
import {
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
  contract: JsonObjectSchema,
  context: Type.Optional(JsonObjectSchema),
});

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
        return await planUserContractApproval(opts.contractStore, contract);
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

    const flow = await context.loadBrowserFlow(flowId);
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

    const flow = await context.loadBrowserFlow(flowId);
    if (!flow) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }

    await context.saveBrowserFlow({
      ...flow,
      authToken,
    });

    const contract = flow.contract ?? {};
    const portalEntryUrl = await context.resolvePortalEntryUrlForContract(
      contract,
    );
    if (!portalEntryUrl) {
      throw new HTTPException(503, {
        message: "Auth portal is not configured",
      });
    }

    const portalUrl = new URL(portalEntryUrl);
    portalUrl.searchParams.set("flowId", flowId);
    return c.redirect(portalUrl.toString());
  });
}
