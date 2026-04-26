<script lang="ts">
  import { base } from "$app/paths";

  const queue = [
    { id: "INS-2048", site: "North Pump Station", status: "Evidence review", due: "14:00", tone: "badge-warning" },
    { id: "INS-2051", site: "Cold Storage Dock", status: "Crew en route", due: "15:30", tone: "badge-info" },
    { id: "INS-2056", site: "West Relay Yard", status: "Report draft", due: "17:00", tone: "badge-success" },
  ] as const;

  const actions = [
    { href: `${base}/assignments`, label: "Dispatch queue", detail: "Load selected work" },
    { href: `${base}/sites`, label: "Refresh site", detail: "Update summary" },
    { href: `${base}/evidence`, label: "Attach evidence", detail: "Transfer intake" },
    { href: `${base}/reports`, label: "Generate report", detail: "Operation closeout" },
  ] as const;

  const activity = [
    "Site summary refreshed for North Pump Station",
    "Evidence bundle staged by Riley / Chen",
    "Report operation queued for West Relay Yard",
  ] as const;
</script>

<svelte:head>
  <title>Today’s Field Board · Field Inspection Desk</title>
</svelte:head>

<section class="flex w-full flex-col gap-5">
  <header class="card border border-base-300/70 bg-base-100/90 shadow-lg shadow-base-300/15 backdrop-blur">
    <div class="card-body gap-4">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div class="space-y-2">
          <p class="text-xs font-bold uppercase tracking-[0.24em] text-primary">Today’s Field Board</p>
          <h1 class="text-3xl font-black tracking-tight sm:text-4xl">Inspection command overview</h1>
          <p class="max-w-3xl text-sm leading-6 text-base-content/70">
            Coordinate daily site inspections with the current queue, selected site status, evidence intake, report progress, and live activity in one operator board.
          </p>
        </div>
        <div class="rounded-box border border-dashed border-primary/35 bg-primary/5 px-4 py-3 text-sm text-base-content/70">
          <span class="font-bold text-primary">Trellis surface:</span> app routes teach RPC, operations, transfer, events, and state as workflow capabilities.
        </div>
      </div>
    </div>
  </header>

  <div class="stats stats-vertical border border-base-300/70 bg-base-100/90 shadow-lg shadow-base-300/15 lg:stats-horizontal">
    <div class="stat">
      <div class="stat-title">Open inspections</div>
      <div class="stat-value text-3xl">12</div>
      <div class="stat-desc">4 need dispatcher review</div>
    </div>
    <div class="stat">
      <div class="stat-title">Evidence bundles</div>
      <div class="stat-value text-3xl">8</div>
      <div class="stat-desc">2 awaiting upload confirmation</div>
    </div>
    <div class="stat">
      <div class="stat-title">Report operations</div>
      <div class="stat-value text-3xl">3</div>
      <div class="stat-desc">1 can still be canceled</div>
    </div>
  </div>

  <div class="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
    <div class="card border border-base-300/70 bg-base-100/90 shadow-lg shadow-base-300/15">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-xs font-bold uppercase tracking-[0.2em] text-primary">Inspection queue</p>
            <h2 class="card-title text-xl">Priority work</h2>
          </div>
          <a class="btn btn-sm btn-outline" href={`${base}/assignments`}>Open assignments</a>
        </div>

        <div class="overflow-x-auto">
          <table class="table table-zebra">
            <thead>
              <tr>
                <th>Inspection</th>
                <th>Site</th>
                <th>Status</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {#each queue as item (item.id)}
                <tr>
                  <td class="font-mono text-sm font-semibold">{item.id}</td>
                  <td>{item.site}</td>
                  <td><span class={["badge badge-outline", item.tone]}>{item.status}</span></td>
                  <td>{item.due}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card border border-base-300/70 bg-base-100/90 shadow-lg shadow-base-300/15">
      <div class="card-body gap-4">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.2em] text-primary">Selected site</p>
          <h2 class="card-title text-xl">North Pump Station</h2>
          <p class="text-sm text-base-content/65">Sector 7 · Bay 14 · inspection INS-2048</p>
        </div>
        <div class="rounded-box bg-base-200/75 p-4">
          <div class="flex items-center justify-between text-sm">
            <span class="font-semibold">Closeout readiness</span>
            <span>68%</span>
          </div>
          <progress class="progress progress-primary mt-3 h-2 w-full" value="68" max="100"></progress>
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-box border border-base-300/70 p-3">
            <p class="text-xs uppercase tracking-[0.16em] text-base-content/50">Report</p>
            <p class="font-semibold">Draft queued</p>
          </div>
          <div class="rounded-box border border-base-300/70 p-3">
            <p class="text-xs uppercase tracking-[0.16em] text-base-content/50">Evidence</p>
            <p class="font-semibold">Bundle pending</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="grid gap-5 lg:grid-cols-2">
    <div class="card border border-base-300/70 bg-base-100/90 shadow-lg shadow-base-300/15">
      <div class="card-body gap-4">
        <h2 class="card-title">Quick actions</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each actions as action (action.href)}
            <a class="rounded-box border border-base-300 bg-base-200/55 p-4 transition hover:border-primary/45 hover:bg-base-200" href={action.href}>
              <span class="block font-bold">{action.label}</span>
              <span class="text-sm text-base-content/65">{action.detail}</span>
            </a>
          {/each}
        </div>
      </div>
    </div>

    <div class="card border border-base-300/70 bg-base-100/90 shadow-lg shadow-base-300/15">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between">
          <h2 class="card-title">Activity context</h2>
          <a class="link link-primary text-sm font-semibold" href={`${base}/activity`}>View feed</a>
        </div>
        <ul class="space-y-3">
          {#each activity as item (item)}
            <li class="flex gap-3 text-sm leading-6">
              <span class="mt-2 size-2 rounded-full bg-primary"></span>
              <span>{item}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
</section>
