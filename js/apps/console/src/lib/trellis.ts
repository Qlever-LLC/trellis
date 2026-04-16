import type { BaseError, Result } from "@qlever-llc/result";
import { resolve } from "$app/paths";
import type { EventOpts, HealthHeartbeat } from "@qlever-llc/trellis";
import type { InferSchemaType } from "@qlever-llc/trellis/contracts";
import { createAuthState, getTrellis as getTrellisContext } from "@qlever-llc/trellis-svelte";
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
    fn: (heartbeat: HealthHeartbeat) => void | Promise<void>,
    opts?: EventOpts,
  ): Promise<Result<void, BaseError>>;
};

export const auth = createAuthState({
  authUrl: APP_CONFIG.authUrl,
  contract: trellisApp,
  loginPath: resolve("/login"),
});

export function getTrellis() {
  return getTrellisContext<AppTrellis>();
}
