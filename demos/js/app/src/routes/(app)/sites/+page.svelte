<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getTrellis } from "$lib/trellis";

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
  let mounted = false;
  let selectionRequestId = 0;
  let refreshRunId = 0;

  async function loadSite(siteId: string): Promise<void> {
    const requestId = ++selectionRequestId;
    selectedSiteId = siteId;
    error = null;

    try {
      const response = await trellis.request("Sites.Get", { siteId }).orThrow();
      if (!mounted || requestId !== selectionRequestId || selectedSiteId !== siteId) return;
      selectedSite = response.site ?? null;
    } catch (cause) {
      if (!mounted || requestId !== selectionRequestId) return;
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadSites(preferredSiteId?: string): Promise<void> {
    const requestId = ++selectionRequestId;
    loading = true;
    error = null;

    try {
      const response = await trellis.request("Sites.List", {}).orThrow();
      if (!mounted || requestId !== selectionRequestId) return;
      sites = response.sites;

      const siteIdToLoad = preferredSiteId ?? selectedSiteId ?? response.sites[0]?.siteId;
      if (siteIdToLoad) {
        selectedSiteId = siteIdToLoad;
        const siteResponse = await trellis.request("Sites.Get", { siteId: siteIdToLoad }).orThrow();
        if (!mounted || requestId !== selectionRequestId || selectedSiteId !== siteIdToLoad) return;
        selectedSite = siteResponse.site ?? null;
      } else {
        selectedSiteId = null;
        selectedSite = null;
      }
    } catch (cause) {
      if (!mounted || requestId !== selectionRequestId) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!mounted || requestId !== selectionRequestId) return;
      loading = false;
    }
  }

  async function watchRefresh(ref: RefreshOperationRef, runId: number): Promise<void> {
    const stream = await ref.watch().orThrow();
    for await (const event of stream) {
      if (!mounted || runId !== refreshRunId) return;
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
    const runId = ++refreshRunId;

    try {
      const ref = await trellis.operation("Sites.Refresh").input({ siteId: selectedSiteId }).start().orThrow();
      if (!mounted || runId !== refreshRunId) return;
      acceptedId = ref.id;
      void watchRefresh(ref, runId).catch((cause) => {
        if (!mounted || runId !== refreshRunId) return;
        error = cause instanceof Error ? cause.message : String(cause);
      });
      const terminal = await ref.wait().orThrow();
      if (!mounted || runId !== refreshRunId) return;
      if (terminal.output) {
        selectedSite = terminal.output.site;
        await loadSites(terminal.output.site.siteId);
      }
    } catch (cause) {
      if (!mounted || runId !== refreshRunId) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!mounted || runId !== refreshRunId) return;
      refreshing = false;
    }
  }

  onMount(() => {
    mounted = true;
    void loadSites();
  });

  onDestroy(() => {
    mounted = false;
    selectionRequestId += 1;
    refreshRunId += 1;
  });
</script>

<svelte:head>
  <title>Site Status · Field Inspection Desk</title>
</svelte:head>

<section class="page-sheet rounded-box p-5 sm:p-7">
  <div class="flex flex-col gap-6">
  <header class="pb-1">
    <div class="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div class="min-w-0 space-y-3">
        <div class="trellis-kicker">Sites.Refresh</div>
        <h1 class="break-words text-2xl font-black tracking-tight md:text-3xl">Site status</h1>
        <p class="max-w-3xl break-words text-sm text-base-content/70">
          Review each inspection location, refresh the active site summary, and watch the operation timeline as the service reconciles status.
        </p>
      </div>
      <div class="flex min-w-0 flex-wrap gap-3">
        <button class="btn btn-accent btn-sm" onclick={() => void loadSites()} disabled={loading || refreshing}>
          {loading ? "Loading sites..." : "Refresh board"}
        </button>
        <button class="btn btn-outline btn-sm" onclick={refreshSite} disabled={refreshing || !selectedSiteId}>
          {refreshing ? "Reconciling..." : "Reconcile active site"}
        </button>
        <div class="badge badge-outline badge-lg max-w-full"><span class="truncate">Teaching note: RPC + operation</span></div>
      </div>
    </div>
  </header>

  <div class="stats stats-vertical overflow-hidden border-y border-base-300/80 bg-base-200/35 md:stats-horizontal">
    <div class="stat">
      <div class="stat-title">Sites on board</div>
      <div class="stat-value text-3xl">{sites.length}</div>
      <div class="stat-desc">Sites.List result</div>
    </div>
    <div class="stat">
      <div class="stat-title min-w-0 break-words">Active status</div>
      <div class="stat-value min-w-0 break-words text-lg">{selectedSite?.latestStatus ?? "No site selected"}</div>
      <div class="stat-desc">Current summary snapshot</div>
    </div>
  </div>

  {#if error}
    <div role="alert" class="alert alert-error"><span>{error}</span></div>
  {/if}

  <div class="section-rule grid gap-7 pt-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
    <section class="min-w-0">
      <div class="flex flex-col gap-5">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Status board</h2>
          <span class="badge badge-ghost max-w-full"><span class="truncate">Sites.List</span></span>
        </div>

        {#if loading}
          <div class="alert"><span>Loading site status summaries.</span></div>
        {:else if sites.length === 0}
          <div class="alert"><span>No site status records are available.</span></div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-zebra executive-table min-w-[48rem]">
              <thead>
                <tr><th>Site</th><th>Status</th><th>Open</th><th>Overdue</th><th><span class="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {#each sites as siteItem (siteItem.siteId)}
                  <tr class={selectedSiteId === siteItem.siteId ? "bg-base-200" : undefined}>
                    <th scope="row">
                      <div class="break-words font-medium">{siteItem.siteName}</div>
                      <div class="break-words font-mono text-xs text-base-content/60">{siteItem.siteId}</div>
                    </th>
                    <td><span class="badge badge-outline max-w-40"><span class="truncate">{siteItem.latestStatus}</span></span></td>
                    <td>{siteItem.openInspections}</td>
                    <td>{siteItem.overdueInspections}</td>
                    <td class="text-right">
                      <button class="btn btn-outline btn-sm" onclick={() => loadSite(siteItem.siteId)} disabled={selectedSiteId === siteItem.siteId} aria-label={`Inspect ${siteItem.siteName}`}>Inspect</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="min-w-0 border-t border-base-300/80 pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
      <div class="flex flex-col gap-5">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Active site dossier</h2>
          {#if acceptedId}
            <span class="badge badge-outline max-w-full font-mono"><span class="truncate">{acceptedId}</span></span>
          {:else if selectedSiteId}
            <span class="badge badge-outline max-w-full"><span class="truncate">{selectedSiteId}</span></span>
          {/if}
        </div>

        {#if selectedSite}
          <div class="overflow-x-auto">
            <table class="table table-sm executive-table min-w-[28rem]">
              <tbody>
                <tr><th scope="row">Site</th><td class="break-words font-medium">{selectedSite.siteName}</td></tr>
                <tr><th scope="row">Field status</th><td class="break-words">{selectedSite.latestStatus}</td></tr>
                <tr><th scope="row">Open inspections</th><td>{selectedSite.openInspections}</td></tr>
                <tr><th scope="row">Overdue inspections</th><td>{selectedSite.overdueInspections}</td></tr>
                <tr><th scope="row">Last report</th><td class="break-words font-mono text-xs">{selectedSite.lastReportAt}</td></tr>
              </tbody>
            </table>
          </div>
        {:else}
          <div class="alert"><span>Select a site to load its dossier. Teaching note: this calls Sites.Get.</span></div>
        {/if}

        {#if progressLog.length > 0}
          <div class="divider my-0">Reconcile timeline</div>
          <div class="space-y-2">
            {#each progressLog as entry, index (`${entry.label}-${index}`)}
              <div class="min-w-0 border-t border-base-300/80 bg-base-200/45 px-1 py-3 text-sm">
                <span class="badge badge-outline badge-sm max-w-full"><span class="truncate">{entry.state}</span></span>
                <span class="ml-2 break-words">{entry.label}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
  </div>
</section>
