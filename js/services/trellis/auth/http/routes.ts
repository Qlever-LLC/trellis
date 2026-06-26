import type { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { rateLimiter } from "@hono-rate-limiter/hono-rate-limiter";

import { registerDeviceActivationHttpRoutes } from "../device_activation/http.ts";
import { resolveCorsOrigin } from "../redirect.ts";
import { registerAccountFlowRoutes } from "./account_flow_routes.ts";
import { registerBootstrapRoutes } from "./bootstrap_routes.ts";
import { registerBrowserAuthRoutes } from "./browser_routes.ts";
import { registerFlowRoutes } from "./flow_routes.ts";
import {
  type AuthHttpRouteOptions,
  createAuthHttpRouteContext,
} from "./route_context.ts";
import { registerSessionLogoutRoutes } from "./session_logout_routes.ts";

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

function browserFlowPortalEndpointFlowId(
  pathname: string,
  method: string,
): string | undefined {
  const prefix = "/auth/flow/";
  if (!pathname.startsWith(prefix)) return undefined;
  const parts = pathname.slice(prefix.length).split("/");
  if (parts.length > 3) return undefined;
  if (parts.length === 1 && method !== "GET") return undefined;
  if (
    parts.length === 2 &&
    (parts[1] !== "approval" || (method !== "POST" && method !== "OPTIONS"))
  ) {
    return undefined;
  }
  if (
    parts.length === 3 &&
    (parts[1] !== "register" || parts[2] !== "local" ||
      (method !== "POST" && method !== "OPTIONS"))
  ) {
    return undefined;
  }
  const flowId = parts[0];
  if (!flowId) return undefined;
  try {
    return decodeURIComponent(flowId);
  } catch {
    return undefined;
  }
}

function browserFlowBindEndpointFlowId(
  pathname: string,
  method: string,
): string | undefined {
  const prefix = "/auth/flow/";
  if (!pathname.startsWith(prefix)) return undefined;
  if (method !== "POST" && method !== "OPTIONS") return undefined;

  const parts = pathname.slice(prefix.length).split("/");
  if (parts.length !== 2 || parts[1] !== "bind") return undefined;
  const flowId = parts[0];
  if (!flowId) return undefined;
  try {
    return decodeURIComponent(flowId);
  } catch {
    return undefined;
  }
}

function setCorsHeaders(
  c: {
    header: (name: string, value: string) => void;
    req: RateLimitContext["req"];
  },
  origin: string,
): void {
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  c.header("Vary", "Origin");
  const requestHeaders = c.req?.header("access-control-request-headers");
  if (requestHeaders) {
    c.header("Access-Control-Allow-Headers", requestHeaders);
  }
}

function globalAuthCorsOptions(origins: readonly string[]) {
  if (origins.includes("*")) {
    return {
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: false,
    };
  }
  return {
    origin: (origin: string) => resolveCorsOrigin(origin, origins),
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  };
}

function shouldUseHsts(config: AuthHttpRouteOptions["config"]): boolean {
  const publicLocation = config.web.publicOrigin ?? config.oauth.redirectBase;
  try {
    return new URL(publicLocation).protocol === "https:";
  } catch {
    return false;
  }
}

function setSecurityHeaders(
  c: { header: (name: string, value: string) => void },
  config: AuthHttpRouteOptions["config"],
): void {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
    ].join("; "),
  );
  if (shouldUseHsts(config)) {
    c.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
}

function isRouteScopedBrowserFlowCors(
  pathname: string,
  method: string,
): boolean {
  if (pathname === "/auth/login/local") return true;
  return browserFlowPortalEndpointFlowId(pathname, method) !== undefined ||
    pathname.startsWith("/auth/flow/");
}

export function registerHttpRoutes(
  app: Hono,
  opts: AuthHttpRouteOptions,
): void {
  const { config } = opts;
  const context = createAuthHttpRouteContext(opts);

  const securityHeaders = async (
    c: { header: (name: string, value: string) => void },
    next: () => Promise<void>,
  ) => {
    setSecurityHeaders(c, config);
    await next();
  };

  app.use("/auth/*", securityHeaders);
  app.use("/bootstrap/*", securityHeaders);

  app.use("/auth/login/local", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin) {
      // The flow id is in the POST body, so preflight cannot be narrowed here.
      // The route validates the selected portal origin after loading the flow.
      setCorsHeaders(c, origin);
      if (c.req.method === "OPTIONS") return c.body(null, 204);
    }
    await next();
  });

  app.use("/auth/flow/*", async (c, next) => {
    const flowId = browserFlowPortalEndpointFlowId(
      new URL(c.req.url).pathname,
      c.req.method,
    );
    if (!flowId) {
      await next();
      return;
    }
    const origin = await context.resolveBrowserFlowCorsOrigin(
      flowId,
      c.req.header("origin"),
    );
    if (origin) {
      setCorsHeaders(c, origin);
      if (c.req.method === "OPTIONS") {
        return c.body(null, 204);
      }
    }
    await next();
  });

  app.use("/auth/flow/*", async (c, next) => {
    const flowId = browserFlowBindEndpointFlowId(
      new URL(c.req.url).pathname,
      c.req.method,
    );
    if (!flowId) {
      await next();
      return;
    }
    const origin = await context.resolveBrowserFlowBindCorsOrigin(
      flowId,
      c.req.header("origin"),
    );
    if (origin) {
      setCorsHeaders(c, origin);
      if (c.req.method === "OPTIONS") {
        return c.body(null, 204);
      }
    }
    await next();
  });

  {
    const corsOptions = globalAuthCorsOptions(config.web.origins);
    const authCors = cors(corsOptions);
    app.use(
      "/auth/*",
      async (c, next) => {
        const url = new URL(c.req.url);
        if (isRouteScopedBrowserFlowCors(url.pathname, c.req.method)) {
          await next();
          return;
        }
        return await authCors(c, next);
      },
    );
    app.use(
      "/bootstrap/*",
      cors(corsOptions),
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
  registerAccountFlowRoutes(app, context);
  registerBrowserAuthRoutes(app, context);
  registerSessionLogoutRoutes(app, context);
  registerDeviceActivationHttpRoutes(app, {
    deploymentPortalRouteStorage: opts.deploymentPortalRouteStorage,
    contracts: opts.contracts,
    deploymentAuthorityStorage: opts.deploymentAuthorityStorage,
    deploymentAuthorityPlanStorage: opts.deploymentAuthorityPlanStorage,
    materializedAuthorityStorage: opts.materializedAuthorityStorage,
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
