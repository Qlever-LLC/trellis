<script lang="ts">
  import { resolve } from "$app/paths";

  const queue = [
    { id: "INS-2048", site: "North Pump Station", status: "Evidence review", due: "14:00", tone: "badge-warning" },
    { id: "INS-2051", site: "Cold Storage Dock", status: "Crew en route", due: "15:30", tone: "badge-info" },
    { id: "INS-2056", site: "West Relay Yard", status: "Report draft", due: "17:00", tone: "badge-success" },
  ] as const;

  const actions = [
    { path: "/assignments", label: "Dispatch queue", detail: "Load selected work" },
    { path: "/sites", label: "Refresh site", detail: "Update summary" },
    { path: "/evidence", label: "Attach evidence", detail: "Transfer intake" },
    { path: "/reports", label: "Generate report", detail: "Operation closeout" },
  ] as const;

  const activity = [
    "Site summary refreshed for North Pump Station",
    "Evidence bundle staged by Riley / Chen",
    "Report operation queued for West Relay Yard",
  ] as const;
</script>

<svelte:head>
  <title>System Overview · Field Inspection Desk</title>
</svelte:head>

<section class="page-sheet rounded-box p-5 sm:p-7">
  <div class="flex flex-col gap-7">
    <header class="command-header pb-2">
      <div class="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div class="min-w-0 space-y-3">
          <p class="trellis-kicker">System overview</p>
          <h1 class="break-words text-3xl font-black tracking-tight sm:text-4xl">Inspection command overview</h1>
          <p class="max-w-3xl break-words text-sm leading-6 text-base-content/70">
            Coordinate daily site inspections with sample scenario framing, then open each route to load live Trellis-backed workflow data.
          </p>
        </div>
        <div class="min-w-0 border-t border-dashed border-accent/35 bg-accent/5 px-1 py-3 text-sm leading-6 text-base-content/70 lg:max-w-sm lg:border-y lg:px-4">
          <span class="font-bold text-accent">Trellis surface:</span> app routes teach RPC, operations, transfer, events, and state as workflow capabilities.
        </div>
      </div>
    </header>

  <div class="stats stats-vertical overflow-hidden border-y border-base-300/80 bg-base-200/35 lg:stats-horizontal">
    <div class="stat">
      <div class="stat-title min-w-0 break-words">Open inspections</div>
      <div class="stat-value text-3xl">12</div>
      <div class="stat-desc min-w-0 break-words">Demo fixture: 4 need dispatcher review</div>
    </div>
    <div class="stat">
      <div class="stat-title min-w-0 break-words">Evidence bundles</div>
      <div class="stat-value text-3xl">8</div>
      <div class="stat-desc min-w-0 break-words">Demo fixture: 2 awaiting upload confirmation</div>
    </div>
    <div class="stat">
      <div class="stat-title min-w-0 break-words">Report operations</div>
      <div class="stat-value text-3xl">3</div>
      <div class="stat-desc min-w-0 break-words">Demo fixture: 1 can still be canceled</div>
    </div>
  </div>

  <div class="section-rule grid gap-7 pt-7 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
    <section class="min-w-0">
      <div class="flex flex-col gap-5">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="trellis-kicker">Demo fixture</p>
            <h2 class="min-w-0 break-words text-xl font-black tracking-tight">Sample priority work</h2>
          </div>
          <a class="btn btn-sm btn-outline" href={resolve("/assignments")}>Open assignments</a>
        </div>

        <div class="overflow-x-auto">
            <table class="table table-zebra executive-table min-w-[42rem]">
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
                  <th scope="row" class="break-words font-mono text-sm font-semibold">{item.id}</th>
                  <td class="break-words">{item.site}</td>
                  <td><span class={["badge badge-outline max-w-40", item.tone]}><span class="truncate">{item.status}</span></span></td>
                  <td>{item.due}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="min-w-0 border-t border-base-300/80 pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
      <div class="flex flex-col gap-5">
        <div class="min-w-0">
          <p class="trellis-kicker">Sample scenario</p>
          <h2 class="min-w-0 break-words text-xl font-black tracking-tight">North Pump Station</h2>
          <p class="break-words text-sm text-base-content/65">Sector 7 · Bay 14 · inspection INS-2048</p>
        </div>
        <div class="border-y border-base-300/75 bg-base-200/35 py-4">
          <div class="flex items-center justify-between text-sm">
            <span class="font-semibold">Closeout readiness</span>
            <span>68%</span>
          </div>
          <progress class="progress progress-accent mt-3 h-2 w-full" value="68" max="100" aria-label="Sample closeout readiness progress"></progress>
        </div>
        <div class="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 border-t border-base-300/70 pt-4 text-sm sm:grid-cols-2">
          <div>
            <p class="trellis-kicker">Report</p>
            <p class="break-words font-semibold">Draft queued</p>
          </div>
          <div>
            <p class="trellis-kicker">Evidence</p>
            <p class="break-words font-semibold">Bundle pending</p>
          </div>
        </div>
      </div>
    </section>
  </div>

  <div class="section-rule grid gap-7 pt-7 lg:grid-cols-2">
    <section class="min-w-0">
      <div class="flex flex-col gap-5">
        <h2 class="text-xl font-black tracking-tight">Workflow capability</h2>
        <div class="grid border-y border-base-300/80 sm:grid-cols-2">
          {#each actions as action (action.path)}
            <a class="min-w-0 border-b border-base-300/70 px-1 py-4 transition hover:bg-base-200/55 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0" href={resolve(action.path)}>
              <span class="block break-words font-bold">{action.label}</span>
              <span class="break-words text-sm text-base-content/65">{action.detail}</span>
            </a>
          {/each}
        </div>
      </div>
    </section>

    <section class="min-w-0 border-t border-base-300/80 pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <div class="flex flex-col gap-5">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 class="min-w-0 break-words text-xl font-black tracking-tight">Sample activity context</h2>
          <a class="link link-accent text-sm font-semibold" href={resolve("/activity")}>View feed</a>
        </div>
        <ul class="space-y-3">
          {#each activity as item (item)}
            <li class="flex min-w-0 gap-3 text-sm leading-6">
              <span class="mt-2 size-2 rounded-full bg-accent"></span>
              <span class="min-w-0 break-words">{item}</span>
            </li>
          {/each}
        </ul>
      </div>
    </section>
  </div>
  </div>
</section>
