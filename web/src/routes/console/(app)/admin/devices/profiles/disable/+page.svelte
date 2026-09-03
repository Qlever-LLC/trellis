<script lang="ts">
  import { ulid } from "ulid";
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthDeploymentsDisableInput,
    AuthDeploymentsListOutput,
  } from "@trellis/apis/trellis.auth";
  import { resolve } from "$lib/console_paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type Deployment = AuthDeploymentsListOutput["entries"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let deployments = $state<Deployment[]>([]);
  let selectedDeploymentId = $state(page.url.searchParams.get("deployment") ?? "");
  let confirmationModal: ConfirmationModal | undefined = $state();

  const activeDeployments = $derived(deployments.filter((deployment) => deployment.state === "active"));
  const selectedDeployment = $derived(activeDeployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.authDeploymentsList({ kind: "device", state: "active", limit: 100 }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      const loadedDeployments = (response.entries ?? []).filter((deployment): deployment is Deployment => deployment.kind === "device");
      const loadedActiveDeployments = loadedDeployments.filter((deployment) => deployment.state === "active");
      deployments = loadedDeployments;
      if (selectedDeploymentId && !loadedActiveDeployments.some((deployment) => deployment.deploymentId === selectedDeploymentId)) {
        selectedDeploymentId = "";
      }
      if (!selectedDeploymentId && loadedActiveDeployments.length) {
        selectedDeploymentId = loadedActiveDeployments[0]?.deploymentId ?? "";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function disableDeployment() {
    if (!selectedDeployment) return;
    pending = true;
    error = null;
    try {
      const response = await trellis.authDeploymentsDisable({
        deploymentId: selectedDeployment.deploymentId,
        expectedVersion: selectedDeployment.version,
        idempotencyKey: ulid(),
        reason: null,
      } satisfies AuthDeploymentsDisableInput,
      ).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Device deployment ${selectedDeployment.deploymentId} disabled.`, "Disabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      pending = false;
    }
  }

  async function requestDisableDeployment() {
    if (!selectedDeployment) return;
    const confirmed = await confirmationModal?.confirm({
      title: "Disable device deployment?",
      message: "This prevents new device activations for the deployment until it is re-enabled.",
      confirmLabel: "Disable deployment",
      targetLabel: "Device deployment",
      targetName: selectedDeployment.deploymentId,
      expectedValue: selectedDeployment.deploymentId,
    });
    if (confirmed) await disableDeployment();
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Disable device deployment" description="Select an active deployment and confirm the disable workflow.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/devices")}>Back to devices</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading device deployments" /></Panel>
  {:else if activeDeployments.length === 0}
    <EmptyState title="No active deployments" description="There are no active device deployments available to disable." />
  {:else}
    <Panel title="Confirm deployment disable" eyebrow="Destructive workflow">
      <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void requestDisableDeployment(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Deployment</span>
          <select class="select select-bordered select-sm" bind:value={selectedDeploymentId} required>
            {#each activeDeployments as deployment (deployment.deploymentId)}
              <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
            {/each}
          </select>
        </label>

        {#if selectedDeployment}
          <div class="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
            <div class="trellis-identifier font-medium">{selectedDeployment.deploymentId}</div>
            <div class="text-base-content/60">Review: {selectedDeployment.reviewMode}</div>
            <div class="text-base-content/60">Delegation: {selectedDeployment.requiresDeviceDelegation ? "required" : "not required"}</div>
            <div class="text-base-content/60">Authority: review the deployment authority desired state.</div>
          </div>
        {/if}

        <div class="flex justify-end">
          <button type="submit" class="btn btn-error btn-sm" disabled={pending || !selectedDeployment}>
            {pending ? "Disabling…" : "Disable deployment"}
          </button>
        </div>
      </form>
    </Panel>
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />
