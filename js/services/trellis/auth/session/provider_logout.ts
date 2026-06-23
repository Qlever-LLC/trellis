import type { Config } from "../../config.ts";
import type { Provider } from "../providers/index.ts";
import type { UserSession } from "../schemas.ts";

type LogoutCapableProvider = {
  buildLogoutUrl(args?: {
    returnTo?: string;
    federated?: boolean;
  }): Promise<string | undefined>;
};

/** Result returned by provider logout URL construction. */
export type BuildProviderLogoutUrlResult =
  | { ok: true; url?: string }
  | { ok: false; error: "invalid_return_to" };

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function sameOrigin(left: URL, right: string): boolean {
  const parsed = parseHttpUrl(right);
  return parsed?.origin === left.origin;
}

function hasLogoutBuilder(
  provider: Provider,
): provider is Provider & LogoutCapableProvider {
  return "buildLogoutUrl" in provider &&
    typeof provider.buildLogoutUrl === "function";
}

/**
 * Validates a browser return URL for provider logout.
 *
 * The return URL must be http(s) and same-origin with the session app when the
 * session is app-bound. Sessions without an app origin fall back to explicit
 * configured web origins; wildcard origins do not authorize logout returns.
 */
export function validateProviderLogoutReturnTo(args: {
  returnTo: string;
  session: UserSession;
  config: Pick<Config, "web">;
}): boolean {
  const returnUrl = parseHttpUrl(args.returnTo);
  if (!returnUrl) return false;

  if (args.session.app?.origin) {
    return sameOrigin(returnUrl, args.session.app.origin);
  }

  return args.config.web.origins.some((origin) =>
    origin !== "*" && sameOrigin(returnUrl, origin)
  );
}

/**
 * Builds the upstream provider logout URL for a user session when supported.
 *
 * Unsupported providers, provider mismatches, missing providers, and ordinary
 * provider construction failures produce an empty successful result. Invalid
 * return URLs are reported explicitly so RPC wiring can reject open redirects.
 */
export async function buildProviderLogoutUrl(args: {
  provider: Provider | undefined;
  session: UserSession;
  returnTo?: string;
  federated?: boolean;
  config: Pick<Config, "web">;
}): Promise<BuildProviderLogoutUrlResult> {
  if (args.returnTo !== undefined) {
    const validReturnTo = validateProviderLogoutReturnTo({
      returnTo: args.returnTo,
      session: args.session,
      config: args.config,
    });
    if (!validReturnTo) return { ok: false, error: "invalid_return_to" };
  }

  const provider = args.provider;
  if (!provider || provider.name !== args.session.identity.provider) {
    return { ok: true };
  }
  if (!hasLogoutBuilder(provider)) return { ok: true };

  try {
    const url = await provider.buildLogoutUrl({
      returnTo: args.returnTo,
      federated: args.federated,
    });
    return url === undefined ? { ok: true } : { ok: true, url };
  } catch {
    return { ok: true };
  }
}
