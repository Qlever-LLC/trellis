<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListDeviceInstancesInput,
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

  type Instance = AuthListDeviceInstancesOutput["instances"][number] & {
    metadata?: Record<string, string>;
  };
  type Deployment = AuthListDeviceDeploymentsOutput["deployments"][number];
  type InstanceState = NonNullable<AuthListDeviceInstancesInput["state"]> | "all";
  const understoodMetadataKeys = ["name", "serialNumber", "modelNumber"] as const;

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);

  let instances = $state<Instance[]>([]);
  let deployments = $state<Deployment[]>([]);

  let deploymentFilter = $state("");
  let stateFilter = $state<InstanceState>("all");

  let showMetadata = $state(false);

  function instanceQuery(): AuthListDeviceInstancesInput {
    return {
      deploymentId: deploymentFilter || undefined,
      state: stateFilter === "all" ? undefined : stateFilter,
    };
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [instancesResponse, deploymentsResponse] = await Promise.all([
        trellis.request("Auth.ListDeviceInstances", instanceQuery()).take(),
        trellis.request("Auth.ListDeviceDeployments", {}).take(),
      ]);
      if (isErr(instancesResponse)) { error = errorMessage(instancesResponse); return; }
      if (isErr(deploymentsResponse)) { error = errorMessage(deploymentsResponse); return; }

      instances = instancesResponse.instances ?? [];
      deployments = deploymentsResponse.deployments ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function understoodMetadataValue(instance: Instance, key: (typeof understoodMetadataKeys)[number]): string | null {
    return instance.metadata?.[key] ?? null;
  }

  function opaqueMetadataEntries(metadata: Instance["metadata"]): Array<[string, string]> {
    return Object.entries(metadata ?? {}).filter(([key]) => !understoodMetadataKeys.includes(key as (typeof understoodMetadataKeys)[number])) as Array<[string, string]>;
  }

  function instanceRowKey(instance: Instance): string {
    return `${instance.instanceId}:${instance.createdAt}:${instance.publicIdentityKey}`;
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Device instances" description="Register known device identities and inspect activation state.">
    {#snippet actions()}
      <details class="dropdown dropdown-end">
        <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
        <ul class="menu dropdown-content z-10 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
          <li><a href={resolve("/admin/devices/instances/provision")}>Provision device instance</a></li>
          <li><a href={resolve("/admin/devices/instances/disable")}>Disable device instance</a></li>
        </ul>
      </details>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  <div class="flex flex-wrap items-end justify-between gap-3">
    <form class="flex flex-wrap items-end gap-2" onsubmit={(event) => { event.preventDefault(); void load(); }}>
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
          <option value="registered">Registered</option>
          <option value="activated">Activated</option>
          <option value="revoked">Revoked</option>
          <option value="disabled">Disabled</option>
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
    <Panel><LoadingState label="Loading device instances" /></Panel>
  {:else if instances.length === 0}
    <EmptyState title="No device instances" description="Provision an instance or adjust filters to see existing devices." />
  {:else}
    <Panel title="Instances" eyebrow="Primary table">
      <div class="overflow-x-auto">
      <table class="table table-sm trellis-table">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Deployment</th>
            <th>Identity Key</th>
            <th>Name</th>
            <th>Serial</th>
            <th>Model</th>
            {#if showMetadata}
              <th>Metadata</th>
            {/if}
            <th>State</th>
            <th>Created</th>
            <th>Activated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each instances as instance (instanceRowKey(instance))}
            <tr>
              <td class="trellis-identifier font-medium">{instance.instanceId}</td>
              <td class="text-base-content/60">{instance.deploymentId}</td>
              <td class="trellis-identifier text-base-content/60">{instance.publicIdentityKey}</td>
              <td class="text-base-content/60">{understoodMetadataValue(instance, "name") ?? "—"}</td>
              <td class="text-base-content/60">{understoodMetadataValue(instance, "serialNumber") ?? "—"}</td>
              <td class="text-base-content/60">{understoodMetadataValue(instance, "modelNumber") ?? "—"}</td>
              {#if showMetadata}
                <td class="text-xs text-base-content/60">
                  {#if opaqueMetadataEntries(instance.metadata).length > 0}
                    <div class="space-y-1">
                      {#each opaqueMetadataEntries(instance.metadata) as [key, value] (key)}
                        <div><span class="font-medium text-base-content">{key}</span>=<span class="font-mono">{value}</span></div>
                      {/each}
                    </div>
                  {:else}
                    —
                  {/if}
                </td>
              {/if}
              <td><span class="badge badge-sm">{instance.state}</span></td>
              <td class="text-base-content/60">{formatDate(instance.createdAt)}</td>
              <td class="text-base-content/60">{instance.activatedAt ? formatDate(instance.activatedAt) : "—"}</td>
              <td class="text-right">
                {#if instance.state === "disabled"}
                  <span class="text-xs text-base-content/40">—</span>
                {:else}
                  <a class="btn btn-ghost btn-xs text-error" href={resolve(`/admin/devices/instances/disable?instance=${encodeURIComponent(instance.instanceId)}`)}>Disable</a>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
      <p class="text-xs text-base-content/50">{instances.length} instance{instances.length !== 1 ? "s" : ""}</p>
    </Panel>
  {/if}
</section>
