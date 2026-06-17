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
    formatConsoleAuthError,
    getConsoleRedirectTarget,
    auth,
  } from "../../lib/auth";
  import Notice from "../../lib/components/Notice.svelte";
  import { errorMessage } from "../../lib/format";

  let status = $state("Completing sign-in…");
  let authError = $state<string | null>(null);
  let missingCapabilities = $state<string[]>([]);
  let selectedAuthUrl = $state("");

  function targetPath(): string {
    return getConsoleRedirectTarget(page.url);
  }

  function loginUrl(authError?: string): string {
    return buildConsoleLoginUrl({
      redirectTo: targetPath(),
      location: page.url,
      authUrl: selectedAuthUrl,
      authError,
    });
  }

  function cleanupCallbackUrl(): void {
    const nextUrl = new URL(window.location.href);
    if (nextUrl.searchParams.has("flowId") || nextUrl.searchParams.has("authError")) {
      nextUrl.searchParams.delete("flowId");
      nextUrl.searchParams.delete("authError");
      replaceState(
        `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
        page.state,
      );
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
        window.location.href = loginUrl(formatConsoleAuthError("approval_denied"));
        return;
      }

      if (result.status === "approval_required") {
        status = "Approval still pending";
        authError = "Return to the Trellis approval page and approve or deny access to continue.";
        return;
      }

      if (result.status === "insufficient_capabilities") {
        missingCapabilities = result.missingCapabilities;
        authError = "An administrator needs to grant additional capabilities before you can continue.";
        status = "Insufficient access";
        return;
      }

      if (result.status === "error" && result.code === "flow_expired") {
        window.location.href = loginUrl(result.message);
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
  <div class="card trellis-card w-full max-w-sm border border-base-300 bg-base-100 shadow-none">
    <div class="card-body items-center text-center gap-4">
      <h1 class="text-lg font-semibold">{status}</h1>

      {#if authError}
        <Notice variant="error" class="text-sm">{authError}</Notice>
        {#if missingCapabilities.length}
          <details class="collapse collapse-arrow rounded-box bg-base-200 text-left">
            <summary class="collapse-title min-h-0 py-3 text-xs font-semibold uppercase text-base-content/50">
              Technical details
            </summary>
            <ul class="collapse-content flex flex-col gap-1 text-xs text-base-content/55">
              {#each missingCapabilities as capability (capability)}
                <li class="trellis-identifier break-all">{capability}</li>
              {/each}
            </ul>
          </details>
        {/if}
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          onclick={() => {
            window.location.href = loginUrl();
          }}>Back to sign in</button
        >
      {:else}
        <span class="loading loading-spinner loading-md"></span>
      {/if}
    </div>
  </div>
</div>
