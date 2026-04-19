<script lang="ts">
  import { onMount } from "svelte";
  import { requestValue, type KvSummary } from "$lib/trellis";

  let loading = $state(true);
  let error = $state<string | null>(null);
  let summaries = $state<KvSummary[]>([]);
  let selectedSiteId = $state<string | null>(null);
  let selectedSummary = $state<KvSummary | null>(null);

  async function loadSummary(siteId: string): Promise<void> {
    selectedSiteId = siteId;
    error = null;

    try {
      const response = await requestValue("Inspection.Summaries.Get", { siteId });
      selectedSummary = response.summary ?? null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadSummaries(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await requestValue("Inspection.Summaries.List", {});
      summaries = response.summaries;
      const firstSiteId = response.summaries[0]?.siteId;
      if (firstSiteId) {
        await loadSummary(firstSiteId);
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
  <title>KV · Field inspection demo</title>
</svelte:head>

<section class="stack">
  <header class="page-header">
    <p class="eyebrow">KV-backed view</p>
    <h1>Site summary projection</h1>
    <p class="page-summary">The KV demo service projects its latest site summaries and exposes them through small read-oriented RPCs.</p>
  </header>

  <div class="button-row">
    <button class="button" onclick={loadSummaries} disabled={loading}>Refresh summary list</button>
  </div>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="feature-grid" style="grid-template-columns: 1.1fr 0.9fr;">
    <section class="surface-card">
      <div class="split">
        <h2 class="section-title">Projected sites</h2>
        <span class="pill">{summaries.length} records</span>
      </div>

      {#if loading}
        <div class="empty-state">Reading the latest KV-backed projection…</div>
      {:else if summaries.length === 0}
        <div class="empty-state">No site summaries are available yet.</div>
      {:else}
        <ul class="data-list">
          {#each summaries as summary (summary.siteId)}
            <li>
              <div class="split">
                <h3>{summary.siteName}</h3>
                <button class="ghost-button" onclick={() => loadSummary(summary.siteId)} disabled={selectedSiteId === summary.siteId}>
                  Open detail
                </button>
              </div>
              <p class="muted">{summary.openInspections} open · {summary.overdueInspections} overdue</p>
              <p class="status-line code">{summary.siteId} · {summary.latestStatus}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="surface-card">
      <div class="split">
        <h2 class="section-title">Selected projection</h2>
        {#if selectedSiteId}
          <span class="pill">{selectedSiteId}</span>
        {/if}
      </div>

      {#if selectedSummary}
        <dl class="field-list">
          <li><strong>{selectedSummary.siteName}</strong><span class="muted">Projected display name</span></li>
          <li><strong>{selectedSummary.latestStatus}</strong><span class="muted">Latest status flag</span></li>
          <li><strong>{selectedSummary.openInspections}</strong><span class="muted">Open inspections</span></li>
          <li><strong>{selectedSummary.overdueInspections}</strong><span class="muted">Overdue inspections</span></li>
          <li><strong class="code">{selectedSummary.lastReportAt}</strong><span class="muted">Last report timestamp</span></li>
        </dl>
      {:else}
        <div class="empty-state">Choose a projected site to inspect its current read model.</div>
      {/if}
    </section>
  </div>
</section>
