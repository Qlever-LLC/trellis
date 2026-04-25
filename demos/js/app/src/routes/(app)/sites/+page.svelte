<script lang="ts">
  import { onMount } from "svelte";
  import { getTrellis } from "$lib/trellis-context.ts";

  type SiteSummary = {
    siteId: string;
    siteName: string;
    latestStatus: string;
    openInspections: number;
    overdueInspections: number;
    lastReportAt: string;
  };
  type SitesRefreshProgress = { stage: string; message: string };
  type SitesRefreshResponse = { site: SiteSummary };

  type RefreshEvent = {
    type: string;
    snapshot: { state: string };
    progress?: SitesRefreshProgress;
  };
  type RefreshTerminal = {
    state: string;
    output?: SitesRefreshResponse;
  };
  type RefreshOperationRef = {
    id: string;
    watch(): { orThrow(): Promise<AsyncIterable<RefreshEvent>> };
    wait(): { orThrow(): Promise<RefreshTerminal> };
  };

  const trellis = getTrellis();

  let loading = $state(true);
  let refreshing = $state(false);
  let error = $state<string | null>(null);
  let sites = $state<SiteSummary[]>([]);
  let selectedSiteId = $state<string | null>(null);
  let selectedSite = $state<SiteSummary | null>(null);
  let acceptedId = $state<string | null>(null);
  let progressLog = $state<Array<{ label: string; state: string }>>([]);

  async function loadSite(siteId: string): Promise<void> {
    selectedSiteId = siteId;
    error = null;

    try {
      const response = await trellis.request("Sites.Get", { siteId }).orThrow();
      selectedSite = response.site ?? null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadSites(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await trellis.request("Sites.List", {}).orThrow();
      sites = response.sites;

      const firstSiteId = response.sites[0]?.siteId;
      if (firstSiteId) {
        await loadSite(firstSiteId);
      } else {
        selectedSiteId = null;
        selectedSite = null;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function watchRefresh(ref: RefreshOperationRef): Promise<void> {
    const stream = await ref.watch().orThrow();
    for await (const event of stream) {
      const label = event.progress ? `${event.progress.stage}: ${event.progress.message}` : `${event.type} update`;
      progressLog = [{ label, state: event.snapshot.state }, ...progressLog].slice(0, 6);
    }
  }

  async function refreshSite(): Promise<void> {
    if (!selectedSiteId) return;

    refreshing = true;
    error = null;
    acceptedId = null;
    progressLog = [];

    try {
      const ref = await trellis.operation("Sites.Refresh").input({ siteId: selectedSiteId }).start().orThrow();
      acceptedId = ref.id;
      void watchRefresh(ref);
      const terminal = await ref.wait().orThrow();
      if (terminal.output) {
        selectedSite = terminal.output.site;
        await loadSites();
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    void loadSites();
  });
</script>

<svelte:head>
  <title>Sites · Field Ops Console</title>
</svelte:head>

<section class="flex w-full flex-col gap-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Sites</h1>
    <p class="text-sm text-base-content/70">Read site summaries and refresh one without polling a status endpoint.</p>
    <div class="badge badge-outline">Uses: RPC + operation</div>
  </header>

  <div class="flex flex-wrap gap-3">
    <button class="btn btn-primary btn-sm" onclick={loadSites} disabled={loading || refreshing}>
      {loading ? "Loading..." : "Reload sites"}
    </button>
    <button class="btn btn-outline btn-sm" onclick={refreshSite} disabled={refreshing || !selectedSiteId}>
      {refreshing ? "Refreshing..." : "Refresh site summary"}
    </button>
    <div class="badge badge-outline badge-lg">{sites.length} site{sites.length === 1 ? "" : "s"}</div>
  </div>

  {#if error}
    <div role="alert" class="alert alert-error"><span>{error}</span></div>
  {/if}

  <div class="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">Site summaries</h2>
          <span class="text-sm text-base-content/60">Sites.List</span>
        </div>

        {#if loading}
          <div class="alert"><span>Loading site summaries.</span></div>
        {:else if sites.length === 0}
          <div class="alert"><span>No site summaries available.</span></div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-zebra">
              <thead>
                <tr><th>Site</th><th>Status</th><th>Open</th><th>Overdue</th><th></th></tr>
              </thead>
              <tbody>
                {#each sites as siteItem (siteItem.siteId)}
                  <tr class={selectedSiteId === siteItem.siteId ? "bg-base-200" : undefined}>
                    <td>
                      <div class="font-medium">{siteItem.siteName}</div>
                      <div class="font-mono text-xs text-base-content/60">{siteItem.siteId}</div>
                    </td>
                    <td>{siteItem.latestStatus}</td>
                    <td>{siteItem.openInspections}</td>
                    <td>{siteItem.overdueInspections}</td>
                    <td class="text-right">
                      <button class="btn btn-outline btn-sm" onclick={() => loadSite(siteItem.siteId)} disabled={selectedSiteId === siteItem.siteId}>View</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">Selected summary</h2>
          {#if acceptedId}
            <span class="badge badge-outline font-mono">{acceptedId}</span>
          {:else if selectedSiteId}
            <span class="badge badge-outline">{selectedSiteId}</span>
          {/if}
        </div>

        {#if selectedSite}
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr><th>Site</th><td>{selectedSite.siteName}</td></tr>
                <tr><th>Status</th><td>{selectedSite.latestStatus}</td></tr>
                <tr><th>Open inspections</th><td>{selectedSite.openInspections}</td></tr>
                <tr><th>Overdue inspections</th><td>{selectedSite.overdueInspections}</td></tr>
                <tr><th>Last report</th><td class="font-mono text-xs">{selectedSite.lastReportAt}</td></tr>
              </tbody>
            </table>
          </div>
        {:else}
          <div class="alert"><span>Select a site to load Sites.Get.</span></div>
        {/if}

        {#if progressLog.length > 0}
          <div class="divider my-0">Refresh progress</div>
          <div class="space-y-2">
            {#each progressLog as entry, index (`${entry.label}-${index}`)}
              <div class="rounded-box bg-base-200 px-3 py-2 text-sm">
                <span class="font-medium">{entry.state}</span> · {entry.label}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
</section>
