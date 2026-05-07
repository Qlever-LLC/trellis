<script lang="ts">
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import {
    portalRedirectLocation,
    submitPortalApproval,
  } from "@qlever-llc/trellis/auth/browser";
  import { trellisUrl } from "$lib/config";
  import PortalBrand from "$lib/components/PortalBrand.svelte";
  import { createLoginPortalFlow } from "$lib/portal_login";
  import {
    shouldOfferPortalReturnLink,
    shouldStayOnPortalCompletionPage,
  } from "./page_state";

  const flow = createLoginPortalFlow(pageUrl);
  let denying = $state(false);

  interface CapabilityMetadata {
    displayName: string;
    description: string;
    consequence?: string;
  }

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function isCapabilityMetadata(value: unknown): value is CapabilityMetadata {
    if (!isPlainObject(value)) return false;
    return (
      typeof value.displayName === "string" &&
      typeof value.description === "string" &&
      (value.consequence === undefined || typeof value.consequence === "string")
    );
  }

  function capabilityEntries(
    capabilities: unknown,
  ): { key: string; capability: CapabilityMetadata }[] {
    if (!isPlainObject(capabilities)) return [];
    return Object.entries(capabilities)
      .filter((entry): entry is [string, CapabilityMetadata] =>
        isCapabilityMetadata(entry[1])
      )
      .map(([key, capability]) => ({ key, capability }));
  }

  type UserDisplay = {
    origin: string;
    id: string;
    name?: string;
    email?: string;
    image?: string;
  };

  type TechnicalDetail = { label: string; value: string };

  function userDisplayName(user: UserDisplay): string {
    return user.name ?? user.email ?? user.id;
  }

  function userSecondaryIdentity(user: UserDisplay): string | null {
    if (user.email && user.email !== userDisplayName(user)) return user.email;
    return null;
  }

  function avatarInitial(user: UserDisplay): string {
    return userDisplayName(user).trim().charAt(0).toUpperCase() || "?";
  }

  function userImage(user: UserDisplay): string | null {
    return typeof user.image === "string" && user.image.length > 0
      ? user.image
      : null;
  }

  function rawUserId(user: UserDisplay): string {
    return `${user.origin}:${user.id}`;
  }

  function technicalCapabilityLabel(key: string): string {
    const namespaced = key.includes("::") ? key.split("::").at(-1) ?? key : key;
    const withoutTrellisPrefix = namespaced.replace(/^trellis\./, "");
    const words = withoutTrellisPrefix
      .split(/[.:_-]+/)
      .filter((word) => word.length > 0 && word.toLowerCase() !== "trellis");
    return words
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(" ");
  }

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
      const returnLocation =
        "returnLocation" in flow.state &&
        typeof flow.state.returnLocation === "string"
          ? flow.state.returnLocation
          : undefined;
      return returnLocation ?? trellisUrl;
    }
    return trellisUrl;
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
    if (!flow.flowId) {
      flow.error = "Missing flow id.";
      return;
    }

    denying = true;
    flow.error = null;
    let redirected = false;

    try {
      const nextState = await submitPortalApproval(
        { authUrl: trellisUrl },
        flow.flowId,
        "denied",
      );
      const nextLocation = portalRedirectLocation(nextState);
      if (nextLocation) {
        redirected = true;
        window.location.assign(nextLocation);
        return;
      }
      flow.state = nextState;
    } catch (error) {
      flow.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (!redirected) denying = false;
    }
  }

  onMount(() => {
    if (!browser) return;
    void loadFlow();
  });
</script>

<svelte:head>
  <title>Sign in · Trellis</title>
</svelte:head>

