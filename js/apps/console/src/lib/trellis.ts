import { AsyncResult } from "@qlever-llc/result";
import type { BaseError, MaybeAsync } from "@qlever-llc/result";
import type { EventOpts } from "@qlever-llc/trellis";
import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
import type { InferSchemaType } from "@qlever-llc/trellis/contracts";
import {
  type ConnectionState,
} from "@qlever-llc/trellis-svelte";
import contract from "./contract.ts";
import { APP_CONFIG } from "./config.ts";
import {
  getAuth as getAuthContext,
  getConnectionState as getConnectionStateContext,
  getTrellis as getTrellisContext,
} from "./trellis-context.svelte.ts";

export { contract };
export type { ConnectionState };

type AppApi = typeof contract.API.trellis;
type RequestOpts = { timeout?: number };
type RpcMethodName = keyof AppApi["rpc"] & string;
type RpcInput<TMethod extends RpcMethodName> = InferSchemaType<AppApi["rpc"][TMethod]["input"]>;
type RpcOutput<TMethod extends RpcMethodName> = InferSchemaType<AppApi["rpc"][TMethod]["output"]>;

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

export type AppTrellis = {
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

export const trellisUrl = APP_CONFIG.authUrl;

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
  const createLiveClient = (): Promise<RuntimeTrellis> => {
    return getTrellisContext() as Promise<RuntimeTrellis>;
  };

  const liveTrellis: AppTrellis & { createLiveClient: typeof createLiveClient } = {
    createLiveClient,
    request,
    event(
      method: "Health.Heartbeat",
      subjectData: Record<string, unknown>,
      fn: (heartbeat: HealthHeartbeat) => MaybeAsync<void, BaseError>,
      opts?: EventOpts,
    ) {
      return AsyncResult.from((async () => {
        const trellis = await this.createLiveClient();
        return await trellis.event(method, subjectData, fn, opts);
      })());
    },
  };

  return Promise.resolve(liveTrellis);
}

export function getAuth() {
  return getAuthContext();
}

export function getConnectionState() {
  return getConnectionStateContext();
}
