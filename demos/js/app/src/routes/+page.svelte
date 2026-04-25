<script lang="ts">
  import { resolve } from "$app/paths";
</script>

<svelte:head>
  <title>Home · Trellis Demo App</title>
  <meta
    name="description"
    content="Overview page for the Trellis demo app and its learning routes."
  />
</svelte:head>

<section class="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <div class="card border border-base-300/70 bg-base-100/85 shadow-sm backdrop-blur">
    <div class="card-body gap-5">
      <div class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Browser runtime demo</p>
        <h1 class="card-title text-3xl tracking-tight sm:text-4xl">Trellis demo app</h1>
        <p class="max-w-2xl text-sm leading-6 text-base-content/75 sm:text-base">
          Use this app to learn the Trellis demo routes for RPC, operations, transfers, KV data, jobs, and shared state.
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <a class="btn btn-primary" href={resolve("/rpc")}>Sign in to start</a>
        <a class="btn btn-outline" href={resolve("/rpc")}>Open RPC route</a>
      </div>
    </div>
  </div>

  <div class="card border border-base-300/70 bg-base-100/85 shadow-sm backdrop-blur">
    <div class="card-body gap-4">
      <h2 class="card-title text-xl">Demo routes</h2>

      <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <a class="card h-full border border-base-300/70 bg-base-100 transition-colors hover:border-primary/30 hover:bg-base-200" href={resolve("/rpc")}>
            <div class="card-body gap-2 p-4">
              <span class="font-semibold">RPC</span>
              <span class="text-sm text-base-content/70">Read a device record through a direct request.</span>
            </div>
          </a>
        </li>
        <li>
          <a class="card h-full border border-base-300/70 bg-base-100 transition-colors hover:border-primary/30 hover:bg-base-200" href={resolve("/operation")}>
            <div class="card-body gap-2 p-4">
              <span class="font-semibold">Operation</span>
              <span class="text-sm text-base-content/70">Run an inspection flow with tracked progress.</span>
            </div>
          </a>
        </li>
        <li>
          <a class="card h-full border border-base-300/70 bg-base-100 transition-colors hover:border-primary/30 hover:bg-base-200" href={resolve("/transfer")}>
            <div class="card-body gap-2 p-4">
              <span class="font-semibold">Transfer</span>
              <span class="text-sm text-base-content/70">View uploaded photos and attachments.</span>
            </div>
          </a>
        </li>
        <li>
          <a class="card h-full border border-base-300/70 bg-base-100 transition-colors hover:border-primary/30 hover:bg-base-200" href={resolve("/kv")}>
            <div class="card-body gap-2 p-4">
              <span class="font-semibold">KV</span>
              <span class="text-sm text-base-content/70">Check cached values and lookup data.</span>
            </div>
          </a>
        </li>
        <li>
          <a class="card h-full border border-base-300/70 bg-base-100 transition-colors hover:border-primary/30 hover:bg-base-200" href={resolve("/jobs")}>
            <div class="card-body gap-2 p-4">
              <span class="font-semibold">Jobs</span>
              <span class="text-sm text-base-content/70">Follow background processing work.</span>
            </div>
          </a>
        </li>
        <li>
          <a class="card h-full border border-base-300/70 bg-base-100 transition-colors hover:border-primary/30 hover:bg-base-200" href={resolve("/state")}>
            <div class="card-body gap-2 p-4">
              <span class="font-semibold">State</span>
              <span class="text-sm text-base-content/70">Inspect shared app state for the demo session.</span>
            </div>
          </a>
        </li>
      </ul>
    </div>
  </div>
</section>