{#snippet userIdentity(user: UserDisplay)}
  <section
    class="portal-subtle-panel flex items-center gap-3.5 rounded-box p-3.5 sm:gap-4"
  >
    <p class="portal-section-label shrink-0">Signed in as</p>
    <div class="flex min-w-0 flex-1 items-center gap-3.5">
      {#if userImage(user)}
        <img
          class="size-11 rounded-full object-cover"
          src={userImage(user) ?? ""}
          alt=""
        />
      {:else}
        <div
          class="flex size-11 items-center justify-center rounded-full border border-base-300 bg-base-100 text-sm font-semibold text-base-content/70"
          aria-hidden="true"
        >
          {avatarInitial(user)}
        </div>
      {/if}
      <div class="flex min-w-0 items-baseline gap-2">
        <p class="truncate text-[0.98rem] font-semibold leading-5 text-base-content">
          {userDisplayName(user)}
        </p>
        {#if userSecondaryIdentity(user)}
          <span class="shrink-0 text-base-content/25" aria-hidden="true">/</span>
          <p class="portal-copy truncate text-sm leading-5">
            {userSecondaryIdentity(user)}
          </p>
        {/if}
      </div>
    </div>
  </section>
{/snippet}

{#snippet technicalDetails(
  userId: string | null,
  items: TechnicalDetail[],
  capabilityKeys: string[],
)}
  <details class="portal-details portal-debug-details max-w-xl px-3 text-center">
    <summary
      class="inline-flex cursor-pointer items-center gap-2 rounded-field text-[0.68rem] leading-5 text-base-content/45"
    >
      {#if userId}
        <span class="mono break-all">{userId}</span>
        <span aria-hidden="true">/</span>
      {/if}
      <span>Technical details</span>
    </summary>
    <dl class="mx-auto mt-3 grid max-w-xl gap-3 rounded-box border border-base-300 bg-base-100 p-4 text-left text-xs text-base-content/60">
      {#each items as item (item.label)}
        <div>
          <dt class="font-medium text-base-content/45">{item.label}</dt>
          <dd class="mono mt-1 break-all leading-5">{item.value}</dd>
        </div>
      {/each}
      {#if capabilityKeys.length > 0}
        <div>
          <dt class="font-medium text-base-content/45">Raw capability keys</dt>
          <dd>
            <ul class="mt-1 grid gap-1">
              {#each capabilityKeys as key (key)}
                <li class="mono break-all leading-5">{key}</li>
              {/each}
            </ul>
          </dd>
        </div>
      {/if}
    </dl>
  </details>
{/snippet}

<div
  class="portal-shell flex min-h-screen flex-col items-center justify-center gap-7 px-4 py-10 sm:px-6"
  data-theme="portal"
>
  <div
    class={[
      "portal-card card w-full border border-base-300",
      flow.state?.status === "approval_required" ||
      flow.state?.status === "insufficient_capabilities"
        ? "max-w-xl"
        : "max-w-md",
    ]}
  >
    <div class="card-body gap-6 p-7 sm:p-8">
      <div class="flex justify-center">
        <PortalBrand subtitle="Login portal" />
      </div>

      {#if flow.loading}
        <div class="flex items-center gap-4 py-3">
          <span class="loading loading-ring loading-lg"></span>
          <div>
            <p class="text-sm font-medium text-base-content">Loading request</p>
            <p class="portal-copy text-xs">Resolving provider and approval state.</p>
          </div>
        </div>
      {:else if flow.state?.status === "choose_provider"}
        <div>
          <h1 class="text-xl font-semibold tracking-[-0.025em] text-base-content">Choose a sign-in method</h1>
          <p class="mt-2 inline-flex rounded-full border border-base-300 bg-base-200/55 px-3 py-1 text-xs font-medium text-base-content/65">
            {flow.state.app.displayName}
          </p>
        </div>
        <div class="flex flex-col gap-2.5">
          {#each flow.state.providers as provider (provider.id)}
            <a
              class="btn btn-outline btn-block justify-between"
              data-sveltekit-reload
              href={flow.providerUrl(provider.id)}
            >
              <span>Sign in with {provider.displayName}</span>
            </a>
          {/each}
        </div>
      {:else if flow.state?.status === "approval_required"}
        <div>
          <h1 class="text-2xl font-semibold tracking-[-0.035em] text-base-content">Approve access</h1>
          <p class="portal-copy mt-2 max-w-[58ch] text-sm">
            Review what <strong class="font-medium text-base-content"
              >{flow.state.approval.displayName}</strong
            > is asking to access from your account.
          </p>
        </div>

        {@render userIdentity(flow.state.user)}

        <section class="space-y-2.5 border-t border-base-300 pt-4">
          <p class="portal-section-label">Requested capabilities</p>
          <ul class="overflow-hidden rounded-box border border-base-300">
            {#each capabilityEntries(flow.state.approval.capabilities) as entry (entry.key)}
              <li class="portal-capability-row px-3.5 py-3">
                <p class="text-sm font-semibold leading-5 text-base-content">
                  {entry.capability.displayName}
                </p>
                <p class="portal-copy mt-0.5 text-sm leading-5">
                  {entry.capability.description}
                </p>
                {#if entry.capability.consequence}
                  <p class="mt-1 text-xs leading-5 text-base-content/55">
                    {entry.capability.consequence}
                  </p>
                {/if}
              </li>
            {:else}
              <li class="portal-subtle-panel rounded-box p-4 text-sm leading-6 text-base-content/65">
                No explicit capabilities are requested beyond identity and
                session binding for this sign-in.
              </li>
            {/each}
          </ul>
        </section>

        <div class="portal-action-row -mx-7 -mb-7 flex flex-col gap-2.5 rounded-b-box px-7 py-5 sm:-mx-8 sm:-mb-8 sm:px-8">
          <button
            class="btn btn-primary btn-block"
            disabled={flow.loading}
            onclick={() => void approve()}
          >
            {#if flow.loading}
              <span class="loading loading-spinner loading-sm"></span>
            {:else}
              Approve
            {/if}
          </button>
          <button
            class="btn btn-ghost btn-block text-base-content/70"
            disabled={flow.loading || denying}
            onclick={() => void deny()}
          >
            {denying ? "Denying..." : "Deny"}
          </button>
        </div>
      {:else if flow.state?.status === "insufficient_capabilities"}
        <div>
          <h1 class="text-2xl font-semibold tracking-[-0.035em] text-base-content">Access denied</h1>
          <p class="portal-copy mt-2 max-w-[58ch] text-sm">
            An administrator needs to grant the required capabilities before you
            can continue.
            {#if !shouldShowReturnToAppLink()}
              Return to the CLI to finish sign-in or close this page.
            {/if}
          </p>
        </div>
        {#if flow.state.user}
          {@render userIdentity(flow.state.user)}
        {/if}
        <section class="space-y-2.5 border-t border-base-300 pt-4">
          <p class="portal-section-label">Missing capabilities</p>
          <ul class="overflow-hidden rounded-box border border-base-300">
            {#each flow.state.missingCapabilities as cap (cap)}
              <li class="portal-capability-row px-3.5 py-3">
                <p class="text-sm font-semibold text-base-content">
                  {technicalCapabilityLabel(cap)}
                </p>
              </li>
            {/each}
          </ul>
        </section>
        {#if shouldShowReturnToAppLink()}
          <a
            class="btn btn-outline btn-block"
            href={returnToApp()}
            >Return to app</a
          >
        {/if}
      {:else if flow.state?.status === "approval_denied"}
        <div>
          <h1 class="text-xl font-semibold tracking-[-0.025em] text-base-content">Access denied</h1>
          <p class="portal-copy mt-2 text-sm">
            You denied access for {flow.state.approval.displayName}. Start a new
            sign-in if you want to review the request again.
            {#if !shouldShowReturnToAppLink()}
              Return to the CLI to finish sign-in or close this page.
            {/if}
          </p>
        </div>
        {#if shouldShowReturnToAppLink()}
          <a
            class="btn btn-outline btn-block"
            href={returnToApp()}
            >Return to app</a
          >
        {/if}
      {:else if flow.state?.status === "expired"}
        <div>
          <h1 class="text-xl font-semibold tracking-[-0.025em] text-base-content">Session expired</h1>
          <p class="portal-copy mt-2 text-sm">
            This sign-in request is no longer active. Return to the app and
            start sign-in again.
          </p>
        </div>
        <a
          class="btn btn-outline btn-block"
          href={trellisUrl}
          >Open Trellis</a
        >
      {:else if flow.state?.status === "redirect"}
        {#if showDetachedCompletion()}
          <div>
            <h1 class="text-xl font-semibold tracking-[-0.025em] text-base-content">Connected</h1>
            <p class="portal-copy mt-2 text-sm">
              Return to the CLI to finish sign-in.
            </p>
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
  {#if flow.state?.status === "approval_required"}
    {@render technicalDetails(
      rawUserId(flow.state.user),
      [
        { label: "Request handle", value: flow.state.flowId },
        { label: "Contract id", value: flow.state.approval.contractId },
        { label: "Contract digest", value: flow.state.approval.contractDigest },
        { label: "Signed-in user id", value: rawUserId(flow.state.user) },
      ],
      capabilityEntries(flow.state.approval.capabilities).map((entry) => entry.key),
    )}
  {:else if flow.state?.status === "insufficient_capabilities" && flow.state.user}
    {@render technicalDetails(
      rawUserId(flow.state.user),
      [
        { label: "Request handle", value: flow.state.flowId },
        { label: "Contract id", value: flow.state.approval.contractId },
        { label: "Contract digest", value: flow.state.approval.contractDigest },
        { label: "Signed-in user id", value: rawUserId(flow.state.user) },
      ],
      flow.state.missingCapabilities,
    )}
  {/if}
</div>
