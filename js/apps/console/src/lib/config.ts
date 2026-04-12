const AUTH_URL_STORAGE_KEY = "trellis.console.authUrl";
const AUTH_URL_QUERY_PARAM = "authUrl";

const CANONICAL_LOOPBACK_HOST = "localhost";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", CANONICAL_LOOPBACK_HOST]);

type RuntimeAppConfig = {
  authUrl?: string;
};

function readRuntimeConfig(): RuntimeAppConfig {
  const config = (globalThis as typeof globalThis & {
    __TRELLIS_RUNTIME_CONFIG__?: RuntimeAppConfig;
  }).__TRELLIS_RUNTIME_CONFIG__;
  return config ?? {};
}

const runtimeConfig = readRuntimeConfig();
const viteEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {};

export const APP_CONFIG = {
  authUrl: runtimeConfig.authUrl ?? viteEnv["VITE_TRELLIS_AUTH_URL"],
};

function normalizeConfiguredUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (isLoopbackHost(url.hostname)) {
    url.hostname = CANONICAL_LOOPBACK_HOST;
  }
  return url.toString().replace(/\/$/, "");
}

function tryNormalizeConfiguredUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeConfiguredUrl(value.trim());
  } catch {
    return null;
  }
}

function getStorage(
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis.localStorage === "undefined") return null;
  return globalThis.localStorage;
}

function applySelectedAuthUrl(url: URL, authUrl: string | null | undefined): void {
  const normalized = tryNormalizeConfiguredUrl(authUrl);
  if (!normalized) {
    url.searchParams.delete(AUTH_URL_QUERY_PARAM);
    return;
  }
  if (normalized === APP_CONFIG.authUrl) {
    url.searchParams.delete(AUTH_URL_QUERY_PARAM);
    return;
  }
  url.searchParams.set(AUTH_URL_QUERY_PARAM, normalized);
}

export function getSelectedAuthUrl(
  location: URL | Location = globalThis.location,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): string | undefined {
  const current = toUrl(location);
  const store = getStorage(storage);
  const fromQuery = tryNormalizeConfiguredUrl(current.searchParams.get(AUTH_URL_QUERY_PARAM));
  if (fromQuery) {
    store?.setItem(AUTH_URL_STORAGE_KEY, fromQuery);
    return fromQuery;
  }

  const fromStorage = tryNormalizeConfiguredUrl(store?.getItem(AUTH_URL_STORAGE_KEY));
  if (fromStorage) {
    return fromStorage;
  }

  return APP_CONFIG.authUrl;
}

export function persistSelectedAuthUrl(
  authUrl: string,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): string | undefined {
  const normalized = tryNormalizeConfiguredUrl(authUrl) ?? APP_CONFIG.authUrl;
  const store = getStorage(storage);

  if (!normalized) {
    store?.removeItem(AUTH_URL_STORAGE_KEY);
    return undefined;
  }

  store?.setItem(AUTH_URL_STORAGE_KEY, normalized);
  return normalized;
}

function toUrl(location: URL | Location): URL {
  return location instanceof URL ? new URL(location.toString()) : new URL(location.href);
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

export function getCanonicalLoopbackUrl(location: URL | Location): URL {
  const url = toUrl(location);

  if (isLoopbackHost(url.hostname)) {
    url.hostname = CANONICAL_LOOPBACK_HOST;
  }

  return url;
}

export function getCanonicalLoopbackRedirectUrl(location: URL | Location = globalThis.location): string | null {
  const current = toUrl(location);
  const canonical = getCanonicalLoopbackUrl(current);

  return canonical.toString() === current.toString() ? null : canonical.toString();
}

export function buildAppLoginUrl(
  redirectTo: string,
  location: URL | Location = globalThis.location,
  authError?: string,
  authUrl?: string,
): string {
  const url = new URL("/login", getCanonicalLoopbackUrl(location).origin);
  url.searchParams.set("redirectTo", redirectTo);
  if (authError) {
    url.searchParams.set("authError", authError);
  }
  applySelectedAuthUrl(url, authUrl ?? getSelectedAuthUrl(location));
  return url.toString();
}

export function buildAppCallbackUrl(
  redirectTo: string,
  location: URL | Location = globalThis.location,
  authUrl?: string,
): string {
  const url = new URL("/callback", getCanonicalLoopbackUrl(location).origin);
  url.searchParams.set("redirectTo", redirectTo);
  applySelectedAuthUrl(url, authUrl ?? getSelectedAuthUrl(location));
  return url.toString();
}
