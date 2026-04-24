import { env } from "$env/dynamic/public";
import {
  bindFlow,
  type BindResponse,
  getOrCreateSessionKey,
  type SessionKeyHandle,
} from "@qlever-llc/trellis";
import { startAuthRequest } from "@qlever-llc/trellis/auth";
import type { TrellisClientFor } from "@qlever-llc/trellis-svelte";
import contract from "../../contract.ts";
import { trellisApp } from "./trellis-context.ts";

export type AppTrellis = TrellisClientFor<typeof contract>;

export function getTrellis(): AppTrellis;
export function getTrellis<TClient>(): TClient;
export function getTrellis<
  TClient = AppTrellis,
>(): TClient {
  return trellisApp.getTrellis<TClient>();
}

export function getConnection() {
  return trellisApp.getConnection();
}

function requirePublicTrellisUrl(): string {
  const value = env.PUBLIC_TRELLIS_URL?.trim() || "http://localhost:3000";

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch (error) {
    throw new Error(
      `Invalid PUBLIC_TRELLIS_URL ${JSON.stringify(value)}: ${
        (error as Error).message
      }`,
    );
  }
}

export const trellisUrl = requirePublicTrellisUrl();

type AuthCallbackResult =
  | BindResponse
  | { status: "approval_denied" }
  | { status: "approval_required" }
  | { status: "error"; message: string };

class DemoAuthState {
  #handle: SessionKeyHandle | null = null;

  async init(): Promise<SessionKeyHandle> {
    this.#handle ??= await getOrCreateSessionKey();
    return this.#handle;
  }

  async handleCallback(
    callbackUrl: string,
  ): Promise<AuthCallbackResult | null> {
    const flowId = new URL(callbackUrl).searchParams.get("flowId");
    if (!flowId) return null;

    try {
      return await bindFlow({ authUrl: trellisUrl }, await this.init(), flowId);
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async signIn(options: { redirectTo: string }): Promise<void> {
    const response = await startAuthRequest({
      authUrl: trellisUrl,
      redirectTo: options.redirectTo,
      handle: await this.init(),
      contract: contract.CONTRACT,
    });

    if (response.status === "flow_started") {
      window.location.href = response.loginUrl;
      return;
    }

    if (response.status === "bound") {
      window.location.href = options.redirectTo;
      return;
    }

    throw new Error("Authentication completed without a browser redirect");
  }
}

export const auth = new DemoAuthState();
