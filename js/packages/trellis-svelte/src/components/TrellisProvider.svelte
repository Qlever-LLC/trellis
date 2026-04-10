<script lang="ts">
  import type { NatsConnection } from "@nats-io/nats-core";
  import { AsyncResult } from "@qlever-llc/result";
  import { onDestroy } from "svelte";
  import type { Snippet } from "svelte";
  import {
    setAppContext,
    setAuthContext,
    setNatsStateContext,
    setTrellisContext,
  } from "../context.svelte.ts";
  import type { AuthState, BindErrorResult } from "../state/auth.svelte.ts";
  import { createNatsState, type NatsState } from "../state/nats.svelte.ts";
  import { createTrellisState, type TrellisState } from "../state/trellis.svelte.ts";

  type TrellisApp = {
    auth: AuthState;
  };

  type Props = {
    children: Snippet;
    loading?: Snippet;
    bindError?: Snippet<[BindErrorResult]>;
    app: TrellisApp;
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
    app,
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

  type InitContext = {
    auth: AuthState;
    nats: NatsState;
    trellis: TrellisState;
  };
  const isBrowser = typeof window !== "undefined";

  function getRedirectTo(): string {
    if (typeof window === "undefined") {
      return "/";
    }

    return window.location.pathname + window.location.search;
  }

  function redirectToLogin(redirectTo: string): void {
    if (typeof window === "undefined") return;

    const url = new URL(app.auth.loginPath, window.location.origin);
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
      const authState = app.auth;

      await authState.init();
      const bindResult = await authState.handleCallback();
      authState.cleanupCallbackUrl();

      if (bindResult !== null && bindResult.status !== "bound") {
        bindErrorResult = bindResult;
        onBindError?.(bindResult);
        return null;
      }

      if (!authState.isAuthenticated) {
        handleAuthRequired();
        return null;
      }

      const natsState = await createNatsState(authState, {
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

      const trellisState = await createTrellisState(authState, natsState, {
        contract: authState.contract,
      });

      return {
        auth: authState,
        nats: natsState,
        trellis: trellisState,
      };
    });

    if (result.isErr()) {
      const error = result.error;
      app.auth.clearAuth();
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
  const trellisPromise: Promise<TrellisState["trellis"]> | null = readyPromise?.then((ctx) => ctx.trellis.trellis) ?? null;
  const natsPromise: Promise<NatsConnection> | null = readyPromise?.then((ctx) => ctx.nats.nc) ?? null;

  if (readyPromise && natsStatePromise && trellisPromise && natsPromise) {
    void readyPromise.catch(() => {});
    setAppContext(() => app);
    setAuthContext(() => app.auth);
    setNatsStateContext(natsStatePromise);
    setTrellisContext({
      trellis: trellisPromise,
      nats: natsPromise,
    });
  }

  onDestroy(() => {
    if (!readyPromise) return;

    void readyPromise.then((ctx) => {
      ctx.trellis.stop();
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
