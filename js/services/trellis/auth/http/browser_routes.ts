import type { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { AsyncResult, isErr } from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ulid } from "ulid";

import { recordTrellisDuration } from "@qlever-llc/trellis/telemetry";

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
  type CookieOccurrences,
  getApprovalResolutionBlocker,
  getCookie,
  getCookieOccurrences,
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

const OAUTH_COOKIE_NAME = "trellis_oauth";
const OAUTH_AUTH_PROBE_COOKIE_NAME = "trellis_oauth_probe_auth";
const OAUTH_ROOT_PROBE_COOKIE_NAME = "trellis_oauth_probe_root";
const OAUTH_COOKIE_MAX_AGE_SECONDS = 300;

async function oauthRequestDiagnostics(c: {
  req: {
    url: string;
    header: (name: string) => string | undefined;
  };
}, fingerprintSalt?: string) {
  const userAgent = c.req.header("user-agent")?.trim();
  const clientAddress = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const clientHints = [
    c.req.header("sec-ch-ua")?.trim(),
    c.req.header("sec-ch-ua-mobile")?.trim(),
    c.req.header("sec-ch-ua-platform")?.trim(),
  ].filter((value): value is string => Boolean(value)).join("\n");

  return {
    origin: new URL(c.req.url).origin,
    forwardedHost: c.req.header("x-forwarded-host")?.trim() || undefined,
    forwardedProto: c.req.header("x-forwarded-proto")?.trim() || undefined,
    userAgentHash: userAgent && fingerprintSalt
      ? await hashKey(`oauth-user-agent:${fingerprintSalt}:${userAgent}`)
      : undefined,
    clientAddressHash: clientAddress && fingerprintSalt
      ? await hashKey(
        `oauth-client-address:${fingerprintSalt}:${clientAddress}`,
      )
      : undefined,
    clientHintsHash: clientHints && fingerprintSalt
      ? await hashKey(`oauth-client-hints:${fingerprintSalt}:${clientHints}`)
      : undefined,
  };
}

function continuityStatus(
  expected: string | undefined,
  received: string | undefined,
):
  | "matching"
  | "different"
  | "start_missing"
  | "callback_missing"
  | "unavailable" {
  if (!expected && !received) return "unavailable";
  if (!expected) return "start_missing";
  if (!received) return "callback_missing";
  return expected === received ? "matching" : "different";
}

function diagnosticCookieStatus(
  occurrences: CookieOccurrences,
  valueHashes: string[],
  expectedHash: string | undefined,
): "matching" | "different" | "missing" | "malformed" | "unavailable" {
  if (!expectedHash) return "unavailable";
  if (occurrences.occurrenceCount === 0) return "missing";
  if (occurrences.values.length === 0) return "malformed";
  return valueHashes.includes(expectedHash) ? "matching" : "different";
}

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
    emailVerified: boolean;
    displayName: string | null;
  };
  user: {
    id: string;
    origin: string;
    email?: string;
    emailVerified: boolean;
    name?: string;
    image?: string;
  };
  provider?: string;
  pendingAuthKV: AuthHttpRouteContext["opts"]["runtimeDeps"]["pendingAuthKV"];
  logger: AuthHttpRouteContext["opts"]["runtimeDeps"]["logger"];
}): Promise<PendingAuth> {
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
      emailVerified: args.user.emailVerified,
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

  return pending;
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

function stringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const property = Reflect.get(value, key);
  return typeof property === "string" && property.length > 0
    ? property
    : undefined;
}

