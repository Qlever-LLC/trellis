import type {
  AuthActivateDeviceOutput,
} from "../../../trellis/auth/device_activation.ts";
import type { TerminalOperation } from "../../../trellis/operations.ts";

type DeviceActivationProgressInput = {
  instanceId: string;
  deploymentId: string;
  reviewId: string;
  requestedAt: string | Date;
};
type PendingReviewDeviceActivationOutput = Extract<
  AuthActivateDeviceOutput,
  { status: "pending_review" }
>;

function isDeviceActivationProgressInput(
  value: AuthActivateDeviceOutput,
): value is PendingReviewDeviceActivationOutput {
  const record = value as Record<string, unknown>;
  return record.status === "pending_review" &&
    typeof record.instanceId === "string" &&
    typeof record.deploymentId === "string" &&
    typeof record.reviewId === "string" &&
    (typeof record.requestedAt === "string" ||
      record.requestedAt instanceof Date);
}

export type DeviceActivationView =
  | { mode: "sign_in_required"; flowId: string }
  | { mode: "ready"; flowId: string }
  | {
    mode: "pending_review";
    flowId: string;
    instanceId: string;
    deploymentId: string;
    reviewId: string;
    requestedAt: string;
  }
  | {
    mode: "activated";
    flowId: string;
    instanceId: string;
    deploymentId: string;
    activatedAt: string;
    confirmationCode?: string;
  }
  | { mode: "rejected"; flowId: string; reason?: string }
  | { mode: "expired"; flowId: string; reason: string }
  | { mode: "invalid_flow"; reason: string; flowId?: string };

function isoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string") return message;
  }
  return String(error);
}

function errorContext(error: unknown): Record<string, unknown> | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  if ("getContext" in error) {
    const getContext = Reflect.get(error, "getContext");
    if (typeof getContext === "function") {
      const context = Reflect.apply(getContext, error, []);
      return typeof context === "object" && context !== null
        ? context as Record<string, unknown>
        : null;
    }
  }

  if (!("context" in error)) return null;

  const context = Reflect.get(error, "context");
  return typeof context === "object" && context !== null
    ? context as Record<string, unknown>
    : null;
}

function errorReason(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("reason" in error)) {
    return undefined;
  }

  const reason = Reflect.get(error, "reason");
  return typeof reason === "string" ? reason : undefined;
}

export function createDeviceActivationReadyView(
  flowId: string,
): DeviceActivationView {
  return { mode: "ready", flowId };
}

export function createDeviceActivationSignInRequiredView(
  flowId: string,
): DeviceActivationView {
  return { mode: "sign_in_required", flowId };
}

export function createInvalidDeviceActivationView(
  reason: string,
  flowId?: string,
): DeviceActivationView {
  return flowId
    ? { mode: "invalid_flow", reason, flowId }
    : { mode: "invalid_flow", reason };
}

export function mapDeviceActivationOutput(
  flowId: string,
  result: AuthActivateDeviceOutput,
): DeviceActivationView {
  if (result.status === "activated") {
    return {
      mode: "activated",
      flowId,
      instanceId: result.instanceId,
      deploymentId: result.deploymentId,
      activatedAt: isoString(result.activatedAt),
      ...(result.confirmationCode
        ? { confirmationCode: result.confirmationCode }
        : {}),
    };
  }

  if (isDeviceActivationProgressInput(result)) {
    return mapDeviceActivationProgress(flowId, result);
  }

  if (result.reason === "device_flow_expired") {
    return {
      mode: "expired",
      flowId,
      reason:
        "The activation request expired. Start again from the auth service.",
    };
  }

  if (result.reason === "device_activation_revoked") {
    return {
      mode: "rejected",
      flowId,
      reason: "The activation request was revoked.",
    };
  }

  if (result.reason === "activation_not_started") {
    return createDeviceActivationReadyView(flowId);
  }

  return {
    mode: "rejected",
    flowId,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

export function mapDeviceActivationProgress(
  flowId: string,
  progress: DeviceActivationProgressInput,
): DeviceActivationView {
  return {
    mode: "pending_review",
    flowId,
    instanceId: progress.instanceId,
    deploymentId: progress.deploymentId,
    reviewId: progress.reviewId,
    requestedAt: isoString(progress.requestedAt),
  };
}

export function mapDeviceActivationFailure(
  flowId: string,
  error: unknown,
): DeviceActivationView | null {
  const message = errorMessage(error);
  const context = errorContext(error);
  const authReason = errorReason(error);
  const reason = typeof context?.reason === "string"
    ? context.reason
    : authReason;

  if (
    reason === "device_flow_not_found" ||
    authReason === "device_activation_flow_not_found" ||
    message.includes("device_flow_not_found") ||
    message.includes("device_activation_flow_not_found")
  ) {
    return createInvalidDeviceActivationView(
      "This activation link is no longer valid.",
      flowId,
    );
  }

  if (
    reason === "device_flow_expired" ||
    authReason === "device_activation_flow_expired" ||
    message.includes("device_flow_expired") ||
    message.includes("device_activation_flow_expired")
  ) {
    return {
      mode: "expired",
      flowId,
      reason:
        "The activation request expired. Start again from the auth service.",
    };
  }

  if (
    reason === "unknown_device" || authReason === "unknown_device" ||
    message.includes("unknown_device")
  ) {
    return createInvalidDeviceActivationView(
      "This activation link no longer matches a known device.",
      flowId,
    );
  }

  if (
    reason === "device_deployment_not_found" ||
    authReason === "device_deployment_not_found" ||
    message.includes("device_deployment_not_found")
  ) {
    return createInvalidDeviceActivationView(
      "This device deployment is no longer available.",
      flowId,
    );
  }

  if (authReason === "invalid_request" || message.includes("invalid_request")) {
    return createInvalidDeviceActivationView(
      "Trellis rejected this activation request. Start again from the device.",
      flowId,
    );
  }

  if (
    reason === "device_activation_revoked" ||
    message.includes("device_activation_revoked")
  ) {
    return { mode: "rejected", flowId, reason };
  }

  return null;
}

export function mapDeviceActivationTerminal(
  flowId: string,
  terminal: TerminalOperation<unknown, AuthActivateDeviceOutput>,
): DeviceActivationView | null {
  if (terminal.state === "completed") {
    return terminal.output
      ? mapDeviceActivationOutput(flowId, terminal.output)
      : null;
  }

  return terminal.error
    ? mapDeviceActivationFailure(flowId, terminal.error)
    : null;
}
