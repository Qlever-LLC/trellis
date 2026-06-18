/**
 * Classifies auth/session errors that should automatically restart login
 * instead of showing a user-visible error screen.
 *
 * Real policy failures (insufficient capabilities after fresh login,
 * inactive account, explicit denial) are NOT recoverable and must
 * surface to the user.
 */

type TransportErrorLike = {
  code?: unknown;
  context?: unknown;
  message?: unknown;
};

function isTransportErrorLike(value: unknown): value is TransportErrorLike {
  return typeof value === "object" && value !== null;
}

function contextReason(error: TransportErrorLike): string | undefined {
  const context = error.context;
  if (typeof context === "object" && context !== null) {
    const reason = (context as Record<string, unknown>).reason;
    if (typeof reason === "string") return reason;
  }
  return undefined;
}

const RECOVERABLE_CODES = new Set([
  "trellis.bootstrap.not_ready",
  "trellis.bootstrap.auth_required",
  "trellis.auth.bind_expired",
  "trellis.auth.login_failed",
]);

const RECOVERABLE_REASONS = new Set([
  "insufficient_permissions",
  "contract_not_active",
  "session_not_found",
  "session_expired",
  "flow_expired",
  "user_not_found",
]);

export function isRecoverableConsoleAuthError(error: unknown): boolean {
  if (!isTransportErrorLike(error)) return false;

  const code = typeof error.code === "string" ? error.code : undefined;
  if (code && RECOVERABLE_CODES.has(code)) {
    return true;
  }

  const reason = contextReason(error);
  if (reason && RECOVERABLE_REASONS.has(reason)) {
    return true;
  }

  // Also check message for flow_expired since some errors embed it there
  if (typeof error.message === "string") {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("session_not_found") ||
      msg.includes("session_expired") ||
      msg.includes("flow_expired")
    ) {
      return true;
    }
  }

  return false;
}
