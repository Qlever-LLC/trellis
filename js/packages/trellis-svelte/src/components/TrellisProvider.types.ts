import type {
  ClientAuthOptions,
  ClientAuthRequiredContext,
  ClientOpts,
  ConnectedTrellisClient,
} from "@qlever-llc/trellis";
import type { Snippet } from "svelte";
import type {
  TrellisAppOwner,
  TrellisContractLike,
} from "../context.svelte.ts";

/** Props accepted by the Svelte Trellis provider component. */
export type TrellisProviderProps<
  TContract extends TrellisContractLike = TrellisContractLike,
> =
  & {
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
  }
  & (
    | {
      contract: TContract;
      setTrellis: (
        trellis: ConnectedTrellisClient<TContract>,
      ) => ConnectedTrellisClient<TContract>;
      app?: never;
    }
    | {
      app: TrellisAppOwner<TContract>;
      contract?: never;
      setTrellis?: never;
    }
  );
