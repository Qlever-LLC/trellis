<script lang="ts">
  import type {
    AuthCreateDeviceDeploymentInput,
    AuthDisableDeviceDeploymentInput,
    AuthEnableDeviceDeploymentInput,
    AuthListDeviceDeploymentsInput,
    AuthListDeviceDeploymentsOutput,
    AuthListInstalledContractsOutput,
    AuthRemoveDeviceDeploymentInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type Deployment = AuthListDeviceDeploymentsOutput["deployments"][number];
  type InstalledContract = AuthListInstalledContractsOutput["contracts"][number];
  type DisabledFilter = "all" | "active" | "disabled";

  const trellis = getTrellis();
  const notifications = getNotifications();
  type DeploymentsRequester = {
    request(method: "Auth.ListDeviceDeployments", input: AuthListDeviceDeploymentsInput): { orThrow(): Promise<AuthListDeviceDeploymentsOutput> };
    request(method: "Auth.ListInstalledContracts", input: Record<string, never>): { orThrow(): Promise<AuthListInstalledContractsOutput> };
    request(method: "Auth.CreateDeviceDeployment", input: AuthCreateDeviceDeploymentInput): { orThrow(): Promise<void> };
    request(method: "Auth.DisableDeviceDeployment", input: AuthDisableDeviceDeploymentInput): { orThrow(): Promise<void> };
    request(method: "Auth.EnableDeviceDeployment", input: AuthEnableDeviceDeploymentInput): { orThrow(): Promise<void> };
    request(method: "Auth.RemoveDeviceDeployment", input: AuthRemoveDeviceDeploymentInput): { orThrow(): Promise<void> };
  };
  const deploymentsSource: object = trellis;
  const deploymentsRequester = deploymentsSource as DeploymentsRequester;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let createPending = $state(false);
  let actionTarget = $state<string | null>(null);

  let deployments = $state<Deployment[]>([]);
  let contracts = $state<InstalledContract[]>([]);

  let contractFilter = $state("");
  let disabledFilter = $state<DisabledFilter>("all");

  let deploymentId = $state("");
  let reviewMode = $state<"none" | "required">("none");

  function contractOptions() {
    return contracts.map((contract) => contract.id);
  }

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
        deploymentsRequester.request("Auth.ListDeviceDeployments", deploymentQuery()).orThrow(),
        deploymentsRequester.request("Auth.ListInstalledContracts", {}).orThrow(),
      ]);

      deployments = deploymentsResponse.deployments ?? [];
      contracts = contractsResponse.contracts ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function createDeployment() {
    createPending = true;
    error = null;
    try {
      const input: AuthCreateDeviceDeploymentInput = {
        deploymentId: deploymentId.trim(),
        reviewMode,
      };

      await deploymentsRequester.request("Auth.CreateDeviceDeployment", input).orThrow();
      notifications.success(`Device deployment ${input.deploymentId} created.`, "Created");
      deploymentId = "";
      reviewMode = "none";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }

  async function setDeploymentDisabled(deployment: Deployment, disabled: boolean) {
    const verb = disabled ? "Disable" : "Enable";
    if (!window.confirm(`${verb} device deployment ${deployment.deploymentId}?`)) return;

    actionTarget = `${deployment.deploymentId}:${verb.toLowerCase()}`;
    error = null;
    try {
      if (disabled) {
        await deploymentsRequester.request(
          "Auth.DisableDeviceDeployment",
          { deploymentId: deployment.deploymentId } satisfies AuthDisableDeviceDeploymentInput,
        ).orThrow();
      } else {
        await deploymentsRequester.request(
          "Auth.EnableDeviceDeployment",
          { deploymentId: deployment.deploymentId } satisfies AuthEnableDeviceDeploymentInput,
        ).orThrow();
      }
      notifications.success(`Device deployment ${deployment.deploymentId} ${disabled ? "disabled" : "enabled"}.`, disabled ? "Disabled" : "Enabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  async function removeDeployment(deployment: Deployment) {
    if (!window.confirm(`Remove device deployment ${deployment.deploymentId}?`)) return;
    actionTarget = `${deployment.deploymentId}:remove`;
    error = null;
    try {
      await deploymentsRequester.request(
        "Auth.RemoveDeviceDeployment",
        { deploymentId: deployment.deploymentId } satisfies AuthRemoveDeviceDeploymentInput,
      ).orThrow();
      notifications.success(`Device deployment ${deployment.deploymentId} removed.`, "Removed");
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
  <div class="card border border-base-300 bg-base-100">
    <div class="card-body gap-4">
      <div>
        <h2 class="card-title text-base">Create device deployment</h2>
        <p class="text-sm text-base-content/60">Deployments control applied contracts and whether activation needs review.</p>
      </div>

      <form class="grid gap-3 lg:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void createDeployment(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Deployment ID</span>
          <input class="input input-bordered input-sm" bind:value={deploymentId} placeholder="reader.default" required />
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Review mode</span>
          <select class="select select-bordered select-sm" bind:value={reviewMode}>
            <option value="none">No review</option>
            <option value="required">Review required</option>
          </select>
        </label>

        <div class="flex items-end justify-end">
          <button type="submit" class="btn btn-primary btn-sm" disabled={createPending}>
            {createPending ? "Creating…" : "Create Deployment"}
          </button>
        </div>

      </form>

      <datalist id="installed-contract-ids">
        {#each contractOptions() as id (id)}
          <option value={id}></option>
        {/each}
      </datalist>
    </div>
  </div>

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

      <button type="submit" class="btn btn-primary btn-sm" disabled={loading}>Apply</button>
    </form>

    <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if filteredDeployments.length === 0}
    <p class="text-sm text-base-content/60">No device deployments found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
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
              <td class="font-medium">{deployment.deploymentId}</td>
              <td class="text-base-content/60">
                {#if deployment.appliedContracts.length === 0}
                  <span class="text-base-content/40">None</span>
                {:else}
                  <div class="flex flex-col gap-1">
                    {#each deployment.appliedContracts as applied (applied.contractId)}
                      <span>{applied.contractId}</span>
                    {/each}
                  </div>
                {/if}
              </td>
              <td>
                {#if deployment.appliedContracts.length === 0}
                  <span class="text-base-content/40">None</span>
                {:else}
                  <div class="flex flex-wrap gap-1">
                    {#each deployment.appliedContracts as applied (applied.contractId)}
                      {#each applied.allowedDigests as digest (digest)}
                        <span class="badge badge-outline badge-xs font-mono">{digest}</span>
                      {/each}
                    {/each}
                  </div>
                {/if}
              </td>
              <td class="text-base-content/60">{deployment.reviewMode ?? "none"}</td>
              <td>
                {#if deployment.disabled}
                  <span class="badge badge-ghost badge-sm">Disabled</span>
                {:else}
                  <span class="badge badge-success badge-sm">Active</span>
                {/if}
              </td>
              <td class="text-right">
                <button
                  class="btn btn-ghost btn-xs"
                  onclick={() => setDeploymentDisabled(deployment, !deployment.disabled)}
                  disabled={actionTarget === `${deployment.deploymentId}:${deployment.disabled ? "enable" : "disable"}`}
                >
                  {deployment.disabled ? "Enable" : "Disable"}
                </button>
                <button
                  class="btn btn-ghost btn-xs text-error"
                  onclick={() => removeDeployment(deployment)}
                  disabled={actionTarget === `${deployment.deploymentId}:remove`}
                >
                  Remove
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{filteredDeployments.length} deployment{filteredDeployments.length !== 1 ? "s" : ""}</p>
  {/if}
</section>
