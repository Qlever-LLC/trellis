<script lang="ts">
  import type {
    AuthListConnectionsOutput,
    AuthListServiceInstancesOutput,
    AuthListSessionsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../lib/format";
  import { getTrellis } from "../../../lib/trellis";

  type ServiceInstance = AuthListServiceInstancesOutput["instances"][number];

  const trellis = getTrellis();
  type AdminOverviewRequester = {
    request(method: "Auth.ListSessions", input: Record<string, never>): { orThrow(): Promise<AuthListSessionsOutput> };
    request(method: "Auth.ListConnections", input: Record<string, never>): { orThrow(): Promise<AuthListConnectionsOutput> };
    request(method: "Auth.ListServiceInstances", input: Record<string, never>): { orThrow(): Promise<AuthListServiceInstancesOutput> };
  };
  const adminOverviewSource: object = trellis;
  const adminOverviewRequester = adminOverviewSource as AdminOverviewRequester;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let instances = $state<ServiceInstance[]>([]);
  let sessionCount = $state(0);
  let connectionCount = $state(0);

  const activeInstances = $derived(instances.filter((instance) => !instance.disabled).length);
  const disabledInstances = $derived(instances.filter((instance) => instance.disabled).length);

  async function listSessions() {
    return await adminOverviewRequester.request("Auth.ListSessions", {}).orThrow();
  }

  async function listConnections() {
    return await adminOverviewRequester.request("Auth.ListConnections", {}).orThrow();
  }

  async function listServiceInstances() {
    return await adminOverviewRequester.request("Auth.ListServiceInstances", {}).orThrow();
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [sessionsRes, connectionsRes, instancesRes] = await Promise.all([
        listSessions(),
        listConnections(),
        listServiceInstances(),
      ]);
      sessionCount = sessionsRes.sessions?.length ?? 0;
      connectionCount = connectionsRes.connections?.length ?? 0;
      instances = instancesRes.instances ?? [];
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

{#if loading}
  <div class="flex justify-center py-12">
    <span class="loading loading-spinner loading-md"></span>
  </div>
{:else}
  <section class="space-y-6">
    {#if error}
      <div class="alert alert-error"><span>{error}</span></div>
    {/if}

    <div class="stats stats-vertical sm:stats-horizontal shadow border border-base-300 w-full">
      <div class="stat">
        <div class="stat-title">Active Service Instances</div>
        <div class="stat-value text-2xl">{activeInstances}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Disabled Service Instances</div>
        <div class="stat-value text-2xl">{disabledInstances}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Sessions</div>
        <div class="stat-value text-2xl">{sessionCount}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Connections</div>
        <div class="stat-value text-2xl">{connectionCount}</div>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <a href={resolve("/admin/services")} class="btn btn-primary btn-sm">Manage Profiles</a>
      <a href="/admin/services/instances" class="btn btn-outline btn-sm">Manage Instances</a>
      <button class="btn btn-ghost btn-sm" onclick={load}>Refresh</button>
    </div>

    <div>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold">Service Instances</h3>
        <p class="text-xs text-base-content/60">{instances.length} total</p>
      </div>

      {#if instances.length === 0}
        <p class="text-sm text-base-content/60">No service instances provisioned.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Profile</th>
                <th>Contract</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#each instances as instance (instance.instanceId)}
                <tr>
                  <td class="font-medium">{instance.instanceId}</td>
                  <td class="text-base-content/60">{instance.profileId}</td>
                  <td class="text-base-content/60">{instance.currentContractDigest ?? instance.currentContractId ?? "—"}</td>
                  <td>
                    {#if instance.disabled}
                      <span class="badge badge-ghost badge-sm">Disabled</span>
                    {:else}
                      <span class="badge badge-success badge-sm">Active</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </section>
{/if}
