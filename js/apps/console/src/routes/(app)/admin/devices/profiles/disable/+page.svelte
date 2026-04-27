<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthDisableDeviceDeploymentInput,
    AuthListDeviceDeploymentsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "$lib/format";
  import { getNotifications } from "$lib/notifications.svelte";
  import { getTrellis } from "$lib/trellis";

  type Deployment = AuthListDeviceDeploymentsOutput["deployments"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let pending = $state(false);
  let deployments = $state<Deployment[]>([]);
  let selectedDeploymentId = $state(page.url.searchParams.get("deployment") ?? "");

  const activeDeployments = $derived(deployments.filter((deployment) => !deployment.disabled));
  const selectedDeployment = $derived(activeDeployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null);

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.ListDeviceDeployments", { disabled: false }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      const loadedDeployments = response.deployments ?? [];
      const loadedActiveDeployments = loadedDeployments.filter((deployment) => !deployment.disabled);
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
      const response = await trellis.request(
        "Auth.DisableDeviceDeployment",
        { deploymentId: selectedDeployment.deploymentId } satisfies AuthDisableDeviceDeploymentInput,
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

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Disable device deployment" description="Select an active deployment and confirm the disable workflow.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/devices/profiles")}>Back to deployments</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading device deployments" /></Panel>
  {:else if activeDeployments.length === 0}
    <EmptyState title="No active deployments" description="There are no active device deployments available to disable." />
  {:else}
    <Panel title="Confirm deployment disable" eyebrow="Destructive workflow">
      <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void disableDeployment(); }}>
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
            <div class="text-base-content/60">Review mode: {selectedDeployment.reviewMode ?? "none"}</div>
            <div class="text-base-content/60">Applied contracts: {selectedDeployment.appliedContracts.length}</div>
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
