const DEFAULT_AUTH_URL = "http://localhost:3000";

export const APP_CONFIG = {
  authUrl: import.meta.env.VITE_TRELLIS_AUTH_URL ?? DEFAULT_AUTH_URL,
};

export function buildAppCallbackUrl(redirectTo: string): string {
  const url = new URL("/callback", window.location.origin);
  url.searchParams.set("redirectTo", redirectTo);
  return url.toString();
}
