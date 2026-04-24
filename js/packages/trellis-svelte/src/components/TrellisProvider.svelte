<script lang="ts" generics="TContract extends TrellisContractLike">
  import {
    ClientAuthHandledError,
    TrellisClient,
    type ClientAuthOptions,
  } from "@qlever-llc/trellis";
  import { onMount } from "svelte";
  import type {
    ConnectedTrellisRuntime,
    TrellisContractLike,
  } from "../context.svelte.ts";
  import TrellisContextProvider from "./TrellisContextProvider.svelte";
  import type { TrellisProviderProps } from "./TrellisProvider.types.ts";

  const {
    app,
    trellisUrl,
    auth,
    client,
    children,
    loading,
    error: errorSnippet,
    onAuthRequired,
  }: TrellisProviderProps<TContract> = $props();

  let trellis = $state<ConnectedTrellisRuntime | null>(null);
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
        currentUrl: authOptions?.currentUrl ?? (() => new URL(window.location.href)),
      };
    }

    const connectAuth = withBrowserAuthDefaults(auth);

    void (async () => {
      try {
        const connected = await TrellisClient.connect({
          ...client,
          trellisUrl,
          contract: app.contract,
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
  <TrellisContextProvider {app} {trellis} {children} />
{:else if connectError}
  {#if errorSnippet}
    {@render errorSnippet(connectError)}
  {/if}
{:else if loading}
  {@render loading()}
{/if}
