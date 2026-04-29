<script lang="ts" generics="TContract extends TrellisContractLike">
  import {
    ClientAuthHandledError,
    TrellisClient,
    type ClientAuthOptions,
    type ConnectedTrellisClient,
  } from "@qlever-llc/trellis";
  import { onMount } from "svelte";
  import type { TrellisContractLike } from "../context.svelte.ts";
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

  type SerializableTrellisError = {
    message?: unknown;
    code?: unknown;
    hint?: unknown;
    context?: unknown;
  };

  function maybeSerializableError(
    value: unknown,
  ): SerializableTrellisError | undefined {
    if (!value || typeof value !== "object" || !("toSerializable" in value)) {
      return undefined;
    }
    const serialize = value.toSerializable;
    if (typeof serialize !== "function") return undefined;
    const serialized = serialize.call(value);
    return serialized && typeof serialized === "object"
      ? (serialized as SerializableTrellisError)
      : undefined;
  }

  function contextRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  function logConnectionError(error: unknown): void {
    const serialized = maybeSerializableError(error);
    const context = contextRecord(serialized?.context);
    const causeMessage =
      typeof context?.causeMessage === "string"
        ? context.causeMessage
        : undefined;
    const message =
      typeof serialized?.message === "string"
        ? serialized.message
        : error instanceof Error
          ? error.message
          : String(error);

    console.error("Error:", error);
  }

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
        currentUrl:
          authOptions?.currentUrl ?? (() => new URL(window.location.href)),
      };
    }

    const connectAuth = withBrowserAuthDefaults(auth);
    const trellisUrl = resolveTrellisAppUrl(trellisApp.trellisUrl);
    if (!trellisUrl) {
      connectError = new TypeError(
        "Expected trellisApp to resolve a Trellis URL",
      );
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
        logConnectionError(error);
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
  <TrellisContextProvider {trellisApp} {trellis} {children} />
{:else if connectError}
  {#if errorSnippet}
    {@render errorSnippet(connectError)}
  {/if}
{:else if loading}
  {@render loading()}
{/if}
