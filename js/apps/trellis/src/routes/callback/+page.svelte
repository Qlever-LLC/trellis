<script lang="ts">
  import { createAuthState } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { trellisApp } from "../../contracts/trellis_app.ts";
  import {
    buildAppLoginUrl,
    getCanonicalLoopbackRedirectUrl,
    getSelectedAuthUrl,
    persistSelectedAuthUrl
  } from "../../lib/config";
  import { errorMessage } from "../../lib/format";

  let status = $state("Completing sign-in…");
  let authError = $state<string | null>(null);
  let selectedAuthUrl = $state("");

  function targetPath(): string {
    return page.url.searchParams.get("redirectTo") ?? "/profile";
  }

  function loginUrl(): string {
    return buildAppLoginUrl(targetPath(), page.url, undefined, selectedAuthUrl);
  }

  onMount(async () => {
    if (!browser) return;

    const canonicalRedirect = getCanonicalLoopbackRedirectUrl();
    if (canonicalRedirect) {
      window.location.replace(canonicalRedirect);
      return;
    }

    try {
      selectedAuthUrl = persistSelectedAuthUrl(getSelectedAuthUrl(page.url));
      const auth = createAuthState({ authUrl: selectedAuthUrl, loginPath: "/login", contract: trellisApp });
      await auth.init();
      const result = await auth.handleCallback(window.location.href);
      auth.cleanupCallbackUrl();

      if (!result) {
        throw new Error("Missing auth token");
      }

      if (result.status === "bound") {
        await goto(targetPath());
        return;
      }

      if (result.status === "approval_denied") {
        status = "App access was denied.";
        return;
      }

      if (result.status === "approval_required") {
        status = "Approval required";
        return;
      }

      if (result.status === "insufficient_capabilities") {
        authError = `Missing capabilities: ${result.missingCapabilities.join(", ")}`;
        status = "Insufficient access";
        return;
      }

      status = "Sign-in failed";
      authError = result.status === "error" ? result.message : "Unknown error";
    } catch (error) {
      authError = errorMessage(error);
      status = "Sign-in failed";
    }
  });
</script>

<svelte:head>
  <title>Authorizing · Trellis</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-base-200 px-4">
  <div class="card w-full max-w-sm bg-base-100 shadow-lg">
    <div class="card-body items-center text-center gap-4">
      <h1 class="text-lg font-semibold">{status}</h1>

      {#if authError}
        <div class="alert alert-error text-sm">
          <span>{authError}</span>
        </div>
        <a class="btn btn-ghost btn-sm" href={loginUrl()}>Back to sign in</a>
      {:else}
        <span class="loading loading-spinner loading-md"></span>
      {/if}
    </div>
  </div>
</div>
