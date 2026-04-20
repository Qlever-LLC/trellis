function browserOrigin(): string {
  if (typeof globalThis.location === "undefined") {
    throw new Error("Portal auth URL is only available in the browser");
  }

  return globalThis.location.origin;
}

export const APP_CONFIG = {
  get authUrl(): string {
    return browserOrigin();
  },
};

export function buildAppLoginUrl(redirectTo: string, authError?: string): string {
  const url = new URL("/_trellis/portal/users/login", browserOrigin());
  url.searchParams.set("redirectTo", redirectTo);
  if (authError) url.searchParams.set("authError", authError);
  return url.toString();
}
