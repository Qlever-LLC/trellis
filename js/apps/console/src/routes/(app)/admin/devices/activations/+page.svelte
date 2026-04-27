<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListDeviceActivationsInput,
    AuthListDeviceActivationsOutput,
    AuthListDeviceInstancesOutput,
    AuthListDeviceDeploymentsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getTrellis } from "../../../../../lib/trellis";

  type Activation = AuthListDeviceActivationsOutput["activations"][number];
  type DeviceInstance = AuthListDeviceInstancesOutput["instances"][number] & {
    metadata?: Record<string, string>;
  };
  type Deployment = AuthListDeviceDeploymentsOutput["deployments"][number];
  type ActivationState = NonNullable<AuthListDeviceActivationsInput["state"]> | "all";

  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);

  let activations = $state<Activation[]>([]);
  let deviceInstances = $state<DeviceInstance[]>([]);
  let deployments = $state<Deployment[]>([]);

  let instanceFilter = $state("");
  let deploymentFilter = $state("");
  let stateFilter = $state<ActivationState>("all");
  let showMetadata = $state(false);

  let deviceInstancesById = $derived.by(() => new Map(deviceInstances.map((instance) => [instance.instanceId, instance])));

  function activationQuery(): AuthListDeviceActivationsInput {
    return {
      instanceId: instanceFilter.trim() || undefined,
      deploymentId: deploymentFilter || undefined,
      state: stateFilter === "all" ? undefined : stateFilter,
    };
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [activationsResponse, instancesResponse, deploymentsResponse] = await Promise.all([
        trellis.request("Auth.ListDeviceActivations", activationQuery()).take(),
        trellis.request("Auth.ListDeviceInstances", {}).take(),
        trellis.request("Auth.ListDeviceDeployments", {}).take(),
      ]);
      if (isErr(activationsResponse)) { error = errorMessage(activationsResponse); return; }
      if (isErr(instancesResponse)) { error = errorMessage(instancesResponse); return; }
      if (isErr(deploymentsResponse)) { error = errorMessage(deploymentsResponse); return; }

      activations = activationsResponse.activations ?? [];
      deviceInstances = instancesResponse.instances ?? [];
      deployments = deploymentsResponse.deployments ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function understoodMetadataValue(instanceId: string, key: (typeof understoodMetadataKeys)[number]): string | null {
    return deviceInstancesById.get(instanceId)?.metadata?.[key] ?? null;
  }

  function opaqueMetadataEntries(instanceId: string): Array<[string, string]> {
    return Object.entries(deviceInstancesById.get(instanceId)?.metadata ?? {}).filter(
      ([key]) => !understoodMetadataKeys.includes(key as (typeof understoodMetadataKeys)[number]),
    ) as Array<[string, string]>;
  }

  function activationRowKey(activation: Activation): string {
    return `${activation.instanceId}:${activation.activatedAt}:${activation.revokedAt ?? ""}:${activation.state}`;
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Device activations" description="Review active and revoked device activations.">
    {#snippet actions()}
      <details class="dropdown dropdown-end">
        <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
        <ul class="menu dropdown-content z-10 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
          <li><a href={resolve("/admin/devices/activations/revoke")}>Revoke device activation</a></li>
        </ul>
      </details>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  <div class="flex flex-wrap items-end justify-between gap-3">
    <form class="flex flex-wrap items-end gap-2" onsubmit={(event) => { event.preventDefault(); void load(); }}>
      <label class="form-control gap-1">
        <span class="label-text text-xs">Instance</span>
        <input class="input input-bordered input-sm w-52" bind:value={instanceFilter} placeholder="Any instance" />
      </label>

      <label class="form-control gap-1">
        <span class="label-text text-xs">Deployment</span>
        <select class="select select-bordered select-sm w-48" bind:value={deploymentFilter}>
          <option value="">All deployments</option>
          {#each deployments as deployment (deployment.deploymentId)}
            <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
          {/each}
        </select>
      </label>

      <label class="form-control gap-1">
        <span class="label-text text-xs">State</span>
        <select class="select select-bordered select-sm w-40" bind:value={stateFilter}>
          <option value="all">All</option>
          <option value="activated">Activated</option>
          <option value="revoked">Revoked</option>
        </select>
      </label>

      <button type="submit" class="btn btn-outline btn-sm" disabled={loading}>Apply</button>
    </form>

    <div class="flex items-center gap-3">
      <label class="label cursor-pointer gap-2 py-0">
        <span class="label-text text-sm">Show metadata</span>
        <input class="toggle toggle-sm" type="checkbox" bind:checked={showMetadata} />
      </label>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading device activations" /></Panel>
  {:else if activations.length === 0}
    <EmptyState title="No device activations" description="No activations match the current filters." />
  {:else}
    <Panel title="Activations" eyebrow="Primary table">
      <div class="overflow-x-auto">
      <table class="table table-sm trellis-table">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Deployment</th>
            <th>Activated By</th>
            <th>State</th>
            <th>Activated</th>
            <th>Revoked</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each activations as activation (activationRowKey(activation))}
            <tr>
              <td>
                <div class="trellis-identifier font-medium">{activation.instanceId}</div>
                <div class="font-mono text-xs text-base-content/60">{activation.publicIdentityKey}</div>
                <div class="mt-1 space-y-0.5 text-xs text-base-content/60">
                  <div><span class="font-medium text-base-content">Name</span>: {understoodMetadataValue(activation.instanceId, "name") ?? "—"}</div>
                  <div><span class="font-medium text-base-content">Serial</span>: {understoodMetadataValue(activation.instanceId, "serialNumber") ?? "—"}</div>
                  <div><span class="font-medium text-base-content">Model</span>: {understoodMetadataValue(activation.instanceId, "modelNumber") ?? "—"}</div>
                </div>
                {#if showMetadata}
                  <div class="mt-2 space-y-1 text-xs text-base-content/60">
                    {#if opaqueMetadataEntries(activation.instanceId).length > 0}
                      {#each opaqueMetadataEntries(activation.instanceId) as [key, value] (key)}
                        <div><span class="font-medium text-base-content">{key}</span>=<span class="font-mono">{value}</span></div>
                      {/each}
                    {:else}
                      <div>—</div>
                    {/if}
                  </div>
                {/if}
              </td>
              <td class="text-base-content/60">{activation.deploymentId}</td>
              <td class="text-base-content/60">{activation.activatedBy ? `${activation.activatedBy.origin}:${activation.activatedBy.id}` : "—"}</td>
              <td><span class="badge badge-sm">{activation.state}</span></td>
              <td class="text-base-content/60">{formatDate(activation.activatedAt)}</td>
              <td class="text-base-content/60">{activation.revokedAt ? formatDate(activation.revokedAt) : "—"}</td>
              <td class="text-right">
                {#if activation.state === "revoked"}
                  <span class="text-xs text-base-content/40">—</span>
                {:else}
                  <a class="btn btn-ghost btn-xs text-error" href={resolve(`/admin/devices/activations/revoke?instance=${encodeURIComponent(activation.instanceId)}`)}>Revoke</a>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
      <p class="text-xs text-base-content/50">{activations.length} activation{activations.length !== 1 ? "s" : ""}</p>
    </Panel>
  {/if}
</section>
