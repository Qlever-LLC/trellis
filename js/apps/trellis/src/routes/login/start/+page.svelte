<script lang="ts">
  import { buildLoginUrl } from "@trellis/auth";
  import { createAuthState } from "@trellis/svelte";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { trellisApp } from "../../../contracts/trellis_app.ts";
  import {
    APP_CONFIG,
    buildAppCallbackUrl,
    buildAppLoginUrl,
    getCanonicalLoopbackRedirectUrl
  } from "../../../lib/config";
  import { errorMessage } from "../../../lib/format";

  const auth = createAuthState({ authUrl: APP_CONFIG.authUrl, loginPath: "/login", contract: trellisApp });

  let status = $state("Redirecting…");
  let authError = $state<string | null>(null);

  function targetPath(): string {
    return page.url.searchParams.get("redirectTo") ?? "/profile";
  }

  function backToLogin(): string {
    return buildAppLoginUrl(targetPath());
  }

  onMount(() => {
    if (!browser) return;

    const canonicalRedirect = getCanonicalLoopbackRedirectUrl();
    if (canonicalRedirect) {
      window.location.replace(canonicalRedirect);
      return;
    }

    void (async () => {
      try {
        const handle = await auth.init();
        if (auth.isAuthenticated) {
          await goto(targetPath());
          return;
        }

        const loginHref = await buildLoginUrl(
          { authUrl: APP_CONFIG.authUrl },
          APP_CONFIG.defaultProvider,
          buildAppCallbackUrl(targetPath()),
          handle,
          trellisApp.CONTRACT,
        );
        window.location.assign(loginHref);
      } catch (error) {
        status = "Sign-in failed";
        authError = errorMessage(error);
      }
    })();
  });
</script>

<svelte:head>
  <title>Redirecting · Trellis</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-base-200 px-4">
  <div class="card w-full max-w-sm bg-base-100 shadow-lg">
    <div class="card-body items-center text-center gap-4">
      <h1 class="text-lg font-semibold">{status}</h1>

      {#if authError}
        <div class="alert alert-error text-sm">
          <span>{authError}</span>
        </div>
        <a class="btn btn-ghost btn-sm" href={backToLogin()}>Back to sign in</a>
      {:else}
        <span class="loading loading-spinner loading-md"></span>
      {/if}
    </div>
  </div>
</div>
