<script lang="ts">
  import { resolve } from "$app/paths";

  const lanes = [
    {
      href: resolve("/assignments"),
      title: "Dispatch queue",
      copy: "Prioritize crews, accepted work, and the selected site context.",
    },
    {
      href: resolve("/sites"),
      title: "Site intelligence",
      copy: "Refresh KV-backed summaries before inspectors reach the gate.",
    },
    {
      href: resolve("/reports"),
      title: "Report closeout",
      copy: "Generate inspection packets with progress and cancel controls.",
    },
    {
      href: resolve("/evidence"),
      title: "Evidence intake",
      copy: "Attach field observations and supporting evidence through a transfer workflow.",
    },
    {
      href: resolve("/activity"),
      title: "Live activity",
      copy: "Watch service events as assignments, evidence, and reports move.",
    },
    {
      href: resolve("/workspace"),
      title: "Operator workspace",
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
  <title>Field Inspection Desk · Trellis Demo</title>
  <meta
    name="description"
    content="Field Inspection Desk demo for coordinating assignments, site context, reports, evidence, activity, and workspace state."
  />
</svelte:head>

<section class="field-console min-h-screen px-4 py-8 sm:px-6 lg:px-8">
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <div
      class="hero overflow-hidden rounded-box border border-base-300/70 bg-base-100/90 shadow-xl shadow-base-300/20 backdrop-blur"
    >
      <div
        class="hero-content grid w-full gap-8 p-6 text-left lg:grid-cols-[minmax(0,1fr)_22rem] lg:p-10"
      >
        <div class="space-y-6">
          <div class="space-y-3">
            <p
              class="text-xs font-bold uppercase tracking-[0.24em] text-primary"
            >
              Browser demo · field operations
            </p>
            <h1
              class="max-w-3xl text-4xl font-black tracking-tight sm:text-5xl"
            >
              Coordinate today’s inspections from one utility desk.
            </h1>
            <p class="max-w-2xl text-base leading-7 text-base-content/72">
              The demo now follows a Field Inspection Desk: dispatch work,
              inspect site context, collect evidence, produce reports, and watch
              live activity without leaving the operator console.
            </p>
          </div>

          <div class="flex flex-wrap gap-3">
            <a class="btn btn-primary" href={resolve("/dashboard")}>
              Open today’s field board
            </a>
            <a class="btn btn-outline" href={resolve("/assignments")}>
              Review dispatch queue
            </a>
          </div>

          <div
            class="rounded-box border border-dashed border-primary/35 bg-primary/5 p-4 text-sm leading-6 text-base-content/70"
          >
            <span class="font-bold text-primary">Powered by Trellis:</span>
            the workflow is backed by RPC, operations, events, transfers, and browser
            state, surfaced as field desk capabilities instead of standalone primitives.
          </div>
        </div>

        <div class="card border border-base-300 bg-base-200/70 shadow-inner">
          <div class="card-body gap-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title text-lg">Morning command brief</h2>
              <span class="badge badge-neutral">08:10</span>
            </div>
            <div class="grid gap-3">
              {#each boardStats as stat (stat.label)}
                <div class="rounded-box bg-base-100 p-4 shadow-sm">
                  <p
                    class="text-xs font-bold uppercase tracking-[0.18em] text-base-content/45"
                  >
                    {stat.label}
                  </p>
                  <div class="mt-1 flex items-end justify-between gap-3">
                    <span class="text-3xl font-black">{stat.value}</span>
                    <span class="text-sm text-base-content/65"
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

    <div
      class="card border border-base-300/70 bg-base-100/90 shadow-lg shadow-base-300/15 backdrop-blur"
    >
      <div class="card-body gap-4">
        <div
          class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <p
              class="text-xs font-bold uppercase tracking-[0.22em] text-primary"
            >
              Workflow lanes
            </p>
            <h2 class="text-2xl font-black tracking-tight">
              From dispatch to closeout
            </h2>
          </div>
          <span class="badge badge-outline">Industrial utility console</span>
        </div>

        <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {#each lanes as lane (lane.href)}
            <li>
              <a
                class="card h-full border border-base-300/70 bg-base-200/50 transition hover:-translate-y-0.5 hover:border-primary/45 hover:bg-base-200 hover:shadow-md"
                href={lane.href}
              >
                <div class="card-body gap-2 p-4">
                  <span class="font-bold">{lane.title}</span>
                  <span class="text-sm leading-6 text-base-content/68"
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
