/** Browser auth recovery classification helpers. */

/** Stable browser-auth recovery categories for app-owned recovery flows. */
export type BrowserAuthRecoveryKind =
  | "recoverable_stale_session"
  | "recoverable_expired_flow"
  | "recoverable_auth_required"
  | "policy_denied"
  | "insufficient_capabilities"
  | "runtime_unavailable"
  | "unknown";

/** Classification result for a browser-auth related failure. */
export type BrowserAuthRecoveryClassification = {
  kind: BrowserAuthRecoveryKind;
  recoverable: boolean;
  reason?: string;
  code?: string;
};

type ErrorSignal = {
  code?: string;
  reason?: string;
  message?: string;
};

const MAX_ERROR_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function stringProperty(
  record: Record<string, unknown>,
  property: string,
): string | undefined {
  const value = record[property];
  return typeof value === "string" ? value : undefined;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function signalValue(signal: ErrorSignal): string | undefined {
  return signal.code ?? signal.reason ?? signal.message;
}

function classification(
  kind: BrowserAuthRecoveryKind,
  recoverable: boolean,
  signal?: ErrorSignal,
): BrowserAuthRecoveryClassification {
  const reason = signal?.reason ?? signalValue(signal ?? {});
  return {
    kind,
    recoverable,
    ...(reason ? { reason } : {}),
    ...(signal?.code ? { code: signal.code } : {}),
  };
}

function maybeSerializable(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const toSerializable = value.toSerializable;
  if (typeof toSerializable !== "function") return undefined;
  try {
    return toSerializable.call(value);
  } catch {
    return undefined;
  }
}

function pushRecordSignals(
  record: Record<string, unknown>,
  signals: ErrorSignal[],
  queue: unknown[],
): void {
  const message = stringProperty(record, "message");
  const code = stringProperty(record, "code") ??
    stringProperty(record, "error");
  const reason = stringProperty(record, "reason") ??
    stringProperty(record, "status");
  if (message || code || reason) {
    signals.push({
      ...(code ? { code } : {}),
      ...(reason ? { reason } : {}),
      ...(message ? { message } : {}),
    });
  }

  const context = record.context;
  if (isRecord(context)) {
    const contextReason = stringProperty(context, "reason");
    const causeMessage = stringProperty(context, "causeMessage");
    const contextCode = stringProperty(context, "code");
    const contextMessage = stringProperty(context, "message");
    if (contextReason || causeMessage || contextCode || contextMessage) {
      signals.push({
        ...(contextCode ? { code: contextCode } : {}),
        ...(contextReason ? { reason: contextReason } : {}),
        ...(causeMessage ?? contextMessage
          ? { message: causeMessage ?? contextMessage }
          : {}),
      });
    }
    for (const nested of [context.cause, context.error, context.remoteError]) {
      if (nested !== undefined) queue.push(nested);
    }
  }

  for (const nested of [record.cause, record.error, record.remoteError]) {
    if (nested !== undefined) queue.push(nested);
  }
}

function collectErrorSignals(error: unknown): ErrorSignal[] {
  const signals: ErrorSignal[] = [];
  const queue: unknown[] = [error];
  const seen = new WeakSet<object>();
  let depth = 0;

  while (queue.length > 0 && depth < MAX_ERROR_DEPTH) {
    depth += 1;
    const value = queue.shift();
    if (typeof value === "string") {
      signals.push({ message: value });
      continue;
    }
    if (!isRecord(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (value instanceof Error) {
      signals.push({ message: value.message });
    }
    pushRecordSignals(value, signals, queue);

    const serialized = maybeSerializable(value);
    if (serialized && serialized !== value) queue.push(serialized);
  }

  return signals;
}

function hasNormalizedValue(
  signals: ErrorSignal[],
  values: ReadonlySet<string>,
): ErrorSignal | undefined {
  for (const signal of signals) {
    for (const value of [signal.code, signal.reason]) {
      if (value && values.has(normalize(value))) return signal;
    }
  }
  return undefined;
}

function hasMessagePattern(
  signals: ErrorSignal[],
  patterns: readonly RegExp[],
): ErrorSignal | undefined {
  for (const signal of signals) {
    const message = signal.message;
    if (!message) continue;
    const normalized = message.toLowerCase();
    if (patterns.some((pattern) => pattern.test(normalized))) return signal;
  }
  return undefined;
}

function insufficientPermissionsAuthSignal(
  signals: ErrorSignal[],
): ErrorSignal | undefined {
  for (const signal of signals) {
    const reason = signal.reason ? normalize(signal.reason) : undefined;
    const code = signal.code ? normalize(signal.code) : undefined;
    if (reason !== "insufficient_permissions") continue;
    if (code === "trellis.bootstrap.auth_required") return signal;
    const message = signal.message?.toLowerCase() ?? "";
    if (
      message.includes("auth required") ||
      message.includes("requires sign-in") ||
      message.includes("requires signin") ||
      message.includes("stale") ||
      message.includes("session")
    ) {
      return signal;
    }
  }
  return undefined;
}

const APPROVAL_DENIED_VALUES = new Set([
  "approval_denied",
  "trellis.auth.approval_denied",
]);

const INSUFFICIENT_CAPABILITIES_VALUES = new Set([
  "insufficient_capabilities",
  "trellis.auth.insufficient_capabilities",
]);

const RUNTIME_UNAVAILABLE_VALUES = new Set([
  "trellis.bootstrap.not_ready",
  "trellis.runtime.unavailable",
  "runtime_unavailable",
]);

const EXPIRED_FLOW_VALUES = new Set([
  "flow_expired",
  "expired",
  "trellis.auth.bind_expired",
  "trellis.auth.flow_expired",
]);

const STALE_SESSION_VALUES = new Set([
  "session_not_found",
  "session_expired",
  "user_not_found",
  "contract_not_active",
  "trellis.auth.session_not_found",
  "trellis.auth.session_expired",
  "trellis.auth.user_not_found",
  "trellis.auth.contract_not_active",
]);

const AUTH_REQUIRED_VALUES = new Set([
  "auth_required",
  "trellis.bootstrap.auth_required",
  "trellis.auth.login_failed",
]);

/**
 * Classifies browser auth, bootstrap, callback, and transport-like failures.
 *
 * The classifier accepts raw errors, serialized Trellis errors, nested causes,
 * and nested remote errors. Recoverable classifications are intended for
 * app-owned flows that can clear stale auth and restart sign-in without showing a
 * user-facing terminal error.
 */
export function classifyBrowserAuthError(
  error: unknown,
): BrowserAuthRecoveryClassification {
  const signals = collectErrorSignals(error);

  const approvalDenied = hasNormalizedValue(signals, APPROVAL_DENIED_VALUES) ??
    hasMessagePattern(signals, [/approval .*denied/, /access .*denied/]);
  if (approvalDenied) {
    return classification("policy_denied", false, approvalDenied);
  }

  const inactiveOrInvalid = hasNormalizedValue(
    signals,
    new Set(["invalid_credentials", "user_inactive", "inactive_account"]),
  ) ?? hasMessagePattern(signals, [
    /invalid credential/,
    /inactive account/,
    /user inactive/,
  ]);
  if (inactiveOrInvalid) {
    return classification("policy_denied", false, inactiveOrInvalid);
  }

  const insufficientCapabilities = hasNormalizedValue(
    signals,
    INSUFFICIENT_CAPABILITIES_VALUES,
  ) ?? hasMessagePattern(signals, [/insufficient capabilit/]);
  if (insufficientCapabilities) {
    return classification(
      "insufficient_capabilities",
      false,
      insufficientCapabilities,
    );
  }

  const runtimeUnavailable = hasNormalizedValue(
    signals,
    RUNTIME_UNAVAILABLE_VALUES,
  ) ?? hasMessagePattern(signals, [/runtime unavailable/]);
  if (runtimeUnavailable) {
    return classification("runtime_unavailable", false, runtimeUnavailable);
  }

  const expiredFlow = hasNormalizedValue(signals, EXPIRED_FLOW_VALUES) ??
    hasMessagePattern(signals, [/flow .*expired/, /sign\-in .*expired/]);
  if (expiredFlow) {
    return classification("recoverable_expired_flow", true, expiredFlow);
  }

  const staleSession = hasNormalizedValue(signals, STALE_SESSION_VALUES) ??
    hasMessagePattern(signals, [
      /session .*expired/,
      /session .*not found/,
      /user .*not found/,
      /contract .*not active/,
    ]);
  if (staleSession) {
    return classification("recoverable_stale_session", true, staleSession);
  }

  const authRequired = hasNormalizedValue(signals, AUTH_REQUIRED_VALUES) ??
    insufficientPermissionsAuthSignal(signals) ??
    hasMessagePattern(signals, [
      /auth required/,
      /requires sign\-in/,
      /requires signin/,
      /requires authentication/,
    ]);
  if (authRequired) {
    return classification("recoverable_auth_required", true, authRequired);
  }

  return classification("unknown", false);
}

/** Returns whether a browser auth error can silently restart sign-in. */
export function isRecoverableBrowserAuthError(error: unknown): boolean {
  return classifyBrowserAuthError(error).recoverable;
}
