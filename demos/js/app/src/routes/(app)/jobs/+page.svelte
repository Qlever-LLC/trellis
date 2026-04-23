<script lang="ts">
  import { onMount } from "svelte";
  import { getTrellis } from "$lib/trellis-context.svelte";
  import type {
    InspectionSummariesRefreshOutput,
    InspectionSummariesRefreshStatusGetOutput,
  } from "../../../../../generated/js/sdks/demo-jobs-service/types.ts";

  type JobsRefresh = NonNullable<InspectionSummariesRefreshStatusGetOutput["refresh"]>;
  type JobsDemoTrellis = {
    jobs(): {
      listServices(): {
        orThrow(): Promise<Array<{
          healthy: boolean;
          name: string;
          workers: Array<{ instanceId: string; jobType: string; timestamp: string }>;
        }>>;
      };
      list(filter?: { limit?: number }): {
        orThrow(): Promise<Array<{
          id: string;
          service: string;
          state: string;
          type: string;
          updatedAt: string;
        }>>;
      };
    };
    request(method: "Inspection.Summaries.Refresh", input: { siteId: string }): {
      orThrow(): Promise<InspectionSummariesRefreshOutput>;
    };
    request(method: "Inspection.Summaries.RefreshStatus.Get", input: { refreshId: string }): {
      orThrow(): Promise<InspectionSummariesRefreshStatusGetOutput>;
    };
  };
  const siteId = "site-west-yard";
  const terminalStates = new Set(["completed", "failed"]);

  async function getJobsTrellis(): Promise<JobsDemoTrellis> {
    return await getTrellis() as JobsDemoTrellis;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let queueing = $state(false);
  let services = $state<Array<{ healthy: boolean; name: string; workers: Array<{ instanceId: string; jobType: string; timestamp: string; }> }>>([]);
  let jobs = $state<Array<{ id: string; service: string; state: string; type: string; updatedAt: string }>>([]);
  let refresh = $state<JobsRefresh | null>(null);
  async function requestRefreshStatus(
    refreshId: string,
  ): Promise<InspectionSummariesRefreshStatusGetOutput> {
    const trellis = await getJobsTrellis();
    return await trellis.request("Inspection.Summaries.RefreshStatus.Get", { refreshId }).orThrow();
  }

  async function requestRefresh(
    targetSiteId: string,
  ): Promise<InspectionSummariesRefreshOutput> {
    const trellis = await getJobsTrellis();
    return await trellis.request("Inspection.Summaries.Refresh", { siteId: targetSiteId }).orThrow();
  }

  async function loadAdminView(): Promise<void> {
    loading = true;
    error = null;

    try {
      const client = (await getJobsTrellis()).jobs();
      const [servicesResult, jobsResult] = await Promise.all([
        client.listServices().orThrow(),
        client.list({ limit: 8 }).orThrow(),
      ]);

      services = servicesResult.map((service) => ({
        healthy: service.healthy,
        name: service.name,
        workers: service.workers.map((worker) => ({
          instanceId: worker.instanceId,
          jobType: worker.jobType,
          timestamp: worker.timestamp,
        })),
      }));
      jobs = jobsResult.map((job) => ({
        id: job.id,
        service: job.service,
        state: job.state,
        type: job.type,
        updatedAt: job.updatedAt,
      }));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function pollRefresh(refreshId: string): Promise<void> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const response = await requestRefreshStatus(refreshId);
      refresh = response.refresh ?? null;

      if (response.refresh && terminalStates.has(response.refresh.status)) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  async function queueRefresh(): Promise<void> {
    queueing = true;
    error = null;

    try {
      const queued = await requestRefresh(siteId);
      refresh = {
        refreshId: queued.refreshId,
        siteId,
        status: queued.status,
        updatedAt: new Date().toISOString(),
      };
      await pollRefresh(queued.refreshId);
      await loadAdminView();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      queueing = false;
    }
  }

  function refreshBadgeClass(status: string): string {
    if (status === "completed") return "badge badge-success badge-outline";
    if (status === "failed") return "badge badge-error badge-outline";
    return "badge badge-warning badge-outline";
  }

  onMount(() => {
    void loadAdminView();
  });
</script>

<svelte:head>
  <title>Jobs · Trellis demo</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Jobs</h1>
    <p class="text-sm text-base-content/70">Queue work, then inspect workers and recent jobs.</p>
  </header>

  <div class="flex flex-wrap gap-3">
    <button class="btn btn-primary" onclick={queueRefresh} disabled={queueing}>
      {queueing ? "Queueing..." : "Queue West Yard refresh"}
    </button>
    <button class="btn btn-outline" onclick={loadAdminView} disabled={loading}>
      Reload admin view
    </button>
  </div>

  {#if error}
    <div role="alert" class="alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">Latest refresh</h2>
          {#if refresh}
            <span class={refreshBadgeClass(refresh.status)}>{refresh.status}</span>
          {/if}
        </div>

        {#if refresh}
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr>
                  <th>Refresh id</th>
                  <td class="font-mono text-xs">{refresh.refreshId}</td>
                </tr>
                <tr>
                  <th>Site</th>
                  <td>{refresh.siteId}</td>
                </tr>
                <tr>
                  <th>Updated</th>
                  <td class="font-mono text-xs">{refresh.updatedAt}</td>
                </tr>
                {#if refresh.message}
                  <tr>
                    <th>Message</th>
                    <td>{refresh.message}</td>
                  </tr>
                {/if}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="alert">
            <span>Queue a refresh to watch job status move.</span>
          </div>
        {/if}
      </div>
    </section>

    <div class="grid gap-6">
      <section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body gap-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="card-title text-lg">Workers</h2>
            <span class="badge badge-outline">{services.length} service{services.length === 1 ? "" : "s"}</span>
          </div>

          {#if loading}
            <div class="alert">
              <span>Loading worker services.</span>
            </div>
          {:else if services.length === 0}
            <div class="alert">
              <span>No worker services reported.</span>
            </div>
          {:else}
            <div class="overflow-x-auto">
              <table class="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Health</th>
                    <th>Worker heartbeats</th>
                  </tr>
                </thead>
                <tbody>
                  {#each services as service (service.name)}
                    <tr>
                      <td>{service.name}</td>
                      <td>
                        <span class={service.healthy ? "badge badge-success badge-outline" : "badge badge-error badge-outline"}>
                          {service.healthy ? "healthy" : "unhealthy"}
                        </span>
                      </td>
                      <td>{service.workers.length}</td>
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
            <h2 class="card-title text-lg">Recent jobs</h2>
            <span class="badge badge-outline">{jobs.length} job{jobs.length === 1 ? "" : "s"}</span>
          </div>

          {#if loading}
            <div class="alert">
              <span>Loading jobs.</span>
            </div>
          {:else if jobs.length === 0}
            <div class="alert">
              <span>No jobs returned.</span>
            </div>
          {:else}
            <div class="overflow-x-auto">
              <table class="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>State</th>
                    <th>Service</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {#each jobs as job (job.id)}
                    <tr>
                      <td>
                        <div>{job.type}</div>
                        <div class="font-mono text-xs text-base-content/60">{job.id}</div>
                      </td>
                      <td>{job.state}</td>
                      <td>{job.service}</td>
                      <td class="font-mono text-xs">{job.updatedAt}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </section>
    </div>
  </div>
</section>