function oauthAuthorizationErrorMessage(error: unknown): string | null {
  if (stringProperty(error, "code") !== "OAUTH_AUTHORIZATION_RESPONSE_ERROR") {
    return null;
  }

  const description = stringProperty(error, "error_description");
  const providerError = stringProperty(error, "error");
  return description
    ? `Identity provider rejected sign-in: ${description}`
    : providerError
    ? `Identity provider rejected sign-in: ${providerError}`
    : "Identity provider rejected sign-in.";
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
    const totalStartedAt = performance.now();
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

    const handlerStartedAt = performance.now();
    const result = await authStartRequestHandler({
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
    });
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - handlerStartedAt,
      { phase: "start" },
    );
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - totalStartedAt,
      { phase: "start" },
    );
    return c.json(result);
  });

  app.get("/auth/login/:provider", async (c) => {
    const providerLoginStartedAt = performance.now();
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
        return c.redirect(flow.redirectTo);
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
    const flowIdHash = await hashKey(flowId);
    const cookieProbe = randomToken(32);
    const cookieProbeHash = await hashKey(cookieProbe);
    const fingerprintSalt = randomToken(32);
    const requestDiagnostics = await oauthRequestDiagnostics(
      c,
      fingerprintSalt,
    );
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
      diagnostics: {
        version: 1,
        cookieProbeHash,
        fingerprintSalt,
        request: requestDiagnostics,
      },
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

    const secureCookie = shouldUseSecureOauthCookie(config, { logger });
    setCookie(c as CookieContext, OAUTH_COOKIE_NAME, idpParams.state, {
      maxAgeSeconds: OAUTH_COOKIE_MAX_AGE_SECONDS,
      path: "/auth",
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookie,
    });
    setCookie(c as CookieContext, OAUTH_AUTH_PROBE_COOKIE_NAME, cookieProbe, {
      maxAgeSeconds: OAUTH_COOKIE_MAX_AGE_SECONDS,
      path: "/auth",
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookie,
      append: true,
    });
    setCookie(c as CookieContext, OAUTH_ROOT_PROBE_COOKIE_NAME, cookieProbe, {
      maxAgeSeconds: OAUTH_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookie,
      append: true,
    });
    logger.info(
      {
        event: "oauth_provider_redirect_prepared",
        oauthDiagnosticVersion: 1,
        stateHash,
        flowIdHash,
        provider: c.req.param("provider"),
        requestOrigin: requestDiagnostics.origin,
        forwardedHost: requestDiagnostics.forwardedHost,
        forwardedProto: requestDiagnostics.forwardedProto,
        secureCookie,
        routeDurationMs: performance.now() - providerLoginStartedAt,
      },
      "OAuth provider redirect and continuity probes prepared",
    );

    return c.redirect(redirectUrl);
  });

  app.post("/auth/login/local", async (c) => {
    const totalStartedAt = performance.now();
    if (!config.auth.localIdentity.enabled) {
      return c.json({ error: "local_identity_disabled" }, 403);
    }

    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const body = bodyResult.take();
    if (!Value.Check(LocalLoginRequestSchema, body)) {
      return c.json({ error: "Invalid local login request" }, 400);
    }

    const request = Value.Parse(LocalLoginRequestSchema, body);
    const loadFlowStartedAt = performance.now();
    const flow = await context.loadBrowserFlow(request.flowId);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - loadFlowStartedAt,
      { phase: "local_login", authFlow: "local" },
    );
    if (!flow) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }
    if (flow.kind !== "login" || flow.expiresAt <= new Date()) {
      throw new HTTPException(404, { message: "Expired browser flow" });
    }
    if (!flow.sessionKey) {
      throw new HTTPException(400, { message: "Invalid browser flow state" });
    }
    const portalStartedAt = performance.now();
    const selectedPortal = await context.resolveSelectedLoginPortal(flow);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - portalStartedAt,
      { phase: "local_login", authFlow: "local" },
    );
    context.requireSelectedPortalOrigin(
      selectedPortal,
      c.req.header("origin"),
    );

    const identityStartedAt = performance.now();
    const identity = await opts.userIdentityStorage.getByProviderSubject(
      "local",
      request.username,
    );
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - identityStartedAt,
      { phase: "local_login", authFlow: "local" },
    );
    if (!identity) return invalidCredentialsResponse(c);

    const accountStartedAt = performance.now();
    const account = await opts.accountStorage.get(identity.userId);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - accountStartedAt,
      { phase: "local_login", authFlow: "local" },
    );
    if (!account) return invalidCredentialsResponse(c);

    const credentialStartedAt = performance.now();
    const credential = await opts.localCredentialStorage.get(
      identity.identityId,
    );
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - credentialStartedAt,
      { phase: "local_login", authFlow: "local" },
    );
    if (!credential) return invalidCredentialsResponse(c);
    const now = new Date();
    if (isLocalCredentialLocked(credential, now)) {
      return invalidCredentialsResponse(c);
    }

    const verifyStartedAt = performance.now();
    const passwordValid = await verifyLocalCredentialPassword(
      credential,
      request.password,
    );
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - verifyStartedAt,
      { phase: "local_login", authFlow: "local" },
    );
    if (!passwordValid) {
      await opts.localCredentialStorage.put(
        recordLocalCredentialLoginFailure(credential, now),
      );
      return invalidCredentialsResponse(c);
    }
    const credentialPutStartedAt = performance.now();
    await opts.localCredentialStorage.put(
      resetLocalCredentialLoginFailures(credential, now),
    );
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - credentialPutStartedAt,
      { phase: "local_login", authFlow: "local" },
    );
    if (!account.active) return c.json({ error: "user_inactive" }, 403);

    const identityPutStartedAt = performance.now();
    await opts.userIdentityStorage.put({
      ...identity,
      lastLoginAt: now.toISOString(),
    });
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - identityPutStartedAt,
      { phase: "local_login", authFlow: "local" },
    );

    const pendingStartedAt = performance.now();
    await createPendingAuthForIdentity({
      context,
      flowId: request.flowId,
      flow: { ...flow, sessionKey: flow.sessionKey },
      account,
      identity,
      user: {
        origin: "local",
        id: identity.subject,
        emailVerified: false,
      },
      provider: "local",
      pendingAuthKV,
      logger,
    });
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - pendingStartedAt,
      { phase: "local_login", authFlow: "local" },
    );

    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - totalStartedAt,
      { phase: "local_login", authFlow: "local" },
    );
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
      passwordHashingProfile: config.auth.localIdentity.passwordHashing.profile,
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
      user: {
        origin: "local",
        id: result.identity.subject,
        emailVerified: false,
      },
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

    const stateHash = await hashKey(state);
    const oauthStateEntry = await oauthStateKV.get(stateHash).take();
    const oauthStateError = isErr(oauthStateEntry)
      ? oauthStateEntry.error.toSerializable()
      : undefined;
    const oauthStateRecordStatus = !isErr(oauthStateEntry)
      ? "found"
      : oauthStateError?.context?.reason === "not found"
      ? "missing"
      : "unavailable";
    const candidateEntry = isErr(oauthStateEntry)
      ? undefined
      : oauthStateEntry as OAuthStateEntry;
    const flowIdHash = candidateEntry
      ? await hashKey(candidateEntry.value.flowId)
      : undefined;
    const expectedDiagnostics = candidateEntry?.value.kind === "browser_login"
      ? candidateEntry.value.diagnostics
      : undefined;
    const callbackRequest = await oauthRequestDiagnostics(
      c,
      expectedDiagnostics?.fingerprintSalt,
    );
    const cookieContext = c as CookieContext;
    const cookieState = getCookie(cookieContext, OAUTH_COOKIE_NAME);
    const oauthCookies = getCookieOccurrences(cookieContext, OAUTH_COOKIE_NAME);
    const authProbeCookies = getCookieOccurrences(
      cookieContext,
      OAUTH_AUTH_PROBE_COOKIE_NAME,
    );
    const rootProbeCookies = getCookieOccurrences(
      cookieContext,
      OAUTH_ROOT_PROBE_COOKIE_NAME,
    );
    const oauthCookieHashes = await Promise.all(
      oauthCookies.values.map(hashKey),
    );
    const authProbeHashes = await Promise.all(
      authProbeCookies.values.map(hashKey),
    );
    const rootProbeHashes = await Promise.all(
      rootProbeCookies.values.map(hashKey),
    );
    const oauthCookieValueHashes = [...new Set(oauthCookieHashes)].sort();
    const authProbeValueHashes = [...new Set(authProbeHashes)].sort();
    const rootProbeValueHashes = [...new Set(rootProbeHashes)].sort();
    const oauthCookieStatus = oauthCookies.occurrenceCount === 0
      ? "missing"
      : cookieState === null
      ? "malformed"
      : cookieState === state
      ? "matching"
      : "different";
    const authProbeStatus = diagnosticCookieStatus(
      authProbeCookies,
      authProbeValueHashes,
      expectedDiagnostics?.cookieProbeHash,
    );
    const rootProbeStatus = diagnosticCookieStatus(
      rootProbeCookies,
      rootProbeValueHashes,
      expectedDiagnostics?.cookieProbeHash,
    );
    const callbackDiagnostics = {
      event: "oauth_callback_cookie_diagnostics",
      oauthDiagnosticVersion: expectedDiagnostics?.version,
      stateHash,
      flowIdHash,
      provider: providerId,
      oauthStateRecordStatus,
      oauthStateAgeMs: candidateEntry
        ? Date.now() - candidateEntry.value.createdAt.getTime()
        : undefined,
      oauthCookieStatus,
      oauthCookieOccurrenceCount: oauthCookies.occurrenceCount,
      oauthCookieMalformedValueCount: oauthCookies.malformedValueCount,
      oauthCookieMatchingOccurrenceCount: oauthCookieHashes.filter((hash) =>
        hash === stateHash
      ).length,
      oauthCookieValueHashes,
      authProbeStatus,
      authProbeOccurrenceCount: authProbeCookies.occurrenceCount,
      authProbeMatchingOccurrenceCount: expectedDiagnostics
        ? authProbeHashes.filter((hash) =>
          hash === expectedDiagnostics.cookieProbeHash
        ).length
        : 0,
      authProbeMalformedValueCount: authProbeCookies.malformedValueCount,
      authProbeValueHashes,
      rootProbeStatus,
      rootProbeOccurrenceCount: rootProbeCookies.occurrenceCount,
      rootProbeMatchingOccurrenceCount: expectedDiagnostics
        ? rootProbeHashes.filter((hash) =>
          hash === expectedDiagnostics.cookieProbeHash
        ).length
        : 0,
      rootProbeMalformedValueCount: rootProbeCookies.malformedValueCount,
      rootProbeValueHashes,
      callbackOrigin: callbackRequest.origin,
      originContinuity: continuityStatus(
        expectedDiagnostics?.request.origin,
        callbackRequest.origin,
      ),
      forwardedHostContinuity: continuityStatus(
        expectedDiagnostics?.request.forwardedHost,
        callbackRequest.forwardedHost,
      ),
      forwardedProtoContinuity: continuityStatus(
        expectedDiagnostics?.request.forwardedProto,
        callbackRequest.forwardedProto,
      ),
      userAgentContinuity: continuityStatus(
        expectedDiagnostics?.request.userAgentHash,
        callbackRequest.userAgentHash,
      ),
      clientAddressContinuity: continuityStatus(
        expectedDiagnostics?.request.clientAddressHash,
        callbackRequest.clientAddressHash,
      ),
      clientHintsContinuity: continuityStatus(
        expectedDiagnostics?.request.clientHintsHash,
        callbackRequest.clientHintsHash,
      ),
    };
    if (oauthCookieStatus === "matching" && candidateEntry) {
      logger.info(callbackDiagnostics, "OAuth callback cookie diagnostics");
    } else {
      logger.warn(callbackDiagnostics, "OAuth callback cookie diagnostics");
    }
    if (!cookieState || cookieState !== state) {
      throw new HTTPException(400, { message: "OAuth cookie mismatch" });
    }

    if (isErr(oauthStateEntry)) {
      throw new HTTPException(400, { message: "Invalid or expired state" });
    }
    const oauthEntry = oauthStateEntry as OAuthStateEntry;
    const verifiedFlowIdHash = await hashKey(oauthEntry.value.flowId);
    if (oauthEntry.value.provider !== providerId) {
      throw new HTTPException(400, { message: "OAuth provider mismatch" });
    }

    const oauthDeleted = await oauthEntry.delete(true);
    if (isErr(oauthDeleted)) {
      throw new HTTPException(400, { message: "Invalid or expired state" });
    }
    setCookie(c as CookieContext, OAUTH_COOKIE_NAME, "", {
      maxAgeSeconds: 0,
      path: "/auth",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureOauthCookie(config, { logger }),
    });
    if (oauthEntry.value.kind === "browser_login") {
      const secureCookie = shouldUseSecureOauthCookie(config, { logger });
      setCookie(c as CookieContext, OAUTH_AUTH_PROBE_COOKIE_NAME, "", {
        maxAgeSeconds: 0,
        path: "/auth",
        httpOnly: true,
        sameSite: "Lax",
        secure: secureCookie,
        append: true,
      });
      setCookie(c as CookieContext, OAUTH_ROOT_PROBE_COOKIE_NAME, "", {
        maxAgeSeconds: 0,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: secureCookie,
        append: true,
      });
    }

    const tokens = await context.oauthCodeResponse(
      provider,
      url,
      state,
      oauthEntry.value.codeVerifier,
    ).catch((error) => {
      const message = oauthAuthorizationErrorMessage(error);
      if (!message) throw error;
      logger.warn(
        {
          flowIdHash: verifiedFlowIdHash,
          outcome: "provider_rejected",
          provider: providerId,
        },
        "OAuth provider rejected authorization response",
      );
      if (oauthEntry.value.kind === "browser_login") {
        return c.redirect(
          buildRedirectLocation(oauthEntry.value.redirectTo, {
            authError: message,
          }),
        );
      }
      throw new HTTPException(400, { message });
    });
    if (tokens instanceof Response) return tokens;

    const { accessToken } = tokens;

    const user = await provider.getUserInfo(accessToken);
    if (user.provider !== providerId) {
      throw new HTTPException(400, { message: "OAuth provider mismatch" });
    }
    logger.info(
      {
        flowIdHash: verifiedFlowIdHash,
        outcome: "identity_authenticated",
        provider: providerId,
      },
      "OAuth identity authenticated",
    );

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
      emailVerified: user.emailVerified,
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

    const pending = await createPendingAuthForIdentity({
      context,
      flowId,
      flow: { ...flow, sessionKey: oauthEntry.value.sessionKey },
      account: linkedUser.account,
      identity: linkedUser.identity,
      user: {
        origin: providerId,
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        image: user.picture,
      },
      pendingAuthKV,
      logger,
    });

    logger.info(
      {
        flowIdHash: verifiedFlowIdHash,
        outcome: "pending_auth_created",
        provider: providerId,
      },
      "OAuth login callback completed",
    );

    const resolution = await context.requireApprovalResolution(pending);
    if (
      resolution.effectiveApproval.answer === "approved" &&
      resolution.missingCapabilities.length === 0 &&
      getApprovalResolutionBlocker(resolution) === null
    ) {
      return c.redirect(buildRedirectLocation(pending.redirectTo, { flowId }));
    }

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
