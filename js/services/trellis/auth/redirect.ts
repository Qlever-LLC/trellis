import { Result } from "@qlever-llc/trellis-result";

export type RedirectToValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

const RELATIVE_REDIRECT_ERROR =
  "redirectTo must be a relative path or an allowlisted origin";

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
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
  if (!allowedOrigins.includes(url.origin)) {
    return { ok: false, error: RELATIVE_REDIRECT_ERROR };
  }

  return { ok: true, value: url.toString() };
}
