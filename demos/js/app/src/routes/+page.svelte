<script lang="ts">
  import { resolve } from "$app/paths";

  const demoLinks = [
    {
      href: "/rpc",
      label: "RPC",
      detail: "Read a device record through a direct request.",
    },
    {
      href: "/operation",
      label: "Operation",
      detail: "Run an inspection flow with tracked progress.",
    },
    {
      href: "/transfer",
      label: "Transfer",
      detail: "View uploaded photos and attachments.",
    },
    {
      href: "/kv",
      label: "KV",
      detail: "Check cached values and lookup data.",
    },
    {
      href: "/jobs",
      label: "Jobs",
      detail: "Follow background processing work.",
    },
    {
      href: "/state",
      label: "State",
      detail: "Inspect shared app state for the demo session.",
    },
  ] as const;
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
        <a class="btn btn-primary" href={resolve("/login?redirectTo=/rpc")}>Sign in to start</a>
        <a class="btn btn-outline" href={resolve("/rpc")}>Open RPC route</a>
      </div>
    </div>
  </div>

  <div class="card border border-base-300/70 bg-base-100/85 shadow-sm backdrop-blur">
    <div class="card-body gap-4">
      <h2 class="card-title text-xl">Demo routes</h2>

      <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each demoLinks as link (link.href)}
          <li>
            <a class="card h-full border border-base-300/70 bg-base-100 transition-colors hover:border-primary/30 hover:bg-base-200" href={resolve(link.href)}>
              <div class="card-body gap-2 p-4">
                <span class="font-semibold">{link.label}</span>
                <span class="text-sm text-base-content/70">{link.detail}</span>
              </div>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</section>
