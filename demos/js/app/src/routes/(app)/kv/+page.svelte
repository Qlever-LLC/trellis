<script lang="ts">
  import { onMount } from "svelte";
  import { getTrellis } from "$lib/trellis-context.ts";
  import type { SiteSummary } from "@trellis-demo/kv-service-sdk";

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let summaries = $state<SiteSummary[]>([]);
  let selectedSiteId = $state<string | null>(null);
  let selectedSummary = $state<SiteSummary | null>(null);

  async function loadSummary(siteId: string): Promise<void> {
    selectedSiteId = siteId;
    error = null;

    try {
      const response = await trellis
        .request("Inspection.Summaries.Get", {
          siteId,
        })
        .orThrow();
      selectedSummary = response.summary ?? null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadSummaries(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await trellis
        .request("Inspection.Summaries.List", {})
        .orThrow();
      summaries = response.summaries;

      const firstSiteId = response.summaries[0]?.siteId;
      if (firstSiteId) {
        await loadSummary(firstSiteId);
      } else {
        selectedSiteId = null;
        selectedSummary = null;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadSummaries();
  });
</script>

<svelte:head>
  <title>KV · Trellis demo</title>
</svelte:head>

<section class="flex w-full flex-col gap-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">KV</h1>
    <p class="text-sm text-base-content/70">Read a KV-backed projection.</p>
  </header>

  <div class="flex flex-wrap gap-3">
    <button
      class="btn btn-primary btn-sm"
      onclick={loadSummaries}
      disabled={loading}
    >
      {loading ? "Loading..." : "Refresh summaries"}
    </button>
    <div class="badge badge-outline badge-lg">
      {summaries.length} projected site{summaries.length === 1 ? "" : "s"}
    </div>
  </div>

  {#if error}
    <div role="alert" class="alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">Projection list</h2>
          <span class="text-sm text-base-content/60"
            >Inspection.Summaries.List</span
          >
        </div>

        {#if loading}
          <div class="alert">
            <span>Loading projection data.</span>
          </div>
        {:else if summaries.length === 0}
          <div class="alert">
            <span>No site summaries available.</span>
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-zebra">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Status</th>
                  <th>Open</th>
                  <th>Overdue</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each summaries as summary (summary.siteId)}
                  <tr
                    class={selectedSiteId === summary.siteId
                      ? "bg-base-200"
                      : undefined}
                  >
                    <td>
                      <div class="font-medium">{summary.siteName}</div>
                      <div class="font-mono text-xs text-base-content/60">
                        {summary.siteId}
                      </div>
                    </td>
                    <td>{summary.latestStatus}</td>
                    <td>{summary.openInspections}</td>
                    <td>{summary.overdueInspections}</td>
                    <td class="text-right">
                      <button
                        class="btn btn-outline btn-sm"
                        onclick={() => loadSummary(summary.siteId)}
                        disabled={selectedSiteId === summary.siteId}
                      >
                        View
                      </button>
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
          {#if selectedSiteId}
            <span class="badge badge-outline">{selectedSiteId}</span>
          {/if}
        </div>

        {#if selectedSummary}
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr>
                  <th>Site</th>
                  <td>{selectedSummary.siteName}</td>
                </tr>
                <tr>
                  <th>Status</th>
                  <td>{selectedSummary.latestStatus}</td>
                </tr>
                <tr>
                  <th>Open inspections</th>
                  <td>{selectedSummary.openInspections}</td>
                </tr>
                <tr>
                  <th>Overdue inspections</th>
                  <td>{selectedSummary.overdueInspections}</td>
                </tr>
                <tr>
                  <th>Last report</th>
                  <td class="font-mono text-xs"
                    >{selectedSummary.lastReportAt}</td
                  >
                </tr>
              </tbody>
            </table>
          </div>
        {:else}
          <div class="alert">
            <span>Select a site to load Inspection.Summaries.Get.</span>
          </div>
        {/if}
      </div>
    </section>
  </div>
</section>
