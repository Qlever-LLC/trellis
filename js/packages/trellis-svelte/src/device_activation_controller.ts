import type { BaseError } from "@qlever-llc/result";
import type { AsyncResult } from "@qlever-llc/result";
import type {
  AuthActivateDeviceOutput,
  AuthActivateDeviceProgress,
} from "../../trellis/auth/device_activation.ts";
import type {
  OperationEvent,
  TerminalOperation,
} from "../../trellis/operations.ts";
import {
  clearPreservedDeviceActivationCallbackState,
  getPreservedDeviceActivationCallbackState,
  preserveDeviceActivationCallbackState,
  type StorageLike,
} from "./internal/callback_state.ts";
import {
  buildDeviceActivationCallbackPath,
  buildDeviceActivationConnectAuthUrlState,
  cleanupDeviceActivationCallbackUrl,
  type DeviceActivationConnectAuthUrlState,
  resolveDeviceActivationUrlState,
} from "./internal/portal_url.ts";
import {
  createDeviceActivationReadyView,
  createDeviceActivationSignInRequiredView,
  createInvalidDeviceActivationView,
  type DeviceActivationView,
  mapDeviceActivationFailure,
  mapDeviceActivationProgress,
  mapDeviceActivationTerminal,
} from "./internal/activation_view.ts";

export type DeviceActivationSignInOptions = {
  redirectTo?: string;
  landingPath?: string;
  context?: unknown;
};

export type DeviceActivationBindResult =
  | { status: "bound" }
  | { status: "approval_denied" }
  | { status: "approval_required" }
  | { status: "insufficient_capabilities"; missingCapabilities: string[] }
  | { status: "error"; message: string };

export type DeviceActivationAuth = {
  init(): Promise<unknown>;
  handleCallback(
    callbackUrl: string,
  ): Promise<DeviceActivationBindResult | null>;
  signIn(options?: DeviceActivationSignInOptions): Promise<never>;
};

export type DeviceActivationControllerConfig = {
  authState: DeviceActivationAuth;
  createClient(
    authUrlState: DeviceActivationConnectAuthUrlState,
  ): Promise<DeviceActivationClient>;
  getUrl?: () => URL;
  replaceUrl?: (url: string) => void;
  sessionStorage?: StorageLike;
  createCallbackToken?: () => string;
};

export type DeviceActivationOperationRef = {
  watch(): AsyncResult<
    AsyncIterable<
      OperationEvent<AuthActivateDeviceProgress, AuthActivateDeviceOutput>
    >,
    BaseError
  >;
  wait(): AsyncResult<
    TerminalOperation<AuthActivateDeviceProgress, AuthActivateDeviceOutput>,
    BaseError
  >;
};

export type DeviceActivationClient = {
  activateDevice(
    input: { flowId: string },
  ): Promise<DeviceActivationOperationRef>;
};

