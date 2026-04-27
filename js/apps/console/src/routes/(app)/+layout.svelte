<script lang="ts">
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import type { Component, Snippet } from "svelte";
  import { onMount } from "svelte";
  import { setSelectedTrellisUrl, trellisApp } from "$lib/trellis-context.svelte";
  import AuthenticatedApp from "../../lib/components/AuthenticatedApp.svelte";
  import { buildConsoleLoginUrl } from "../../lib/auth";
  import { APP_CONFIG, getSelectedAuthUrl, persistSelectedAuthUrl } from "../../lib/config";

  type Props = {
    children: Snippet;
  };
  type ConsoleTrellisProviderProps = {
    trellisApp: typeof trellisApp;
    auth: { redirectTo(): string };
    onAuthRequired(loginUrl: string): void;
    children: Snippet;
    loading: Snippet;
  };

  const ConsoleTrellisProvider = TrellisProvider as Component<ConsoleTrellisProviderProps>;

  let { children }: Props = $props();
  let initialized = $state(false);
  let authUrl = $state<string | undefined>(APP_CONFIG.authUrl);

  function currentPath(): string {
    return window.location.pathname + window.location.search;
  }

  onMount(() => {
    const selectedAuthUrl = getSelectedAuthUrl(window.location);
    if (selectedAuthUrl) {
      const persistedAuthUrl = persistSelectedAuthUrl(selectedAuthUrl);
      if (persistedAuthUrl) {
        authUrl = persistedAuthUrl;
      }
    }

    if (!authUrl) {
      window.location.href = buildConsoleLoginUrl({
        redirectTo: currentPath(),
        location: window.location,
      });
      return;
    }

    setSelectedTrellisUrl(authUrl);
    initialized = true;
  });

  function redirectToLogin(loginUrl: string): void {
    window.location.href = loginUrl;
  }
</script>

{#if initialized && authUrl}
  <ConsoleTrellisProvider
    {trellisApp}
    auth={{ redirectTo: () => window.location.href }}
    onAuthRequired={redirectToLogin}
  >
    {#snippet loading()}
      <div class="flex min-h-screen items-center justify-center bg-base-200 px-4 py-10">
        <div class="card trellis-card w-full max-w-sm border border-base-300 bg-base-100 shadow-none">
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
{:else}
  <div class="flex min-h-screen items-center justify-center bg-base-200 px-4 py-10">
    <div class="card trellis-card w-full max-w-sm border border-base-300 bg-base-100 shadow-none">
      <div class="card-body text-center gap-3">
        <h1 class="text-lg font-semibold">Redirecting to sign in</h1>
        <span class="loading loading-spinner loading-md mx-auto"></span>
      </div>
    </div>
  </div>
{/if}
