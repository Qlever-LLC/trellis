<script lang="ts">
  import type { AuthListServiceDeploymentsOutput } from "@qlever-llc/trellis/sdk/auth";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  type Deployment = AuthListServiceDeploymentsOutput["deployments"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();
  type ServiceDeploymentsRequester = {
    request(method: "Auth.ListServiceDeployments", input: Record<string, never>): { orThrow(): Promise<AuthListServiceDeploymentsOutput> };
    request(method: "Auth.CreateServiceDeployment", input: { deploymentId: string; namespaces: string[] }): { orThrow(): Promise<void> };
    request(method: "Auth.ApplyServiceDeploymentContract", input: { deploymentId: string; contract: Record<string, unknown> }): { orThrow(): Promise<void> };
    request(method: "Auth.UnapplyServiceDeploymentContract", input: { deploymentId: string; contractId: string; digests?: string[] }): { orThrow(): Promise<void> };
    request(method: "Auth.DisableServiceDeployment", input: { deploymentId: string }): { orThrow(): Promise<void> };
    request(method: "Auth.EnableServiceDeployment", input: { deploymentId: string }): { orThrow(): Promise<void> };
    request(method: "Auth.RemoveServiceDeployment", input: { deploymentId: string }): { orThrow(): Promise<void> };
  };
  const serviceDeploymentsSource: object = trellis;
  const serviceDeploymentsRequester = serviceDeploymentsSource as ServiceDeploymentsRequester;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let createPending = $state(false);
  let applyPending = $state(false);
  let actionTarget = $state<string | null>(null);

  let deployments = $state<Deployment[]>([]);
  let selectedDeploymentId = $state("");

  let deploymentId = $state("");
  let namespaces = $state("");
  let contractJson = $state("");

  const selectedDeployment = $derived(deployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null);

  function parseNamespaces(value: string): string[] {
    return value
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function syncSelectedDeployment(nextDeployments: Deployment[]) {
    if (nextDeployments.some((deployment) => deployment.deploymentId === selectedDeploymentId)) return;
    selectedDeploymentId = nextDeployments[0]?.deploymentId ?? "";
    contractJson = "";
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await serviceDeploymentsRequester.request("Auth.ListServiceDeployments", {}).orThrow();
      const nextDeployments = res.deployments ?? [];
      deployments = nextDeployments;
      syncSelectedDeployment(nextDeployments);
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
      const nextDeploymentId = deploymentId.trim();
      await serviceDeploymentsRequester.request("Auth.CreateServiceDeployment", {
        deploymentId: nextDeploymentId,
        namespaces: parseNamespaces(namespaces),
      }).orThrow();
      notifications.success(`Service deployment ${nextDeploymentId} created.`, "Created");
      deploymentId = "";
      namespaces = "";
      selectedDeploymentId = nextDeploymentId;
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }

  async function applyContract() {
    if (!selectedDeployment || !contractJson.trim()) return;
    applyPending = true;
    error = null;
    try {
      const contract = JSON.parse(contractJson) as Record<string, unknown>;
      await serviceDeploymentsRequester.request("Auth.ApplyServiceDeploymentContract", {
        deploymentId: selectedDeployment.deploymentId,
        contract,
      }).orThrow();
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
      await serviceDeploymentsRequester.request("Auth.UnapplyServiceDeploymentContract", {
        deploymentId: deployment.deploymentId,
        contractId,
        digests,
      }).orThrow();
      notifications.success(`Contracts updated for ${deployment.deploymentId}.`, "Updated");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  async function setDeploymentDisabled(deployment: Deployment, disabled: boolean) {
    const verb = disabled ? "Disable" : "Enable";
    if (!window.confirm(`${verb} service deployment ${deployment.deploymentId}?`)) return;
    actionTarget = `${deployment.deploymentId}:${verb.toLowerCase()}`;
    error = null;
    try {
      if (disabled) {
        await serviceDeploymentsRequester.request("Auth.DisableServiceDeployment", { deploymentId: deployment.deploymentId }).orThrow();
      } else {
        await serviceDeploymentsRequester.request("Auth.EnableServiceDeployment", { deploymentId: deployment.deploymentId }).orThrow();
      }
      notifications.success(`Service deployment ${deployment.deploymentId} ${disabled ? "disabled" : "enabled"}.`, disabled ? "Disabled" : "Enabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  async function removeDeployment(deployment: Deployment) {
    if (!window.confirm(`Remove service deployment ${deployment.deploymentId}?`)) return;
    actionTarget = `${deployment.deploymentId}:remove`;
    error = null;
    try {
      await serviceDeploymentsRequester.request("Auth.RemoveServiceDeployment", { deploymentId: deployment.deploymentId }).orThrow();
      notifications.success(`Service deployment ${deployment.deploymentId} removed.`, "Removed");
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
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="card-title text-base">Service deployments</h2>
          <p class="text-sm text-base-content/60">Create deployments, apply contract JSON, and manage lifecycle state for Trellis services.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a href="/admin/services/instances" class="btn btn-outline btn-sm">Manage Instances</a>
          <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
        </div>
      </div>

      <form class="grid gap-3 lg:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void createDeployment(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Deployment ID</span>
          <input class="input input-bordered input-sm font-mono" bind:value={deploymentId} placeholder="billing.worker" required />
        </label>

        <label class="form-control gap-1 lg:col-span-2">
          <span class="label-text text-xs">Namespaces</span>
          <textarea class="textarea textarea-bordered textarea-sm font-mono" rows="3" bind:value={namespaces} placeholder="billing, invoices" required></textarea>
        </label>

        <div class="lg:col-span-2 flex justify-end">
          <button type="submit" class="btn btn-primary btn-sm" disabled={createPending}>
            {createPending ? "Creating…" : "Create Deployment"}
          </button>
        </div>
      </form>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div class="card border border-base-300 bg-base-100">
        <div class="card-body gap-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="card-title text-sm">Deployments</h3>
            <span class="text-xs text-base-content/60">{deployments.length} total</span>
          </div>

          {#if deployments.length === 0}
            <p class="text-sm text-base-content/60">No service deployments found.</p>
          {:else}
            <div class="space-y-2">
              {#each deployments as deployment (deployment.deploymentId)}
                <div
                  class={[
                    "rounded-box border p-3 transition-colors",
                    selectedDeploymentId === deployment.deploymentId
                      ? "border-primary bg-primary/5"
                      : "border-base-300 bg-base-100",
                  ]}
                >
                  <button
                    class="w-full text-left"
                    onclick={() => {
                      selectedDeploymentId = deployment.deploymentId;
                      contractJson = "";
                    }}
                  >
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="font-medium font-mono">{deployment.deploymentId}</div>
                    </div>
                    <span class={[
                      "badge badge-sm",
                       deployment.disabled ? "badge-ghost" : "badge-success",
                    ]}>
                      {deployment.disabled ? "Disabled" : "Active"}
                    </span>
                  </div>

                  <div class="mt-3 flex flex-wrap gap-1">
                    {#each deployment.namespaces as namespace (namespace)}
                      <span class="badge badge-outline badge-xs">{namespace}</span>
                    {:else}
                      <span class="text-xs text-base-content/60">No namespaces</span>
                    {/each}
                  </div>
                  </button>
                  <div class="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={(event) => {
                        event.stopPropagation();
                        void setDeploymentDisabled(deployment, !deployment.disabled);
                      }}
                      disabled={actionTarget === `${deployment.deploymentId}:${deployment.disabled ? "enable" : "disable"}`}
                    >
                      {deployment.disabled ? "Enable" : "Disable"}
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs text-error"
                      onclick={(event) => {
                        event.stopPropagation();
                        void removeDeployment(deployment);
                      }}
                      disabled={actionTarget === `${deployment.deploymentId}:remove`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="space-y-4">
        <div class="card border border-base-300 bg-base-100">
          <div class="card-body gap-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 class="card-title text-sm">Apply contract</h3>
                <p class="text-sm text-base-content/60">Paste raw contract JSON and apply it to the selected deployment.</p>
              </div>
              <label class="form-control gap-1 min-w-56">
                <span class="label-text text-xs">Selected deployment</span>
                <select class="select select-bordered select-sm" bind:value={selectedDeploymentId} disabled={deployments.length === 0}>
                  <option value="" disabled>Select a deployment</option>
                  {#each deployments as deployment (deployment.deploymentId)}
                    <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
                  {/each}
                </select>
              </label>
            </div>

            <textarea
              class="textarea textarea-bordered min-h-64 w-full font-mono text-xs"
              bind:value={contractJson}
              placeholder="Paste contract JSON…"
              disabled={!selectedDeployment}
            ></textarea>

            <div class="flex justify-end">
              <button class="btn btn-primary btn-sm" onclick={applyContract} disabled={applyPending || !selectedDeployment || !contractJson.trim()}>
                {applyPending ? "Applying…" : "Apply Contract"}
              </button>
            </div>
          </div>
        </div>

        <div class="card border border-base-300 bg-base-100">
          <div class="card-body gap-3">
            <div>
              <h3 class="card-title text-sm">Selected deployment details</h3>
              <p class="text-sm text-base-content/60">Unapply an entire contract lineage or remove a specific digest from the selected deployment.</p>
            </div>

            {#if !selectedDeployment}
              <p class="text-sm text-base-content/60">Select a deployment to manage contracts.</p>
            {:else}
              <div class="space-y-4">
                <div class="rounded-box border border-base-300 bg-base-100 p-3">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div class="font-medium font-mono">{selectedDeployment.deploymentId}</div>
                    </div>
                    <span class={[
                      "badge badge-sm",
                       selectedDeployment.disabled ? "badge-ghost" : "badge-success",
                    ]}>
                      {selectedDeployment.disabled ? "Disabled" : "Active"}
                    </span>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-1">
                    {#each selectedDeployment.namespaces as namespace (namespace)}
                      <span class="badge badge-outline badge-xs">{namespace}</span>
                    {/each}
                  </div>
                </div>

                {#if selectedDeployment.appliedContracts.length === 0}
                  <p class="text-sm text-base-content/60">No contracts applied.</p>
                {:else}
                  <div class="space-y-3">
                    {#each selectedDeployment.appliedContracts as applied (applied.contractId)}
                      <div class="rounded-box border border-base-300 bg-base-100 p-3">
                        <div class="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div class="font-medium text-sm">{applied.contractId}</div>
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
                              <span class="font-mono text-xs">{digest}</span>
                              <button
                                class="btn btn-ghost btn-xs text-error"
                                onclick={() => unapplyContract(selectedDeployment, applied.contractId, [digest])}
                                disabled={actionTarget === `${selectedDeployment.deploymentId}:${applied.contractId}:${digest}:unapply`}
                                aria-label={`Unapply digest ${digest}`}
                              >
                                ×
                              </button>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>
