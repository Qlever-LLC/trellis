<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import {
    APP_CONFIG,
    buildAppCallbackUrl,
    getCanonicalLoopbackRedirectUrl,
    getSelectedAuthUrl,
    persistSelectedAuthUrl
  } from "../../lib/config";
  import { errorMessage } from "../../lib/format";
  import { auth } from "../../lib/trellis";

  let authError = $state<string | null>(null);
  let selectedAuthUrl = $state(APP_CONFIG.authUrl ?? "");
  let ready = $state(false);

  const requiresAuthUrl = $derived(!APP_CONFIG.authUrl);

  function targetPath(): string {
    return page.url.searchParams.get("redirectTo") ?? "/profile";
  }

  async function continueToSignIn(): Promise<void> {
    authError = null;

    const trimmedAuthUrl = selectedAuthUrl.trim();

    if (!trimmedAuthUrl) {
      selectedAuthUrl = "";
      authError = "Enter the Trellis auth URL to continue.";
      return;
    }

    const authUrl = persistSelectedAuthUrl(trimmedAuthUrl);
    selectedAuthUrl = authUrl ?? "";

    if (!authUrl) {
      authError = "Enter the Trellis auth URL to continue.";
      return;
    }

    try {
      await auth.signIn({
        authUrl: selectedAuthUrl,
        redirectTo: buildAppCallbackUrl(targetPath(), page.url, selectedAuthUrl),
      });
    } catch (error) {
      const message = errorMessage(error);
      if (!message.startsWith("Redirecting to")) {
        authError = message;
      }
    }
  }

  onMount(() => {
    if (!browser) return;

    authError = page.url.searchParams.get("authError");
    selectedAuthUrl = getSelectedAuthUrl(page.url) ?? "";

    if (page.url.searchParams.has("flowId")) {
      void goto(`/callback${page.url.search}`);
      return;
    }

    const canonicalRedirect = getCanonicalLoopbackRedirectUrl();
    if (canonicalRedirect) {
      window.location.replace(canonicalRedirect);
      return;
    }

    void (async () => {
      try {
        if (selectedAuthUrl) {
          auth.setAuthUrl(selectedAuthUrl);
        }
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
        <h1 class="text-xl font-bold">Trellis Admin Console</h1>
      </div>

      {#if authError}
        <div class="alert alert-error text-sm">
          <span>{authError}</span>
        </div>
      {/if}

      {#if ready}
        <form
          class="space-y-3"
          onsubmit={(event) => {
            event.preventDefault();
            void continueToSignIn();
          }}
        >
          <div class="form-control">
            <label class="label" for="auth-url"><span class="label-text">Trellis Instance URL</span></label>
            <input
              id="auth-url"
              bind:value={selectedAuthUrl}
              type="url"
              class="input input-bordered"
              placeholder={APP_CONFIG.authUrl ?? "https://auth.example.com"}
              required={requiresAuthUrl}
            />
          </div>
          <button type="submit" class="btn btn-block gap-2">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
            </svg>
            Continue to sign in
          </button>
        </form>
      {:else}
        <div class="flex justify-center py-4">
          <span class="loading loading-spinner loading-md"></span>
        </div>
      {/if}
    </div>
  </div>
</div>
