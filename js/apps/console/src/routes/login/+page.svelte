<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import {
    APP_CONFIG,
    getCanonicalLoopbackRedirectUrl,
    getSelectedAuthUrl,
    persistSelectedAuthUrl
  } from "../../lib/config";
  import {
    getConsoleRedirectTarget,
    resolveConsolePath,
    startConsoleSignIn,
    auth,
    formatConsoleAuthError,
  } from "../../lib/auth";
  import Notice from "../../lib/components/Notice.svelte";
  import TrellisLogo from "../../lib/components/TrellisLogo.svelte";
  import { errorMessage } from "../../lib/format";

  let authError = $state<string | null>(null);
  let selectedAuthUrl = $state(APP_CONFIG.authUrl ?? "");
  let ready = $state(false);

  const requiresAuthUrl = $derived(!APP_CONFIG.authUrl);

  function targetPath(): string {
    return getConsoleRedirectTarget(page.url);
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
      await startConsoleSignIn({
        authUrl: selectedAuthUrl,
        redirectTo: targetPath(),
        location: page.url,
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

    const queryAuthError = page.url.searchParams.get("authError");
    authError = queryAuthError ? formatConsoleAuthError(queryAuthError) : null;
    selectedAuthUrl = getSelectedAuthUrl(page.url) ?? "";

    if (page.url.searchParams.has("flowId")) {
      void goto(resolveConsolePath(`/callback${page.url.search}`, page.url));
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
  <div class="card trellis-card w-full max-w-md border border-base-300 bg-base-100 shadow-none">
    <div class="card-body gap-5">
      <div class="flex flex-col items-center text-center" aria-labelledby="login-title">
        <TrellisLogo
          subtitle="Admin Console"
          class="gap-5"
          markClass="h-20 w-20"
          logoClass="h-18 w-18"
          titleClass="text-[2.45rem] font-bold leading-[0.88] tracking-[-0.055em] text-primary sm:text-[3.05rem]"
          subtitleClass="text-[0.7rem] font-semibold tracking-[0.42em] text-accent sm:text-[0.78rem]"
        />
        <h1 id="login-title" class="mt-5 text-xl font-semibold tracking-tight">Sign in to Trellis Console</h1>
      </div>

      {#if authError}
        <Notice variant="error" class="text-sm">{authError}</Notice>
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
            <label class="label" for="auth-url"><span class="label-text">Trellis endpoint</span></label>
            <input
              id="auth-url"
              bind:value={selectedAuthUrl}
              type="url"
              class="input input-bordered"
              placeholder={APP_CONFIG.authUrl ?? "https://auth.example.com"}
              required={requiresAuthUrl}
            />
          </div>
          <button type="submit" class="btn btn-primary btn-block gap-2">
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
