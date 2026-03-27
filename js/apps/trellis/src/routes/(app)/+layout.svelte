<script lang="ts">
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { trellisApp } from "../../contracts/trellis_app.ts";
  import AppShell from "../../lib/components/AppShell.svelte";
  import { APP_CONFIG, buildAppLoginUrl, getSelectedAuthUrl, persistSelectedAuthUrl } from "../../lib/config";
  import { errorMessage } from "../../lib/format";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();
  let authUrl = $state(APP_CONFIG.authUrl);

  onMount(() => {
    authUrl = persistSelectedAuthUrl(getSelectedAuthUrl(window.location));
  });

  function redirectToLogin(redirectTo: string): void {
    window.location.href = buildAppLoginUrl(redirectTo, window.location, undefined, authUrl);
  }

  function handleAuthFailed(error: unknown): void {
    window.location.href = buildAppLoginUrl(
      window.location.pathname + window.location.search,
      window.location,
      errorMessage(error),
      authUrl,
    );
  }
</script>

<TrellisProvider
  authUrl={authUrl}
  natsServers={APP_CONFIG.natsServers}
  serviceName="trellis-app"
  loginPath="/login"
  contract={trellisApp}
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
