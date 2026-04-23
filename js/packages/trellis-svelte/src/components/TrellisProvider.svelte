<script lang="ts">
  import type { TrellisAPI } from "../../../trellis/contracts.ts";
  import { onDestroy } from "svelte";
  import type { TrellisProviderProps } from "./TrellisProvider.types.ts";
  import { connectProviderTrellis, createProviderPublicTrellis } from "./TrellisProvider.impl.js";
  import { createAuthState, type BindErrorResult } from "../state/auth.svelte.ts";
  import { createConnectedNatsState, type NatsState } from "../state/nats.svelte.ts";
  import {
    type ConnectionState,
    type TrellisClientContract,
  } from "../state/trellis.svelte.ts";
  let {
    children,
    loading,
    bindError,
    contexts,
    trellisUrl,
    loginPath,
    contract,
    onAuthExpired,
    onAuthFailed,
    onAuthRequired,
    onBindError,
    onNatsConnecting,
    onNatsConnected,
    onNatsDisconnect,
    onNatsReconnecting,
    onNatsReconnect,
    onNatsError,
  }: ImplementationProps = $props();

  let bindErrorResult = $state<BindErrorResult | null>(null);
  let providerAuth = $state<ReturnType<typeof createAuthState> | null>(null);

  function getProviderAuth() {
    if (providerAuth === null) {
      providerAuth = createAuthState({ authUrl: trellisUrl, loginPath, contract });
    }

    providerAuth.setAuthUrl(trellisUrl);

    return providerAuth;
  }

  type InitContext = {
    auth: ReturnType<typeof createAuthState>;
    nats: NatsState;
  };
  type ProviderContract = TrellisClientContract<TrellisAPI>;
  type ImplementationContexts = {
    trellis: {
      getTrellis(): Promise<unknown>;
      setTrellis(trellis: Promise<unknown>): void;
    };
    auth: {
      getAuth(): ReturnType<typeof createAuthState>;
      setAuth(auth: ReturnType<typeof createAuthState>): void;
    };
    connectionState: {
      getConnectionState(): Promise<ConnectionState>;
      setConnectionState(connectionState: Promise<ConnectionState>): void;
    };
  };
  type ImplementationProps = Omit<TrellisProviderProps<ProviderContract>, "contexts"> & {
    contexts: ImplementationContexts;
  };
  const isBrowser = typeof window !== "undefined";

  function requireTrellisUrl(): string {
    const auth = getProviderAuth();
    const resolvedTrellisUrl = auth.authUrl;
    if (!resolvedTrellisUrl) {
      throw new Error("Trellis URL is not configured");
    }

    return resolvedTrellisUrl;
  }

  function getRedirectTo(): string {
    if (typeof window === "undefined") {
      return "/";
    }

    return window.location.pathname + window.location.search;
  }

  function getCurrentUrl(): URL {
    if (typeof window === "undefined") {
      return new URL("http://localhost/");
    }

    return new URL(window.location.href);
  }

  function redirectToLogin(redirectTo: string): void {
    if (typeof window === "undefined") return;

    const auth = getProviderAuth();
    const url = new URL(auth.loginPath, window.location.origin);
    url.searchParams.set("redirectTo", redirectTo);
    window.location.href = url.toString();
  }

  function handleAuthRequired(): void {
    const redirectTo = getRedirectTo();
    onAuthRequired?.(redirectTo);
    if (!onAuthRequired) {
      redirectToLogin(redirectTo);
    }
  }

  async function initialize(): Promise<InitContext | null> {
    try {
      const auth = getProviderAuth();
      const handle = await auth.init();
      const providerContract: ProviderContract = contract;

      const connectArgs = {
        trellisUrl: requireTrellisUrl(),
        contract: providerContract,
        auth: {
          handle,
          currentUrl: getCurrentUrl,
        },
        onAuthRequired: ({ loginUrl }) => {
          onAuthExpired?.();
          const redirectTo = getRedirectTo();
          onAuthRequired?.(redirectTo);
          if (!onAuthRequired && typeof window !== "undefined") {
            window.location.href = loginUrl;
          }
        },
      };
      const seedTrellis = await connectProviderTrellis(connectArgs);

      const natsState = await createConnectedNatsState(seedTrellis.natsConnection, {
        onConnecting: onNatsConnecting,
        onConnected: onNatsConnected,
        onDisconnect: onNatsDisconnect,
        onReconnecting: onNatsReconnecting,
        onReconnect: onNatsReconnect,
        onError: onNatsError,
        onAuthRequired: () => {
          onAuthExpired?.();
          handleAuthRequired();
        },
      });

      const connectionStatePromise: Promise<ConnectionState> = Promise.resolve({
        get status() {
          return natsState.status;
        },
        disconnect: () => natsState.disconnect(),
      });
      const publicTrellis = createProviderPublicTrellis(seedTrellis);
      contexts.auth.setAuth(auth);
      contexts.connectionState.setConnectionState(connectionStatePromise);
      contexts.trellis.setTrellis(Promise.resolve(publicTrellis));

      return {
        auth,
        nats: natsState,
      };
    } catch (error) {
      getProviderAuth().clearAuth();
      onAuthFailed?.(error);
      throw error;
    }
  }

  const initPromise = isBrowser ? initialize() : null;
  const readyPromise: Promise<InitContext> | null = initPromise?.then((ctx) => {
    if (!ctx) {
      throw new Error("Trellis context is not available");
    }
    return ctx;
  }) ?? null;
  readyPromise?.catch(() => {});

  onDestroy(() => {
    if (!readyPromise) return;

    void readyPromise.then((ctx) => {
      void ctx.nats.disconnect();
    });
  });
</script>

{#if !isBrowser}
  {#if loading}
    {@render loading()}
  {/if}
{:else}
  {#await initPromise}
    {#if loading}
      {@render loading()}
    {/if}
  {:then ctx}
    {#if bindErrorResult}
      {#if bindError}
        {@render bindError(bindErrorResult)}
      {/if}
    {:else if ctx}
      {@render children()}
    {/if}
  {/await}
{/if}
