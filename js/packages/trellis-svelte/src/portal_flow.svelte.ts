import {
  fetchPortalFlowState,
  portalFlowIdFromUrl,
  portalProviderLoginUrl,
  type BrowserPortalFlowState as PortalFlowState,
  submitPortalApproval,
  type AuthConfig,
} from "@qlever-llc/trellis/auth/browser";

export type CreatePortalFlowConfig = AuthConfig & {
  getUrl?: () => URL;
};

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

  #config: AuthConfig;
  #getUrl: () => URL;

  constructor(config: CreatePortalFlowConfig) {
    this.#config = { authUrl: config.authUrl };
    this.#getUrl = config.getUrl ?? defaultGetUrl;
  }

  async load(): Promise<PortalFlowState | null> {
    this.loading = true;
    this.error = null;
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

  async #submit(decision: "approved" | "denied"): Promise<PortalFlowState | null> {
    if (!this.flowId) {
      this.error = "Missing flow id.";
      return null;
    }

    this.loading = true;
    this.error = null;

    try {
      const state = await submitPortalApproval(this.#config, this.flowId, decision);
      this.state = state;
      return state;
    } catch (error) {
      this.error = errorMessage(error);
      return null;
    } finally {
      this.loading = false;
    }
  }
}

export function createPortalFlow(config: CreatePortalFlowConfig): PortalFlowController {
  return new PortalFlowController(config);
}
