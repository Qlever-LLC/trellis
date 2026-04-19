import { AsyncResult } from "@qlever-llc/result";
import type { BaseError, MaybeAsync, Result } from "@qlever-llc/result";
import { resolve } from "$app/paths";
import type { EventOpts } from "../../../../packages/trellis/trellis.ts";
import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
import type { InferSchemaType } from "@qlever-llc/trellis/contracts";
import { createAuthState, getTrellis as getProviderTrellis } from "@qlever-llc/trellis-svelte";
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
  ): AsyncResult<RpcOutput<TMethod>, BaseError>;
  request<T = unknown>(
    method: string,
    input: unknown,
    opts?: RequestOpts,
  ): AsyncResult<T, BaseError>;
  event(
    method: "Health.Heartbeat",
    subjectData: Record<string, unknown>,
    fn: (heartbeat: HealthHeartbeat) => MaybeAsync<void, BaseError>,
    opts?: EventOpts,
  ): AsyncResult<void, BaseError>;
};

type RuntimeTrellis = {
  request(
    method: string,
    input: unknown,
    opts?: RequestOpts,
  ): AsyncResult<unknown, BaseError>;
  event(
    method: "Health.Heartbeat",
    subjectData: Record<string, unknown>,
    fn: (heartbeat: HealthHeartbeat) => MaybeAsync<void, BaseError>,
    opts?: EventOpts,
  ): AsyncResult<void, BaseError>;
};

export const auth = createAuthState({
  authUrl: APP_CONFIG.authUrl,
  contract: trellisApp,
  loginPath: resolve("/login"),
});

function request<TMethod extends RpcMethodName>(
  method: TMethod,
  input: RpcInput<TMethod>,
  opts?: RequestOpts,
): AsyncResult<RpcOutput<TMethod>, BaseError>;
function request<T = unknown>(
  method: string,
  input: unknown,
  opts?: RequestOpts,
): AsyncResult<T, BaseError>;
function request(
  this: { createLiveClient: () => Promise<RuntimeTrellis> },
  method: string,
  input: unknown,
  opts?: RequestOpts,
): AsyncResult<unknown, BaseError> {
  return AsyncResult.from((async () => {
    const trellis = await this.createLiveClient();
    return await trellis.request(method, input, opts);
  })());
}

export function getTrellis(): Promise<AppTrellis> {
  const liveClientPromise = getProviderTrellis<AppApi>() as unknown as Promise<RuntimeTrellis>;

  const createLiveClient = async (): Promise<RuntimeTrellis> => {
    return await liveClientPromise;
  };

  const liveTrellis: AppTrellis & { createLiveClient: typeof createLiveClient } = {
    createLiveClient,
    request,
    event: function (
      method: "Health.Heartbeat",
      subjectData: Record<string, unknown>,
      fn: (heartbeat: HealthHeartbeat) => MaybeAsync<void, BaseError>,
      opts?: EventOpts,
    ): AsyncResult<void, BaseError> {
      return AsyncResult.from((async () => {
        const trellis = await this.createLiveClient();
        return await trellis.event(method, subjectData, fn, opts);
      })());
    },
  };

  return Promise.resolve(liveTrellis);
}
