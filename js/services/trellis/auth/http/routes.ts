import type { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { rateLimiter } from "@hono-rate-limiter/hono-rate-limiter";

import { registerDeviceActivationHttpRoutes } from "../device_activation/http.ts";
import { resolveCorsOrigin } from "../redirect.ts";
import { registerBootstrapRoutes } from "./bootstrap_routes.ts";
import { registerBrowserAuthRoutes } from "./browser_routes.ts";
import { registerFlowRoutes } from "./flow_routes.ts";
import {
  type AuthHttpRouteOptions,
  createAuthHttpRouteContext,
} from "./route_context.ts";

type RateLimitContext = {
  env?: unknown;
  req?: { header: (name: string) => string | undefined };
};

function remoteAddressFromEnv(env: unknown): string | null {
  if (!env || typeof env !== "object") return null;
  if (!("remoteAddr" in env)) return null;
  const remoteAddr = env.remoteAddr;
  if (typeof remoteAddr === "string" && remoteAddr.length > 0) {
    return remoteAddr;
  }
  if (!remoteAddr || typeof remoteAddr !== "object") return null;
  if (!("hostname" in remoteAddr)) return null;
  return typeof remoteAddr.hostname === "string" &&
      remoteAddr.hostname.length > 0
    ? remoteAddr.hostname
    : null;
}

export function authHttpRateLimitKey(c: RateLimitContext): string {
  return remoteAddressFromEnv(c.env) ?? "trellis-auth-http";
}

export function registerHttpRoutes(
  app: Hono,
  opts: AuthHttpRouteOptions,
): void {
  const { config } = opts;
  const context = createAuthHttpRouteContext(opts);

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

  if (config.httpRateLimit.max > 0) {
    app.use(
      "/auth/*",
      rateLimiter({
        windowMs: config.httpRateLimit.windowMs,
        limit: config.httpRateLimit.max,
        keyGenerator: authHttpRateLimitKey,
      }),
    );
  }

  registerBootstrapRoutes(app, context);
  registerBrowserAuthRoutes(app, context);
  registerDeviceActivationHttpRoutes(app, {
    portalStorage: opts.portalStorage,
    portalDefaultStorage: opts.portalDefaultStorage,
    devicePortalSelectionStorage: opts.devicePortalSelectionStorage,
    browserFlowsKV: opts.runtimeDeps.browserFlowsKV,
    deviceActivationReviewStorage: opts.deviceActivationReviewStorage,
    deviceActivationStorage: opts.deviceActivationStorage,
    deviceDeploymentStorage: opts.deviceDeploymentStorage,
    deviceInstanceStorage: opts.deviceInstanceStorage,
    deviceProvisioningSecretStorage: opts.deviceProvisioningSecretStorage,
    logger: opts.runtimeDeps.logger,
    sentinelCreds: opts.runtimeDeps.sentinelCreds,
    config,
  });
  registerFlowRoutes(app, context);
}
