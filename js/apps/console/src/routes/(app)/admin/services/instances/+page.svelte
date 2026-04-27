<script lang="ts">
  import type {
    AuthListServiceInstancesOutput,
    AuthListServiceDeploymentsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../../lib/trellis";

  type ServiceInstance = AuthListServiceInstancesOutput["instances"][number];
  type ServiceDeployment = AuthListServiceDeploymentsOutput["deployments"][number];
  type DisabledFilter = "all" | "active" | "disabled";

  const trellis = getTrellis();
  const notifications = getNotifications();
  type ServiceInstancesRequester = {
    request(method: "Auth.ListServiceInstances", input: ReturnType<typeof query>): { orThrow(): Promise<AuthListServiceInstancesOutput> };
    request(method: "Auth.ListServiceDeployments", input: Record<string, never>): { orThrow(): Promise<AuthListServiceDeploymentsOutput> };
    request(method: "Auth.ProvisionServiceInstance", input: { deploymentId: string; instanceKey: string }): { orThrow(): Promise<void> };
    request(method: "Auth.DisableServiceInstance", input: { instanceId: string }): { orThrow(): Promise<void> };
    request(method: "Auth.EnableServiceInstance", input: { instanceId: string }): { orThrow(): Promise<void> };
    request(method: "Auth.RemoveServiceInstance", input: { instanceId: string }): { orThrow(): Promise<void> };
  };
  const serviceInstancesSource: object = trellis;
  const serviceInstancesRequester = serviceInstancesSource as ServiceInstancesRequester;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let createPending = $state(false);
  let actionTarget = $state<string | null>(null);

  let instances = $state<ServiceInstance[]>([]);
  let deployments = $state<ServiceDeployment[]>([]);

  let deploymentFilter = $state("");
  let disabledFilter = $state<DisabledFilter>("all");

  let provisionDeploymentId = $state("");
  let instanceKey = $state("");

  const provisionDeployments = $derived(deployments.filter((deployment) => !deployment.disabled));
  const canProvision = $derived(Boolean(provisionDeploymentId && instanceKey.trim() && !createPending));

  function query() {
    return {
      deploymentId: deploymentFilter || undefined,
      disabled: disabledFilter === "all" ? undefined : disabledFilter === "disabled",
    };
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [instancesRes, deploymentsRes] = await Promise.all([
        serviceInstancesRequester.request("Auth.ListServiceInstances", query()).orThrow(),
        serviceInstancesRequester.request("Auth.ListServiceDeployments", {}).orThrow(),
      ]);
      instances = instancesRes.instances ?? [];
      deployments = deploymentsRes.deployments ?? [];
      if (!provisionDeploymentId || !provisionDeployments.some((deployment) => deployment.deploymentId === provisionDeploymentId)) {
        provisionDeploymentId = provisionDeployments[0]?.deploymentId ?? "";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function provisionInstance() {
    createPending = true;
    error = null;
    try {
      await serviceInstancesRequester.request("Auth.ProvisionServiceInstance", {
        deploymentId: provisionDeploymentId,
        instanceKey: instanceKey.trim(),
      }).orThrow();
      notifications.success("Service instance provisioned.", "Provisioned");
      instanceKey = "";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }

  async function setInstanceDisabled(instance: ServiceInstance, disabled: boolean) {
    const verb = disabled ? "Disable" : "Enable";
    if (!window.confirm(`${verb} service instance ${instance.instanceId}?`)) return;
    actionTarget = instance.instanceId;
    error = null;
    try {
      if (disabled) {
        await serviceInstancesRequester.request("Auth.DisableServiceInstance", { instanceId: instance.instanceId }).orThrow();
      } else {
        await serviceInstancesRequester.request("Auth.EnableServiceInstance", { instanceId: instance.instanceId }).orThrow();
      }
      notifications.success(`Service instance ${instance.instanceId} ${disabled ? "disabled" : "enabled"}.`, disabled ? "Disabled" : "Enabled");
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionTarget = null;
    }
  }

  async function removeInstance(instance: ServiceInstance) {
    if (!window.confirm(`Remove service instance ${instance.instanceId}?`)) return;
    actionTarget = `${instance.instanceId}:remove`;
    error = null;
    try {
      await serviceInstancesRequester.request("Auth.RemoveServiceInstance", { instanceId: instance.instanceId }).orThrow();
      notifications.success(`Service instance ${instance.instanceId} removed.`, "Removed");
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
          <h2 class="card-title text-base">Provision service instance</h2>
          <p class="text-sm text-base-content/60">Bind a runtime service key to an existing service deployment.</p>
        </div>
        <a href={resolve("/admin/services")} class="btn btn-outline btn-sm">Back to Deployments</a>
      </div>

      <form class="grid gap-3 lg:grid-cols-[1fr_2fr_auto]" onsubmit={(event) => { event.preventDefault(); void provisionInstance(); }}>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Deployment</span>
          <select class="select select-bordered select-sm" bind:value={provisionDeploymentId} required>
            <option value="" disabled>Select a deployment</option>
            {#each provisionDeployments as deployment (deployment.deploymentId)}
              <option value={deployment.deploymentId}>{deployment.deploymentId}</option>
            {/each}
          </select>
        </label>

        <label class="form-control gap-1">
          <span class="label-text text-xs">Instance key</span>
          <input class="input input-bordered input-sm font-mono" bind:value={instanceKey} placeholder="base64url public key" required />
        </label>

        <div class="flex items-end">
          <button type="submit" class="btn btn-primary btn-sm" disabled={!canProvision}>
            {createPending ? "Provisioning…" : "Provision"}
          </button>
        </div>
      </form>
    </div>
  </div>

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
        <span class="label-text text-xs">Status</span>
        <select class="select select-bordered select-sm w-36" bind:value={disabledFilter}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>

      <button type="submit" class="btn btn-primary btn-sm" disabled={loading}>Apply</button>
    </form>

    <div class="flex items-center gap-3">
      <p class="text-xs text-base-content/60">{instances.length} instance{instances.length === 1 ? "" : "s"}</p>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if instances.length === 0}
    <p class="text-sm text-base-content/60">No service instances found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Deployment</th>
            <th>Contract</th>
            <th>Capabilities</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each instances as instance (instance.instanceId)}
            <tr>
              <td>
                <div class="font-medium">{instance.instanceId}</div>
                <div class="font-mono text-xs text-base-content/60 break-all">{instance.instanceKey}</div>
              </td>
              <td class="text-base-content/60">{instance.deploymentId}</td>
              <td>
                <div class="text-sm text-base-content/80">{instance.currentContractId ?? "—"}</div>
                <div class="font-mono text-xs text-base-content/60">{instance.currentContractDigest ?? "—"}</div>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  {#each instance.capabilities as capability (capability)}
                    <span class="badge badge-outline badge-xs">{capability}</span>
                  {:else}
                    <span class="text-base-content/60">—</span>
                  {/each}
                </div>
              </td>
              <td>
                {#if instance.disabled}
                  <span class="badge badge-ghost badge-sm">Disabled</span>
                {:else}
                  <span class="badge badge-success badge-sm">Active</span>
                {/if}
              </td>
              <td class="text-base-content/60">{formatDate(instance.createdAt)}</td>
              <td>
                <div class="flex flex-wrap justify-end gap-2">
                  <button
                    class="btn btn-ghost btn-xs"
                    onclick={() => setInstanceDisabled(instance, !instance.disabled)}
                    disabled={actionTarget === instance.instanceId}
                  >
                    {instance.disabled ? "Enable" : "Disable"}
                  </button>
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    onclick={() => removeInstance(instance)}
                    disabled={actionTarget === `${instance.instanceId}:remove`}
                  >
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
