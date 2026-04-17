<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto, replaceState } from "$app/navigation";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import {
    APP_CONFIG,
    getCanonicalLoopbackRedirectUrl,
    getSelectedAuthUrl,
    persistSelectedAuthUrl
  } from "../../lib/config";
  import { errorMessage } from "../../lib/format";
  import { auth } from "../../lib/trellis";

  let status = $state("Completing sign-in…");
  let authError = $state<string | null>(null);
  let selectedAuthUrl = $state("");

  function resolveAppPath(path: string): string {
    const url = new URL(path, page.url);
    const appBase = base || "";

    if (url.origin !== page.url.origin) {
      return url.toString();
    }

    if (appBase && url.pathname === appBase) {
      return `${appBase}/${url.search}${url.hash}`;
    }

    if (appBase && url.pathname.startsWith(`${appBase}/`)) {
      return `${appBase}${url.pathname.slice(appBase.length)}${url.search}${url.hash}`;
    }

    return `${appBase}${url.pathname}${url.search}${url.hash}`;
  }

  function targetPath(): string {
    return resolveAppPath(page.url.searchParams.get("redirectTo") ?? "/profile");
  }

  function loginUrl(): string {
    const url = new URL(resolveAppPath("/login"), page.url);
    url.searchParams.set("redirectTo", targetPath());
    if (selectedAuthUrl && selectedAuthUrl !== APP_CONFIG.authUrl) {
      url.searchParams.set("authUrl", selectedAuthUrl);
    }
    return url.toString();
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
        if (auth.isAuthenticated) {
          await goto(targetPath());
          return;
        }
        status = "Sign-in failed";
        authError = "Missing flow id.";
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
