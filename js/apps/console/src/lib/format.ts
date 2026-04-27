type ErrorLike = {
  name?: unknown;
  message?: unknown;
  getContext?: () => Record<string, unknown>;
  error?: {
    message?: unknown;
    remoteError?: {
      message?: unknown;
      issues?: Array<{ path?: unknown; message?: unknown }>;
    };
    issues?: Array<{ path?: unknown; message?: unknown }>;
    context?: {
      reason?: unknown;
    };
  };
};

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
    return context.reason;
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
      return candidate.error.context.reason;
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
