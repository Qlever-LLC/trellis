import { Result } from "@qlever-llc/result";

export type RedirectToValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

const WILDCARD_ORIGIN = "*";
const RELATIVE_REDIRECT_ERROR =
  "redirectTo must be a relative path or an allowed origin";

function originIsAllowed(
  origin: string,
  allowedOrigins: readonly string[],
): boolean {
  return allowedOrigins.includes(WILDCARD_ORIGIN) ||
    allowedOrigins.includes(origin);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "::1";
}

export function validateRedirectTo(
  raw: unknown,
  allowedOrigins: readonly string[],
): RedirectToValidation {
  if (raw === null || raw === undefined) {
    return { ok: false, error: "Missing redirectTo" };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "Invalid redirectTo" };
  }

  if (raw.startsWith("/")) {
    if (raw.startsWith("//")) {
      return { ok: false, error: RELATIVE_REDIRECT_ERROR };
    }
    return { ok: true, value: raw };
  }

  const urlResult = Result.try(() => new URL(raw));
  if (urlResult.isErr()) {
    return { ok: false, error: RELATIVE_REDIRECT_ERROR };
  }
  const url = urlResult.take() as URL;

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: RELATIVE_REDIRECT_ERROR };
  }
  if (isLoopbackHostname(url.hostname)) {
    return { ok: true, value: url.toString() };
  }
  if (!originIsAllowed(url.origin, allowedOrigins)) {
    return { ok: false, error: RELATIVE_REDIRECT_ERROR };
  }

  return { ok: true, value: url.toString() };
}

export function resolveCorsOrigin(
  requestOrigin: string | undefined,
  allowedOrigins: readonly string[],
): string | undefined {
  if (!requestOrigin) return undefined;
  return originIsAllowed(requestOrigin, allowedOrigins)
    ? requestOrigin
    : undefined;
}
