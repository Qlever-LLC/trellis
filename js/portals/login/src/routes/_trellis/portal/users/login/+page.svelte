<script lang="ts">
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { portalRedirectLocation } from "@qlever-llc/trellis/auth/browser";
  import { createPortalFlow } from "@qlever-llc/trellis-svelte";
  import { APP_CONFIG } from "../../../../../lib/config";
  import {
    shouldOfferPortalReturnLink,
    shouldStayOnPortalCompletionPage,
  } from "./page_state";

  const flow = createPortalFlow({
    authUrl: APP_CONFIG.authUrl,
    getUrl: () => pageUrl(),
  });

  function pageUrl(): URL {
    return new URL(window.location.href);
  }

  function redirectLocation(): string | null {
    return portalRedirectLocation(flow.state);
  }

  function showDetachedCompletion(): boolean {
    if (!browser) return false;
    return shouldStayOnPortalCompletionPage(pageUrl(), redirectLocation());
  }

  function returnToApp(): string {
    if (
      flow.state?.status === "approval_denied" ||
      flow.state?.status === "insufficient_capabilities"
    ) {
      const returnLocation = "returnLocation" in flow.state && typeof flow.state.returnLocation === "string"
        ? flow.state.returnLocation
        : undefined;
      return returnLocation ?? APP_CONFIG.authUrl;
    }
    return APP_CONFIG.authUrl;
  }

  function shouldShowReturnToAppLink(): boolean {
    if (!browser) return false;
    return shouldOfferPortalReturnLink(pageUrl(), returnToApp());
  }

  function followRedirect(): void {
    const nextLocation = redirectLocation();
    if (nextLocation) {
      if (shouldStayOnPortalCompletionPage(pageUrl(), nextLocation)) {
        return;
      }
      window.location.assign(nextLocation);
    }
  }

  async function loadFlow(): Promise<void> {
    await flow.load();
    followRedirect();
  }

  async function approve(): Promise<void> {
    await flow.approve();
    followRedirect();
  }

  async function deny(): Promise<void> {
    await flow.deny();
    followRedirect();
  }

  onMount(() => {
    if (!browser) return;
    void loadFlow();
  });
</script>

<svelte:head>
  <title>Sign In · Trellis</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10" data-theme="portal">
  <div class="flex items-center gap-2">
    <span class="inline-block h-2 w-2 rounded-full bg-primary"></span>
    <span class="text-sm font-semibold text-base-content/55">Trellis Auth</span>
  </div>

  <div class="card w-full max-w-sm border border-base-300 bg-base-100 shadow-md">
    <div class="card-body gap-5 p-6">
      {#if flow.loading}
        <div class="flex items-center justify-center py-4">
          <span class="loading loading-ring loading-md"></span>
        </div>
      {:else if flow.state?.status === "choose_provider"}
        <div>
          <h1 class="text-lg font-bold text-base-content">Sign in</h1>
          <p class="mt-1 text-sm text-base-content/60">
            Sign in to continue to <strong class="font-semibold text-base-content">{flow.state.app.displayName}</strong>
          </p>
        </div>
        <div class="flex flex-col gap-2">
          {#each flow.state.providers as provider (provider.id)}
            <a class="btn btn-outline btn-block" data-sveltekit-reload href={flow.providerUrl(provider.id)}>
              Continue with {provider.displayName}
            </a>
          {/each}
        </div>
      {:else if flow.state?.status === "approval_required"}
        <div>
          <h1 class="text-lg font-bold text-base-content">Approve access</h1>
          <p class="mt-1 text-sm text-base-content/60">
            Confirm access for <strong class="font-semibold text-base-content">{flow.state.approval.displayName}</strong>
          </p>
        </div>
        <div class="rounded-box border border-base-300 bg-base-100 p-4">
          <p class="text-xs font-bold uppercase tracking-widest text-base-content/45">Signed in as</p>
          <p class="mt-1 text-sm font-semibold text-base-content">{flow.state.user.name ?? flow.state.user.id}</p>
          <p class="mono mt-0.5 text-xs text-base-content/50">{flow.state.user.origin}:{flow.state.user.id}</p>
        </div>
        <div class="flex flex-col gap-2">
          <button class="btn btn-primary btn-block" disabled={flow.loading} onclick={() => void approve()}>
            {#if flow.loading}
              <span class="loading loading-spinner loading-sm"></span>
            {:else}
              Approve
            {/if}
          </button>
          <button class="btn btn-outline btn-block" disabled={flow.loading} onclick={() => void deny()}>
            Deny
          </button>
        </div>
      {:else if flow.state?.status === "insufficient_capabilities"}
        <div>
          <h1 class="text-lg font-bold text-base-content">Access denied</h1>
          <p class="mt-1 text-sm text-base-content/60">
            {#if shouldShowReturnToAppLink()}
              Your account is missing required capabilities.
            {:else}
              Your account is missing required capabilities. Return to the CLI to finish sign-in or close this page.
            {/if}
          </p>
        </div>
        {#if flow.state.user}
          <div class="rounded-box border border-base-300 bg-base-100 p-4">
            <p class="text-xs font-bold uppercase tracking-widest text-base-content/45">Signed in as</p>
            <p class="mt-1 text-sm font-semibold text-base-content">{flow.state.user.name ?? flow.state.user.id}</p>
            <p class="mono mt-0.5 text-xs text-base-content/50">{flow.state.user.origin}:{flow.state.user.id}</p>
          </div>
        {/if}
        <div class="rounded-box border border-base-300 bg-base-100 p-4">
          <p class="text-xs font-bold uppercase tracking-widest text-base-content/45">Missing capabilities</p>
          <ul class="mt-2 flex flex-col gap-1.5">
            {#each flow.state.missingCapabilities as cap (cap)}
              <li class="mono text-xs text-base-content/65">{cap}</li>
            {/each}
          </ul>
        </div>
        {#if shouldShowReturnToAppLink()}
          <a class="btn btn-outline btn-block" href={returnToApp()}>Return to app</a>
        {/if}
      {:else if flow.state?.status === "approval_denied"}
        <div>
          <h1 class="text-lg font-bold text-base-content">Access denied</h1>
          <p class="mt-1 text-sm text-base-content/60">
            You denied access to {flow.state.approval.displayName}.
            {#if !shouldShowReturnToAppLink()}
              Return to the CLI to finish sign-in or close this page.
            {/if}
          </p>
        </div>
        {#if shouldShowReturnToAppLink()}
          <a class="btn btn-outline btn-block" href={returnToApp()}>Return to app</a>
        {/if}
      {:else if flow.state?.status === "expired"}
        <div>
          <h1 class="text-lg font-bold text-base-content">Session expired</h1>
          <p class="mt-1 text-sm text-base-content/60">Return to the app and try again.</p>
        </div>
        <a class="btn btn-outline btn-block" href={APP_CONFIG.authUrl}>Open auth service</a>
      {:else if flow.state?.status === "redirect"}
        {#if showDetachedCompletion()}
          <div>
            <h1 class="text-lg font-bold text-base-content">Connected</h1>
            <p class="mt-1 text-sm text-base-content/60">Return to the CLI to finish sign-in.</p>
          </div>
        {:else}
          <div class="flex items-center gap-3 text-sm text-base-content/60">
            <span class="loading loading-ring loading-sm"></span>
            <span>Redirecting...</span>
          </div>
        {/if}
      {/if}

      {#if flow.error}
        <div class="alert alert-error text-sm">
          <span>{flow.error}</span>
        </div>
      {/if}
    </div>
  </div>
</div>