export type DeviceActivationState = {
  loading: boolean;
  requestPending: boolean;
  authError: string | null;
  view: DeviceActivationView | null;
  flowId: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redirectErrorMessage(error: unknown): string | null {
  const message = errorMessage(error);
  return message.startsWith("Redirecting to auth for provider selection")
    ? null
    : message;
}

function bindErrorMessage(result: DeviceActivationBindResult): string | null {
  if (result.status === "bound") return null;
  if (result.status === "approval_denied") return "Portal access was denied.";
  if (result.status === "approval_required") {
    return "Approval is still pending.";
  }
  if (result.status === "insufficient_capabilities") {
    return `Missing capabilities: ${result.missingCapabilities.join(", ")}`;
  }
  return result.message;
}

function defaultGetUrl(): URL {
  return new URL(globalThis.location.href);
}

function defaultReplaceUrl(url: string): void {
  globalThis.history.replaceState(globalThis.history.state, "", url);
}

function defaultCreateCallbackToken(): string {
  return crypto.randomUUID();
}

export function createInitialDeviceActivationState(): DeviceActivationState {
  return {
    loading: true,
    requestPending: false,
    authError: null,
    view: null,
    flowId: null,
  };
}

export class DeviceActivationControllerCore {
  protected readonly state: DeviceActivationState;

  #authState: DeviceActivationAuth;
  #createClient: DeviceActivationControllerConfig["createClient"];
  #getUrl: () => URL;
  #replaceUrl: (url: string) => void;
  #sessionStorage: StorageLike | null;
  #createCallbackToken: () => string;
  #client: DeviceActivationClient | null = null;
  #observationRunId = 0;

  constructor(
    config: DeviceActivationControllerConfig,
    state: DeviceActivationState = createInitialDeviceActivationState(),
  ) {
    this.state = state;
    this.#authState = config.authState;
    this.#createClient = config.createClient;
    this.#getUrl = config.getUrl ?? defaultGetUrl;
    this.#replaceUrl = config.replaceUrl ?? defaultReplaceUrl;
    this.#sessionStorage = config.sessionStorage ?? null;
    this.#createCallbackToken = config.createCallbackToken ??
      defaultCreateCallbackToken;
  }

  get loading(): boolean {
    return this.state.loading;
  }

  get requestPending(): boolean {
    return this.state.requestPending;
  }

  get authError(): string | null {
    return this.state.authError;
  }

  get view(): DeviceActivationView | null {
    return this.state.view;
  }

  get flowId(): string | null {
    return this.state.flowId;
  }

  async load(): Promise<void> {
    this.stop();
    this.state.loading = true;
    this.state.authError = null;
    this.state.view = null;
    this.#client = null;

    const currentUrl = this.#getUrl();
    const preservedState = this.#sessionStorage
      ? getPreservedDeviceActivationCallbackState(this.#sessionStorage)
      : null;
    const { flowId, isAuthCallback } = resolveDeviceActivationUrlState(
      currentUrl,
      preservedState,
    );
    this.state.flowId = flowId;

    if (!flowId) {
      this.state.view = createInvalidDeviceActivationView("Missing flow id.");
      this.state.loading = false;
      return;
    }

    try {
      await this.#authState.init();

      if (isAuthCallback) {
        const bindResult = await this.#authState.handleCallback(
          currentUrl.toString(),
        );
        const cleanedUrl = cleanupDeviceActivationCallbackUrl(
          currentUrl,
          flowId,
        );
        if (cleanedUrl) {
          this.#replaceUrl(cleanedUrl);
        }
        if (this.#sessionStorage) {
          clearPreservedDeviceActivationCallbackState(this.#sessionStorage);
        }

        const callbackAuthError = currentUrl.searchParams.get("authError");
        if (callbackAuthError && !bindResult) {
          this.state.authError = callbackAuthError;
          this.state.view = createDeviceActivationSignInRequiredView(flowId);
          return;
        }

        if (bindResult) {
          const bindError = bindErrorMessage(bindResult);
          if (bindError) {
            this.state.authError = bindError;
            this.state.view = createDeviceActivationSignInRequiredView(flowId);
            return;
          }
        }
      }

      try {
        this.#client = await this.#createClient(
          buildDeviceActivationConnectAuthUrlState(currentUrl),
        );
        this.state.view = createDeviceActivationReadyView(flowId);
      } catch (error) {
        this.#client = null;
        if (isAuthCallback) {
          this.state.authError = errorMessage(error);
        }
        this.state.view = createDeviceActivationSignInRequiredView(flowId);
      }
    } catch (error) {
      this.state.authError = errorMessage(error);
      this.state.view = createDeviceActivationSignInRequiredView(flowId);
    } finally {
      this.state.loading = false;
    }
  }

  stop(): void {
    this.#observationRunId += 1;
  }

  async signIn(): Promise<void> {
    this.state.authError = null;
    if (!this.state.flowId || !this.#sessionStorage) return;

    const callbackToken = this.#createCallbackToken();
    preserveDeviceActivationCallbackState(this.#sessionStorage, {
      flowId: this.state.flowId,
      callbackToken,
    });

    try {
      await this.#authState.signIn({
        redirectTo: buildDeviceActivationCallbackPath(
          this.#getUrl(),
          callbackToken,
        ),
      });
    } catch (error) {
      const message = redirectErrorMessage(error);
      if (message) {
        this.state.authError = message;
      }
    }
  }

  async requestActivation(): Promise<void> {
    const flowId = this.state.flowId;
    if (!flowId || !this.#client) return;

    this.stop();
    const runId = this.#observationRunId;
    this.state.requestPending = true;
    this.state.authError = null;

    try {
      const operation = await this.#client.activateDevice({ flowId });
      const watch = await operation.watch().match({
        ok: (value) => value,
        err: () => null,
      });
      const watchPromise = watch
        ? this.#observeWatch(flowId, watch, runId)
        : Promise.resolve(false);
      const terminal = await operation.wait().orThrow();
      const handledByWatch = await watchPromise;
      if (!handledByWatch && this.#isRunActive(runId)) {
        this.#applyTerminal(flowId, terminal);
      }
    } catch (error) {
      if (!this.#isRunActive(runId)) return;

      const nextView = mapDeviceActivationFailure(flowId, error);
      if (nextView) {
        this.state.view = nextView;
      } else {
        this.state.view = createDeviceActivationReadyView(flowId);
        this.state.authError = errorMessage(error);
      }
    } finally {
      if (this.#isRunActive(runId)) {
        this.state.requestPending = false;
      }
    }
  }

  #isRunActive(runId: number): boolean {
    return this.#observationRunId === runId;
  }

  #applyTerminal(
    flowId: string,
    terminal: TerminalOperation<
      AuthActivateDeviceProgress,
      AuthActivateDeviceOutput
    >,
  ): void {
    const view = mapDeviceActivationTerminal(flowId, terminal);
    if (view) {
      this.state.view = view;
      return;
    }

    this.state.view = createDeviceActivationReadyView(flowId);
    if (terminal.error?.message) {
      this.state.authError = terminal.error.message;
    }
  }

  async #observeWatch(
    flowId: string,
    watch: AsyncIterable<
      OperationEvent<AuthActivateDeviceProgress, AuthActivateDeviceOutput>
    >,
    runId: number,
  ): Promise<boolean> {
    const iterator = watch[Symbol.asyncIterator]();

    while (true) {
      const next = await iterator.next();
      if (next.done) {
        return false;
      }

      const event = next.value;
      if (!this.#isRunActive(runId)) {
        await iterator.return?.();
        return false;
      }

      if (
        event.type === "completed" || event.type === "failed" ||
        event.type === "cancelled"
      ) {
        this.#applyTerminal(flowId, event.snapshot);
        return true;
      }

      if (event.type === "progress") {
        this.state.view = mapDeviceActivationProgress(flowId, event.progress);
      }
    }
  }
}
