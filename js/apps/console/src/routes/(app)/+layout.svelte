<script lang="ts">
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { trellisApp } from "$lib/trellis-context.svelte";
  import AuthenticatedApp from "../../lib/components/AuthenticatedApp.svelte";
  import { buildConsoleLoginUrl } from "../../lib/auth";
  import { getSelectedAuthUrl, persistSelectedAuthUrl } from "../../lib/config";
  import { trellisUrl as fixedTrellisUrl } from "../../lib/trellis";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();
  let initialized = $state(false);
  let authUrl = $state<string | undefined>(fixedTrellisUrl);

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

    initialized = true;
  });

  function redirectToLogin(loginUrl: string): void {
    window.location.href = loginUrl;
  }
</script>

{#if initialized && authUrl}
  <TrellisProvider
    app={trellisApp}
    trellisUrl={authUrl}
    auth={{ redirectTo: () => window.location.href }}
    onAuthRequired={redirectToLogin}
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
  </TrellisProvider>
{:else}
  <div class="flex min-h-screen items-center justify-center px-4 py-10">
    <div class="card w-full max-w-sm bg-base-100 shadow-lg">
      <div class="card-body text-center gap-3">
        <h1 class="text-lg font-semibold">Redirecting to sign in</h1>
        <span class="loading loading-spinner loading-md mx-auto"></span>
      </div>
    </div>
  </div>
{/if}
