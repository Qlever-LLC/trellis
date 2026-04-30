<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListDeviceDeploymentsInput,
    AuthListDeviceDeploymentsOutput,
    AuthListInstalledContractsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getTrellis } from "../../../../../lib/trellis";

  type Deployment = AuthListDeviceDeploymentsOutput["deployments"][number];
  type InstalledContract = AuthListInstalledContractsOutput["contracts"][number];
  type DisabledFilter = "all" | "active" | "disabled";

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);

  let deployments = $state<Deployment[]>([]);
  let contracts = $state<InstalledContract[]>([]);

  let contractFilter = $state("");
  let disabledFilter = $state<DisabledFilter>("all");

  function deploymentQuery(): AuthListDeviceDeploymentsInput {
    return {
      disabled: disabledFilter === "all" ? undefined : disabledFilter === "disabled",
    };
  }

  function matchesContractFilter(deployment: Deployment): boolean {
    const filter = contractFilter.trim().toLowerCase();
    if (!filter) return true;
    return deployment.appliedContracts.some((entry) =>
      entry.contractId.toLowerCase().includes(filter)
    );
  }

  const filteredDeployments = $derived.by(() =>
    deployments.filter((deployment) => matchesContractFilter(deployment))
  );

  async function load() {
    loading = true;
    error = null;
    try {
      const [deploymentsResponse, contractsResponse] = await Promise.all([
        trellis.request("Auth.ListDeviceDeployments", deploymentQuery()).take(),
        trellis.request("Auth.ListInstalledContracts", {}).take(),
      ]);
      if (isErr(deploymentsResponse)) { error = errorMessage(deploymentsResponse); return; }
      if (isErr(contractsResponse)) { error = errorMessage(contractsResponse); return; }

      deployments = deploymentsResponse.deployments ?? [];
      contracts = contractsResponse.contracts ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Device deployments" description="Manage activation review requirements and inspect applied contracts.">
    {#snippet actions()}
      <details class="dropdown dropdown-end">
        <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
        <ul class="menu dropdown-content z-10 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
          <li><a href={resolve("/admin/devices/profiles/new")}>Create device deployment</a></li>
          <li><a href={resolve("/admin/devices/profiles/disable")}>Disable device deployment</a></li>
        </ul>
      </details>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  <div class="flex flex-wrap items-end justify-between gap-3">
    <form class="flex flex-wrap items-end gap-2" onsubmit={(event) => { event.preventDefault(); void load(); }}>
      <label class="form-control gap-1">
        <span class="label-text text-xs">Contract filter</span>
        <input class="input input-bordered input-sm w-56" bind:value={contractFilter} list="installed-contract-ids" placeholder="Any contract" />
      </label>

      <label class="form-control gap-1">
        <span class="label-text text-xs">Status</span>
        <select class="select select-bordered select-sm w-36" bind:value={disabledFilter}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>

      <button type="submit" class="btn btn-outline btn-sm" disabled={loading}>Apply</button>
    </form>

  </div>

  <datalist id="installed-contract-ids">
    {#each contracts as contract (contract.digest)}
      <option value={contract.id}></option>
    {/each}
  </datalist>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading device deployments" /></Panel>
  {:else if filteredDeployments.length === 0}
    <EmptyState title="No device deployments found" description="No deployments match the current status or contract filter." />
  {:else}
    <Panel title="Deployments" eyebrow="Primary table">
      <div class="overflow-x-auto">
      <table class="table table-sm trellis-table">
        <thead>
          <tr>
            <th>Deployment</th>
            <th>Contract</th>
            <th>Allowed Digests</th>
            <th>Review</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each filteredDeployments as deployment (deployment.deploymentId)}
            <tr>
              <td class="trellis-identifier font-medium">{deployment.deploymentId}</td>
              <td class="text-base-content/60">
                {#if deployment.appliedContracts.length === 0}
                  <span class="text-base-content/40">None</span>
                {:else}
                  <div class="flex flex-col gap-1">
                    {#each deployment.appliedContracts as applied, index (`${applied.contractId}:${index}`)}
                      <span class="flex items-center gap-1">
                        <span>{applied.contractId}</span>
                        <span class="badge badge-ghost badge-xs">{applied.allowedDigests.length}</span>
                      </span>
                    {/each}
                  </div>
                {/if}
              </td>
              <td>
                {#if deployment.appliedContracts.length === 0}
                  <span class="text-base-content/40">None</span>
                {:else}
                  <div class="trellis-token-list">
                    {#each deployment.appliedContracts as applied, index (`${applied.contractId}:${index}`)}
                      {#if applied.allowedDigests.length === 0}
                        <span class="badge badge-ghost badge-xs">Lineage allowed</span>
                      {:else}
                        {#each applied.allowedDigests as digest (digest)}
                          <span class="badge badge-outline badge-xs font-mono">{digest}</span>
                        {/each}
                      {/if}
                    {/each}
                  </div>
                {/if}
              </td>
              <td class="text-base-content/60">{deployment.reviewMode ?? "none"}</td>
              <td>
                {#if deployment.disabled}
                  <span class="badge badge-neutral badge-sm">Disabled</span>
                {:else}
                  <span class="badge badge-success badge-sm">Active</span>
                {/if}
              </td>
              <td class="text-right">
                {#if deployment.disabled}
                  <span class="text-xs text-base-content/40">—</span>
                {:else}
                  <a class="btn btn-ghost btn-xs text-error" href={resolve(`/admin/devices/profiles/disable?deployment=${encodeURIComponent(deployment.deploymentId)}`)}>Disable</a>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
      <p class="text-xs text-base-content/50">{filteredDeployments.length} deployment{filteredDeployments.length !== 1 ? "s" : ""}</p>
    </Panel>
  {/if}
</section>
