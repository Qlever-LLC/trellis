<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { digestContractManifest, type TrellisContractV1 } from "@qlever-llc/trellis/contracts";
  import type { AuthListServiceDeploymentsOutput } from "@qlever-llc/trellis/sdk/auth";
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

  type Deployment = AuthListServiceDeploymentsOutput["deployments"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let applyPending = $state(false);
  let actionTarget = $state<string | null>(null);
  let deployments = $state.raw<Deployment[]>([]);
  let selectedDeploymentId = $state(page.url.searchParams.get("deployment") ?? "");
  let contractJson = $state("");

  const selectedDeployment = $derived(deployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null);

  function syncSelectedDeployment(nextDeployments: Deployment[]) {
    if (nextDeployments.some((deployment) => deployment.deploymentId === selectedDeploymentId)) return;
    selectedDeploymentId = nextDeployments[0]?.deploymentId ?? "";
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await trellis.request("Auth.ListServiceDeployments", {}).take();
      if (isErr(res)) { error = errorMessage(res); return; }
      deployments = res.deployments ?? [];
      syncSelectedDeployment(deployments);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function applyContract() {
    if (!selectedDeployment || !contractJson.trim()) return;
    applyPending = true;
    error = null;
    try {
      const contract = JSON.parse(contractJson) as TrellisContractV1;
      const response = await trellis.request("Auth.ApplyServiceDeploymentContract", {
        deploymentId: selectedDeployment.deploymentId,
        contract,
        expectedDigest: digestContractManifest(contract),
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Contract applied to ${selectedDeployment.deploymentId}.`, "Applied");
      contractJson = "";
      await load();
    } catch (e) {
      error = e instanceof SyntaxError ? `Invalid contract JSON: ${e.message}` : errorMessage(e);
    } finally {
      applyPending = false;
    }
  }

  async function unapplyContract(deployment: Deployment, contractId: string, digests?: string[]) {
    const target = digests?.length ? `${contractId}:${digests.join(",")}` : `${contractId}:lineage`;
    const scope = digests?.length ? `digest ${digests.join(", ")}` : `lineage ${contractId}`;
    if (!window.confirm(`Unapply ${scope} from ${deployment.deploymentId}?`)) return;
    actionTarget = `${deployment.deploymentId}:${target}:unapply`;
    error = null;
    try {
      const response = await trellis.request("Auth.UnapplyServiceDeploymentContract", {
        deploymentId: deployment.deploymentId,
        contractId,
        digests,
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Contracts updated for ${deployment.deploymentId}.`, "Updated");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Service contracts" description="Apply and remove contracts for service deployments.">
    {#snippet actions()}
      <a href={resolve("/admin/services")} class="btn btn-ghost btn-sm">Back to service deployments</a>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading service contracts" /></Panel>
  {:else if deployments.length === 0}
    <EmptyState title="No service deployments" description="Create a service deployment before applying contracts.">
      {#snippet actions()}
        <a href={resolve("/admin/services/new")} class="btn btn-outline btn-sm">Create deployment</a>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Panel title="Apply contract" eyebrow="Selected deployment" class="min-w-0">
        <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void applyContract(); }}>
          <label class="form-control gap-1">
            <span class="label-text text-xs">Deployment</span>
            <select class="select select-bordered select-sm" bind:value={selectedDeploymentId}>
              {#each deployments as deployment (deployment.deploymentId)}
                <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
              {/each}
            </select>
          </label>

          <label class="form-control gap-1">
            <span class="label-text text-xs">Contract JSON</span>
            <textarea class="textarea textarea-bordered min-h-80 w-full font-mono text-xs" bind:value={contractJson} placeholder="Paste contract JSON…"></textarea>
          </label>

          <div class="flex flex-wrap justify-end gap-2">
            <a href={resolve("/admin/services")} class="btn btn-ghost btn-sm">Cancel</a>
            <button class="btn btn-outline btn-sm" disabled={applyPending || !selectedDeployment || !contractJson.trim()}>
              {applyPending ? "Applying…" : "Apply contract"}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Applied contracts" eyebrow={selectedDeployment?.deploymentId ?? "No deployment"} class="min-w-0">
        {#if !selectedDeployment}
          <EmptyState title="Select a deployment" description="Choose a service deployment to manage its contracts." />
        {:else if selectedDeployment.appliedContracts.length === 0}
          <EmptyState title="No contracts" description="This service deployment has no applied contracts." />
        {:else}
          <div class="space-y-3">
            {#each selectedDeployment.appliedContracts as applied, index (`${applied.contractId}:${index}`)}
              <div class="rounded-box border border-base-300 bg-base-100 p-3">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div class="font-medium">{applied.contractId}</div>
                    <div class="text-xs text-base-content/60">{applied.allowedDigests.length} digest(s)</div>
                  </div>
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    onclick={() => unapplyContract(selectedDeployment, applied.contractId)}
                    disabled={actionTarget === `${selectedDeployment.deploymentId}:${applied.contractId}:lineage:unapply`}
                  >
                    Unapply lineage
                  </button>
                </div>

                <div class="mt-3 flex flex-wrap gap-2">
                  {#each applied.allowedDigests as digest (digest)}
                    <div class="flex items-center gap-1 rounded-full border border-base-300 px-2 py-1">
                      <span class="trellis-identifier">{digest}</span>
                      <button
                        class="btn btn-ghost btn-xs text-error"
                        onclick={() => unapplyContract(selectedDeployment, applied.contractId, [digest])}
                        disabled={actionTarget === `${selectedDeployment.deploymentId}:${applied.contractId}:${digest}:unapply`}
                        aria-label={`Unapply digest ${digest}`}
                      >
                        ×
                      </button>
                    </div>
                  {:else}
                    <span class="text-xs text-base-content/60">Lineage allowed</span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </Panel>
    </div>
  {/if}
</section>
