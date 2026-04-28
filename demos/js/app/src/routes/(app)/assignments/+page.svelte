<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getTrellis } from "$lib/trellis";

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
  let mounted = false;
  let selectionRequestId = 0;

  async function selectSite(siteId: string): Promise<void> {
    const requestId = ++selectionRequestId;
    selectedSiteId = siteId;
    error = null;

    try {
      const response = await trellis.request("Sites.Get", { siteId }).orThrow();
      if (!mounted || requestId !== selectionRequestId || selectedSiteId !== siteId) return;
      site = response.site ?? null;
    } catch (cause) {
      if (!mounted || requestId !== selectionRequestId) return;
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadAssignments(): Promise<void> {
    const requestId = ++selectionRequestId;
    loading = true;
    error = null;

    try {
      const response = await trellis.request("Assignments.List", {}).orThrow();
      if (!mounted || requestId !== selectionRequestId) return;
      assignments = response.assignments;

      const firstSiteId = response.assignments[0]?.siteId;
      if (firstSiteId) {
        selectedSiteId = firstSiteId;
        const siteResponse = await trellis.request("Sites.Get", { siteId: firstSiteId }).orThrow();
        if (!mounted || requestId !== selectionRequestId || selectedSiteId !== firstSiteId) return;
        site = siteResponse.site ?? null;
      } else {
        selectedSiteId = null;
        site = null;
      }
    } catch (cause) {
      if (!mounted || requestId !== selectionRequestId) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!mounted || requestId !== selectionRequestId) return;
      loading = false;
    }
  }

  function priorityClass(priority: InspectionAssignment["priority"]): string {
    if (priority === "high") return "badge badge-error badge-outline";
    if (priority === "medium") return "badge badge-warning badge-outline";
    return "badge badge-success badge-outline";
  }

  onMount(() => {
    mounted = true;
    void loadAssignments();
  });

  onDestroy(() => {
    mounted = false;
    selectionRequestId += 1;
  });
</script>

<svelte:head>
  <title>Inspection Queue · Field Inspection Desk</title>
</svelte:head>

<section class="page-sheet rounded-box p-5 sm:p-7">
  <div class="flex flex-col gap-6">
  <header class="pb-1">
    <div class="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div class="min-w-0 space-y-3">
        <div class="trellis-kicker">Assignments.List</div>
        <h1 class="break-words text-2xl font-black tracking-tight md:text-3xl">Inspection queue</h1>
        <p class="max-w-3xl break-words text-sm text-base-content/70">
          Triage assigned inspections, jump to the site context, and keep priority work visible for the desk operator.
        </p>
      </div>
      <div class="flex min-w-0 flex-wrap gap-3">
        <button class="btn btn-accent btn-sm" onclick={loadAssignments} disabled={loading}>
          {loading ? "Loading queue..." : "Refresh queue"}
        </button>
        <div class="badge badge-outline badge-lg max-w-full"><span class="truncate">Teaching note: RPC</span></div>
      </div>
    </div>
  </header>

  <div class="stats stats-vertical overflow-hidden border-y border-base-300/80 bg-base-200/35 md:stats-horizontal">
    <div class="stat">
      <div class="stat-title">Queued inspections</div>
      <div class="stat-value text-3xl">{assignments.length}</div>
      <div class="stat-desc">Assignments.List result</div>
    </div>
    <div class="stat">
      <div class="stat-title min-w-0 break-words">Selected site</div>
      <div class="stat-value min-w-0 break-words text-lg">{site?.siteName ?? "None"}</div>
      <div class="stat-desc">Loaded with Sites.Get</div>
    </div>
  </div>

  {#if error}
    <div role="alert" class="alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="section-rule grid gap-7 pt-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.9fr)]">
    <section class="min-w-0">
      <div class="flex flex-col gap-5">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Dispatch lane</h2>
          <span class="badge badge-ghost max-w-full"><span class="truncate">Assignments.List</span></span>
        </div>

        {#if loading}
          <div class="alert"><span>Loading the inspection queue.</span></div>
        {:else if assignments.length === 0}
          <div class="alert"><span>No inspections are waiting in the queue.</span></div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-zebra executive-table min-w-[44rem]">
              <thead>
                <tr>
                  <th>Inspection stop</th>
                  <th>Asset</th>
                  <th>Priority</th>
                  <th><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {#each assignments as assignment (assignment.inspectionId)}
                  <tr class={selectedSiteId === assignment.siteId ? "bg-base-200" : undefined}>
                    <th scope="row">
                      <div class="break-words font-medium">{assignment.siteName}</div>
                      <div class="break-words text-xs text-base-content/60">{assignment.checklistName}</div>
                    </th>
                    <td>
                      <div class="break-words">{assignment.assetName}</div>
                      <div class="break-words font-mono text-xs text-base-content/60">{assignment.inspectionId}</div>
                    </td>
                    <td><span class={priorityClass(assignment.priority)}>{assignment.priority}</span></td>
                    <td class="text-right">
                      <button class="btn btn-outline btn-sm" onclick={() => selectSite(assignment.siteId)} disabled={selectedSiteId === assignment.siteId} aria-label={`Open site context for ${assignment.siteName}`}>
                        Open context
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

    <section class="min-w-0 border-t border-base-300/80 pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
      <div class="flex flex-col gap-5">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Site context</h2>
          {#if selectedSiteId}
            <span class="badge badge-outline max-w-full"><span class="truncate">{selectedSiteId}</span></span>
          {/if}
        </div>

        {#if site}
          <div class="overflow-x-auto">
            <table class="table table-sm executive-table min-w-[28rem]">
              <tbody>
                  <tr><th scope="row">Site</th><td class="break-words font-medium">{site.siteName}</td></tr>
                  <tr><th scope="row">Field status</th><td class="break-words">{site.latestStatus}</td></tr>
                  <tr><th scope="row">Open inspections</th><td>{site.openInspections}</td></tr>
                  <tr><th scope="row">Overdue</th><td>{site.overdueInspections}</td></tr>
                  <tr><th scope="row">Last report run</th><td class="break-words font-mono text-xs">{site.lastReportAt}</td></tr>
              </tbody>
            </table>
          </div>
        {:else}
          <div class="alert"><span>Select an inspection to preview its site status. Teaching note: this calls Sites.Get.</span></div>
        {/if}
      </div>
    </section>
  </div>
  </div>
</section>
