import { resolve } from "$app/paths";
import { createAuthState } from "@qlever-llc/trellis-svelte";
import contract from "./contract.ts";
import {
  APP_CONFIG,
  buildAppCallbackUrl,
  buildAppLoginUrl,
} from "./config.ts";

export const auth = createAuthState({
  authUrl: APP_CONFIG.authUrl,
  contract,
  loginPath: resolve("/login"),
});

function toUrl(location: URL | Location): URL {
  return location instanceof URL ? new URL(location.toString()) : new URL(location.href);
}

export function resolveConsolePath(
  path: string,
  location: URL | Location = globalThis.location,
): string {
  const url = new URL(path, toUrl(location));
  const appBase = resolve("/").replace(/\/$/, "");
  const currentUrl = toUrl(location);

  if (url.origin !== currentUrl.origin) {
    return url.toString();
  }

  if (appBase && url.pathname === appBase) {
    return `${appBase}/${url.search}${url.hash}`;
  }

  if (appBase && url.pathname.startsWith(`${appBase}/`)) {
    return `${appBase}${url.pathname.slice(appBase.length)}${url.search}${url.hash}`;
  }

  return `${appBase}${url.pathname}${url.search}${url.hash}`;
}

export function getConsoleRedirectTarget(
  location: URL | Location = globalThis.location,
  fallback = "/profile",
): string {
  const currentUrl = toUrl(location);
  return resolveConsolePath(currentUrl.searchParams.get("redirectTo") ?? fallback, currentUrl);
}

export function buildConsoleLoginUrl(options: {
  redirectTo: string;
  location?: URL | Location;
  authError?: string;
  authUrl?: string;
}): string {
  const location = options.location ?? globalThis.location;
  return buildAppLoginUrl(
    resolveConsolePath(options.redirectTo, location),
    location,
    options.authError,
    options.authUrl,
    resolve("/login"),
  );
}

export function buildConsoleCallbackUrl(options: {
  redirectTo: string;
  location?: URL | Location;
  authUrl?: string;
}): string {
  const location = options.location ?? globalThis.location;
  return buildAppCallbackUrl(
    resolveConsolePath(options.redirectTo, location),
    location,
    options.authUrl,
    resolve("/callback"),
  );
}

export async function startConsoleSignIn(options: {
  authUrl?: string;
  redirectTo: string;
  location?: URL | Location;
}): Promise<never> {
  return await auth.signIn({
    authUrl: options.authUrl,
    redirectTo: buildConsoleCallbackUrl(options),
  });
}
