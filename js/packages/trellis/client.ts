import type { NatsConnection } from "@nats-io/nats-core";
import { CONTRACT_STATE_METADATA } from "./contract_support/mod.ts";
import type { ContractStateMetadata } from "./contract_support/mod.ts";
import type { TrellisAPI } from "./contracts.ts";

import type { LoggerLike } from "./globals.ts";
import type { RuntimeStateStoresForContract, TrellisAuth } from "./trellis.ts";
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

type ClientContract<TApi, TContract> = {
  CONTRACT: TContract;
  API: {
    owned?: TApi;
    trellis?: TApi;
  };
  readonly [CONTRACT_STATE_METADATA]?: ContractStateMetadata;
};

type ClientContractManifest = {
  state?: Readonly<Record<string, unknown>>;
  schemas?: Readonly<Record<string, unknown>>;
};

type ClientContractShape = {
  CONTRACT: ClientContractManifest;
  API: {
    owned?: TrellisAPI;
    trellis?: TrellisAPI;
  };
  readonly [CONTRACT_STATE_METADATA]?: ContractStateMetadata;
};

type ClientContractForApi<TApi extends TrellisAPI> = ClientContract<
  TApi,
  ClientContractManifest
>;

type ApiForClientContract<TContract extends ClientContractShape> =
  TContract extends { API: { trellis: infer TApi } }
    ? TApi extends TrellisAPI ? TApi : never
    : TContract extends { API: { owned: infer TApi } }
      ? TApi extends TrellisAPI ? TApi : never
    : never;

/**
 * Create a Trellis client typed from a contract module's derived outbound surface.
 */
export function createClient<TContract extends ClientContractShape>(
  contract: TContract,
  nats: NatsConnection,
  auth: TrellisAuth,
  opts?: ClientOpts,
): Trellis<
  ApiForClientContract<TContract>,
  "client",
  RuntimeStateStoresForContract<TContract>
>;
export function createClient<
  TApi extends TrellisAPI,
  TContract extends ClientContractForApi<TApi> = ClientContractForApi<TApi>,
>(
  contract: TContract,
  nats: NatsConnection,
  auth: TrellisAuth,
  opts?: ClientOpts,
): Trellis<TApi, "client", RuntimeStateStoresForContract<TContract>>;
export function createClient<
  TContract extends ClientContractShape,
>(
  contract: TContract,
  nats: NatsConnection,
  auth: TrellisAuth,
  opts?: ClientOpts,
): unknown {
  const api = contract.API.trellis ?? contract.API.owned;
  if (!api) {
    throw new Error("Contract is missing an owned or trellis API view");
  }

  return new Trellis<
    TrellisAPI,
    "client",
    RuntimeStateStoresForContract<ClientContractShape>
  >(
    opts?.name ?? "client",
    nats,
    auth,
    {
      log: opts?.log,
      timeout: opts?.timeout,
      stream: opts?.stream,
      noResponderRetry: opts?.noResponderRetry,
      api,
      state: contract[CONTRACT_STATE_METADATA],
    },
  );
}

async function loadCoreApi(): Promise<TrellisAPI> {
  try {
    const mod = await import("@qlever-llc/trellis/sdk/core") as CoreSdkModule;
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
