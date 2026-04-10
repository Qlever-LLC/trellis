import type { NatsConnection } from "@nats-io/nats-core";
import type { TrellisAPI } from "./contracts.ts";

import type { LoggerLike } from "./globals.ts";
import type { TrellisAuth } from "./trellis.ts";
import { Trellis } from "./trellis.ts";

type NoResponderRetryOpts = {
  maxAttempts?: number;
  baseDelayMs?: number;
};

export type ClientOpts = {
  /**
   * Logical name for this client instance (used for logs and consumer names).
   * Defaults to "client".
   */
  name?: string;
  log?: LoggerLike;
  timeout?: number;
  stream?: string;
  noResponderRetry?: NoResponderRetryOpts;
};

type ClientContract<TApi> = {
  API: {
    owned?: TApi;
    trellis?: TApi;
  };
};

/**
 * Create a Trellis client typed from a contract module's derived outbound surface.
 */
export function createClient<TApi extends TrellisAPI>(
  contract: ClientContract<TApi>,
  nats: NatsConnection,
  auth: TrellisAuth,
  opts?: ClientOpts,
): Trellis<TApi> {
  const api = contract.API.trellis ?? contract.API.owned;
  if (!api) {
    throw new Error("Contract is missing an owned or trellis API view");
  }

  return new Trellis<TApi>(
    opts?.name ?? "client",
    nats,
    auth,
    {
      log: opts?.log,
      timeout: opts?.timeout,
      stream: opts?.stream,
      noResponderRetry: opts?.noResponderRetry,
      api,
    },
  );
}
