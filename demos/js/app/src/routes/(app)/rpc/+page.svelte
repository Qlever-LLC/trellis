<script lang="ts">
  import { onMount } from "svelte";
  import { getTrellis } from "$lib/trellis-context.svelte";
  import type {
    InspectionAssignmentsListOutput,
    InspectionSitesGetSummaryOutput,
  } from "../../../../../generated/js/sdks/demo-rpc-service/types.ts";

  type RpcAssignment = InspectionAssignmentsListOutput["assignments"][number];
  type RpcSiteSummary = NonNullable<InspectionSitesGetSummaryOutput["summary"]>;
  type RpcDemoTrellis = {
    request(method: "Inspection.Assignments.List", input: {}): {
      orThrow(): Promise<InspectionAssignmentsListOutput>;
    };
    request(method: "Inspection.Sites.GetSummary", input: { siteId: string }): {
      orThrow(): Promise<InspectionSitesGetSummaryOutput>;
    };
  };

  async function getRpcTrellis(): Promise<RpcDemoTrellis> {
    return await getTrellis() as RpcDemoTrellis;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let assignments = $state<RpcAssignment[]>([]);
  let selectedSiteId = $state<string | null>(null);
  let summary = $state<RpcSiteSummary | null>(null);
  async function selectSite(siteId: string): Promise<void> {
    selectedSiteId = siteId;
    error = null;

    try {
      const response = await (await getRpcTrellis())
        .request("Inspection.Sites.GetSummary", { siteId })
        .orThrow();
      summary = response.summary ?? null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadAssignments(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await (await getRpcTrellis())
        .request("Inspection.Assignments.List", {})
        .orThrow();
      assignments = response.assignments;

      const firstSiteId = response.assignments[0]?.siteId;
      if (firstSiteId) {
        await selectSite(firstSiteId);
      } else {
        selectedSiteId = null;
        summary = null;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function priorityClass(priority: RpcAssignment["priority"]): string {
    if (priority === "high") return "badge badge-error badge-outline";
    if (priority === "medium") return "badge badge-warning badge-outline";
    return "badge badge-success badge-outline";
  }

  onMount(() => {
    void loadAssignments();
  });
</script>

<svelte:head>
  <title>RPC · Trellis demo</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">RPC</h1>
    <p class="text-sm text-base-content/70">Direct request and response calls.</p>
  </header>

  <div class="flex flex-wrap gap-3">
    <button class="btn btn-primary btn-sm" onclick={loadAssignments} disabled={loading}>
      {loading ? "Loading..." : "Reload assignments"}
    </button>
    <div class="badge badge-outline badge-lg">{assignments.length} assignment{assignments.length === 1 ? "" : "s"}</div>
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
          <h2 class="card-title text-lg">Assignments</h2>
          <span class="text-sm text-base-content/60">Inspection.Assignments.List</span>
        </div>

        {#if loading}
          <div class="alert">
            <span>Loading assignments.</span>
          </div>
        {:else if assignments.length === 0}
          <div class="alert">
            <span>No assignments returned.</span>
          </div>
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
                    <td>
                      <span class={priorityClass(assignment.priority)}>{assignment.priority}</span>
                    </td>
                    <td class="text-right">
                      <button
                        class="btn btn-outline btn-sm"
                        onclick={() => selectSite(assignment.siteId)}
                        disabled={selectedSiteId === assignment.siteId}
                      >
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
          <h2 class="card-title text-lg">Site summary</h2>
          {#if selectedSiteId}
            <span class="badge badge-outline">{selectedSiteId}</span>
          {/if}
        </div>

        {#if summary}
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr>
                  <th>Site</th>
                  <td>{summary.siteName}</td>
                </tr>
                <tr>
                  <th>Status</th>
                  <td>{summary.latestStatus}</td>
                </tr>
                <tr>
                  <th>Open</th>
                  <td>{summary.openInspections}</td>
                </tr>
                <tr>
                  <th>Overdue</th>
                  <td>{summary.overdueInspections}</td>
                </tr>
                <tr>
                  <th>Last report</th>
                  <td class="font-mono text-xs">{summary.lastReportAt}</td>
                </tr>
              </tbody>
            </table>
          </div>
        {:else}
          <div class="alert">
            <span>Select an assignment to load Inspection.Sites.GetSummary.</span>
          </div>
        {/if}
      </div>
    </section>
  </div>
</section>
