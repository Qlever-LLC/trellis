<script lang="ts">
  import { onMount } from "svelte";
  import { getTrellis } from "$lib/trellis-context.ts";

  type InspectionAssignment = {
    inspectionId: string;
    siteId: string;
    siteName: string;
    assetName: string;
    checklistName: string;
    priority: "high" | "medium" | "low";
  };
  type SiteSummary = {
    siteName: string;
    latestStatus: string;
    openInspections: number;
    overdueInspections: number;
    lastReportAt: string;
  };

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let assignments = $state<InspectionAssignment[]>([]);
  let selectedSiteId = $state<string | null>(null);
  let site = $state<SiteSummary | null>(null);

  async function selectSite(siteId: string): Promise<void> {
    selectedSiteId = siteId;
    error = null;

    try {
      const response = await trellis.request("Sites.Get", { siteId }).orThrow();
      site = response.site ?? null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadAssignments(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await trellis.request("Assignments.List", {}).orThrow();
      assignments = response.assignments;

      const firstSiteId = response.assignments[0]?.siteId;
      if (firstSiteId) {
        await selectSite(firstSiteId);
      } else {
        selectedSiteId = null;
        site = null;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function priorityClass(priority: InspectionAssignment["priority"]): string {
    if (priority === "high") return "badge badge-error badge-outline";
    if (priority === "medium") return "badge badge-warning badge-outline";
    return "badge badge-success badge-outline";
  }

  onMount(() => {
    void loadAssignments();
  });
</script>

<svelte:head>
  <title>Assignments · Field Ops Console</title>
</svelte:head>

<section class="flex w-full flex-col gap-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Assignments</h1>
    <p class="text-sm text-base-content/70">List assigned inspections and open the selected site.</p>
    <div class="badge badge-outline">Uses: RPC</div>
  </header>

  <div class="flex flex-wrap gap-3">
    <button class="btn btn-primary btn-sm" onclick={loadAssignments} disabled={loading}>
      {loading ? "Loading..." : "Reload assignments"}
    </button>
    <div class="badge badge-outline badge-lg">
      {assignments.length} assignment{assignments.length === 1 ? "" : "s"}
    </div>
  </div>

  {#if error}
    <div role="alert" class="alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.9fr)]">
    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">Work queue</h2>
          <span class="text-sm text-base-content/60">Assignments.List</span>
        </div>

        {#if loading}
          <div class="alert"><span>Loading assignments.</span></div>
        {:else if assignments.length === 0}
          <div class="alert"><span>No assignments returned.</span></div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-zebra">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Asset</th>
                  <th>Priority</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each assignments as assignment (assignment.inspectionId)}
                  <tr class={selectedSiteId === assignment.siteId ? "bg-base-200" : undefined}>
                    <td>
                      <div class="font-medium">{assignment.siteName}</div>
                      <div class="text-xs text-base-content/60">{assignment.checklistName}</div>
                    </td>
                    <td>
                      <div>{assignment.assetName}</div>
                      <div class="font-mono text-xs text-base-content/60">{assignment.inspectionId}</div>
                    </td>
                    <td><span class={priorityClass(assignment.priority)}>{assignment.priority}</span></td>
                    <td class="text-right">
                      <button class="btn btn-outline btn-sm" onclick={() => selectSite(assignment.siteId)} disabled={selectedSiteId === assignment.siteId}>
                        View site
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
          <h2 class="card-title text-lg">Selected site</h2>
          {#if selectedSiteId}
            <span class="badge badge-outline">{selectedSiteId}</span>
          {/if}
        </div>

        {#if site}
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr><th>Site</th><td>{site.siteName}</td></tr>
                <tr><th>Status</th><td>{site.latestStatus}</td></tr>
                <tr><th>Open</th><td>{site.openInspections}</td></tr>
                <tr><th>Overdue</th><td>{site.overdueInspections}</td></tr>
                <tr><th>Last report</th><td class="font-mono text-xs">{site.lastReportAt}</td></tr>
              </tbody>
            </table>
          </div>
        {:else}
          <div class="alert"><span>Select an assignment to load Sites.Get.</span></div>
        {/if}
      </div>
    </section>
  </div>
</section>
