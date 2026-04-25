<script lang="ts">
  import { resolve } from "$app/paths";

  const areas = [
    { href: "/assignments", title: "Assignments", copy: "List work and load the selected site.", uses: "Uses: RPC" },
    { href: "/sites", title: "Sites", copy: "Read site summaries and refresh one.", uses: "Uses: RPC + operation" },
    { href: "/reports", title: "Reports", copy: "Generate, watch, and cancel reports.", uses: "Uses: operation" },
    { href: "/evidence", title: "Evidence", copy: "Upload text evidence for a field record.", uses: "Uses: transfer operation" },
    { href: "/activity", title: "Activity", copy: "Subscribe to live product events.", uses: "Uses: events" },
    { href: "/workspace", title: "Workspace", copy: "Save operator context between sessions.", uses: "Uses: state" },
  ] as const;
</script>

<svelte:head>
  <title>Dashboard · Field Ops Console</title>
</svelte:head>

<section class="flex w-full flex-col gap-6">
  <header class="space-y-2">
    <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Field Ops Console</p>
    <h1 class="text-2xl font-semibold">Dashboard</h1>
    <p class="max-w-2xl text-sm text-base-content/70">
      A product-oriented walkthrough for assignments, site summaries, reports, evidence, live activity, and workspace state.
    </p>
  </header>

  <div class="stats stats-vertical border border-base-300 bg-base-100 shadow-sm lg:stats-horizontal">
    <div class="stat">
      <div class="stat-title">Primary workflow</div>
      <div class="stat-value text-2xl">Inspect</div>
      <div class="stat-desc">Assignments and sites</div>
    </div>
    <div class="stat">
      <div class="stat-title">Outputs</div>
      <div class="stat-value text-2xl">Report</div>
      <div class="stat-desc">Progress and cancel</div>
    </div>
    <div class="stat">
      <div class="stat-title">Telemetry</div>
      <div class="stat-value text-2xl">Live</div>
      <div class="stat-desc">Activity events</div>
    </div>
  </div>

  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    {#each areas as item (item.href)}
      <a class="card h-full border border-base-300 bg-base-100 shadow-sm transition-colors hover:border-primary/40 hover:bg-base-200" href={resolve(item.href)}>
        <div class="card-body gap-3">
          <div class="flex items-start justify-between gap-3">
            <h2 class="card-title text-lg">{item.title}</h2>
            <span class="badge badge-outline">{item.uses}</span>
          </div>
          <p class="text-sm text-base-content/70">{item.copy}</p>
        </div>
      </a>
    {/each}
  </div>
</section>
