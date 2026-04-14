<script lang="ts">
  import { resolve } from "$app/paths";
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import AppShell from "../../lib/components/AppShell.svelte";
  import { buildAppLoginUrl, getSelectedAuthUrl, persistSelectedAuthUrl } from "../../lib/config";
  import { errorMessage } from "../../lib/format";
  import { trellisApp } from "../../../contracts/trellis_app.ts";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();
  let initialized = $state(false);
  let authUrl = $state<string | undefined>(undefined);

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
    <TrellisProvider
      trellisUrl={authUrl}
      contract={trellisApp}
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

    <AppShell>
      {@render children()}
    </AppShell>
  </TrellisProvider>
{/if}
