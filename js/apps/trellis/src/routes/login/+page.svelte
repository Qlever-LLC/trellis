<script lang="ts">
  import { createAuthState } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { trellisApp } from "../../contracts/trellis_app.ts";
  import { APP_CONFIG, getCanonicalLoopbackRedirectUrl } from "../../lib/config";
  import { errorMessage } from "../../lib/format";

  const auth = createAuthState({ authUrl: APP_CONFIG.authUrl, loginPath: "/login", contract: trellisApp });

  let authError = $state<string | null>(null);
  let ready = $state(false);

  function targetPath(): string {
    return page.url.searchParams.get("redirectTo") ?? "/profile";
  }

  function startHref(): string {
    const url = new URL("/login/start", page.url.origin);
    url.searchParams.set("redirectTo", targetPath());
    return url.pathname + url.search;
  }

  onMount(() => {
    if (!browser) return;

    authError = page.url.searchParams.get("authError");

    const canonicalRedirect = getCanonicalLoopbackRedirectUrl();
    if (canonicalRedirect) {
      window.location.replace(canonicalRedirect);
      return;
    }

    void (async () => {
      try {
        await auth.init();
        if (auth.isAuthenticated) {
          await goto(targetPath());
          return;
        }
      } catch (error) {
        authError = errorMessage(error);
      } finally {
        ready = true;
      }
    })();
  });
</script>

<svelte:head>
  <title>Sign In · Trellis</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-base-200 px-4">
  <div class="card w-full max-w-sm bg-base-100 shadow-lg">
    <div class="card-body gap-5">
      <div class="text-center">
        <h1 class="text-xl font-bold">Trellis</h1>
        <p class="text-sm text-base-content/60 mt-1">Sign in to continue</p>
      </div>

      {#if authError}
        <div class="alert alert-error text-sm">
          <span>{authError}</span>
        </div>
      {/if}

      {#if ready}
        <form class="space-y-3" onsubmit={(e) => e.preventDefault()}>
          <div class="form-control">
            <label class="label" for="email"><span class="label-text">Email</span></label>
            <input id="email" type="email" class="input input-bordered" placeholder="you@example.com" />
          </div>
          <div class="form-control">
            <label class="label" for="password"><span class="label-text">Password</span></label>
            <input id="password" type="password" class="input input-bordered" />
          </div>
          <button type="submit" class="btn btn-neutral btn-block" disabled>Sign in</button>
        </form>

        <div class="divider text-xs text-base-content/40">OR</div>

        <a class="btn btn-outline btn-block gap-2" href={startHref()}>
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          Continue with GitHub
        </a>
      {:else}
        <div class="flex justify-center py-4">
          <span class="loading loading-spinner loading-md"></span>
        </div>
      {/if}
    </div>
  </div>
</div>
