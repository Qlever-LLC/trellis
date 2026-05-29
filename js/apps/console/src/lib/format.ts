type ErrorLike = {
  name?: unknown;
  message?: unknown;
  reason?: unknown;
  getContext?: () => Record<string, unknown>;
  error?: {
    message?: unknown;
    reason?: unknown;
    remoteError?: {
      message?: unknown;
      reason?: unknown;
      context?: Record<string, unknown>;
      issues?: Array<{ path?: unknown; message?: unknown }>;
    };
    issues?: Array<{ path?: unknown; message?: unknown }>;
    context?: {
      reason?: unknown;
    };
  };
};

function formatAuthReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  switch (reason) {
    case "invalid_request":
      return "The request could not be completed. Check the form and try again.";
    case "insufficient_permissions":
      return "This Console session is missing permission for that action. Sign out and connect the Console again to accept the updated access.";
    case "session_not_found":
    case "session_expired":
      return "Your session has expired. Sign in again.";
    case "invalid_signature":
    case "missing_session_key":
    case "missing_proof":
      return "Your session could not be verified. Sign in again.";
    case "user_not_found":
      return "That user account could not be found.";
    case "username_taken":
      return "That username is already in use.";
    case "user_inactive":
      return "This account is inactive. Contact an administrator.";
    case "forbidden":
      return "You are not allowed to complete this action.";
    case "last_admin_required":
      return "At least one active administrator is required.";
    default:
      return null;
  }
}

function formatContextMessage(
  context: Record<string, unknown> | undefined,
): string | null {
  if (!context) return null;

  if (typeof context.message === "string" && context.message.length > 0) {
    return context.message;
  }

  if (
    typeof context.causeMessage === "string" && context.causeMessage.length > 0
  ) {
    return context.causeMessage;
  }

  if (typeof context.reason === "string" && context.reason.length > 0) {
    return formatAuthReason(context.reason) ?? context.reason;
  }

  return null;
}

function formatIssues(
  issues: Array<{ path?: unknown; message?: unknown }>,
): string | null {
  if (issues.length === 0) return null;
  return issues
    .map((issue) => {
      const path = typeof issue.path === "string" ? issue.path : "";
      const message = typeof issue.message === "string"
        ? issue.message
        : "Invalid value";
      return path ? `${path}: ${message}` : message;
    })
    .join("; ");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatList(values: string[] | null | undefined): string {
  if (!values || values.length === 0) return "-";
  return values.join(", ");
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const candidate = error as ErrorLike;

    const directContext = typeof candidate.getContext === "function"
      ? candidate.getContext()
      : undefined;
    const directContextMessage = formatContextMessage(directContext);
    if (directContextMessage) {
      return directContextMessage;
    }

    if (typeof candidate.error?.context?.reason === "string") {
      return formatAuthReason(candidate.error.context.reason) ??
        candidate.error.context.reason;
    }

    const nestedContextMessage = formatContextMessage(candidate.error?.context);
    if (nestedContextMessage) {
      return nestedContextMessage;
    }

    const remoteIssues = candidate.error?.remoteError?.issues;
    if (Array.isArray(remoteIssues)) {
      return formatIssues(remoteIssues) ?? "Validation failed";
    }

    const localIssues = candidate.error?.issues;
    if (Array.isArray(localIssues)) {
      return formatIssues(localIssues) ?? "Validation failed";
    }

    const remoteContextMessage = formatContextMessage(
      candidate.error?.remoteError?.context,
    );
    if (remoteContextMessage) {
      return remoteContextMessage;
    }

    const directReasonMessage = formatAuthReason(candidate.reason);
    if (directReasonMessage) {
      return directReasonMessage;
    }

    const nestedReasonMessage = formatAuthReason(candidate.error?.reason);
    if (nestedReasonMessage) {
      return nestedReasonMessage;
    }

    const remoteReasonMessage = formatAuthReason(
      candidate.error?.remoteError?.reason,
    );
    if (remoteReasonMessage) {
      return remoteReasonMessage;
    }

    if (typeof candidate.error?.remoteError?.message === "string") {
      return candidate.error.remoteError.message;
    }

    if (typeof candidate.error?.message === "string") {
      return candidate.error.message;
    }

    if (typeof candidate.message === "string") {
      return candidate.message;
    }
  }

  if (error instanceof Error) return error.message;

  return "Unexpected error";
}
