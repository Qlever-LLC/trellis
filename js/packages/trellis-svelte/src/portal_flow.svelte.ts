import {
  type AuthConfig,
  type BrowserPortalFlowState as PortalFlowState,
  fetchPortalFlowState,
  portalFlowIdFromUrl,
  portalProviderLoginUrl,
  submitPortalApproval,
} from "@qlever-llc/trellis/auth/browser";

export type CreatePortalFlowConfig = AuthConfig & {
  getUrl?: () => URL;
};

export type PortalFlowErrorClassification = {
  kind: string;
  recoverable: boolean;
  reason?: string;
  code?: string;
};

type ErrorSignal = {
  code?: string;
  reason?: string;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

const EXPIRED_FLOW_VALUES = new Set([
  "flow_expired",
  "flow_not_found",
  "missing_flow",
  "missing_flow_id",
  "expired",
  "trellis.auth.bind_expired",
  "trellis.auth.flow_expired",
]);

const AUTH_REQUIRED_VALUES = new Set([
  "auth_required",
  "session_not_found",
  "session_expired",
  "trellis.bootstrap.auth_required",
  "trellis.auth.session_not_found",
  "trellis.auth.session_expired",
]);

function stringSignal(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function collectErrorSignals(error: unknown): ErrorSignal[] {
  const values: unknown[] = [error];
  if (isRecord(error) && isRecord(error.context)) values.push(error.context);

  return values.flatMap((value) => {
    if (typeof value === "string") return [{ message: value }];
    if (!isRecord(value)) return [];

    const code = stringSignal(value, "code") ?? stringSignal(value, "error");
    const reason = stringSignal(value, "reason") ??
      stringSignal(value, "status");
    const message = value instanceof Error
      ? value.message
      : stringSignal(value, "causeMessage") ?? stringSignal(value, "message");

    return code || reason || message
      ? [{
        ...(code ? { code } : {}),
        ...(reason ? { reason } : {}),
        ...(message ? { message } : {}),
      }]
      : [];
  });
}

function matchingSignal(
  signals: ErrorSignal[],
  values: ReadonlySet<string>,
  messages: readonly RegExp[],
): ErrorSignal | undefined {
  return signals.find((signal) => {
    const identifiers = [signal.code, signal.reason];
    return identifiers.some((value) => value && values.has(normalize(value))) ||
      messages.some((pattern) =>
        pattern.test(signal.message?.toLowerCase() ?? "")
      );
  });
}

function classification(
  kind: string,
  recoverable: boolean,
  signal?: ErrorSignal,
): PortalFlowErrorClassification {
  const reason = signal?.reason ?? signal?.code ?? signal?.message;
  return {
    kind,
    recoverable,
    ...(reason ? { reason } : {}),
    ...(signal?.code ? { code: signal.code } : {}),
  };
}

function classifyPortalFlowError(
  error: unknown,
): PortalFlowErrorClassification {
  const signals = collectErrorSignals(error);
  const expiredFlow = matchingSignal(signals, EXPIRED_FLOW_VALUES, [
    /flow .*expired/,
    /flow .*not found/,
    /missing flow/,
    /sign\-in .*expired/,
  ]);
  if (expiredFlow) {
    return classification("recoverable_expired_flow", true, expiredFlow);
  }

  const authRequired = matchingSignal(signals, AUTH_REQUIRED_VALUES, [
    /auth required/,
    /session .*expired/,
    /session .*not found/,
    /requires sign\-in/,
    /requires signin/,
    /requires authentication/,
  ]);
  if (authRequired) {
    return classification("recoverable_auth_required", true, authRequired);
  }

  return classification("unknown", false);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultGetUrl(): URL {
  return new URL(globalThis.location.href);
}

export class PortalFlowController {
  flowId: string | null = $state(null);
  state: PortalFlowState | null = $state(null);
  loading = $state(false);
  error: string | null = $state(null);
  errorClassification: PortalFlowErrorClassification | null = $state(null);

  #config: AuthConfig;
  #getUrl: () => URL;

  constructor(config: CreatePortalFlowConfig) {
    this.#config = { authUrl: config.authUrl };
    this.#getUrl = config.getUrl ?? defaultGetUrl;
  }

  async load(): Promise<PortalFlowState | null> {
    this.loading = true;
    this.error = null;
    this.errorClassification = null;
    this.state = null;

    try {
      const flowId = portalFlowIdFromUrl(this.#getUrl());
      this.flowId = flowId;
      if (!flowId) {
        this.error = "Missing flow id.";
        return null;
      }

      const state = await fetchPortalFlowState(this.#config, flowId);
      this.state = state;
      return state;
    } catch (error) {
      this.error = errorMessage(error);
      this.errorClassification = classifyPortalFlowError(error);
      this.state = null;
      return null;
    } finally {
      this.loading = false;
    }
  }

  providerUrl(providerId: string): string {
    if (!this.flowId) {
      throw new Error("Missing flow id.");
    }

    return portalProviderLoginUrl(this.#config, providerId, this.flowId);
  }

  async approve(): Promise<PortalFlowState | null> {
    return this.#submit("approved");
  }

  async deny(): Promise<PortalFlowState | null> {
    return this.#submit("denied");
  }

  async #submit(
    decision: "approved" | "denied",
  ): Promise<PortalFlowState | null> {
    if (!this.flowId) {
      this.error = "Missing flow id.";
      this.errorClassification = null;
      return null;
    }

    this.loading = true;
    this.error = null;
    this.errorClassification = null;

    try {
      const state = await submitPortalApproval(
        this.#config,
        this.flowId,
        decision,
      );
      this.state = state;
      return state;
    } catch (error) {
      this.error = errorMessage(error);
      this.errorClassification = classifyPortalFlowError(error);
      return null;
    } finally {
      this.loading = false;
    }
  }
}

export function createPortalFlow(
  config: CreatePortalFlowConfig,
): PortalFlowController {
  return new PortalFlowController(config);
}
