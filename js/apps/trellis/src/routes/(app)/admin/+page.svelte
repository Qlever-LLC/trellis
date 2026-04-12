<script lang="ts">
  import type {
    AuthListConnectionsOutput,
    AuthListServicesOutput,
    AuthListSessionsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { onMount } from "svelte";
  import { errorMessage } from "../../../lib/format";
  import { getTrellis } from "../../../lib/trellis";

  const trellisPromise = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let services = $state<AuthListServicesOutput["services"]>([]);
  let sessionCount = $state(0);
  let connectionCount = $state(0);

  const activeServices = $derived(services.filter((s) => s.active).length);
  const needsSetup = $derived(services.filter((s) => !s.contractDigest).length);

  async function listSessions() {
    const trellis = await trellisPromise;
    return await trellis.requestOrThrow("Auth.ListSessions", {});
  }

  async function listConnections() {
    const trellis = await trellisPromise;
    return await trellis.requestOrThrow("Auth.ListConnections", {});
  }

  async function listServices() {
    const trellis = await trellisPromise;
    return await trellis.requestOrThrow("Auth.ListServices", {});
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [sessionsRes, connectionsRes, servicesRes] = await Promise.all([
        listSessions(),
        listConnections(),
        listServices(),
      ]);
      sessionCount = sessionsRes.sessions?.length ?? 0;
      connectionCount = connectionsRes.connections?.length ?? 0;
      services = servicesRes.services ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => { void load(); });
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
        <div class="stat-title">Active Services</div>
        <div class="stat-value text-2xl">{activeServices}</div>
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

    {#if needsSetup > 0}
      <div class="alert alert-warning">
        <span>{needsSetup} service{needsSetup > 1 ? "s" : ""} need{needsSetup === 1 ? "s" : ""} setup</span>
      </div>
    {/if}

    <div>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold">Services</h3>
        <button class="btn btn-ghost btn-sm" onclick={load}>Refresh</button>
      </div>

      {#if services.length === 0}
        <p class="text-sm text-base-content/60">No services installed.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Contract</th>
                <th>Bindings</th>
              </tr>
            </thead>
            <tbody>
              {#each services as service (service.sessionKey ?? service.contractId ?? service.displayName)}
                <tr>
                  <td class="font-medium">{service.displayName}</td>
                  <td>
                    {#if service.active}
                      <span class="badge badge-success badge-sm">Active</span>
                    {:else if service.contractDigest}
                      <span class="badge badge-ghost badge-sm">Inactive</span>
                    {:else}
                      <span class="badge badge-warning badge-sm">Needs setup</span>
                    {/if}
                  </td>
                  <td class="text-base-content/60">{service.contractId ?? "—"}</td>
                  <td class="text-base-content/60">
                    {#if service.resourceBindings?.kv}
                      {Object.keys(service.resourceBindings.kv).length} KV
                    {:else}
                      —
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
