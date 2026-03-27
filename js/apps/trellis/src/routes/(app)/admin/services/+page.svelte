<script lang="ts">
  import type { AuthListServicesOutput } from "@qlever-llc/trellis-sdk-auth";
  import { getTrellisFor } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { trellisApp } from "../../../../contracts/trellis_app.ts";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";

  const trellisPromise = getTrellisFor(trellisApp);
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let search = $state("");
  let services = $state<AuthListServicesOutput["services"]>([]);
  let expandedKey = $state<string | null>(null);
  let upgradeJson = $state("");
  let upgradePending = $state(false);
  let upgradeLoadPending = $state(false);

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) =>
      [s.displayName, s.description, s.contractId, s.contractDigest, s.sessionKey, ...(s.capabilities ?? []), ...(s.namespaces ?? [])]
        .filter(Boolean).some((v: string) => v.toLowerCase().includes(q))
    );
  });

  const activeCount = $derived(services.filter((s) => s.active).length);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await (await trellisPromise).requestOrThrow("Auth.ListServices", {});
      services = res.services ?? [];
    } catch (e) { error = errorMessage(e); }
    finally { loading = false; }
  }

  function toggleExpand(key: string) {
    expandedKey = expandedKey === key ? null : key;
    upgradeJson = "";
  }

  async function loadCurrentContract(digest: string) {
    upgradeLoadPending = true;
    try {
      const res = await (await trellisPromise).requestOrThrow("Auth.GetInstalledContract", { digest });
      upgradeJson = JSON.stringify(res.contract?.contract ?? res.contract, null, 2);
    } catch (e) { error = `Could not load contract (digest: ${digest.slice(0, 12)}…). It may have been removed from storage.`; }
    finally { upgradeLoadPending = false; }
  }

  async function upgradeContract(sessionKey: string) {
    if (!upgradeJson.trim()) return;
    upgradePending = true;
    try {
      const contract = JSON.parse(upgradeJson);
      await (await trellisPromise).requestOrThrow("Auth.UpgradeServiceContract", { sessionKey, contract });
      notifications.success("Contract upgraded.", "Upgraded");
      upgradeJson = "";
      await load();
    } catch (e) { error = errorMessage(e); }
    finally { upgradePending = false; }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <div class="flex items-center justify-between">
    <div class="stats shadow border border-base-300">
      <div class="stat py-2 px-4">
        <div class="stat-title text-xs">Active</div>
        <div class="stat-value text-xl">{activeCount}</div>
      </div>
    </div>
    <div class="flex gap-2">
      <input class="input input-bordered input-sm w-48" placeholder="Search services…" bind:value={search} />
      <a href="/admin/services/new" class="btn btn-primary btn-sm">Install Service</a>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if filtered.length === 0}
    <p class="text-sm text-base-content/60">No services found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Service</th>
            <th>Contract</th>
            <th>Digest</th>
            <th>Bindings</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as service}
            <tr class="cursor-pointer hover" onclick={() => toggleExpand(service.sessionKey)}>
              <td class="font-medium">{service.displayName}</td>
              <td class="text-base-content/60">{service.contractId ?? "—"}</td>
              <td class="font-mono text-xs text-base-content/60">{service.contractDigest?.slice(0, 12) ?? "—"}{service.contractDigest ? "…" : ""}</td>
              <td class="text-base-content/60">
                {#if service.resourceBindings?.kv}
                  {Object.keys(service.resourceBindings.kv).length} KV
                {:else}
                  —
                {/if}
              </td>
              <td>
                {#if service.active}
                  <span class="badge badge-success badge-sm">Active</span>
                {:else}
                  <span class="badge badge-ghost badge-sm">Inactive</span>
                {/if}
              </td>
            </tr>

            {#if expandedKey === service.sessionKey}
              <tr>
                <td colspan="5" class="bg-base-200 p-4">
                  <div class="space-y-4">
                    {#if service.resourceBindings?.kv}
                      <div>
                        <h4 class="text-xs font-semibold uppercase text-base-content/50 mb-2">KV Bindings</h4>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {#each Object.entries(service.resourceBindings.kv as Record<string, { bucket: string }>) as [alias, binding]}
                            <div class="card bg-base-100 border border-base-300 p-3">
                              <p class="font-medium text-sm">{alias}</p>
                              <p class="text-xs text-base-content/60 font-mono">{binding.bucket}</p>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}

                    {#if service.contractDigest}
                      <div>
                        <h4 class="text-xs font-semibold uppercase text-base-content/50 mb-2">Upgrade Contract</h4>
                        <div class="flex gap-2 mb-2">
                          <button
                            class="btn btn-ghost btn-xs"
                            onclick={() => loadCurrentContract(service.contractDigest)}
                            disabled={upgradeLoadPending}
                          >
                            {upgradeLoadPending ? "Loading…" : "Load current"}
                          </button>
                        </div>
                        <textarea
                          class="textarea textarea-bordered w-full font-mono text-xs"
                          rows="8"
                          placeholder="Paste contract JSON…"
                          bind:value={upgradeJson}
                        ></textarea>
                        <button
                          class="btn btn-primary btn-sm mt-2"
                          onclick={() => upgradeContract(service.sessionKey)}
                          disabled={upgradePending || !upgradeJson.trim()}
                        >
                          {upgradePending ? "Upgrading…" : "Upgrade"}
                        </button>
                      </div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
