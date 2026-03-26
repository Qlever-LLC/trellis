<script lang="ts">
  import { createAuthState } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { activityApp } from "../../contracts/activity_app.ts";
  import { APP_CONFIG, buildAppCallbackUrl } from "../../lib/config";
  import { errorMessage } from "../../lib/format";

  const auth = createAuthState({ authUrl: APP_CONFIG.authUrl, loginPath: "/login", contract: activityApp });

  let pending = $state(false);
  let ready = $state(false);
  let authError = $state<string | null>(null);

  function targetPath(): string {
    return page.url.searchParams.get("redirectTo") ?? "/activity";
  }

  onMount(async () => {
    if (!browser) return;

    try {
      await auth.init();
      if (auth.isAuthenticated) {
        await goto(targetPath());
        return;
      }
    } catch (nextError) {
      authError = errorMessage(nextError);
    } finally {
      ready = true;
    }
  });

  async function signIn(provider: string) {
    pending = true;
    authError = null;

    try {
      await auth.signIn(provider, buildAppCallbackUrl(targetPath()));
    } catch (nextError) {
      const message = errorMessage(nextError);
      if (!message.startsWith("Redirecting to")) {
        authError = message;
      }
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>Sign In · Activity Console</title>
</svelte:head>

<div class="min-h-screen px-4 py-8 md:px-6 lg:px-8" data-theme="activity">
  <div class="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col gap-6 lg:flex-row">
    <section class="card flex-1 border border-base-300/70 paper-panel shadow-2xl">
      <div class="card-body justify-between gap-8 p-6 md:p-8 lg:p-10">
        <div class="space-y-6">
          <div class="flex items-center gap-3">
            <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-content shadow-lg shadow-primary/20">
              <span class="display text-lg font-semibold">A</span>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.3em] text-primary/70">Trellis</p>
              <h1 class="display text-4xl text-base-content md:text-5xl">Activity console</h1>
            </div>
          </div>

          <p class="max-w-2xl text-base leading-7 text-base-content/70 md:text-lg">
            Sign in to inspect connection churn, session revocations, and operator interventions captured by the Activity projection.
          </p>
        </div>

        <div class="grid gap-4 md:grid-cols-3">
          <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">Signal</p>
            <p class="mt-2 text-sm text-base-content/75">Auth.Connect and Auth.Disconnect events in one feed.</p>
          </div>
          <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">Security</p>
            <p class="mt-2 text-sm text-base-content/75">Watch kicked connections and revoked sessions without opening the main admin app.</p>
          </div>
          <div class="rounded-box border border-base-300/60 bg-base-100/55 p-4">
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/45">Provider</p>
            <p class="mt-2 text-sm text-base-content/75">{APP_CONFIG.defaultProvider}</p>
          </div>
        </div>
      </div>
    </section>

    <aside class="card w-full border border-base-300/70 bg-base-100/80 shadow-2xl lg:max-w-md">
      <div class="card-body gap-6 p-6 md:p-8">
        <div class="space-y-2">
          <div class="badge badge-outline badge-primary">Operator sign-in</div>
          <h2 class="display text-3xl text-base-content">Enter the feed</h2>
          <p class="text-sm leading-6 text-base-content/70">Use the configured identity provider to bind a browser session key and attach to the realtime audit stream.</p>
        </div>

        <div class="stats stats-vertical border border-base-300/60 bg-base-200/35 shadow-sm">
          <div class="stat py-4">
            <div class="stat-title">Provider</div>
            <div class="stat-value text-lg text-primary">{APP_CONFIG.defaultProvider}</div>
          </div>
          <div class="stat py-4">
            <div class="stat-title">Auth service</div>
            <div class="stat-value mono break-all text-base text-base-content">{APP_CONFIG.authUrl}</div>
          </div>
        </div>

        <div class="space-y-3">
          <button class="btn btn-primary btn-block" disabled={!ready || pending} onclick={() => signIn(APP_CONFIG.defaultProvider)}>
            {#if pending}
              <span class="loading loading-spinner loading-sm"></span>
              Redirecting
            {:else}
              Continue with {APP_CONFIG.defaultProvider}
            {/if}
          </button>
          <a class="btn btn-ghost btn-block" href={APP_CONFIG.authUrl} target="_blank" rel="noreferrer">
            Open Auth service
          </a>
        </div>

        {#if authError}
          <div class="alert alert-error">
            <span>{authError}</span>
          </div>
        {/if}
      </div>
    </aside>
  </div>
</div>
