import { resolve } from "$app/paths";
import { AsyncResult } from "@qlever-llc/result";
import type { BaseError, MaybeAsync } from "@qlever-llc/result";
import type { EventOpts } from "../../../../packages/trellis/trellis.ts";
import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
import { createAuthState } from "@qlever-llc/trellis-svelte";
import { trellisApp } from "../../contracts/trellis_app.ts";
import { APP_CONFIG } from "./config.ts";
import { getTrellis as getContextTrellis } from "./trellis-context.svelte.ts";

type RequestOpts = { timeout?: number };
type RuntimeTrellis = {
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

type AppTrellis = {
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

export const auth = createAuthState({
  authUrl: APP_CONFIG.authUrl,
  contract: trellisApp,
  loginPath: resolve("/login"),
});

function request<T = unknown>(
  this: { createLiveClient: () => Promise<RuntimeTrellis> },
  method: string,
  input: unknown,
  opts?: RequestOpts,
): AsyncResult<T, BaseError> {
  return AsyncResult.from((async () => {
    const trellis = await this.createLiveClient();
    return await trellis.request(method, input, opts);
  })());
}

export function getTrellis(): Promise<AppTrellis> {
  const liveClientPromise: Promise<RuntimeTrellis> = getContextTrellis().then((trellis: unknown) => trellis as RuntimeTrellis);

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
