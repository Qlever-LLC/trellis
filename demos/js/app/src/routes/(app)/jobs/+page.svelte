<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { onMount } from "svelte";
  import { getJobsClient, requestValue, type JobsRefresh } from "$lib/trellis";

  const siteId = "site-west-yard";
  const terminalStates = new Set(["completed", "failed"]);

  let loading = $state(true);
  let error = $state<string | null>(null);
  let queueing = $state(false);
  let services = $state<Array<{ healthy: boolean; name: string; workers: Array<{ instanceId: string; jobType: string; timestamp: string; }> }>>([]);
  let jobs = $state<Array<{ id: string; service: string; state: string; type: string; updatedAt: string }>>([]);
  let refresh = $state<JobsRefresh | null>(null);

  async function loadAdminView(): Promise<void> {
    loading = true;
    error = null;

    try {
      const client = await getJobsClient();
      const [servicesResult, jobsResult] = await Promise.all([
        client.listServices(),
        client.list({ limit: 8 }),
      ]);

      const servicesValue = servicesResult.take();
      if (isErr(servicesValue)) {
        throw servicesValue.error;
      }

      const jobsValue = jobsResult.take();
      if (isErr(jobsValue)) {
        throw jobsValue.error;
      }

      services = servicesValue.map((service) => ({
        healthy: service.healthy,
        name: service.name,
        workers: service.workers.map((worker) => ({
          instanceId: worker.instanceId,
          jobType: worker.jobType,
          timestamp: worker.timestamp,
        })),
      }));
      jobs = jobsValue.map((job) => ({
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
      const response = await requestValue("Inspection.Summaries.RefreshStatus.Get", { refreshId });
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
      const queued = await requestValue("Inspection.Summaries.Refresh", { siteId });
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

  onMount(() => {
    void loadAdminView();
  });
</script>

<svelte:head>
  <title>Jobs · Field inspection demo</title>
</svelte:head>

<section class="stack">
  <header class="page-header">
    <p class="eyebrow">Jobs surface</p>
    <h1>Queue a refresh, then inspect workers</h1>
    <p class="page-summary">The page uses the demo jobs RPCs to enqueue work and the Trellis Jobs admin surface to read the broader worker and job state.</p>
  </header>

  <div class="button-row">
    <button class="button" onclick={queueRefresh} disabled={queueing}>{queueing ? "Queueing…" : "Queue West Yard refresh"}</button>
    <button class="ghost-button" onclick={loadAdminView} disabled={loading}>Reload jobs view</button>
  </div>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="feature-grid" style="grid-template-columns: 0.95fr 1.05fr;">
    <section class="surface-card">
      <div class="split">
        <h2 class="section-title">Latest refresh</h2>
        {#if refresh}
          <span class={`pill ${refresh.status === "completed" ? "success" : refresh.status === "failed" ? "danger" : "warn"}`}>
            {refresh.status}
          </span>
        {/if}
      </div>

      {#if refresh}
        <dl class="field-list">
          <li><strong class="code">{refresh.refreshId}</strong><span class="muted">Refresh id</span></li>
          <li><strong>{refresh.siteId}</strong><span class="muted">Target site</span></li>
          <li><strong class="code">{refresh.updatedAt}</strong><span class="muted">Last status timestamp</span></li>
          {#if refresh.message}
            <li><strong>{refresh.message}</strong><span class="muted">Worker message</span></li>
          {/if}
        </dl>
      {:else}
        <div class="empty-state">Queue a refresh to watch the demo job move through its status updates.</div>
      {/if}
    </section>

    <section class="surface-card stack">
      <div class="split">
        <h2 class="section-title">Jobs admin snapshot</h2>
        <span class="pill">{jobs.length} recent jobs</span>
      </div>

      {#if loading}
        <div class="empty-state">Loading worker and job state…</div>
      {:else}
        <div class="stack">
          <div>
            <h3>Workers</h3>
            {#if services.length === 0}
              <div class="empty-state">No worker services were reported.</div>
            {:else}
              <ul class="data-list">
                {#each services as service (service.name)}
                  <li>
                    <div class="split">
                      <strong>{service.name}</strong>
                      <span class={`pill ${service.healthy ? "success" : "danger"}`}>{service.healthy ? "healthy" : "unhealthy"}</span>
                    </div>
                    <p class="status-line">{service.workers.length} worker heartbeat(s)</p>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <div>
            <h3>Recent jobs</h3>
            {#if jobs.length === 0}
              <div class="empty-state">No jobs were returned by the admin list call.</div>
            {:else}
              <ul class="log-list">
                {#each jobs as job (job.id)}
                  <li>
                    <div class="split">
                      <strong>{job.type}</strong>
                      <span class="pill">{job.state}</span>
                    </div>
                    <p class="status-line code">{job.service} · {job.id}</p>
                    <p class="status-line">Updated {job.updatedAt}</p>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      {/if}
    </section>
  </div>
</section>
