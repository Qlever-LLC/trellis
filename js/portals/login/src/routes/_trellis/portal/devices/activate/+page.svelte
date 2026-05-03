<script lang="ts">
  import { onMount } from "svelte";
  import PortalBrand from "$lib/components/PortalBrand.svelte";
  import { trellisUrl } from "$lib/config";
  import { createPortalDeviceActivationController } from "$lib/device_activation";

  const controller = createPortalDeviceActivationController();

  onMount(() => {
    void controller.load();
    return () => controller.stop();
  });
</script>

<svelte:head>
  <title>Approve device · Trellis</title>
</svelte:head>

{#snippet technicalDetails(items: { label: string; value: string }[])}
  <details class="portal-details border-t border-base-300 pt-4">
    <summary
      class="flex cursor-pointer items-center gap-3 rounded-field py-2 text-sm font-medium text-base-content/65"
    >
      Technical details
    </summary>
    <dl class="mt-3 grid gap-3 text-xs text-base-content/60">
      {#each items as item (item.label)}
        <div>
          <dt class="font-medium text-base-content/45">{item.label}</dt>
          <dd class="mono mt-1 break-all leading-5">{item.value}</dd>
        </div>
      {/each}
    </dl>
  </details>
{/snippet}

<div
  class="portal-shell flex min-h-screen flex-col items-center justify-center gap-7 px-4 py-10 sm:px-6"
  data-theme="portal"
>
  <PortalBrand subtitle="Device approval" />

  <div
    class="portal-card card w-full max-w-lg border border-base-300"
  >
    <div class="card-body gap-6 p-7 sm:p-8">
      {#if controller.loading}
        <div class="flex items-center gap-4 py-3">
          <span class="loading loading-ring loading-lg"></span>
          <div>
            <p class="text-sm font-medium text-base-content">Loading activation</p>
            <p class="portal-copy text-xs">Checking request state and reviewer context.</p>
          </div>
        </div>
      {:else}
        <div>
          <h1 class="text-2xl font-semibold tracking-[-0.035em] text-base-content">
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

          <p class="portal-copy mt-2 max-w-[58ch] text-sm">
            {#if controller.view?.mode === "sign_in_required"}
              Sign in to review this deployment request.
            {:else if controller.view?.mode === "ready"}
              You are signed in and can approve this deployment request now.
            {:else if controller.view?.mode === "pending_review"}
              A reviewer still needs to approve this deployment request. This
              page is waiting on the same activation operation the device
              started.
            {:else if controller.view?.mode === "activated"}
              This deployment request has been approved and can finish setup.
            {:else if controller.view?.mode === "rejected"}
              This deployment request was not approved. Start again if you want
              to submit a new request.
            {:else if controller.view?.mode === "expired"}
              This approval link has expired. Start again from the device or CLI.
            {:else}
              This approval link is missing or no longer valid. Start again from
              the device or CLI.
            {/if}
          </p>
        </div>

        {#if controller.view?.mode === "sign_in_required"}
          <button
            class="btn btn-primary btn-block"
            onclick={() => void controller.signIn()}>Continue to sign in</button
          >
        {:else if controller.view?.mode === "ready"}
          <div class="portal-subtle-panel rounded-box p-4">
            <p class="portal-section-label">
              Activation request
            </p>
            <dl class="mt-3 flex flex-col gap-2 text-sm">
              <div>
                <dt class="text-xs font-medium text-base-content/45">
                  Request handle
                </dt>
                <dd class="mono mt-0.5 break-all text-base-content">
                  {controller.view.flowId}
                </dd>
              </div>
            </dl>
            <p class="portal-copy mt-3 text-xs">
              Trellis verifies the deployment and device identity when this
              request is submitted. If review is required, or after approval,
              Trellis shows the verified deployment and device details here.
            </p>
          </div>
          <button
            class="btn btn-primary btn-block"
            disabled={controller.requestPending}
            onclick={() => void controller.requestActivation()}
          >
            {#if controller.requestPending}
              <span class="loading loading-spinner loading-sm"></span>
              Approving...
            {:else}
              Approve device
            {/if}
          </button>
        {:else if controller.view?.mode === "pending_review"}
          <div class="alert alert-info text-sm leading-6">
            <span class="portal-status-dot size-2 rounded-full" aria-hidden="true"></span>
            <span>Approval has been requested and is waiting for review.</span>
          </div>

          {@render technicalDetails([
            { label: "Deployment id", value: controller.view.deploymentId },
            { label: "Device id", value: controller.view.instanceId },
          ])}
          <p class="portal-copy text-xs">
            Activation is bound to this deployment request and contract digest.
            A review decision completes the original activation operation.
          </p>
        {:else if controller.view?.mode === "activated"}
          <div class="alert alert-success text-sm leading-6">
            <span class="portal-status-dot size-2 rounded-full" aria-hidden="true"></span>
            <span>Approval complete.</span>
          </div>

          {#if controller.view.confirmationCode}
            <div
              class="portal-subtle-panel rounded-box p-5 text-center"
            >
              <p class="portal-section-label">
                Confirmation code
              </p>
              <p
                class="mono mt-3 break-all text-3xl font-semibold tracking-[0.18em] text-base-content sm:text-4xl"
              >
                {controller.view.confirmationCode}
              </p>
              <p class="portal-copy mt-3 text-xs">
                Return this code to the device or CLI if it is waiting for one.
              </p>
            </div>
          {/if}

          {@render technicalDetails([
            { label: "Deployment id", value: controller.view.deploymentId },
            { label: "Device id", value: controller.view.instanceId },
          ])}
          <p class="portal-copy text-xs">
            Approval completed the original activation operation for this
            deployment request and contract digest.
          </p>
        {:else if controller.view?.mode === "rejected"}
          <div class="alert alert-error text-sm leading-6">
            <span
              >{controller.view.reason ??
                "This approval request was denied."}</span
            >
          </div>
          <button
            class="btn btn-outline btn-block"
            onclick={() => void controller.signIn()}>Sign in again</button
          >
        {:else if controller.view?.mode === "expired"}
          <div class="alert alert-error text-sm leading-6">
            <span>{controller.view.reason}</span>
          </div>
          <a class="btn btn-outline btn-block" href={trellisUrl}
            >Return to app</a
          >
        {:else if controller.view?.mode === "invalid_flow"}
          <div class="alert alert-error text-sm leading-6">
            <span>{controller.view.reason}</span>
          </div>
          <a class="btn btn-outline btn-block" href={trellisUrl}
            >Return to app</a
          >
        {/if}
      {/if}

      {#if controller.authError}
        <div class="alert alert-error text-sm leading-6">
          <span>{controller.authError}</span>
        </div>
      {/if}
    </div>
  </div>
</div>
