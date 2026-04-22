<script lang="ts">
  import { onMount } from "svelte";
  import {
    createDeviceActivationController,
  } from "@qlever-llc/trellis-svelte";
  import {
    connectPortalActivation,
    createPortalActivationAuthState,
    trellisUrl,
  } from "../../../../../lib/trellis";

  const authState = createPortalActivationAuthState();

  const controller = createDeviceActivationController({
    authState,
    createClient: (authUrlState) => connectPortalActivation(authState, authUrlState),
    sessionStorage: typeof window === "undefined" ? undefined : window.sessionStorage,
  });

  onMount(() => {
    void controller.load();
    return () => controller.stop();
  });
</script>

<svelte:head>
  <title>Approve Device · Trellis</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10" data-theme="portal">
  <div class="flex items-center gap-2">
    <span class="inline-block h-2 w-2 rounded-full bg-primary"></span>
    <span class="text-sm font-semibold text-base-content/55">Trellis Auth</span>
  </div>

  <div class="card w-full max-w-md border border-base-300 bg-base-100 shadow-md">
    <div class="card-body gap-5 p-6">
      {#if controller.loading}
        <div class="flex items-center justify-center py-4">
          <span class="loading loading-ring loading-md"></span>
        </div>
      {:else}
        <div>
          <h1 class="text-lg font-bold text-base-content">
            {#if controller.view?.mode === "sign_in_required"}
              Sign in to continue
            {:else if controller.view?.mode === "ready"}
              Approve this device
            {:else if controller.view?.mode === "pending_review"}
              Approval pending
            {:else if controller.view?.mode === "activated"}
              Device approved
            {:else if controller.view?.mode === "rejected"}
              Request denied
            {:else if controller.view?.mode === "expired"}
              Link expired
            {:else}
              Invalid link
            {/if}
          </h1>

          <p class="mt-1 text-sm text-base-content/60">
            {#if controller.view?.mode === "sign_in_required"}
              Sign in to approve this device.
            {:else if controller.view?.mode === "ready"}
              You are signed in and can approve this device now.
            {:else if controller.view?.mode === "pending_review"}
              A reviewer still needs to approve this device before setup can continue.
            {:else if controller.view?.mode === "activated"}
              This device has been approved and can finish setup.
            {:else if controller.view?.mode === "rejected"}
              This device was not approved.
            {:else if controller.view?.mode === "expired"}
              This approval link has expired. Start again from your app.
            {:else}
              This approval link is missing or no longer valid.
            {/if}
          </p>
        </div>

        {#if controller.view?.mode === "sign_in_required"}
          <button class="btn btn-primary btn-block" onclick={() => void controller.signIn()}>Continue to sign in</button>
        {:else if controller.view?.mode === "ready"}
          <button class="btn btn-primary btn-block" disabled={controller.requestPending} onclick={() => void controller.requestActivation()}>
            {#if controller.requestPending}
              <span class="loading loading-spinner loading-sm"></span>
              Approving...
            {:else}
              Approve device
            {/if}
          </button>
        {:else if controller.view?.mode === "pending_review"}
          <div class="alert alert-info text-sm">
            <span>Approval has been requested and is waiting for review.</span>
          </div>

          <div class="rounded-box border border-base-300 bg-base-100 p-4">
            <p class="text-xs font-bold uppercase tracking-widest text-base-content/45">Request details</p>
            <p class="mono mt-2 break-all text-sm text-base-content">{controller.view.profileId}</p>
            <p class="mt-1 text-xs text-base-content/55">Device <span class="mono break-all">{controller.view.instanceId}</span></p>
          </div>
        {:else if controller.view?.mode === "activated"}
          <div class="alert alert-success text-sm">
            <span>Approval complete.</span>
          </div>

          {#if controller.view.confirmationCode}
            <div class="rounded-box border border-success/30 bg-success/10 p-5 text-center">
              <p class="text-xs font-bold uppercase tracking-[0.2em] text-base-content/45">Confirmation code</p>
              <p class="mono mt-3 break-all text-3xl font-semibold tracking-[0.3em] text-base-content sm:text-4xl">{controller.view.confirmationCode}</p>
            </div>
          {/if}

          <div class="rounded-box border border-base-300 bg-base-100 p-4">
            <p class="text-xs font-bold uppercase tracking-widest text-base-content/45">Profile</p>
            <p class="mono mt-2 break-all text-sm text-base-content">{controller.view.profileId}</p>
            <p class="mt-4 text-xs font-bold uppercase tracking-widest text-base-content/35">Device id</p>
            <p class="mono mt-1 break-all text-xs text-base-content/50">{controller.view.instanceId}</p>
          </div>
        {:else if controller.view?.mode === "rejected"}
          <div class="alert alert-error text-sm">
            <span>{controller.view.reason ?? "This approval request was denied."}</span>
          </div>
          <button class="btn btn-outline btn-block" onclick={() => void controller.signIn()}>Sign in again</button>
        {:else if controller.view?.mode === "expired"}
          <div class="alert alert-error text-sm">
            <span>{controller.view.reason}</span>
          </div>
          <a class="btn btn-outline btn-block" href={trellisUrl}>Return to app</a>
        {:else if controller.view?.mode === "invalid_flow"}
          <div class="alert alert-error text-sm">
            <span>{controller.view.reason}</span>
          </div>
          <a class="btn btn-outline btn-block" href={trellisUrl}>Return to app</a>
        {/if}
      {/if}

      {#if controller.authError}
        <div class="flex items-center justify-center py-4">
          <div class="alert alert-error text-sm">
            <span>{controller.authError}</span>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
