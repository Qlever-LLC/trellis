<script lang="ts">
  import type { NatsConnection } from "@nats-io/nats-core";
  import { AsyncResult } from "@qlever-llc/trellis-result";
  import type { Snippet } from "svelte";
  import { onDestroy } from "svelte";
  import {
    setAuthContext,
    setNatsStateContext,
    setTrellisContext,
  } from "../context.svelte.ts";
  import { type AuthState, type AuthStateConfig, type BindErrorResult, createAuthState } from "../state/auth.svelte.ts";
  import { createNatsState, type NatsState } from "../state/nats.svelte.ts";
  import {
    createTrellisState,
    type TrellisClientContract,
    type TrellisState,
  } from "../state/trellis.svelte.ts";

  type Props = {
    children: Snippet;
    loading?: Snippet;
    authUrl: string;
    natsServers: string[];
    serviceName?: string;
    contract?: TrellisClientContract;
    loginPath?: string;
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

  const {
    children,
    loading,
    authUrl,
    natsServers,
    serviceName = "app",
    contract,
    loginPath = "/login",
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

  type InitContext = {
    auth: AuthState;
    nats: NatsState;
    trellis: TrellisState;
  };

  class AuthRequiredError extends Error {
    constructor() {
      super("Authentication required");
    }
  }

  class BindFailedError extends Error {
    constructor() {
      super("Bind failed");
    }
  }

  function createProviderAuthState(): AuthState {
    const config: AuthStateConfig = {
      authUrl,
      loginPath,
      contract,
    };

    return createAuthState(config);
  }

  const authState = createProviderAuthState();

  function getRedirectTo(): string {
    if (typeof window === "undefined") {
      return "/";
    }

    return window.location.pathname + window.location.search;
  }

  async function initialize(): Promise<InitContext> {
    const result = await AsyncResult.try(async () => {
      await authState.init();
      const bindResult = await authState.handleCallback();
      authState.cleanupCallbackUrl();

      if (bindResult !== null && bindResult.status !== "bound") {
        onBindError?.(bindResult);
        throw new BindFailedError();
      }

      if (!authState.isAuthenticated) {
        onAuthRequired?.(getRedirectTo());
        throw new AuthRequiredError();
      }

      const effectiveNatsServers = authState.natsServers ?? natsServers;
      const natsState = await createNatsState(authState, {
        servers: effectiveNatsServers,
        onConnecting: onNatsConnecting,
        onConnected: onNatsConnected,
        onDisconnect: onNatsDisconnect,
        onReconnecting: onNatsReconnecting,
        onReconnect: onNatsReconnect,
        onError: onNatsError,
        onAuthRequired: () => {
          onAuthRequired?.(getRedirectTo());
        },
      });

      const trellisState = await createTrellisState(authState, natsState, {
        serviceName,
        contract,
      });

      return {
        auth: authState,
        nats: natsState,
        trellis: trellisState,
      };
    });

    if (result.isErr()) {
      const error = result.error;
      if (error instanceof AuthRequiredError || error instanceof BindFailedError) {
        throw error;
      }
      authState.clearAuth();
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

  const initPromise = initialize();
  const natsStatePromise = initPromise.then((ctx) => ctx.nats) as Promise<NatsState>;
  const trellisPromise = initPromise.then((ctx) => ctx.trellis.trellis) as Promise<unknown>;
  const natsPromise = initPromise.then((ctx) => ctx.nats.nc) as Promise<NatsConnection>;

  setAuthContext(authState);
  setNatsStateContext(natsStatePromise);
  setTrellisContext({
    trellis: trellisPromise as never,
    nats: natsPromise,
  });

  onDestroy(() => {
    void initPromise.then((ctx) => {
      ctx.trellis.stop();
      void ctx.nats.disconnect();
    });
  });
</script>

{#await initPromise}
  {#if loading}
    {@render loading()}
  {/if}
{:then}
  {@render children()}
{/await}
