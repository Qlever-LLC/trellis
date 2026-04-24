import type {
  ClientAuthOptions,
  ClientAuthRequiredContext,
  ClientOpts,
} from "@qlever-llc/trellis";
import type { Snippet } from "svelte";
import type { TrellisApp, TrellisContractLike } from "../context.svelte.ts";

/** Props accepted by the Svelte Trellis provider component. */
export type TrellisProviderProps<
  TContract extends TrellisContractLike = TrellisContractLike,
> = {
  app: TrellisApp<TContract>;
  trellisUrl: string;
  auth?: ClientAuthOptions;
  client?: ClientOpts;
  children: Snippet;
  loading?: Snippet;
  error?: Snippet<[unknown]>;
  onAuthRequired?: (
    loginUrl: string,
    context: ClientAuthRequiredContext,
  ) => void | Promise<void>;
};
