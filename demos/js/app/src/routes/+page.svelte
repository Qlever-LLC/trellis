<script lang="ts">
  import { resolve } from "$app/paths";
  import DemoClientLogo from "$lib/components/DemoClientLogo.svelte";

  const lanes = [
    {
      path: "/assignments",
      title: "Assignments.List",
      copy: "Prioritize crews, accepted work, and selected-site context.",
    },
    {
      path: "/sites",
      title: "Sites.Refresh",
      copy: "Reconcile site summaries before inspectors reach the gate.",
    },
    {
      path: "/reports",
      title: "Reports.Generate",
      copy: "Generate closeout packets with progress and cancel controls.",
    },
    {
      path: "/evidence",
      title: "Evidence.Upload",
      copy: "Attach field observations and supporting evidence through a transfer workflow.",
    },
    {
      path: "/activity",
      title: "Event watch",
      copy: "Watch service events as assignments, evidence, and reports move.",
    },
    {
      path: "/workspace",
      title: "Workspace state",
      copy: "Keep coordinator context saved between browser sessions.",
    },
  ] as const;

  const boardStats = [
    { label: "Queued inspections", value: "12", detail: "4 require dispatch" },
    { label: "Active sites", value: "7", detail: "2 awaiting evidence" },
    { label: "Reports due", value: "3", detail: "before 17:00" },
  ] as const;
</script>

<svelte:head>
  <title>Field Inspection Desk · Demo client for Trellis</title>
  <meta
    name="description"
    content="Field Inspection Desk is a Trellis-powered demo client for coordinating assignments, site context, reports, evidence, activity, and workspace state."
  />
</svelte:head>

<section class="field-console min-h-screen px-4 py-9 sm:px-6 lg:px-8">
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-7">
    <div class="hero executive-panel overflow-hidden rounded-box">
      <div
        class="hero-content grid w-full gap-9 p-6 text-left sm:p-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:p-11"
      >
        <div class="min-w-0 space-y-7">
          <div class="space-y-4">
            <DemoClientLogo variant="landing" relationship="Powered by Trellis" />
            <p class="trellis-kicker">Browser demo · sample inspection command</p>
            <h1
              class="max-w-3xl break-words text-4xl font-black tracking-tight sm:text-5xl"
            >
              Field inspection command, connected to Trellis server.
            </h1>
            <p class="max-w-2xl break-words text-[1.02rem] leading-8 text-base-content/72">
              A calm command surface for dispatching inspections, reviewing site context,
              collecting evidence, generating reports, and preserving workspace state.
            </p>
          </div>

          <div class="flex flex-wrap gap-3">
            <a class="btn btn-accent" href={resolve("/dashboard")}>
              Open system overview
            </a>
            <a class="btn btn-outline" href={resolve("/assignments")}>
              Review assignments
            </a>
          </div>

          <div class="border-y border-dashed border-accent/35 bg-accent/5 px-1 py-4 text-sm leading-6 text-base-content/70">
            <span class="font-bold text-accent">Powered by Trellis:</span>
            routes demonstrate RPC, operations, events, transfers, and browser state.
            The command brief beside it is labeled demo fixture data.
          </div>
        </div>

        <div class="min-w-0 border-y border-base-300/75 bg-base-100/45 px-1 py-5 lg:px-0">
          <div class="flex min-w-0 flex-col gap-5">
            <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div>
                <p class="trellis-kicker">Application example</p>
                <h2 class="min-w-0 break-words text-lg font-bold">Sample command brief</h2>
              </div>
              <span class="badge badge-accent min-w-0 max-w-full"><span class="truncate">Demo fixture · 08:10</span></span>
            </div>
            <div class="divide-y divide-base-300/80 border-y border-base-300/80">
              {#each boardStats as stat (stat.label)}
                <div class="min-w-0 px-1 py-4">
                  <p
                    class="break-words text-xs font-bold uppercase tracking-[0.18em] text-base-content/50"
                  >
                    {stat.label}
                  </p>
                  <div class="mt-1 flex min-w-0 flex-wrap items-end justify-between gap-3">
                    <span class="text-3xl font-black text-base-content">{stat.value}</span>
                    <span class="min-w-0 break-words text-sm text-base-content/65"
                      >{stat.detail}</span
                    >
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="page-sheet rounded-box p-6 sm:p-7">
      <div class="flex flex-col gap-5">
        <div
          class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <p
              class="text-xs font-bold uppercase tracking-[0.22em] text-accent"
            >
              Executive-system lanes
            </p>
            <h2 class="text-2xl font-black tracking-tight">
              From assignment to closeout
            </h2>
          </div>
          <span class="badge badge-outline">Demo workflow navigation</span>
        </div>

        <ul class="grid min-w-0 gap-x-6 gap-y-0 border-y border-base-300/80 sm:grid-cols-2 lg:grid-cols-3">
          {#each lanes as lane (lane.path)}
            <li class="border-b border-base-300/70 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0">
              <a
                class="block h-full min-w-0 px-1 py-4 transition hover:bg-base-200/55"
                href={resolve(lane.path)}
              >
                <div class="flex min-w-0 flex-col gap-2">
                  <span class="break-words font-bold">{lane.title}</span>
                  <span class="break-words text-sm leading-6 text-base-content/68"
                    >{lane.copy}</span
                  >
                </div>
              </a>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
</section>
