const DEFAULT_AUTH_URL = "http://localhost:3000";
const DEFAULT_NATS_SERVER = "ws://localhost:8080";

const CANONICAL_LOOPBACK_HOST = "localhost";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", CANONICAL_LOOPBACK_HOST]);

function parseServers(value: string | undefined): string[] {
  const raw = value ?? DEFAULT_NATS_SERVER;
  return raw.split(",").map((server) => server.trim()).filter(Boolean);
}

export const APP_CONFIG = {
  authUrl: import.meta.env.VITE_TRELLIS_AUTH_URL ?? DEFAULT_AUTH_URL,
  natsServers: parseServers(import.meta.env.VITE_TRELLIS_NATS_SERVERS),
  defaultProvider: import.meta.env.VITE_TRELLIS_DEFAULT_PROVIDER ?? "github"
};

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

export function getCanonicalLoopbackRedirectUrl(location: URL | Location = window.location): string | null {
  const current = toUrl(location);
  const canonical = getCanonicalLoopbackUrl(current);

  return canonical.toString() === current.toString() ? null : canonical.toString();
}

export function buildAppLoginUrl(
  redirectTo: string,
  location: URL | Location = window.location,
  authError?: string,
): string {
  const url = new URL("/login", getCanonicalLoopbackUrl(location).origin);
  url.searchParams.set("redirectTo", redirectTo);
  if (authError) {
    url.searchParams.set("authError", authError);
  }
  return url.toString();
}

export function buildAppCallbackUrl(redirectTo: string, location: URL | Location = window.location): string {
  const url = new URL("/callback", getCanonicalLoopbackUrl(location).origin);
  url.searchParams.set("redirectTo", redirectTo);
  return url.toString();
}
