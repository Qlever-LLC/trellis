<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import type { Snippet } from "svelte";
  import DemoClientLogo from "$lib/components/DemoClientLogo.svelte";
  import { getConnection } from "$lib/trellis";

  let { children }: { children: Snippet } = $props();

  const connection = getConnection();

  const currentPath = $derived.by((): string => page.url.pathname);
  const status = $derived(connection.status);
  const isConnected = $derived(status.phase === "connected");

  const workflowNav = [
    { path: "/dashboard", label: "System overview", eyebrow: "Command" },
    { path: "/assignments", label: "Assignments", eyebrow: "Assignments.List" },
    { path: "/sites", label: "Sites", eyebrow: "Sites.Refresh" },
    { path: "/reports", label: "Reports", eyebrow: "Reports.Generate" },
    { path: "/evidence", label: "Evidence", eyebrow: "Evidence.Upload" },
    { path: "/activity", label: "Activity", eyebrow: "Event watch" },
    {
      path: "/workspace",
      label: "Workspace",
      eyebrow: "State store",
    },
  ] as const;

</script>

<section class="app-shell field-console text-base-content">
  <aside class="app-sidebar flex min-w-0 flex-col px-4 py-5 lg:px-5">
    <div class="flex min-h-full flex-col gap-6">
      <a
        class="btn btn-ghost min-h-0 justify-start px-1 py-1 text-left hover:bg-base-200/70"
        href={resolve("/")}
        aria-label="Field Inspection Desk home"
      >
        <span class="sm:hidden"><DemoClientLogo variant="compact" /></span>
        <span class="hidden sm:inline-flex"><DemoClientLogo /></span>
      </a>

      <div class="section-rule pt-5">
        <p class="trellis-kicker">Navigation system</p>
        <h1 class="mt-1 text-lg font-black tracking-tight">Inspection command</h1>
      </div>

      <nav class="min-w-0" aria-label="Field inspection workflow">
        <ul class="menu gap-1 p-0">
          {#each workflowNav as item (item.path)}
            <li>
              <a
                href={resolve(item.path)}
                class={[
                  "executive-nav-link",
                  currentPath === resolve(item.path) && "menu-active",
                ]}
                aria-current={currentPath === resolve(item.path) ? "page" : undefined}
              >
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="break-words text-sm font-bold">{item.label}</span>
                  <span class="break-words text-[0.65rem] uppercase tracking-[0.18em] opacity-60">{item.eyebrow}</span>
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </nav>

      <div class="section-rule space-y-3 pt-5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-base-content/48">Trellis server</p>
            <p class="mt-1 break-words text-sm font-semibold">{isConnected ? "Live session" : "Auth required"}</p>
          </div>
          <span
            class={{
              "badge badge-outline min-w-0 max-w-28 gap-2 py-3 font-semibold uppercase tracking-[0.14em]": true,
              "badge-success": isConnected,
              "badge-warning": !isConnected,
            }}
          >
            <span class="size-2 rounded-full bg-current"></span>
            <span class="min-w-0 truncate">{status.phase}</span>
          </span>
        </div>
        {#if !isConnected}
          <a class="btn btn-accent btn-sm w-full" href={resolve("/dashboard")}>Sign in through demo flow</a>
        {/if}
      </div>

      <div class="mt-auto section-rule bg-accent/5 px-1 pt-5 text-xs leading-5 text-base-content/70">
        <span class="font-bold text-accent">Powered by Trellis:</span>
        Field Inspection Desk is a demo client for the Trellis server. RPC, operations, events, transfer, and state appear as workflow lanes.
      </div>
    </div>
  </aside>

  <main class="app-main px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
    <div class="page-workspace mx-auto">
      {@render children()}
    </div>
  </main>
</section>
