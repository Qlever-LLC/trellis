import type { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { AsyncResult, isErr } from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";

import {
  completeAdminBootstrapLocalPassword,
  type CompleteAdminBootstrapLocalPasswordError,
} from "../account_flows/local_password_completion.ts";
import { hashKey } from "../crypto.ts";
import type { AccountFlow, UserAccount } from "../schemas.ts";
import type { AuthHttpRouteContext } from "./route_context.ts";
import {
  type CookieContext,
  setCookie,
  shouldUseSecureOauthCookie,
} from "./support.ts";

const localLoginProvider = {
  id: "local",
  displayName: "Username and password",
};

const AdminBootstrapLocalPasswordRequestSchema = Type.Object({
  username: Type.Optional(Type.String({ minLength: 1 })),
  password: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String({ minLength: 1 })),
  email: Type.Optional(Type.String({ minLength: 1 })),
});

function completionErrorStatus(
  error: CompleteAdminBootstrapLocalPasswordError,
): 400 | 403 | 404 | 409 | 410 {
  switch (error) {
    case "flow_not_found":
      return 404;
    case "flow_expired":
      return 410;
    case "admin_already_exists":
    case "local_identity_exists":
    case "flow_already_consumed":
    case "flow_consume_conflict":
      return 409;
    case "target_user_not_found":
      return 404;
    case "flow_wrong_kind":
    case "flow_missing_admin_capability":
    case "flow_missing_target_user":
    case "flow_missing_local_identity":
    case "local_provider_not_allowed":
    case "target_user_inactive":
      return 403;
    case "local_username_mismatch":
    case "local_password_too_short":
      return 400;
  }
}

function completionErrorBody(
  error: CompleteAdminBootstrapLocalPasswordError,
  passwordMinLength: number,
): { error: CompleteAdminBootstrapLocalPasswordError; minLength?: number } {
  return error === "local_password_too_short"
    ? { error, minLength: passwordMinLength }
    : { error };
}

function flowBase(flow: AccountFlow) {
  return {
    kind: flow.kind,
    ...(flow.targetUserId === null ? {} : { targetUserId: flow.targetUserId }),
    ...(flow.returnTo ? { returnTo: flow.returnTo } : {}),
  };
}

function buildAccountFlowProviders(
  flow: AccountFlow,
  providers: AuthHttpRouteContext["providers"],
  options: { includeLocal?: boolean } = {},
) {
  const allowedProviders = flow.allowedProviders === null
    ? null
    : new Set(flow.allowedProviders);
  const includeLocal = allowedProviders === null ||
    allowedProviders.has("local");
  const oauthProviders = Object.entries(providers)
    .filter(([id]) => allowedProviders === null || allowedProviders.has(id))
    .map(([id, provider]) => ({ id, displayName: provider.displayName }));

  return includeLocal && options.includeLocal !== false
    ? [localLoginProvider, ...oauthProviders]
    : oauthProviders;
}

function buildTargetSummary(account: UserAccount) {
  return {
    userId: account.userId,
    ...(account.name === null ? {} : { name: account.name }),
    ...(account.email === null ? {} : { email: account.email }),
    active: account.active,
  };
}

function assertAccountFlowProviderStartAllowed(
  flow: AccountFlow,
  providerId: string,
): void {
  if (flow.consumedAt !== null) {
    throw new HTTPException(409, { message: "flow_already_consumed" });
  }
  if (new Date(flow.expiresAt).getTime() <= Date.now()) {
    throw new HTTPException(410, { message: "flow_expired" });
  }
  if (flow.kind === "local_password_reset") {
    throw new HTTPException(403, { message: "flow_wrong_kind" });
  }
  if (
    flow.allowedProviders !== null &&
    !flow.allowedProviders.includes(providerId)
  ) {
    throw new HTTPException(403, { message: "provider_not_allowed" });
  }
}

async function buildActiveAccountFlowState(
  flowId: string,
  flow: AccountFlow,
  context: AuthHttpRouteContext,
) {
  const target = flow.targetUserId === null
    ? undefined
    : await context.opts.accountStorage.get(flow.targetUserId);
  const targetAlreadyHasLocalIdentity = flow.kind === "identity_link" && target
    ? (await context.opts.userIdentityStorage.listByUser(target.userId)).some(
      (identity) => identity.provider === "local",
    )
    : false;

  return {
    status: "active",
    flowId,
    ...flowBase(flow),
    allowedProviders: flow.allowedProviders,
    profileHint: flow.kind === "local_password_reset" ? null : flow.profileHint,
    expiresAt: flow.expiresAt,
    passwordPolicy: {
      minLength: context.config.auth.localIdentity.passwordPolicy.minLength,
    },
    providers: buildAccountFlowProviders(flow, context.providers, {
      includeLocal: !targetAlreadyHasLocalIdentity,
    }),
    ...(target ? { target: buildTargetSummary(target) } : {}),
  };
}

