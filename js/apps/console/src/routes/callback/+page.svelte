<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto, replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import {
    getCanonicalLoopbackRedirectUrl,
    getSelectedAuthUrl,
    persistSelectedAuthUrl
  } from "../../lib/config";
  import {
    buildConsoleLoginUrl,
    getConsoleRedirectTarget,
    auth,
  } from "../../lib/auth";
  import { errorMessage } from "../../lib/format";

  let status = $state("Completing sign-in…");
  let authError = $state<string | null>(null);
  let selectedAuthUrl = $state("");

  function targetPath(): string {
    return getConsoleRedirectTarget(page.url);
  }

  function loginUrl(): string {
    return buildConsoleLoginUrl({
      redirectTo: targetPath(),
      location: page.url,
      authUrl: selectedAuthUrl,
    });
  }

  function cleanupCallbackUrl(): void {
    const nextUrl = new URL(window.location.href);
    if (nextUrl.searchParams.has("flowId") || nextUrl.searchParams.has("authError")) {
      nextUrl.searchParams.delete("flowId");
      nextUrl.searchParams.delete("authError");
      replaceState(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, page.state);
    }
  }

  onMount(async () => {
    if (!browser) return;

    const canonicalRedirect = getCanonicalLoopbackRedirectUrl();
    if (canonicalRedirect) {
      window.location.replace(canonicalRedirect);
      return;
    }

    try {
      const authUrl = getSelectedAuthUrl(page.url);
      selectedAuthUrl = authUrl ? (persistSelectedAuthUrl(authUrl) ?? "") : "";
      if (selectedAuthUrl) {
        auth.setAuthUrl(selectedAuthUrl);
      }
      await auth.init();
      const result = await auth.handleCallback(window.location.href);
      cleanupCallbackUrl();

      if (!result) {
        await goto(targetPath());
        return;
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
