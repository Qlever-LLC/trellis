<script lang="ts">
  import { TrellisProvider } from "@qlever-llc/trellis-svelte";
  import type { Component, Snippet } from "svelte";
  import { onMount } from "svelte";
  import { setSelectedTrellisUrl, trellisApp } from "$lib/trellis-context.svelte";
  import AuthenticatedApp from "../../lib/components/AuthenticatedApp.svelte";
  import { auth, buildConsoleLoginUrl } from "../../lib/auth";
  import { isRecoverableConsoleAuthError } from "../../lib/auth_recovery";
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
    error: Snippet<[unknown]>;
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
    if (loginUrl) {
      window.location.href = loginUrl;
      return;
    }

    window.location.href = buildConsoleLoginUrl({
      redirectTo: currentPath(),
      location: window.location,
      authError: "Your session ended. Sign in again.",
    });
  }

  function connectionErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return "Trellis could not open the runtime connection.";
  }

  function retryConnection(): void {
    window.location.reload();
  }

  let recovering = $state(false);

  async function recoverAuth(): Promise<void> {
    if (recovering) return;
    recovering = true;
    await auth.resetSession();
    window.location.href = buildConsoleLoginUrl({
      redirectTo: currentPath(),
      location: window.location,
    });
  }

  function isRecoverableAuthError(error: unknown): boolean {
    return isRecoverableConsoleAuthError(error);
  }

  async function signInAgain(): Promise<void> {
    await auth.resetSession();
    window.location.href = buildConsoleLoginUrl({
      redirectTo: currentPath(),
      location: window.location,
    });
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

    {#snippet error(connectError)}
      {#if isRecoverableAuthError(connectError)}
        {@const _trigger = recoverAuth()}
        <div class="flex min-h-screen items-center justify-center bg-base-200 px-4 py-10">
          <div class="card trellis-card w-full max-w-sm border border-base-300 bg-base-100 shadow-none">
            <div class="card-body text-center gap-3">
              <h1 class="text-lg font-semibold">Connecting</h1>
              <span class="loading loading-spinner loading-md mx-auto"></span>
            </div>
          </div>
        </div>
      {:else}
        <div class="flex min-h-screen items-center justify-center bg-base-200 px-4 py-10">
          <div class="card trellis-card w-full max-w-md border border-base-300 bg-base-100 shadow-none">
            <div class="card-body gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-error">Runtime connection</p>
                <h1 class="text-lg font-semibold">Connection failed</h1>
              </div>
              <p class="text-sm text-base-content/70">{connectionErrorMessage(connectError)}</p>
              <div class="flex flex-wrap gap-2">
                <button class="btn btn-outline btn-sm" onclick={retryConnection}>Retry</button>
                <button class="btn btn-ghost btn-sm" onclick={signInAgain}>Sign in again</button>
              </div>
            </div>
          </div>
        </div>
      {/if}
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
