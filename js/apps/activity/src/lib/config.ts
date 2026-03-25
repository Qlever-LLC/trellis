const DEFAULT_AUTH_URL = "http://localhost:3000";
const DEFAULT_NATS_SERVER = "ws://localhost:8080";

function parseServers(value: string | undefined): string[] {
  const raw = value ?? DEFAULT_NATS_SERVER;
  return raw.split(",").map((server) => server.trim()).filter(Boolean);
}

export const APP_CONFIG = {
  authUrl: import.meta.env.VITE_TRELLIS_AUTH_URL ?? DEFAULT_AUTH_URL,
  natsServers: parseServers(import.meta.env.VITE_TRELLIS_NATS_SERVERS),
  defaultProvider: import.meta.env.VITE_TRELLIS_DEFAULT_PROVIDER ?? "github",
};

export function buildAppCallbackUrl(redirectTo: string): string {
  const url = new URL("/callback", window.location.origin);
  url.searchParams.set("redirectTo", redirectTo);
  return url.toString();
}
