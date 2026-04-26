<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import type { Snippet } from "svelte";
  import { getConnection } from "$lib/trellis-context.ts";

  let { children }: { children: Snippet } = $props();

  const connection = getConnection();

  const currentPath = $derived.by((): string => page.url.pathname);
  const status = $derived(connection.status);
  const isConnected = $derived(status.phase === "connected");

  const workflowNav = [
    { href: resolve("/dashboard"), label: "Field board", eyebrow: "Overview" },
    { href: resolve("/assignments"), label: "Assignments", eyebrow: "Queue" },
    { href: resolve("/sites"), label: "Sites", eyebrow: "Location intel" },
    { href: resolve("/reports"), label: "Reports", eyebrow: "Closeout" },
    { href: resolve("/evidence"), label: "Evidence", eyebrow: "Media intake" },
    { href: resolve("/activity"), label: "Activity", eyebrow: "Live feed" },
    {
      href: resolve("/workspace"),
      label: "Workspace",
      eyebrow: "Operator state",
    },
  ] as const;

  const activeInspection = {
    id: "INS-2048",
    site: "North Pump Station",
    address: "Sector 7 · Bay 14",
    crew: "Riley / Chen",
    window: "08:30–14:00",
    phase: "Evidence review",
    progress: 68,
  } as const;

  const checkpoints = [
    { label: "Assignment accepted", tone: "text-success" },
    { label: "Site summary refreshed", tone: "text-success" },
    { label: "Evidence bundle pending", tone: "text-warning" },
    { label: "Report draft queued", tone: "text-base-content/45" },
  ] as const;
</script>

<section
  class="field-console min-h-screen w-full px-3 py-3 text-base-content sm:px-5 lg:px-6"
>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-4">
    <header
      class="command-header rounded-box border border-base-300/70 bg-base-100/90 shadow-xl shadow-base-300/20 backdrop-blur"
    >
      <div class="navbar min-h-0 gap-3 px-4 py-3 lg:px-5">
        <div class="navbar-start min-w-0 gap-3">
          <a
            class="btn btn-ghost min-h-0 px-2 py-1 text-left"
            href={resolve("/")}
          >
            <span
              class="grid size-10 place-items-center rounded-box bg-neutral text-sm font-black text-neutral-content shadow-inner"
              >FD</span
            >
            <span class="hidden min-w-0 flex-col leading-tight sm:flex">
              <span
                class="truncate text-sm font-semibold uppercase tracking-[0.22em] text-base-content/55"
                >Field Inspection Desk</span
              >
              <span class="truncate text-lg font-black tracking-tight"
                >Command Center</span
              >
            </span>
          </a>
        </div>

        <div class="navbar-center hidden flex-1 lg:flex">
          <div class="join border border-base-300 bg-base-200/60 p-1">
            {#each workflowNav.slice(0, 4) as item (item.href)}
              <a
                class={{
                  "btn join-item btn-sm": true,
                  "btn-neutral": currentPath === item.href,
                  "btn-ghost": currentPath !== item.href,
                }}
                href={item.href}
                aria-current={currentPath === item.href ? "page" : undefined}
                >{item.label}</a
              >
            {/each}
          </div>
        </div>

        <div class="navbar-end gap-2">
          <div
            class="hidden items-end text-right leading-tight md:flex md:flex-col"
          >
            <span
              class="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-base-content/50"
              >Trellis link</span
            >
            <span class="text-sm font-semibold"
              >{isConnected ? "Live session" : "Auth required"}</span
            >
          </div>
          <span
            class={{
              "badge badge-outline gap-2 py-3 font-semibold uppercase tracking-[0.14em]": true,
              "badge-success": isConnected,
              "badge-warning": !isConnected,
            }}
          >
            <span class="size-2 rounded-full bg-current"></span>
            {status.phase}
          </span>
          {#if isConnected}
            <span
              class="btn btn-sm btn-disabled"
              aria-label="Signed in and connected">Signed in</span
            >
          {:else}
            <a class="btn btn-sm btn-primary" href={resolve("/dashboard")}
              >Sign in</a
            >
          {/if}
        </div>
      </div>
    </header>

    <div class="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)_19rem]">
      <aside
        class="card h-fit border border-base-300/70 bg-base-100/88 shadow-lg shadow-base-300/15 backdrop-blur lg:sticky lg:top-4"
      >
        <div class="card-body gap-4 p-4">
          <div class="space-y-1 border-b border-base-300/70 pb-3">
            <p
              class="text-[0.65rem] font-bold uppercase tracking-[0.24em] text-primary"
            >
              Workflow nav
            </p>
            <h1 class="text-lg font-black tracking-tight">Inspection lanes</h1>
          </div>

          <nav aria-label="Field inspection workflow">
            <ul class="menu gap-1 rounded-box bg-base-200/55 p-1">
              {#each workflowNav as item (item.href)}
                <li>
                  <a
                    href={item.href}
                    class={{ "menu-active": currentPath === item.href }}
                    aria-current={currentPath === item.href
                      ? "page"
                      : undefined}
                  >
                    <span class="flex flex-col gap-0.5">
                      <span class="font-semibold">{item.label}</span>
                      <span
                        class="text-[0.65rem] uppercase tracking-[0.18em] opacity-60"
                        >{item.eyebrow}</span
                      >
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
          </nav>

          <div
            class="rounded-box border border-dashed border-primary/35 bg-primary/5 p-3 text-xs leading-5 text-base-content/70"
          >
            <span class="font-bold text-primary">Powered by Trellis:</span>
            RPC, operations, events, transfer, and state appear as surfaces inside
            the inspection workflow.
          </div>
        </div>
      </aside>

      <main class="min-w-0 pb-8">
        {@render children()}
      </main>

      <aside class="hidden h-fit lg:sticky lg:top-4 lg:block">
        <div
          class="card border border-base-300/70 bg-base-100/88 shadow-lg shadow-base-300/15 backdrop-blur"
        >
          <div class="card-body gap-4 p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p
                  class="text-[0.65rem] font-bold uppercase tracking-[0.24em] text-primary"
                >
                  Active inspection
                </p>
                <h2 class="text-xl font-black tracking-tight">
                  {activeInspection.id}
                </h2>
              </div>
              <span class="badge badge-warning badge-outline"
                >{activeInspection.phase}</span
              >
            </div>

            <div class="rounded-box bg-base-200/70 p-3">
              <p class="font-semibold">{activeInspection.site}</p>
              <p class="text-sm text-base-content/65">
                {activeInspection.address}
              </p>
            </div>

            <dl class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt
                  class="text-xs uppercase tracking-[0.16em] text-base-content/50"
                >
                  Crew
                </dt>
                <dd class="font-semibold">{activeInspection.crew}</dd>
              </div>
              <div>
                <dt
                  class="text-xs uppercase tracking-[0.16em] text-base-content/50"
                >
                  Window
                </dt>
                <dd class="font-semibold">{activeInspection.window}</dd>
              </div>
            </dl>

            <div class="space-y-2">
              <div class="flex items-center justify-between text-sm">
                <span class="font-semibold">Closeout readiness</span>
                <span>{activeInspection.progress}%</span>
              </div>
              <progress
                class="progress progress-primary h-2 w-full"
                value={activeInspection.progress}
                max="100"
              ></progress>
            </div>

            <ul class="space-y-3">
              {#each checkpoints as checkpoint (checkpoint.label)}
                <li class="flex items-center gap-3 text-sm">
                  <span
                    class={["size-2 rounded-full bg-current", checkpoint.tone]}
                  ></span>
                  <span>{checkpoint.label}</span>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  </div>
</section>
