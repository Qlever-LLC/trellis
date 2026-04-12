import {
  defineContract,
  type Trellis,
  type TrellisAPI,
  type TrellisContractV1,
} from "@qlever-llc/trellis";
import { TrellisClient } from "../../../trellis/client_connect.ts";
import { createClient } from "../../../trellis/client.ts";
import { getPublicSessionKey, signBytes } from "@qlever-llc/trellis/auth";
import type { AuthState } from "./auth.svelte.ts";
import type { NatsState } from "./nats.svelte.ts";

export type TrellisClientContract<TApi extends TrellisAPI = TrellisAPI> = {
  CONTRACT: TrellisContractV1;
  CONTRACT_DIGEST: string;
  API: {
    trellis: TApi;
  };
};

export type TrellisStateConfig<TApi extends TrellisAPI = TrellisAPI> = {
  contract?: TrellisClientContract<TApi>;
};

const DEFAULT_TRELLIS_CONTRACT = defineContract({
  id: "trellis.svelte.browser@v1",
  displayName: "Trellis Svelte Browser Client",
  description: "Represent a browser client that only uses its locally declared Trellis APIs.",
  kind: "app",
}) satisfies TrellisClientContract<TrellisAPI>;

/**
 * Svelte 5 wrapper for Trellis client.
 *
 * Manages:
 * - Trellis client instance
 * - Session-key based request signing
 */
export class TrellisState<TApi extends TrellisAPI = TrellisAPI> {
  readonly trellis: Trellis<TApi>;

  private constructor(trellis: Trellis<TApi>) {
    this.trellis = trellis;
  }

  /**
   * Create a TrellisState instance with proper authentication.
   */
  static async create<TApi extends TrellisAPI>(
    authState: AuthState,
    natsState: NatsState,
    config: TrellisStateConfig<TApi>,
  ): Promise<TrellisState<TApi>> {
    const handle = await authState.init();
    const contract = (config.contract ?? DEFAULT_TRELLIS_CONTRACT) as TrellisClientContract<TApi>;
    const clientName = typeof contract.CONTRACT.id === "string" && contract.CONTRACT.id.length > 0
      ? contract.CONTRACT.id
      : "client";
    const trellis = createClient<TApi>(
      contract,
      natsState.nc,
      {
        sessionKey: getPublicSessionKey(handle),
        sign: (data: Uint8Array) => signBytes(handle, data),
      },
      { name: clientName },
    );
    return new TrellisState<TApi>(trellis);
  }

  static fromTrellis<TApi extends TrellisAPI>(trellis: Trellis<TApi>): TrellisState<TApi> {
    return new TrellisState<TApi>(trellis);
  }

  stop(): void {
    // no-op (kept for convenience)
  }
}

/**
 * Factory function to create a TrellisState instance.
 */
export async function createTrellisState<TApi extends TrellisAPI>(
  authState: AuthState,
  natsState: NatsState,
  config: TrellisStateConfig<TApi>,
): Promise<TrellisState<TApi>> {
  return TrellisState.create<TApi>(authState, natsState, config);
}
