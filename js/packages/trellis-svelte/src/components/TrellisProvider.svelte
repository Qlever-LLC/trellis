<script lang="ts">
  import type { NatsConnection } from "@nats-io/nats-core";
  import { AsyncResult } from "@qlever-llc/result";
  import type { Trellis, TrellisAPI } from "../../../trellis/trellis.ts";
  import { onDestroy } from "svelte";
  import type { Snippet } from "svelte";
  import {
    setAuthContext,
    setNatsStateContext,
    setTrellisContext,
  } from "../context.svelte.ts";
  import { createAuthState, type BindErrorResult } from "../state/auth.svelte.ts";
  import { createConnectedNatsState, type NatsState } from "../state/nats.svelte.ts";
  import {
    type TrellisClientContract,
  } from "../state/trellis.svelte.ts";
  import { TrellisClient } from "../../../trellis/client_connect.ts";

  type Props = {
    children: Snippet;
    loading?: Snippet;
    bindError?: Snippet<[BindErrorResult]>;
    trellisUrl: string;
    loginPath?: string;
    contract: TrellisClientContract;
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

  let {
    children,
    loading,
    bindError,
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
  }: Props = $props();

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
    trellis: Trellis<TrellisAPI>;
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
    const result = await AsyncResult.try(async () => {
      const auth = getProviderAuth();

      await auth.init();
      const bindResult = await auth.handleCallback();

      if (bindResult !== null && bindResult.status !== "bound") {
        bindErrorResult = bindResult;
        onBindError?.(bindResult);
        return null;
      }

      if (!auth.isAuthenticated) {
        handleAuthRequired();
        return null;
      }

      const trellis = await TrellisClient.connect({
        trellisUrl: requireTrellisUrl(),
        contract,
        auth: {
          handle: auth.handle ?? undefined,
        },
        onAuthRequired: ({ loginUrl }) => {
          onAuthExpired?.();
          const redirectTo = getRedirectTo();
          onAuthRequired?.(redirectTo);
          if (!onAuthRequired && typeof window !== "undefined") {
            window.location.href = loginUrl;
          }
        },
      });

      const natsState = await createConnectedNatsState(trellis.natsConnection, auth, {
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

      return {
        auth,
        nats: natsState,
        trellis,
      };
    });

    if (result.isErr()) {
      const error = result.error;
      getProviderAuth().clearAuth();
      onAuthFailed?.(error);
      throw error;
    }

    return result.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
  }

  const initPromise = isBrowser ? initialize() : null;
  const readyPromise: Promise<InitContext> | null = initPromise?.then((ctx) => {
    if (!ctx) {
      throw new Error("Trellis context is not available");
    }
    return ctx;
  }) ?? null;
  const natsStatePromise: Promise<NatsState> | null = readyPromise?.then((ctx) => ctx.nats) ?? null;
  const trellisPromise: Promise<Trellis<TrellisAPI>> | null = readyPromise?.then((ctx) => ctx.trellis) ?? null;
  const natsPromise: Promise<NatsConnection> | null = readyPromise?.then((ctx) => ctx.nats.nc) ?? null;

  if (readyPromise && natsStatePromise && trellisPromise && natsPromise) {
    void readyPromise.catch(() => {});
    setAuthContext(() => getProviderAuth());
    setNatsStateContext(natsStatePromise);
    setTrellisContext({
      trellis: trellisPromise,
      nats: natsPromise,
    });
  }

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
