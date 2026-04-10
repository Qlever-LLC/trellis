import type { NatsConnection } from "@nats-io/nats-core";
import type { TrellisAPI } from "./contracts.ts";

import type { LoggerLike } from "./globals.ts";
import type { TrellisAuth } from "./trellis.ts";
import { Trellis } from "./trellis.ts";

type CoreSdkModule = {
  API?: {
    trellis?: TrellisAPI;
  };
  core?: {
    API: {
      trellis: TrellisAPI;
    };
  };
};

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

async function loadCoreApi(): Promise<TrellisAPI> {
  try {
    const mod = await import("./sdk/core.ts") as CoreSdkModule;
    const api = mod.core?.API.trellis ?? mod.API?.trellis;
    if (api) {
      return api;
    }
  } catch (error) {
    throw new Error(
      "Failed to load the Trellis core SDK. Generate the core SDK first or use createClient(contract, ...) with an explicit contract API.",
      { cause: error },
    );
  }

  throw new Error(
    "Failed to load the Trellis core SDK API surface. Use createClient(contract, ...) with an explicit contract API if you do not need the generated core SDK.",
  );
}

export async function createCoreClient(
  nats: NatsConnection,
  auth: TrellisAuth,
  opts?: ClientOpts,
): Promise<Trellis<TrellisAPI>> {
  const api = await loadCoreApi();
  return new Trellis<TrellisAPI>(
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
