import type { BaseError, MaybeAsync, Result } from "@qlever-llc/result";
import { resolve } from "$app/paths";
import { getPublicSessionKey, signBytes } from "../../../../packages/trellis/auth/browser.ts";
import { createClient } from "../../../../packages/trellis/client.ts";
import type { EventOpts } from "../../../../packages/trellis/trellis.ts";
import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
import type { InferSchemaType } from "@qlever-llc/trellis/contracts";
import { createAuthState, getAuth, getNatsState } from "@qlever-llc/trellis-svelte";
import { trellisApp } from "../../contracts/trellis_app.ts";
import { APP_CONFIG } from "./config.ts";

type RequestOpts = { timeout?: number };
type AppApi = typeof trellisApp.API.trellis;
type RpcMethodName = keyof AppApi["rpc"] & string;
type RpcInput<TMethod extends RpcMethodName> = InferSchemaType<AppApi["rpc"][TMethod]["input"]>;
type RpcOutput<TMethod extends RpcMethodName> = InferSchemaType<AppApi["rpc"][TMethod]["output"]>;

type AppTrellis = {
  request<TMethod extends RpcMethodName>(
    method: TMethod,
    input: RpcInput<TMethod>,
    opts?: RequestOpts,
  ): Promise<Result<RpcOutput<TMethod>, BaseError>>;
  request<T = unknown>(
    method: string,
    input: unknown,
    opts?: RequestOpts,
  ): Promise<Result<T, BaseError>>;
  requestOrThrow<TMethod extends RpcMethodName>(
    method: TMethod,
    input: RpcInput<TMethod>,
    opts?: RequestOpts,
  ): Promise<RpcOutput<TMethod>>;
  requestOrThrow<T = unknown>(
    method: string,
    input: unknown,
    opts?: RequestOpts,
  ): Promise<T>;
  event(
    method: "Health.Heartbeat",
    subjectData: Record<string, unknown>,
    fn: (heartbeat: HealthHeartbeat) => MaybeAsync<void, BaseError>,
    opts?: EventOpts,
  ): Promise<Result<void, BaseError>>;
};

type RuntimeTrellis = {
  request(
    method: string,
    input: unknown,
    opts?: RequestOpts,
  ): Promise<Result<unknown, BaseError>>;
  requestOrThrow(
    method: string,
    input: unknown,
    opts?: RequestOpts,
  ): Promise<unknown>;
  event(
    method: "Health.Heartbeat",
    subjectData: Record<string, unknown>,
    fn: (heartbeat: HealthHeartbeat) => MaybeAsync<void, BaseError>,
    opts?: EventOpts,
  ): Promise<Result<void, BaseError>>;
};

export const auth = createAuthState({
  authUrl: APP_CONFIG.authUrl,
  contract: trellisApp,
  loginPath: resolve("/login"),
});

async function request<TMethod extends RpcMethodName>(
  method: TMethod,
  input: RpcInput<TMethod>,
  opts?: RequestOpts,
): Promise<Result<RpcOutput<TMethod>, BaseError>>;
async function request<T = unknown>(
  method: string,
  input: unknown,
  opts?: RequestOpts,
): Promise<Result<T, BaseError>>;
async function request(
  this: { createLiveClient: () => Promise<RuntimeTrellis> },
  method: string,
  input: unknown,
  opts?: RequestOpts,
): Promise<Result<unknown, BaseError>> {
  const trellis = await this.createLiveClient();
  return await trellis.request(method, input, opts);
}

async function requestOrThrow<TMethod extends RpcMethodName>(
  method: TMethod,
  input: RpcInput<TMethod>,
  opts?: RequestOpts,
): Promise<RpcOutput<TMethod>>;
async function requestOrThrow<T = unknown>(
  method: string,
  input: unknown,
  opts?: RequestOpts,
): Promise<T>;
async function requestOrThrow(
  this: { createLiveClient: () => Promise<RuntimeTrellis> },
  method: string,
  input: unknown,
  opts?: RequestOpts,
): Promise<unknown> {
  const trellis = await this.createLiveClient();
  return await trellis.requestOrThrow(method, input, opts);
}

export function getTrellis(): Promise<AppTrellis> {
  const authState = getAuth();
  const natsStatePromise = getNatsState();

  const createBrowserAuth = () => {
    const handle = authState.handle;
    if (!handle) {
      throw new Error("Not authenticated: missing session handle");
    }

    return {
      sessionKey: getPublicSessionKey(handle),
      sign: (data: Uint8Array) => signBytes(handle, data),
    };
  };

  const createLiveClient = async (): Promise<RuntimeTrellis> => {
    const natsState = await natsStatePromise;
    return createClient(trellisApp, natsState.nc, createBrowserAuth(), {
      name: "console",
    }) as unknown as RuntimeTrellis;
  };

  const liveTrellis: AppTrellis & { createLiveClient: typeof createLiveClient } = {
    createLiveClient,
    request,
    requestOrThrow,
    event: async function (
      method: "Health.Heartbeat",
      subjectData: Record<string, unknown>,
      fn: (heartbeat: HealthHeartbeat) => MaybeAsync<void, BaseError>,
      opts?: EventOpts,
    ): Promise<Result<void, BaseError>> {
      const trellis = await this.createLiveClient();
      return await trellis.event(method, subjectData, fn, opts);
    },
  };

  return Promise.resolve(liveTrellis);
}
