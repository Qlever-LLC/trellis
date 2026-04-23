import { defineAppContract } from "../../../trellis/contract.ts";
import { CONTRACT_STATE_METADATA } from "../../../trellis/contract_support/mod.ts";
import type { TrellisClientConnection } from "../../../trellis/client_connect.ts";
import type { TrellisAPI, TrellisContractV1 } from "../../../trellis/contracts.ts";
import type { RuntimeStateStoresForContract, Trellis } from "../../../trellis/trellis.ts";
import { createClient } from "../../../trellis/client.ts";
import { getPublicSessionKey, signBytes } from "../../../trellis/auth/browser.ts";
import type { AuthState } from "./auth.svelte.ts";
import type { NatsState } from "./nats.svelte.ts";
import type { Status } from "./nats.svelte.ts";

type TrellisClientApi = {
  rpc: Record<string, unknown>;
  operations: Record<string, unknown>;
  events: Record<string, unknown>;
  subjects: Record<string, unknown>;
};

export type TrellisClientContract<TApi extends TrellisClientApi = TrellisClientApi> = {
  CONTRACT: TrellisContractV1;
  CONTRACT_DIGEST: string;
  API: {
    trellis: TApi;
  };
};

export type TrellisStateConfig<TApi extends TrellisClientApi = TrellisClientApi> = {
  contract?: TrellisClientContract<TApi>;
};

type RuntimeStateShape = Record<string, { kind: "value" | "map"; value: unknown }>;

export type PublicTrellis<
  TA extends TrellisAPI = TrellisAPI,
  TState extends RuntimeStateShape = {},
> = {
  readonly jobs: TrellisClientConnection<TA, TState>["jobs"];
  readonly respondWithError: TrellisClientConnection<TA, TState>["respondWithError"];
  readonly request: TrellisClientConnection<TA, TState>["request"];
  readonly publish: TrellisClientConnection<TA, TState>["publish"];
  readonly event: TrellisClientConnection<TA, TState>["event"];
  readonly operation: TrellisClientConnection<TA, TState>["operation"];
  readonly wait: TrellisClientConnection<TA, TState>["wait"];
  readonly template: TrellisClientConnection<TA, TState>["template"];
  readonly state: TrellisClientConnection<TA, TState>["state"];
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: TA;
};

export type ConnectionState = {
  readonly status: Status;
  disconnect(): Promise<void>;
};

export type TrellisContractLike<
  TA extends TrellisAPI = TrellisAPI,
  TState extends RuntimeStateShape = RuntimeStateShape,
> = {
  CONTRACT_DIGEST: string;
  API: {
    trellis: TA;
  };
  readonly [CONTRACT_STATE_METADATA]?: TState;
};

export type TypedPublicTrellis<TContract extends TrellisContractLike = TrellisContractLike> =
  PublicTrellis<TContract["API"]["trellis"], RuntimeStateStoresForContract<TContract>>;

export function createPublicTrellis<
  TA extends TrellisAPI,
  TState extends RuntimeStateShape = {},
>(
  trellis: TrellisClientConnection<TA, TState>,
): PublicTrellis<TA, TState> {
  return {
    jobs: trellis.jobs,
    respondWithError: trellis.respondWithError,
    request: trellis.request,
    publish: trellis.publish,
    event: trellis.event,
    operation: trellis.operation,
    wait: trellis.wait,
    template: trellis.template,
    state: trellis.state,
    name: trellis.name,
    timeout: trellis.timeout,
    stream: trellis.stream,
    api: trellis.api,
  };
}

const DEFAULT_TRELLIS_CONTRACT = defineAppContract(
  () => ({
    id: "trellis.svelte.browser@v1",
    displayName: "Trellis Svelte Browser Client",
    description: "Represent a browser client that only uses its locally declared Trellis APIs.",
  }),
) satisfies TrellisClientContract<TrellisAPI>;

/**
 * Svelte 5 wrapper for Trellis client.
 *
 * Manages:
 * - Trellis client instance
 * - Session-key based request signing
 */
export class TrellisState<TApi extends TrellisClientApi = TrellisClientApi> {
  readonly trellis: Trellis;

  private constructor(trellis: Trellis) {
    this.trellis = trellis;
  }

  /**
   * Create a TrellisState instance with proper authentication.
   */
  static async create<TApi extends TrellisClientApi>(
    authState: AuthState,
    natsState: NatsState,
    config: TrellisStateConfig<TApi>,
  ): Promise<TrellisState<TApi>> {
    const handle = await authState.init();
    const contract = (config.contract ?? DEFAULT_TRELLIS_CONTRACT) as TrellisClientContract<TApi>;
    const clientName = typeof contract.CONTRACT.id === "string" && contract.CONTRACT.id.length > 0
      ? contract.CONTRACT.id
      : "client";
    const trellis = createClient(
      contract as TrellisClientContract<TrellisAPI>,
      natsState.nc,
      {
        sessionKey: getPublicSessionKey(handle),
        sign: (data: Uint8Array) => signBytes(handle, data),
      },
      { name: clientName },
    );
    return new TrellisState<TApi>(trellis);
  }

  static fromTrellis<TApi extends TrellisClientApi>(trellis: Trellis): TrellisState<TApi> {
    return new TrellisState<TApi>(trellis);
  }

  stop(): void {
    // no-op (kept for convenience)
  }
}

/**
 * Factory function to create a TrellisState instance.
 */
export async function createTrellisState<TApi extends TrellisClientApi>(
  authState: AuthState,
  natsState: NatsState,
  config: TrellisStateConfig<TApi>,
): Promise<TrellisState<TApi>> {
  return TrellisState.create<TApi>(authState, natsState, config);
}