/** Registers durable account-flow completion HTTP endpoints. */
export function registerAccountFlowRoutes(
  app: Hono,
  context: AuthHttpRouteContext,
): void {
  const { config, opts, providers } = context;
  const { logger, oauthStateKV } = opts.runtimeDeps;

  app.get("/auth/account-flow/:flowId", async (c) => {
    const flowId = c.req.param("flowId");
    const flow = await opts.accountFlowStorage.get(await hashKey(flowId));
    if (!flow) return c.json({ status: "expired" });

    if (flow.consumedAt !== null) {
      return c.json({ status: "consumed", ...flowBase(flow) });
    }

    if (new Date(flow.expiresAt).getTime() <= Date.now()) {
      return c.json({ status: "expired", ...flowBase(flow) });
    }

    return c.json(await buildActiveAccountFlowState(flowId, flow, context));
  });

  app.post("/auth/account-flow/:flowId/local-password", async (c) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) return c.json({ error: "Invalid JSON body" }, 400);

    const body = bodyResult.take();
    if (!Value.Check(AdminBootstrapLocalPasswordRequestSchema, body)) {
      return c.json({ error: "Invalid account flow request" }, 400);
    }
    const request = Value.Parse(AdminBootstrapLocalPasswordRequestSchema, body);
    const result = await completeAdminBootstrapLocalPassword({
      flowId: c.req.param("flowId"),
      username: request.username,
      password: request.password,
      passwordMinLength: config.auth.localIdentity.passwordPolicy.minLength,
      passwordHashingProfile: config.auth.localIdentity.passwordHashing.profile,
      ...(request.name ? { name: request.name } : {}),
      ...(request.email ? { email: request.email } : {}),
      accountFlowStorage: opts.accountFlowStorage,
      accountStorage: opts.accountStorage,
      capabilityGroupStorage: opts.capabilityGroupStorage,
      userIdentityStorage: opts.userIdentityStorage,
      localCredentialStorage: opts.localCredentialStorage,
      sessionStorage: opts.runtimeDeps.sessionStorage,
      connectionsKV: opts.runtimeDeps.connectionsKV,
      kick: opts.kick,
      publishSessionRevoked: async (event) => {
        (await opts.runtimeDeps.trellis.event.auth.sessionsRevoked.publish(
          event,
        )).inspectErr((error) =>
          logger.warn({ error }, "Failed to publish Auth.Sessions.Revoked")
        );
      },
    });

    if (!result.ok) {
      return c.json(
        completionErrorBody(
          result.error,
          config.auth.localIdentity.passwordPolicy.minLength,
        ),
        completionErrorStatus(result.error),
      );
    }

    const flow = await opts.accountFlowStorage.get(
      await hashKey(c.req.param("flowId")),
    );
    return c.json({
      status: "created",
      userId: result.userId,
      ...(flow?.returnTo ? { returnTo: flow.returnTo } : {}),
    });
  });

  app.get("/auth/account-flow/:flowId/login/:provider", async (c) => {
    const providerId = c.req.param("provider");
    if (providerId === "local") {
      throw new HTTPException(400, { message: "Local provider is not OAuth" });
    }
    const provider = providers[providerId];
    if (!provider) {
      throw new HTTPException(400, { message: "Unknown OAuth Provider" });
    }

    const flowId = c.req.param("flowId");
    const flow = await opts.accountFlowStorage.get(await hashKey(flowId));
    if (!flow) throw new HTTPException(404, { message: "flow_not_found" });
    assertAccountFlowProviderStartAllowed(flow, providerId);

    const [redirectUrl, idpParams] = await context.oauthCodeRequest(provider);
    const stateHash = await hashKey(idpParams.state);
    const createResult = await oauthStateKV.create(stateHash, {
      kind: "account_flow",
      provider: providerId,
      flowId,
      ...(flow.returnTo ? { returnTo: flow.returnTo } : {}),
      codeVerifier: idpParams.codeVerifier,
      createdAt: new Date(),
    });
    if (isErr(createResult)) {
      logger.error(
        { error: createResult.error },
        "Failed to store account-flow oauth state",
      );
      throw new HTTPException(500, { message: "Failed to create oauth state" });
    }

    setCookie(c as CookieContext, "trellis_oauth", idpParams.state, {
      maxAgeSeconds: 300,
      path: "/auth",
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureOauthCookie(config, { logger }),
    });

    return c.redirect(redirectUrl);
  });
}
