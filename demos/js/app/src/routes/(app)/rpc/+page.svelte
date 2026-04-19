<script lang="ts">
  import { onMount } from "svelte";
  import { requestValue, type RpcAssignment, type RpcSiteSummary } from "$lib/trellis";

  let loading = $state(true);
  let error = $state<string | null>(null);
  let assignments = $state<RpcAssignment[]>([]);
  let selectedSiteId = $state<string | null>(null);
  let summary = $state<RpcSiteSummary | null>(null);

  async function selectSite(siteId: string): Promise<void> {
    selectedSiteId = siteId;
    error = null;

    try {
      const response = await requestValue("Inspection.Sites.GetSummary", { siteId });
      summary = response.summary ?? null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadAssignments(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await requestValue("Inspection.Assignments.List", {});
      assignments = response.assignments;
      const firstSiteId = response.assignments[0]?.siteId;
      if (firstSiteId) {
        await selectSite(firstSiteId);
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadAssignments();
  });
</script>

<svelte:head>
  <title>RPC · Field inspection demo</title>
</svelte:head>

<section class="stack">
  <header class="page-header">
    <p class="eyebrow">RPC surface</p>
    <h1>Assigned inspections</h1>
    <p class="page-summary">This page pulls the current assignment list and a typed site summary over direct Trellis RPC calls.</p>
  </header>

  <div class="button-row">
    <button class="button" onclick={loadAssignments} disabled={loading}>Reload assignments</button>
  </div>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="feature-grid" style="grid-template-columns: 1.2fr 0.9fr;">
    <section class="surface-card">
      <div class="split">
        <h2 class="section-title">Inspection queue</h2>
        <span class="pill">{assignments.length} active</span>
      </div>

      {#if loading}
        <div class="empty-state">Loading the latest assignment batch…</div>
      {:else if assignments.length === 0}
        <div class="empty-state">No assignments were returned.</div>
      {:else}
        <ul class="data-list">
          {#each assignments as assignment (assignment.inspectionId)}
            <li>
              <div class="split">
                <span class={`pill ${assignment.priority === "high" ? "danger" : assignment.priority === "medium" ? "warn" : "success"}`}>
                  {assignment.priority}
                </span>
                <button class="ghost-button" onclick={() => selectSite(assignment.siteId)} disabled={selectedSiteId === assignment.siteId}>
                  Inspect site
                </button>
              </div>
              <h3>{assignment.siteName}</h3>
              <p class="muted">{assignment.assetName} · {assignment.checklistName}</p>
              <p class="status-line code">{assignment.inspectionId} · {assignment.scheduledFor}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="surface-card">
      <div class="split">
        <h2 class="section-title">Selected site summary</h2>
        {#if selectedSiteId}
          <span class="pill">{selectedSiteId}</span>
        {/if}
      </div>

      {#if summary}
        <dl class="field-list">
          <li><strong>{summary.siteName}</strong><span class="muted">Latest field status</span></li>
          <li><strong>{summary.latestStatus}</strong><span class="muted">Operational state</span></li>
          <li><strong>{summary.openInspections}</strong><span class="muted">Open inspections</span></li>
          <li><strong>{summary.overdueInspections}</strong><span class="muted">Overdue inspections</span></li>
          <li><strong class="code">{summary.lastReportAt}</strong><span class="muted">Last report timestamp</span></li>
        </dl>
      {:else}
        <div class="empty-state">Pick an assignment to load its summary.</div>
      {/if}
    </section>
  </div>
</section>
