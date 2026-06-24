import type { Hono } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import { Value } from "typebox/value";

import { isClientBootstrapProofIatFresh } from "../bootstrap/client.ts";
import { verifyDomainSig } from "../crypto.ts";
import {
  type AuthLogoutRequest,
  AuthLogoutRequestSchema,
  type AuthLogoutResponse,
  buildLogoutSignaturePayload,
  type Session,
  type UserSession,
} from "../schemas.ts";
import { terminateSession } from "../session/logout.ts";
import {
  buildProviderLogoutUrl,
  validateLogoutReturnTo,
} from "../session/provider_logout.ts";
import type { AuthHttpRouteContext } from "./route_context.ts";

type LogoutErrorCode =
  | "invalid_logout_request"
  | "invalid_return_to"
  | "invalid_logout_signature"
  | "logout_session_not_found";

type LogoutErrorStatus = 400 | 401;

type JsonResponder = {
  json: (
    body: Record<string, unknown>,
    status: LogoutErrorStatus,
  ) => Response;
};

function logoutError(
  c: JsonResponder,
  status: LogoutErrorStatus,
  error: LogoutErrorCode,
  extra: Record<string, unknown> = {},
): Response {
  return c.json({ error, ...extra }, status);
}

function logoutSignaturePayload(request: AuthLogoutRequest): string {
  return buildLogoutSignaturePayload({
    iat: request.iat,
    ...(request.providerLogout !== undefined
      ? { providerLogout: request.providerLogout }
      : {}),
    ...(request.federatedProviderLogout !== undefined
      ? { federatedProviderLogout: request.federatedProviderLogout }
      : {}),
    ...(request.returnTo !== undefined ? { returnTo: request.returnTo } : {}),
    ...(request.responseMode !== undefined
      ? { responseMode: request.responseMode }
      : {}),
  });
}

async function loadSession(
  context: AuthHttpRouteContext,
  sessionKey: string,
): Promise<Session | null> {
  return await context.opts.runtimeDeps.sessionStorage.getOneBySessionKey(
    sessionKey,
  ) ?? null;
}

function validateReturnTo(
  returnTo: string | undefined,
  session: Session,
  context: AuthHttpRouteContext,
): string | undefined | null {
  if (returnTo === undefined) return undefined;
  return validateLogoutReturnTo({
      returnTo,
      session,
      config: context.config,
    })
    ? returnTo
    : null;
}

async function providerLogoutUrl(
  request: AuthLogoutRequest,
  session: UserSession,
  returnTo: string | undefined,
  context: AuthHttpRouteContext,
): Promise<string | undefined | null> {
  if (request.providerLogout !== true) return undefined;
  const result = await buildProviderLogoutUrl({
    provider: context.providers[session.identity.provider],
    session,
    ...(returnTo !== undefined ? { returnTo } : {}),
    ...(request.federatedProviderLogout !== undefined
      ? { federated: request.federatedProviderLogout }
      : {}),
    config: context.config,
  });
  if (!result.ok) return null;
  return result.url;
}

/** Registers POST-based signed session logout HTTP endpoints. */
export function registerSessionLogoutRoutes(
  app: Hono,
  context: AuthHttpRouteContext,
): void {
  const { logger } = context.opts.runtimeDeps;

  app.post("/auth/sessions/logout", async (c) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return logoutError(c, 400, "invalid_logout_request");
    }
    const body = bodyResult.take();
    if (!Value.Check(AuthLogoutRequestSchema, body)) {
      return logoutError(c, 400, "invalid_logout_request");
    }

    const request = Value.Parse(AuthLogoutRequestSchema, body);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (!isClientBootstrapProofIatFresh(request.iat, nowSeconds)) {
      return logoutError(c, 400, "invalid_logout_request");
    }

    const signatureValid = await verifyDomainSig(
      request.sessionKey,
      "logout-session",
      logoutSignaturePayload(request),
      request.sig,
    );
    if (!signatureValid) {
      return logoutError(c, 401, "invalid_logout_signature");
    }

    const session = await loadSession(context, request.sessionKey);
    if (!session) {
      return logoutError(c, 401, "logout_session_not_found");
    }

    const returnTo = validateReturnTo(request.returnTo, session, context);
    if (returnTo === null) {
      return logoutError(c, 400, "invalid_return_to");
    }

    const providerUrl = session.type === "user"
      ? await providerLogoutUrl(request, session, returnTo, context)
      : undefined;
    if (providerUrl === null) {
      return logoutError(c, 400, "invalid_return_to");
    }

    const redirectTo = providerUrl ?? returnTo;
    await terminateSession({
      sessionKey: request.sessionKey,
      sessionStorage: context.opts.runtimeDeps.sessionStorage,
      connectionsKV: context.opts.runtimeDeps.connectionsKV,
      kick: async (serverId, clientId) => {
        try {
          await context.opts.kick(serverId, clientId);
        } catch (error) {
          logger.warn(
            { error, serverId, clientId },
            "Failed to kick app connection during HTTP logout",
          );
        }
      },
    });

    if (request.responseMode === "redirect") {
      return redirectTo ? c.redirect(redirectTo, 303) : c.body(null, 204);
    }

    const response: AuthLogoutResponse = {
      success: true,
      ...(redirectTo ? { redirectTo } : {}),
    };
    return c.json(response);
  });
}
