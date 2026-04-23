import type { Snippet } from "svelte";
import type { TrellisProviderContexts } from "../context.svelte.ts";
import type { BindErrorResult } from "../state/auth.svelte.ts";
import type { TrellisClientContract } from "../state/trellis.svelte.ts";
import type { TrellisAPI } from "../../../trellis/contracts.ts";

export type TrellisProviderProps<TContract extends TrellisClientContract<TrellisAPI>> = {
  children: Snippet;
  loading?: Snippet;
  bindError?: Snippet<[BindErrorResult]>;
  contexts: TrellisProviderContexts<TContract>;
  trellisUrl: string;
  loginPath?: string;
  contract: TContract;
  onAuthExpired?: () => void;
  onAuthFailed?: (error: unknown) => void;
  onAuthRequired?: (redirectTo: string) => void;
  onBindError?: (result: BindErrorResult) => void;
  onNatsConnecting?: () => void;
  onNatsConnected?: () => void;
  onNatsDisconnect?: () => void;
  onNatsReconnecting?: () => void;
  onNatsReconnect?: () => void;
  onNatsError?: (error: Error) => void;
};
