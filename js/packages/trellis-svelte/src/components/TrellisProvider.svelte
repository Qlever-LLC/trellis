<script
  lang="ts"
  generics="TContract extends TrellisContractLike"
>
  import {
    ClientAuthHandledError,
    TrellisClient,
    type ClientAuthOptions,
    type ConnectedTrellisClient,
  } from "@qlever-llc/trellis";
  import { onMount } from "svelte";
  import type {
    TrellisContractLike,
  } from "../context.svelte.ts";
  import { resolveTrellisAppUrl } from "../context.svelte.ts";
  import TrellisContextProvider from "./TrellisContextProvider.svelte";
  import type { TrellisProviderProps } from "./TrellisProvider.types.ts";

  const {
    trellisApp,
    auth,
    client,
    children,
    loading,
    error: errorSnippet,
    onAuthRequired,
  }: TrellisProviderProps<TContract> = $props();

  let trellis = $state<ConnectedTrellisClient<TContract> | null>(null);
  let connectError = $state<unknown>(null);

  onMount(() => {
    let active = true;

    function withBrowserAuthDefaults(
      authOptions: ClientAuthOptions | undefined,
    ): ClientAuthOptions {
      if (authOptions?.mode === "session_key") {
        return authOptions;
      }

      return {
        ...authOptions,
        currentUrl: authOptions?.currentUrl ??
          (() => new URL(window.location.href)),
      };
    }

    const connectAuth = withBrowserAuthDefaults(auth);
    const trellisUrl = resolveTrellisAppUrl(trellisApp.trellisUrl);
    if (!trellisUrl) {
      connectError = new TypeError("Expected trellisApp to resolve a Trellis URL");
      return;
    }

    void (async () => {
      try {
        const connected = await TrellisClient.connect({
          ...client,
          trellisUrl,
          contract: trellisApp.contract,
          auth: connectAuth,
          onAuthRequired: onAuthRequired
            ? async (ctx) => {
              await onAuthRequired(ctx.loginUrl, ctx);
              return { status: "handled" };
            }
            : undefined,
        }).orThrow();

        if (active) {
          trellis = connected;
        } else {
          await connected.connection.close();
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof ClientAuthHandledError) return;
        connectError = error;
      }
    })();

    return () => {
      active = false;
      const connected = trellis;
      trellis = null;
      if (connected) {
        void connected.connection.close();
      }
    };
  });
</script>

{#if trellis}
  <TrellisContextProvider
    {trellisApp}
    {trellis}
    {children}
  />
{:else if connectError}
  {#if errorSnippet}
    {@render errorSnippet(connectError)}
  {/if}
{:else if loading}
  {@render loading()}
{/if}
