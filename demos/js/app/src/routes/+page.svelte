<script lang="ts">
  import { resolve } from "$app/paths";

  const areas = [
    { href: "/assignments", title: "Assignments", copy: "Open the field work queue and selected site." },
    { href: "/sites", title: "Sites", copy: "Review KV-backed summaries and refresh one." },
    { href: "/reports", title: "Reports", copy: "Generate reports with progress and cancel controls." },
    { href: "/evidence", title: "Evidence", copy: "Upload text evidence as a transfer operation." },
    { href: "/activity", title: "Activity", copy: "Subscribe to live service events." },
    { href: "/workspace", title: "Workspace", copy: "Manage saved browser app state entries." },
  ] as const;
</script>

<svelte:head>
  <title>Home · Field Ops Console</title>
  <meta name="description" content="Overview page for the Field Ops Console demo app." />
</svelte:head>

<section class="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <div class="card border border-base-300/70 bg-base-100/85 shadow-sm backdrop-blur">
    <div class="card-body gap-5">
      <div class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Browser console demo</p>
        <h1 class="card-title text-3xl tracking-tight sm:text-4xl">Field Ops Console</h1>
        <p class="max-w-2xl text-sm leading-6 text-base-content/75 sm:text-base">
          Coordinate inspections, refresh site summaries, generate reports, upload evidence, and watch live field activity in one consolidated Trellis demo app.
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <a class="btn btn-primary" href={resolve("/dashboard")}>Sign in to start</a>
        <a class="btn btn-outline" href={resolve("/assignments")}>Open assignments</a>
      </div>
    </div>
  </div>

  <div class="card border border-base-300/70 bg-base-100/85 shadow-sm backdrop-blur">
    <div class="card-body gap-4">
      <h2 class="card-title text-xl">Console areas</h2>

      <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each areas as area (area.href)}
          <li>
            <a class="card h-full border border-base-300/70 bg-base-100 transition-colors hover:border-primary/30 hover:bg-base-200" href={resolve(area.href)}>
              <div class="card-body gap-2 p-4">
                <span class="font-semibold">{area.title}</span>
                <span class="text-sm text-base-content/70">{area.copy}</span>
              </div>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</section>
