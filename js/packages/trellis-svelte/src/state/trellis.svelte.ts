import { defineAppContract } from "../../../trellis/contract.ts";
import type { TrellisAPI, TrellisContractV1 } from "../../../trellis/contracts.ts";
import type { Trellis } from "../../../trellis/trellis.ts";
import { createClient } from "../../../trellis/client.ts";
import { getPublicSessionKey, signBytes } from "@qlever-llc/trellis/auth/browser";
import type { AuthState } from "./auth.svelte.ts";
import type { NatsState } from "./nats.svelte.ts";

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
