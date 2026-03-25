import type { NatsConnection } from "@nats-io/nats-core";
import { getPublicSessionKey, signBytes } from "@trellis/auth";
import { defineContract, type TrellisAPI } from "@trellis/contracts";
import { type ClientOpts, createClient, type Trellis, type TrellisAuth } from "@trellis/trellis";
import type { AuthState } from "./auth.svelte.ts";
import type { NatsState } from "./nats.svelte.ts";

export type TrellisClientContract<TApi extends TrellisAPI = TrellisAPI> = {
  CONTRACT: Record<string, unknown>;
  CONTRACT_DIGEST: string;
  API: {
    trellis: TApi;
  };
};

export type TrellisStateConfig<TApi extends TrellisAPI = TrellisAPI> = {
  serviceName: string;
  contract?: TrellisClientContract<TApi>;
};

const DEFAULT_TRELLIS_CONTRACT = defineContract({
  id: "trellis.svelte.browser@v1",
  displayName: "Trellis Svelte Browser Client",
  description: "Represent a browser client that only uses its locally declared Trellis APIs.",
  kind: "browser",
});

/**
 * Svelte 5 wrapper for Trellis client.
 *
 * Manages:
 * - Trellis client instance
 * - Session-key based request signing
 */
export class TrellisState {
  readonly trellis: Trellis<TrellisAPI>;

  private constructor(trellis: Trellis<TrellisAPI>) {
    this.trellis = trellis;
  }

  /**
   * Create a TrellisState instance with proper authentication.
   */
  static async create<TApi extends TrellisAPI = TrellisAPI>(
    authState: AuthState,
    natsState: NatsState,
    config: TrellisStateConfig<TApi>,
  ): Promise<TrellisState> {
    const handle = await authState.init();
    const contract = (config.contract ?? DEFAULT_TRELLIS_CONTRACT) as TrellisClientContract<TApi>;
    const trellis = createClient(
      contract,
      natsState.nc,
      {
        sessionKey: getPublicSessionKey(handle),
        sign: (data: Uint8Array) => signBytes(handle, data),
      },
      { name: config.serviceName },
    ) as unknown as Trellis<TrellisAPI>;
    return new TrellisState(trellis);
  }

  stop(): void {
    // no-op (kept for convenience)
  }
}

/**
 * Factory function to create a TrellisState instance.
 */
export async function createTrellisState<TApi extends TrellisAPI = TrellisAPI>(
  authState: AuthState,
  natsState: NatsState,
  config: TrellisStateConfig<TApi>,
): Promise<TrellisState> {
  return TrellisState.create(authState, natsState, config);
}
