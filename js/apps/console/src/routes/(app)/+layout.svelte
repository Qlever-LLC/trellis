<script lang="ts">
  import { resolve } from "$app/paths";
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import type { Component, Snippet } from "svelte";
  import { onMount } from "svelte";
  import contract from "$lib/contract";
  import { contexts } from "$lib/trellis-context.svelte";
  import AuthenticatedApp from "../../lib/components/AuthenticatedApp.svelte";
  import { buildAppLoginUrl, getSelectedAuthUrl, persistSelectedAuthUrl } from "../../lib/config";
  import { errorMessage } from "../../lib/format";
  import { trellisUrl as fixedTrellisUrl } from "../../lib/trellis";

  type Props = {
    children: Snippet;
  };

  type ConsoleTrellisProviderProps = {
    children: Snippet;
    loading?: Snippet;
    contexts: typeof contexts;
    trellisUrl: string | undefined;
    contract: typeof contract;
    loginPath: string;
    onAuthRequired?: (redirectTo: string) => void;
    onAuthFailed?: (error: unknown) => void;
  };

  // @ts-expect-error Svelte hits deep instantiation on TrellisProvider's generic component type here; the local prop shape keeps the app-owned contexts boundary explicit.
  const ConsoleTrellisProvider: Component<ConsoleTrellisProviderProps> = TrellisProvider;

  let { children }: Props = $props();
  let initialized = $state(false);
  let authUrl = $state<string | undefined>(fixedTrellisUrl);

  onMount(() => {
    const selectedAuthUrl = getSelectedAuthUrl(window.location);
    if (selectedAuthUrl) {
      const persistedAuthUrl = persistSelectedAuthUrl(selectedAuthUrl);
      if (persistedAuthUrl) {
        authUrl = persistedAuthUrl;
      }
    }
    initialized = true;
  });

  function redirectToLogin(redirectTo: string): void {
    window.location.href = buildAppLoginUrl(
      redirectTo,
      window.location,
      undefined,
      authUrl,
      resolve("/login"),
    );
  }

  function handleAuthFailed(error: unknown): void {
    window.location.href = buildAppLoginUrl(
      window.location.pathname + window.location.search,
      window.location,
      errorMessage(error),
      authUrl,
      resolve("/login"),
    );
  }
</script>

{#if initialized}
  <ConsoleTrellisProvider
    {contexts}
    trellisUrl={authUrl}
    contract={contract}
    loginPath={resolve("/login")}
    onAuthRequired={redirectToLogin}
    onAuthFailed={handleAuthFailed}
  >
    {#snippet loading()}
      <div class="flex min-h-screen items-center justify-center px-4 py-10">
        <div class="card w-full max-w-sm bg-base-100 shadow-lg">
          <div class="card-body text-center gap-3">
            <h1 class="text-lg font-semibold">Connecting</h1>
            <span class="loading loading-spinner loading-md mx-auto"></span>
          </div>
        </div>
      </div>
    {/snippet}

    <AuthenticatedApp>
      {@render children()}
    </AuthenticatedApp>
  </ConsoleTrellisProvider>
{/if}
